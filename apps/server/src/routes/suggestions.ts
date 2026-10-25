import { type PastDecision, SUGGEST_LOOKBACK_DAYS, suggestRules } from "@synapse/core";
import { PgRunStore, schema } from "@synapse/db";
import { and, desc, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { type AppEnv, apiError } from "../http";

type Ctx = { var: AppEnv["Variables"] };

/** Learned rules: offer an allow rule for actions the user keeps approving unchanged. */
export const suggestions = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { suggestions } = await load(c);
    return c.json({ suggestions });
  })
  .post("/:id/accept", async (c) => {
    const { suggestions, store } = await load(c);
    const s = suggestions.find((x) => x.id === c.req.param("id"));
    if (!s) apiError(404, "not_found", "Suggestion not found.");
    const { db } = c.var.services.database;
    const userId = c.var.user.id;
    // First among allow/ask rules so it takes effect; block rules still win regardless.
    await db.transaction(async (tx) => {
      await tx
        .update(schema.policyRules)
        .set({ position: sql`${schema.policyRules.position} + 1` })
        .where(eq(schema.policyRules.userId, userId));
      await tx.insert(schema.policyRules).values({
        userId,
        position: 0,
        tool: s.tool,
        decision: "allow",
        when: s.when.length > 0 ? s.when : null,
        note: s.note,
      });
    });
    return c.json(await store.getPolicy(userId));
  })
  .post("/:id/dismiss", async (c) => {
    const id = c.req.param("id");
    const { suggestions, dismissed } = await load(c);
    if (!suggestions.some((x) => x.id === id) && !dismissed.includes(id))
      apiError(404, "not_found", "Suggestion not found.");
    // Keep the list bounded; the oldest dismissals fall off first.
    const next = [...dismissed.filter((d) => d !== id), id].slice(-200);
    await c.var.services.database.db
      .insert(schema.userSettings)
      .values({ userId: c.var.user.id, dismissedSuggestions: next })
      .onConflictDoUpdate({
        target: schema.userSettings.userId,
        set: { dismissedSuggestions: next },
      });
    return c.body(null, 204);
  });

async function load(c: Ctx) {
  const { db } = c.var.services.database;
  const userId = c.var.user.id;
  const since = new Date(Date.now() - SUGGEST_LOOKBACK_DAYS * 24 * 3600_000);
  const rows = await db
    .select({
      tool: schema.toolCalls.name,
      effect: schema.toolCalls.effect,
      input: schema.toolCalls.input,
      inputEdited: schema.toolCalls.inputEdited,
      status: schema.toolCalls.status,
      decidedAt: schema.toolCalls.decidedAt,
      preview: schema.toolCalls.preview,
    })
    .from(schema.toolCalls)
    .where(
      and(
        eq(schema.toolCalls.userId, userId),
        // Human decisions only; auto-allowed calls carry no decider.
        eq(schema.toolCalls.decidedBy, userId),
        isNotNull(schema.toolCalls.decidedAt),
        gte(schema.toolCalls.decidedAt, since),
        ne(schema.toolCalls.effect, "read"),
      ),
    )
    .orderBy(desc(schema.toolCalls.decidedAt))
    .limit(2000);
  const decisions: PastDecision[] = rows.map((r) => ({
    tool: r.tool,
    effect: r.effect,
    input: r.input,
    inputEdited: r.inputEdited,
    approved: r.status !== "denied",
    decidedAt: r.decidedAt!,
    preview: r.preview,
  }));
  const store = new PgRunStore(db);
  const policy = await store.getPolicy(userId);
  const [settings] = await db
    .select({ dismissed: schema.userSettings.dismissedSuggestions })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId));
  const dismissed = settings?.dismissed ?? [];
  return { suggestions: suggestRules(decisions, policy.rules, dismissed), dismissed, store };
}
