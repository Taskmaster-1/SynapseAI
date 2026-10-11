import type {
  ArgMatcher,
  Decision,
  Effect,
  PolicyDefaults,
  RunStatus,
  ToolCallStatus,
  ToolOutput,
} from "@synapse/core";
import type { JSONValue, ModelMessage } from "ai";
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

// ── Auth (Better Auth core schema) ─────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── Settings ───────────────────────────────────────────────────────────────

export interface ModelSettings {
  /** Ordered fallback chain of "provider:model-id". Empty means server default. */
  chain: string[];
  summary?: string;
}

export interface Budgets {
  perRunUsd: number;
  perDayUsd: number;
}

export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  policyDefaults: jsonb("policy_defaults").$type<PolicyDefaults>(),
  models: jsonb("models").$type<ModelSettings>(),
  budgets: jsonb("budgets").$type<Budgets>(),
  /** Bring-your-own provider keys, encrypted with the server secret. */
  providerKeys: jsonb("provider_keys").$type<Record<string, string>>(),
  instructions: text("instructions"),
  updatedAt: updatedAt(),
});

export const policyRules = pgTable(
  "policy_rules",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    tool: text("tool").notNull(),
    decision: text("decision").$type<Decision>().notNull(),
    when: jsonb("when").$type<ArgMatcher[]>(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("policy_rules_user_idx").on(t.userId, t.position)],
);

// ── Chats, runs, messages ─────────────────────────────────────────────────

export const chats = pgTable(
  "chats",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("chats_user_updated_idx").on(t.userId, t.updatedAt)],
);

export const runs = pgTable(
  "runs",
  {
    id: id(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").$type<RunStatus>().notNull().default("queued"),
    trigger: text("trigger").notNull().default("chat"),
    tainted: boolean("tainted").notNull().default(false),
    steps: integer("steps").notNull().default(0),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    error: text("error"),
    cancelRequested: text("cancel_requested").$type<"now" | "after_step">(),
    /** Worker lease. A run with an expired lease is picked up again by another worker. */
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("runs_chat_idx").on(t.chatId, t.createdAt),
    index("runs_user_idx").on(t.userId, t.createdAt),
    index("runs_claimable_idx")
      .on(t.status, t.leaseExpiresAt)
      .where(sql`status in ('queued', 'running')`),
    // One active run per chat; new messages queue as pending inputs instead.
    uniqueIndex("runs_one_active_per_chat")
      .on(t.chatId)
      .where(sql`status in ('queued', 'running', 'waiting')`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    model: text("model"),
    kind: text("kind").$type<"message" | "handover">().notNull().default("message"),
    cutoffSeq: integer("cutoff_seq"),
    message: jsonb("message").$type<ModelMessage>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_chat_seq_idx").on(t.chatId, t.seq)],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /** The model's tool call id; unique within a run. */
    id: text("id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    name: text("name").notNull(),
    input: jsonb("input").$type<JSONValue>().notNull(),
    inputEdited: boolean("input_edited").notNull().default(false),
    effect: text("effect").$type<Effect>().notNull(),
    status: text("status").$type<ToolCallStatus>().notNull(),
    decision: text("decision").$type<Decision>().notNull(),
    decisionReason: text("decision_reason"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    output: jsonb("output").$type<ToolOutput>(),
    fullOutput: jsonb("full_output").$type<ToolOutput>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.id] }),
    index("tool_calls_awaiting_idx")
      .on(t.userId, t.createdAt)
      .where(sql`status = 'awaiting_approval'`),
  ],
);

/** Ordered, replayable event log per run. Clients resume with the last seq they saw. */
export const runEvents = pgTable(
  "run_events",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    event: jsonb("event").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
);

/** User messages sent while a run is active; drained at the next step boundary. */
export const pendingInputs = pgTable(
  "pending_inputs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("pending_inputs_chat_idx").on(t.chatId, t.id)],
);

// ── Integrations ───────────────────────────────────────────────────────────

export interface ConnectionAuth {
  type: "none" | "bearer" | "oauth";
  /** Encrypted secret material (token JSON). */
  secret?: string;
  /** OAuth client information and PKCE verifier during the flow, encrypted. */
  oauthState?: string;
}

export const connections = pgTable(
  "connections",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    status: text("status").$type<"active" | "needs_auth" | "error" | "disabled">().notNull(),
    auth: jsonb("auth").$type<ConnectionAuth>().notNull(),
    /** Per-tool effect overrides; undeclared tools default to "write". */
    toolEffects: jsonb("tool_effects").$type<Record<string, Effect>>().notNull().default({}),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("connections_user_name_idx").on(t.userId, t.name)],
);

// ── Knowledge & memory ─────────────────────────────────────────────────────

export const memories = pgTable(
  "memories",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    source: text("source").$type<"user" | "agent">().notNull().default("user"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("memories_user_idx").on(t.userId)],
);

export const EMBEDDING_DIMENSIONS = 1536;

export const documents = pgTable(
  "documents",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    bytes: integer("bytes").notNull(),
    status: text("status")
      .$type<"processing" | "ready" | "error">()
      .notNull()
      .default("processing"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("documents_user_idx").on(t.userId, t.createdAt)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    content: text("content").notNull(),
    /** Short document-level context prepended before embedding (contextual retrieval). */
    context: text("context"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('english', coalesce(context, '') || ' ' || content)`),
  },
  (t) => [
    index("chunks_user_idx").on(t.userId),
    index("chunks_tsv_idx").using("gin", t.tsv),
    index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

// ── Automations ────────────────────────────────────────────────────────────

/** A prompt that runs on a schedule in its own chat. Approvals land in the inbox. */
export const automations = pgTable(
  "automations",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    /** Five-field cron expression, evaluated in `timezone`. */
    schedule: text("schedule").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    enabled: boolean("enabled").notNull().default(true),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("automations_user_idx").on(t.userId),
    index("automations_due_idx").on(t.nextRunAt).where(sql`enabled`),
  ],
);
