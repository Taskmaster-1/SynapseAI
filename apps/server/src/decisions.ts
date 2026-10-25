import { evaluatePolicy, type RunEvent, UNDO_DENIAL } from "@synapse/core";
import { decideToolCalls, PgRunStore, schema, undoToolCall } from "@synapse/db";
import type { JSONValue } from "ai";
import { and, eq } from "drizzle-orm";
import type { DecisionSource } from "./notify/types";
import type { Services } from "./services";

export class DecisionInputError extends Error {
  constructor(
    readonly status: 400 | 404 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Decision {
  toolCallId: string;
  approved: boolean;
  reason?: string;
  /** Approve with this input instead of the agent's. */
  input?: JSONValue;
}

/**
 * Applies a person's decisions on one run's awaiting calls, wherever they were made (web,
 * phone, Slack). All or nothing; then tells live viewers, wakes the run (or parks it until
 * an undo window ends) and lets notification channels update what they showed.
 */
export async function decide(
  services: Services,
  args: { userId: string; runId: string; decisions: Decision[]; via: DecisionSource },
): Promise<{ executeAfter: Record<string, string> }> {
  const { userId, runId, decisions, via } = args;
  if (new Set(decisions.map((d) => d.toolCallId)).size !== decisions.length)
    throw new DecisionInputError(400, "duplicate", "Each action can be decided once.");
  for (const d of decisions)
    if (d.approved && d.input !== undefined)
      await assertEditAllowed(services, userId, runId, d.toolCallId, d.input);

  const decided = await decideToolCalls(services.database.db, {
    userId,
    runId,
    decisions: decisions.map((d) => ({
      toolCallId: d.toolCallId,
      approved: d.approved,
      ...(d.reason ? { reason: d.reason } : {}),
      ...(d.approved && d.input !== undefined ? { editedInput: d.input } : {}),
    })),
    via,
  });
  for (const [toolCallId, at] of Object.entries(decided.executeAfter))
    await emitNow(services, runId, {
      type: "tool.status",
      toolCallId,
      status: "approved",
      executeAfter: at.toISOString(),
    });
  if (decided.requeued && decided.runnableAt) {
    // Parked until the undo window ends: it is queued, not waiting on anyone.
    await emitNow(services, runId, { type: "run.status", status: "queued" });
    wakeAt(services, runId, decided.runnableAt);
  } else await services.wake(runId);

  await services.notifier.resolved(
    decisions.map((d) => ({
      userId,
      runId,
      toolCallId: d.toolCallId,
      approved: d.approved,
      via,
      executeAfter: decided.executeAfter[d.toolCallId] ?? null,
    })),
  );
  return {
    executeAfter: Object.fromEntries(
      Object.entries(decided.executeAfter).map(([id, at]) => [id, at.toISOString()]),
    ),
  };
}

/** Takes back an approved send or delete while its undo window is open. */
export async function undo(
  services: Services,
  args: { userId: string; runId: string; toolCallId: string },
) {
  await undoToolCall(services.database.db, args);
  const output = { type: "denied" as const, reason: UNDO_DENIAL };
  await emitNow(services, args.runId, {
    type: "tool.status",
    toolCallId: args.toolCallId,
    status: "denied",
  });
  await emitNow(services, args.runId, { type: "tool.result", toolCallId: args.toolCallId, output });
  await services.wake(args.runId);
}

/** An edited input must not turn an allowed action into one the user's rules block. */
async function assertEditAllowed(
  services: Services,
  userId: string,
  runId: string,
  toolCallId: string,
  input: JSONValue,
) {
  const { db } = services.database;
  const [call] = await db
    .select({ name: schema.toolCalls.name, effect: schema.toolCalls.effect })
    .from(schema.toolCalls)
    .where(
      and(
        eq(schema.toolCalls.runId, runId),
        eq(schema.toolCalls.id, toolCallId),
        eq(schema.toolCalls.userId, userId),
      ),
    );
  if (!call) throw new DecisionInputError(404, "not_found", "Action not found.");
  const policy = await new PgRunStore(db).getPolicy(userId);
  const verdict = evaluatePolicy(
    { tool: call.name, effect: call.effect, input, tainted: true },
    policy.rules,
    policy.defaults,
  );
  if (verdict.decision === "block")
    throw new DecisionInputError(422, "blocked", `The edited action is blocked: ${verdict.reason}`);
}

export async function emitNow(services: Services, runId: string, event: RunEvent) {
  await services.events.emit(runId, event);
  services.events.forget(runId);
}

function wakeAt(services: Services, runId: string, at: Date) {
  const timer = setTimeout(
    () => void services.wake(runId).catch(() => {}),
    Math.max(0, at.getTime() - Date.now()) + 25,
  );
  timer.unref?.();
}
