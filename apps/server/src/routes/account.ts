import { unsafePatternReason } from "@synapse/core";
import { schema } from "@synapse/db";
import { ingestDocument, searchKnowledge } from "@synapse/tools";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, apiError, body } from "../http";

const Decision = z.enum(["allow", "ask", "block"]);
const Matcher = z.discriminatedUnion("op", [
  z.object({ path: z.string().min(1), op: z.literal("equals"), value: z.json() }),
  z.object({ path: z.string().min(1), op: z.literal("in"), value: z.array(z.json()) }),
  z.object({ path: z.string().min(1), op: z.literal("allEndWith"), value: z.array(z.string()) }),
  z.object({ path: z.string().min(1), op: z.literal("matches"), value: z.string().max(500) }),
]);
const Defaults = z.object({
  read: Decision,
  write: Decision,
  send: Decision,
  destructive: Decision,
});
const Rule = z.object({
  id: z.string().optional(),
  tool: z.string().min(1).max(128),
  decision: Decision,
  when: z.array(Matcher).max(10).optional(),
  note: z.string().max(300).optional(),
});

// ── Policy ─────────────────────────────────────────────────────────────────

export const policy = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await loadPolicy(c.var.services.database.db, c.var.user.id)))
  .put("/", async (c) => {
    const input = await body(c, z.object({ defaults: Defaults, rules: z.array(Rule).max(200) }));
    for (const rule of input.rules) {
      for (const m of rule.when ?? []) {
        const problem = m.op === "matches" ? unsafePatternReason(m.value) : null;
        if (problem) apiError(422, "invalid_pattern", `Rule for ${rule.tool}: ${problem}`);
      }
    }
    const { db } = c.var.services.database;
    const userId = c.var.user.id;
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.userSettings)
        .values({ userId, policyDefaults: input.defaults })
        .onConflictDoUpdate({
          target: schema.userSettings.userId,
          set: { policyDefaults: input.defaults },
        });
      await tx.delete(schema.policyRules).where(eq(schema.policyRules.userId, userId));
      if (input.rules.length > 0) {
        await tx.insert(schema.policyRules).values(
          input.rules.map((r, position) => ({
            userId,
            position,
            tool: r.tool,
            decision: r.decision,
            when: r.when ?? null,
            note: r.note ?? null,
          })),
        );
      }
    });
    return c.json(await loadPolicy(db, userId));
  });

async function loadPolicy(db: AppEnv["Variables"]["services"]["database"]["db"], userId: string) {
  const [settings] = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId));
  const rules = await db
    .select()
    .from(schema.policyRules)
    .where(eq(schema.policyRules.userId, userId))
    .orderBy(asc(schema.policyRules.position));
  return {
    defaults: {
      read: "allow",
      write: "ask",
      send: "ask",
      destructive: "ask",
      ...settings?.policyDefaults,
    },
    rules: rules.map((r) => ({
      id: r.id,
      tool: r.tool,
      decision: r.decision,
      ...(r.when ? { when: r.when } : {}),
      ...(r.note ? { note: r.note } : {}),
    })),
  };
}

// ── Memory ─────────────────────────────────────────────────────────────────

const MemoryContent = z.string().trim().min(1).max(500);

export const memories = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await c.var.services.database.db
      .select({
        id: schema.memories.id,
        content: schema.memories.content,
        source: schema.memories.source,
        createdAt: schema.memories.createdAt,
      })
      .from(schema.memories)
      .where(eq(schema.memories.userId, c.var.user.id))
      .orderBy(asc(schema.memories.createdAt));
    return c.json({ memories: rows });
  })
  .post("/", async (c) => {
    const { content } = await body(c, z.object({ content: MemoryContent }));
    const [memory] = await c.var.services.database.db
      .insert(schema.memories)
      .values({ userId: c.var.user.id, content, source: "user" })
      .returning();
    return c.json({ memory }, 201);
  })
  .patch("/:id", async (c) => {
    const { content } = await body(c, z.object({ content: MemoryContent }));
    const [memory] = await c.var.services.database.db
      .update(schema.memories)
      .set({ content })
      .where(
        and(eq(schema.memories.id, c.req.param("id")), eq(schema.memories.userId, c.var.user.id)),
      )
      .returning();
    if (!memory) apiError(404, "not_found", "Note not found.");
    return c.json({ memory });
  })
  .delete("/:id", async (c) => {
    await c.var.services.database.db
      .delete(schema.memories)
      .where(
        and(eq(schema.memories.id, c.req.param("id")), eq(schema.memories.userId, c.var.user.id)),
      );
    return c.body(null, 204);
  });

// ── Documents ──────────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const TEXT_TYPES = /^(text\/|application\/(json|xml|x-ndjson|csv))/;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|ndjson|xml|html?|ya?ml|log|rst)$/i;

export const documents = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await c.var.services.database.db
      .select({
        id: schema.documents.id,
        name: schema.documents.name,
        mimeType: schema.documents.mimeType,
        bytes: schema.documents.bytes,
        status: schema.documents.status,
        error: schema.documents.error,
        createdAt: schema.documents.createdAt,
      })
      .from(schema.documents)
      .where(eq(schema.documents.userId, c.var.user.id))
      .orderBy(desc(schema.documents.createdAt));
    return c.json({ documents: rows });
  })
  .get("/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (!q) return c.json({ results: [] });
    const { toolset } = c.var.services;
    const results = await searchKnowledge(toolset.db, toolset.embedder, c.var.user.id, q, 10);
    return c.json({ results });
  })
  .post("/", async (c) => {
    const form = await c.req
      .formData()
      .catch(() => apiError(400, "invalid_form", "Expected multipart form data."));
    const file = form.get("file");
    if (!(file instanceof File))
      apiError(422, "missing_file", "Attach a file in the `file` field.");
    if (file.size > MAX_UPLOAD_BYTES)
      apiError(413, "too_large", "Files up to 10 MB are supported.");
    if (!TEXT_TYPES.test(file.type) && !TEXT_EXTENSIONS.test(file.name)) {
      apiError(422, "unsupported_type", "Upload text, Markdown, CSV, JSON or HTML files.");
    }
    let text = await file.text();
    if (/html?$/i.test(file.name) || file.type.includes("html")) {
      const { htmlToText } = await import("@synapse/tools");
      text = htmlToText(text);
    }
    const { toolset } = c.var.services;
    const id = await ingestDocument(toolset.db, toolset.embedder, {
      userId: c.var.user.id,
      name: file.name,
      mimeType: file.type || "text/plain",
      text,
    }).catch((e) =>
      apiError(500, "ingest_failed", e instanceof Error ? e.message : "Could not process file."),
    );
    const [document] = await toolset.db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    return c.json({ document }, 201);
  })
  .delete("/:id", async (c) => {
    await c.var.services.database.db
      .delete(schema.documents)
      .where(
        and(eq(schema.documents.id, c.req.param("id")), eq(schema.documents.userId, c.var.user.id)),
      );
    return c.body(null, 204);
  });

// ── Settings & usage ───────────────────────────────────────────────────────

const PROVIDERS = ["anthropic", "openai", "google"] as const;

export const settings = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await loadSettings(c)))
  .put("/", async (c) => {
    const input = await body(
      c,
      z.object({
        instructions: z.string().max(4000).nullable().optional(),
        models: z.object({ chain: z.array(z.string().regex(/^[a-z-]+:.+$/)).max(5) }).optional(),
        budgets: z
          .object({
            perRunUsd: z.number().min(0).max(1000),
            perDayUsd: z.number().min(0).max(10_000),
          })
          .optional(),
        providerKeys: z
          .partialRecord(z.enum(PROVIDERS), z.string().min(8).max(400).nullable())
          .optional(),
      }),
    );
    const { db } = c.var.services.database;
    const userId = c.var.user.id;
    const [current] = await db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId));
    const keys = { ...current?.providerKeys };
    for (const [provider, value] of Object.entries(input.providerKeys ?? {})) {
      if (value === null) delete keys[provider];
      else keys[provider] = await c.var.services.box.seal(value);
    }
    const patch = {
      ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
      ...(input.models ? { models: input.models } : {}),
      ...(input.budgets ? { budgets: input.budgets } : {}),
      providerKeys: keys,
    };
    await db
      .insert(schema.userSettings)
      .values({ userId, ...patch })
      .onConflictDoUpdate({ target: schema.userSettings.userId, set: patch });
    return c.json(await loadSettings(c));
  });

async function loadSettings(c: { var: AppEnv["Variables"] }) {
  const { config, database } = c.var.services;
  const [s] = await database.db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, c.var.user.id));
  return {
    instructions: s?.instructions ?? null,
    models: { chain: s?.models?.chain ?? [], defaultChain: config.SYNAPSE_MODELS },
    budgets: s?.budgets ?? {
      perRunUsd: config.RUN_MAX_COST_USD,
      perDayUsd: config.DAY_MAX_COST_USD,
    },
    providerKeys: Object.fromEntries(PROVIDERS.map((p) => [p, Boolean(s?.providerKeys?.[p])])),
  };
}

export const usage = new Hono<AppEnv>().get("/", async (c) => {
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 3600_000);
  const rows = await c.var.services.database.db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${schema.runs.createdAt}), 'YYYY-MM-DD')`,
      costUsd: sql<number>`sum(${schema.runs.costUsd})::float`,
      runs: sql<number>`count(*)::int`,
      inputTokens: sql<number>`sum(${schema.runs.inputTokens})::int`,
      outputTokens: sql<number>`sum(${schema.runs.outputTokens})::int`,
    })
    .from(schema.runs)
    .where(and(eq(schema.runs.userId, c.var.user.id), gte(schema.runs.createdAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return c.json({ days: rows });
});
