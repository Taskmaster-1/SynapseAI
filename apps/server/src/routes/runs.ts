import { evaluatePolicy } from "@synapse/core";
import {
  decideToolCall,
  decideToolCalls,
  PgRunStore,
  readEvents,
  requestCancel,
  schema,
} from "@synapse/db";
import type { JSONValue } from "ai";
import { and, asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { type AppEnv, apiError, body } from "../http";

const PAUSE_OR_END = new Set(["waiting", "completed", "failed", "cancelled"]);
const EVENT_PAGE = 1000;

export const runs = new Hono<AppEnv>()
  .get("/", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
    const rows = await c.var.services.database.db
      .select({
        id: schema.runs.id,
        chatId: schema.runs.chatId,
        chatTitle: schema.chats.title,
        status: schema.runs.status,
        trigger: schema.runs.trigger,
        model: schema.runs.model,
        steps: schema.runs.steps,
        inputTokens: schema.runs.inputTokens,
        outputTokens: schema.runs.outputTokens,
        costUsd: schema.runs.costUsd,
        error: schema.runs.error,
        createdAt: schema.runs.createdAt,
        finishedAt: schema.runs.finishedAt,
      })
      .from(schema.runs)
      .innerJoin(schema.chats, eq(schema.chats.id, schema.runs.chatId))
      .where(eq(schema.runs.userId, c.var.user.id))
      .orderBy(desc(schema.runs.createdAt))
      .limit(limit);
    return c.json({ runs: rows });
  })

  .get("/:id", async (c) => {
    const { db } = c.var.services.database;
    const run = await ownRun(c, c.req.param("id"));
    const toolCalls = await db
      .select({
        id: schema.toolCalls.id,
        name: schema.toolCalls.name,
        effect: schema.toolCalls.effect,
        status: schema.toolCalls.status,
        decision: schema.toolCalls.decision,
        decisionReason: schema.toolCalls.decisionReason,
        input: schema.toolCalls.input,
        inputEdited: schema.toolCalls.inputEdited,
        output: schema.toolCalls.output,
        decidedBy: schema.toolCalls.decidedBy,
        decidedAt: schema.toolCalls.decidedAt,
        createdAt: schema.toolCalls.createdAt,
      })
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.runId, run.id))
      .orderBy(asc(schema.toolCalls.createdAt));
    const { leaseOwner: _l, leaseExpiresAt: _e, ...publicRun } = run;
    return c.json({ run: publicRun, toolCalls });
  })

  .get("/:id/events", async (c) => {
    const { database, bus } = c.var.services;
    const run = await ownRun(c, c.req.param("id"));
    const fromHeader = Number(c.req.header("last-event-id"));
    const fromQuery = Number(c.req.query("after"));
    let lastSeq =
      Number.isFinite(fromHeader) && fromHeader > 0
        ? fromHeader
        : Number.isFinite(fromQuery)
          ? fromQuery
          : 0;

    c.header("x-accel-buffering", "no");
    return streamSSE(c, async (stream) => {
      let wake: (() => void) | null = null;
      let pending = true; // read once immediately
      const unsubscribe = bus.subscribe(run.id, () => {
        pending = true;
        wake?.();
      });
      const ping = setInterval(() => void stream.write(": ping\n\n"), 15_000);
      stream.onAbort(() => {
        unsubscribe();
        clearInterval(ping);
        wake?.();
      });

      try {
        while (!stream.aborted) {
          if (!pending) {
            await new Promise<void>((resolve) => {
              wake = resolve;
              // Safety net in case a notification is missed.
              setTimeout(resolve, 10_000);
            });
            wake = null;
          }
          pending = false;
          const events = await readEvents(database, run.id, lastSeq);
          let done = false;
          for (const e of events) {
            await stream.writeSSE({ id: String(e.seq), data: JSON.stringify(e) });
            lastSeq = e.seq;
            // Only the latest status counts: a run can pause, be approved and resume.
            if (e.type === "run.status") done = PAUSE_OR_END.has(e.status);
          }
          if (events.length === EVENT_PAGE) {
            pending = true;
            continue;
          }
          if (done) break;
          if (events.length === 0) {
            const [current] = await database.db
              .select({ status: schema.runs.status })
              .from(schema.runs)
              .where(eq(schema.runs.id, run.id));
            // A paused or finished run whose events the client already has: close.
            if (current && PAUSE_OR_END.has(current.status)) break;
          }
        }
      } finally {
        unsubscribe();
        clearInterval(ping);
      }
    });
  })

  .post("/:id/tool-calls/:toolCallId/decision", async (c) => {
    const input = await body(
      c,
      z.object({
        approved: z.boolean(),
        reason: z.string().max(1000).optional(),
        input: z.json().optional(),
      }),
    );
    const runId = c.req.param("id");
    if (input.approved && input.input !== undefined)
      await assertEditAllowed(c, runId, c.req.param("toolCallId"), input.input);
    await decideToolCall(c.var.services.database.db, {
      userId: c.var.user.id,
      runId,
      toolCallId: c.req.param("toolCallId"),
      approved: input.approved,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.input !== undefined ? { editedInput: input.input } : {}),
    });
    await c.var.services.wake(runId);
    return c.body(null, 204);
  })

  // Several calls from one run decided at once (the grouped checklist). All or nothing.
  .post("/:id/tool-calls/decisions", async (c) => {
    const { decisions } = await body(
      c,
      z.object({
        decisions: z
          .array(
            z.object({
              toolCallId: z.string().min(1),
              approved: z.boolean(),
              reason: z.string().max(1000).optional(),
              editedInput: z.json().optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
    );
    const runId = c.req.param("id");
    if (new Set(decisions.map((d) => d.toolCallId)).size !== decisions.length)
      apiError(400, "duplicate", "Each action can be decided once.");
    for (const d of decisions)
      if (d.approved && d.editedInput !== undefined)
        await assertEditAllowed(c, runId, d.toolCallId, d.editedInput);
    await decideToolCalls(c.var.services.database.db, {
      userId: c.var.user.id,
      runId,
      decisions: decisions.map((d) => ({
        toolCallId: d.toolCallId,
        approved: d.approved,
        ...(d.reason ? { reason: d.reason } : {}),
        ...(d.approved && d.editedInput !== undefined ? { editedInput: d.editedInput } : {}),
      })),
    });
    await c.var.services.wake(runId);
    return c.body(null, 204);
  })

  .post("/:id/cancel", async (c) => {
    const { mode } = await body(
      c,
      z.object({ mode: z.enum(["now", "after_step"]).default("now") }),
    );
    const runId = c.req.param("id");
    await requestCancel(c.var.services.database.db, { userId: c.var.user.id, runId, mode });
    await c.var.services.wake(runId);
    return c.body(null, 204);
  });

export const approvals = new Hono<AppEnv>().get("/", async (c) => {
  const rows = await c.var.services.database.db
    .select({
      runId: schema.toolCalls.runId,
      chatId: schema.runs.chatId,
      chatTitle: schema.chats.title,
      toolCallId: schema.toolCalls.id,
      name: schema.toolCalls.name,
      effect: schema.toolCalls.effect,
      input: schema.toolCalls.input,
      reason: schema.toolCalls.decisionReason,
      preview: schema.toolCalls.preview,
      createdAt: schema.toolCalls.createdAt,
    })
    .from(schema.toolCalls)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.toolCalls.runId))
    .innerJoin(schema.chats, eq(schema.chats.id, schema.runs.chatId))
    .where(
      and(
        eq(schema.toolCalls.userId, c.var.user.id),
        eq(schema.toolCalls.status, "awaiting_approval"),
      ),
    )
    .orderBy(desc(schema.toolCalls.createdAt));
  return c.json({ approvals: rows });
});

/** Edited arguments are re-checked against block rules: editing must not route around them. */
async function assertEditAllowed(
  c: { var: AppEnv["Variables"] },
  runId: string,
  toolCallId: string,
  input: JSONValue,
) {
  const { db } = c.var.services.database;
  const [call] = await db
    .select({ name: schema.toolCalls.name, effect: schema.toolCalls.effect })
    .from(schema.toolCalls)
    .where(
      and(
        eq(schema.toolCalls.runId, runId),
        eq(schema.toolCalls.id, toolCallId),
        eq(schema.toolCalls.userId, c.var.user.id),
      ),
    );
  if (!call) apiError(404, "not_found", "Action not found.");
  const policy = await new PgRunStore(db).getPolicy(c.var.user.id);
  const verdict = evaluatePolicy(
    { tool: call.name, effect: call.effect, input, tainted: true },
    policy.rules,
    policy.defaults,
  );
  if (verdict.decision === "block")
    apiError(422, "blocked", `The edited action is blocked: ${verdict.reason}`);
}

async function ownRun(c: { var: AppEnv["Variables"] }, id: string) {
  const [run] = await c.var.services.database.db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.id, id), eq(schema.runs.userId, c.var.user.id)));
  if (!run) apiError(404, "not_found", "Run not found.");
  return run;
}
