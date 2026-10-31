import { timingSafeEqual } from "node:crypto";
import {
  nextRun,
  planSchedule,
  schema,
  sendMessage,
  startTriggeredTask,
  validateSchedule,
} from "@synapse/db";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, apiError, body } from "../http";
import type { Services } from "../services";
import { TEMPLATE_CATEGORIES, TEMPLATES, type TemplateRequirement } from "../templates";
import { webhookTaskMessage } from "../triggers";

const Trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule") }),
  z.object({ type: z.literal("gmail"), query: z.string().trim().max(500).default("") }),
  z.object({ type: z.literal("webhook") }),
]);

const Fields = z.object({
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(4000),
  trigger: Trigger,
  schedule: z.string().trim().max(100),
  timezone: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
  /** One-off schedules: fire once at this time (ISO with offset) instead of on `schedule`. */
  runAt: z.iso.datetime({ offset: true }).nullable(),
  /** `reminder` only notifies; `task` runs the prompt. */
  kind: z.enum(["task", "reminder"]),
});

export const Create = Fields.extend({
  trigger: Trigger.default({ type: "schedule" }),
  schedule: Fields.shape.schedule.default(""),
  timezone: Fields.shape.timezone.default("UTC"),
  enabled: Fields.shape.enabled.default(true),
  runAt: Fields.shape.runAt.default(null),
  kind: Fields.shape.kind.default("task"),
});

/** No defaults here: a field the client leaves out keeps its current value. */
const Update = Fields.partial().extend({ rotateWebhook: z.boolean().optional() });

type Row = typeof schema.automations.$inferSelect;

/** Fields that depend on the trigger: next fire or poll time, and the email cursor. */
async function triggerState(
  s: Services,
  userId: string,
  a: Pick<Row, "trigger" | "schedule" | "timezone" | "enabled" | "runAt">,
) {
  if (a.trigger.type === "schedule" && a.runAt) {
    if (!a.enabled) return { nextRunAt: null };
    const plan = planSchedule({ when: a.runAt.toISOString(), timezone: a.timezone });
    if (typeof plan === "string") apiError(422, "invalid_schedule", plan);
    return { nextRunAt: plan.nextRunAt };
  }
  if (a.trigger.type === "schedule") {
    const problem = validateSchedule(a.schedule, a.timezone);
    if (problem) apiError(422, "invalid_schedule", problem);
    return { nextRunAt: a.enabled ? nextRun(a.schedule, a.timezone) : null };
  }
  if (a.trigger.type === "gmail") {
    if (!s.config.google)
      apiError(422, "not_configured", "Email triggers need Google set up on this server.");
    const [google] = await s.database.db
      .select({ status: schema.integrations.status })
      .from(schema.integrations)
      .where(
        and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "google")),
      );
    if (google?.status !== "active")
      apiError(422, "google_not_connected", "Connect Google under Connections first.");
    return { nextRunAt: a.enabled ? new Date() : null };
  }
  return { nextRunAt: null };
}

async function publicRow(s: Services, row: Row) {
  const { webhookSecret, cursor: _cursor, ...rest } = row;
  return {
    ...rest,
    webhookUrl:
      row.trigger.type === "webhook" && webhookSecret
        ? `${s.config.PUBLIC_URL}/api/hooks/${row.id}/${await s.box.open(webhookSecret)}`
        : null,
  };
}

const newToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");

/** Which template requirements the user has connected: Google, or an active MCP server. */
async function connected(s: Services, userId: string): Promise<Set<TemplateRequirement>> {
  const { db } = s.database;
  const [google] = await db
    .select({ status: schema.integrations.status })
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "google")));
  const conns = await db
    .select({ name: schema.connections.name, url: schema.connections.url })
    .from(schema.connections)
    .where(and(eq(schema.connections.userId, userId), eq(schema.connections.status, "active")));
  const out = new Set<TemplateRequirement>();
  if (s.config.google && google?.status === "active") out.add("google");
  const [github] = await db
    .select({ status: schema.integrations.status })
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "github")));
  if (s.config.github && github?.status === "active") out.add("github");
  for (const key of ["github", "linear"] as const) {
    if (conns.some((c) => `${c.name} ${c.url}`.toLowerCase().includes(key))) out.add(key);
  }
  return out;
}

export const automations = new Hono<AppEnv>()
  .get("/templates", async (c) => {
    const s = c.var.services;
    const have = await connected(s, c.var.user.id);
    return c.json({
      categories: TEMPLATE_CATEGORIES,
      googleAvailable: Boolean(s.config.google),
      templates: TEMPLATES.map((t) => ({ ...t, missing: t.requires.filter((r) => !have.has(r)) })),
    });
  })

  .get("/", async (c) => {
    const s = c.var.services;
    const rows = await s.database.db
      .select()
      .from(schema.automations)
      .where(eq(schema.automations.userId, c.var.user.id))
      .orderBy(desc(schema.automations.createdAt));
    return c.json({ automations: await Promise.all(rows.map((r) => publicRow(s, r))) });
  })

  .post("/", async (c) => {
    const s = c.var.services;
    const { runAt: at, ...input } = await body(c, Create);
    const runAt = input.trigger.type === "schedule" && at ? new Date(at) : null;
    const state = await triggerState(s, c.var.user.id, { ...input, runAt });
    const webhookSecret = input.trigger.type === "webhook" ? await s.box.seal(newToken()) : null;
    const { db } = s.database;
    const automation = await db.transaction(async (tx) => {
      const [chat] = await tx
        .insert(schema.chats)
        .values({ userId: c.var.user.id, title: input.name })
        .returning({ id: schema.chats.id });
      const [row] = await tx
        .insert(schema.automations)
        .values({
          ...input,
          ...state,
          runAt,
          schedule: input.trigger.type === "schedule" && !runAt ? input.schedule : "",
          userId: c.var.user.id,
          chatId: chat!.id,
          webhookSecret,
          // Email triggers start from now: mail that is already there is not a new event.
          cursor: input.trigger.type === "gmail" ? { after: Date.now(), seen: [] } : null,
        })
        .returning();
      return row!;
    });
    return c.json({ automation: await publicRow(s, automation) }, 201);
  })

  .patch("/:id", async (c) => {
    const s = c.var.services;
    const input = await body(c, Update);
    const current = await own(c, c.req.param("id"));
    const { rotateWebhook, runAt: at, ...rest } = input;
    const changes = { ...rest, ...(at !== undefined ? { runAt: at ? new Date(at) : null } : {}) };
    const merged = { ...current, ...changes };
    if (merged.trigger.type !== "schedule") merged.runAt = null;
    const triggerChanged =
      changes.trigger !== undefined &&
      JSON.stringify(changes.trigger) !== JSON.stringify(current.trigger);
    const state = await triggerState(s, c.var.user.id, merged);
    const needsSecret =
      merged.trigger.type === "webhook" && (rotateWebhook || !current.webhookSecret);
    const [automation] = await s.database.db
      .update(schema.automations)
      .set({
        ...changes,
        ...state,
        runAt: merged.runAt,
        ...(merged.trigger.type === "schedule" && !merged.runAt ? {} : { schedule: "" }),
        ...(needsSecret ? { webhookSecret: await s.box.seal(newToken()) } : {}),
        ...(merged.trigger.type !== "webhook" ? { webhookSecret: null } : {}),
        ...(triggerChanged || (changes.enabled && !current.enabled)
          ? {
              cursor: merged.trigger.type === "gmail" ? { after: Date.now(), seen: [] } : null,
              lastError: null,
            }
          : {}),
      })
      .where(eq(schema.automations.id, current.id))
      .returning();
    return c.json({ automation: await publicRow(s, automation!) });
  })

  .delete("/:id", async (c) => {
    const current = await own(c, c.req.param("id"));
    await c.var.services.database.db
      .delete(schema.automations)
      .where(eq(schema.automations.id, current.id));
    return c.body(null, 204);
  })

  .post("/:id/run", async (c) => {
    const current = await own(c, c.req.param("id"));
    if (current.kind === "reminder")
      apiError(422, "reminder", "Reminders notify you at their time; there is nothing to run.");
    const sent = await sendMessage(c.var.services.database.db, {
      userId: c.var.user.id,
      chatId: current.chatId,
      content: `[Run now: ${current.name}]\n\n${current.prompt}`,
      trigger: "manual",
    });
    await c.var.services.wake(sent.runId);
    return c.json({ ...sent, chatId: current.chatId }, 202);
  });

async function own(c: { var: AppEnv["Variables"] }, id: string) {
  const [row] = await c.var.services.database.db
    .select()
    .from(schema.automations)
    .where(and(eq(schema.automations.id, id), eq(schema.automations.userId, c.var.user.id)));
  if (!row) apiError(404, "not_found", "Automation not found.");
  return row;
}

const MAX_WEBHOOK_BYTES = 256_000;
const WEBHOOKS_PER_HOUR = 60;
const recent = new Map<string, number[]>();

/** Per-automation sliding window, per instance. Stops a leaked URL from running up a bill. */
function allow(id: string, now = Date.now()): boolean {
  const hits = (recent.get(id) ?? []).filter((t) => now - t < 3600_000);
  if (hits.length >= WEBHOOKS_PER_HOUR) {
    recent.set(id, hits);
    return false;
  }
  hits.push(now);
  recent.set(id, hits);
  return true;
}

/**
 * Public webhook endpoint: POST /api/hooks/<automation id>/<token>. The token in the URL is
 * the credential (GitHub, Linear, Stripe, Zapier and curl can all send to a URL). Each
 * delivery starts its own task; the payload is treated as untrusted.
 */
export const hooks = new Hono<AppEnv>().post("/:id/:token", async (c) => {
  const s = c.var.services;
  const notFound = () => c.json({ error: { code: "not_found", message: "Unknown webhook." } }, 404);
  const [row] = await s.database.db
    .select()
    .from(schema.automations)
    .where(eq(schema.automations.id, c.req.param("id")));
  if (row?.trigger.type !== "webhook" || !row.webhookSecret) return notFound();
  const expected = Buffer.from(await s.box.open(row.webhookSecret));
  const given = Buffer.from(c.req.param("token"));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return notFound();
  if (!row.enabled)
    return c.json({ error: { code: "disabled", message: "This automation is paused." } }, 409);

  const length = Number(c.req.header("content-length") ?? 0);
  if (length > MAX_WEBHOOK_BYTES)
    return c.json({ error: { code: "too_large", message: "Payload too large." } }, 413);
  const raw = (await c.req.text()).slice(0, MAX_WEBHOOK_BYTES);
  if (!allow(row.id))
    return c.json(
      { error: { code: "rate_limited", message: `At most ${WEBHOOKS_PER_HOUR} per hour.` } },
      429,
    );

  const event =
    c.req.header("x-github-event") ??
    c.req.header("x-event-type") ??
    c.req.header("x-linear-event");
  const task = await startTriggeredTask(s.database.db, {
    userId: row.userId,
    title: `${row.name}${event ? `: ${event}` : ""}`,
    content: webhookTaskMessage(row, raw),
    trigger: "webhook",
  });
  await s.database.db
    .update(schema.automations)
    .set({ lastRunAt: new Date(), lastError: null })
    .where(eq(schema.automations.id, row.id));
  await s.wake(task.runId);
  return c.json({ ok: true, taskId: task.chatId }, 202);
});
