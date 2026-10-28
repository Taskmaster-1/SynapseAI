import type {
  ArgMatcher,
  Decision,
  Effect,
  PlanGrant,
  PolicyDefaults,
  RunStatus,
  SkillUse,
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
  /** Learned-rule suggestions the user said "not now" to, by suggestion id. */
  dismissedSuggestions: text("dismissed_suggestions").array().notNull().default([]),
  /** Seconds an approved send or destructive action waits, with an Undo, before it runs. 0 disables. */
  undoSeconds: integer("undo_seconds").notNull().default(10),
  /** Email the account address when something needs approval (needs SMTP configured). */
  emailAlerts: boolean("email_alerts").notNull().default(false),
  /** Built-in skills the user switched off, by name. Their own skills carry `enabled`. */
  disabledSkills: text("disabled_skills").array().notNull().default([]),
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

// ── Team workspaces ────────────────────────────────────────────────────────

export type WorkspaceRole = "owner" | "admin" | "member";

/**
 * A team. Its rules apply to every member on top of their own; tasks, connections and
 * memory stay personal.
 */
export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** One workspace per person for now. */
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_role_idx").on(t.workspaceId, t.role),
  ],
);

/** Invite links. Only a SHA-256 of the token is stored; the link is shown once. */
export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role").$type<Exclude<WorkspaceRole, "owner">>().notNull().default("member"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    usedBy: text("used_by").references(() => user.id, { onDelete: "set null" }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("workspace_invites_workspace_idx").on(t.workspaceId, t.createdAt)],
);

/** Team policy rules: like `policy_rules`, plus who must decide an `ask`. */
export const workspaceRules = pgTable(
  "workspace_rules",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    tool: text("tool").notNull(),
    decision: text("decision").$type<Decision>().notNull(),
    when: jsonb("when").$type<ArgMatcher[]>(),
    note: text("note"),
    /** "admin": a workspace owner or admin must approve, not the member. */
    approver: text("approver").$type<"admin">(),
    createdAt: createdAt(),
  },
  (t) => [index("workspace_rules_workspace_idx").on(t.workspaceId, t.position)],
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
    /**
     * Steps of plans the user approved via `propose_plan` (tool + canonical input hash).
     * A matching call runs once without asking; `usedBy` marks a spent grant.
     */
    planGrants: jsonb("plan_grants").$type<PlanGrant[]>().notNull().default([]),
    /** Skills loaded with `load_skill` in this run (name + content hash), in load order. */
    skills: jsonb("skills").$type<SkillUse[]>().notNull().default([]),
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
    /** A user-role row quoting third-party content (an event trigger's email or payload). */
    untrusted: boolean("untrusted").notNull().default(false),
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
    preview: text("preview"),
    decidedBy: text("decided_by"),
    /** "admin" when a team rule says a workspace admin, not the requester, must decide. */
    approver: text("approver").$type<"admin">(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Where the person decided: web, push, slack, email. */
    decidedVia: text("decided_via"),
    /** When notification channels were told this call needs a person. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** Undo window: an approved call does not run before this time. */
    executeAfter: timestamp("execute_after", { withTimezone: true }),
    /** Skills loaded in the run when this call was proposed, with their versions (audit). */
    skills: jsonb("skills").$type<SkillUse[]>(),
    output: jsonb("output").$type<ToolOutput>(),
    fullOutput: jsonb("full_output").$type<ToolOutput>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.id] }),
    // Learned-rule suggestions read a user's recent decisions.
    index("tool_calls_user_decided_idx").on(t.userId, t.decidedAt),
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

/**
 * First-party integrations (Google today). One row per user and provider; tokens are
 * sealed with the server secret. Tools for these are built in, not served over MCP.
 */
export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").$type<"google">().notNull(),
    /** The account the user connected, e.g. their Google email address. */
    account: text("account").notNull(),
    status: text("status").$type<"active" | "needs_auth" | "error">().notNull(),
    /** Sealed token JSON. */
    secret: text("secret").notNull(),
    scopes: text("scopes").notNull().default(""),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integrations_user_provider_idx").on(t.userId, t.provider)],
);

/**
 * Slack, connected per user to approve from a DM. The bot token is sealed; the Slack user
 * who installed it (`slackUserId` in `teamId`) is the only Slack identity that may act for
 * this Synapse user.
 */
export const slackAccounts = pgTable(
  "slack_accounts",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    teamId: text("team_id").notNull(),
    teamName: text("team_name").notNull(),
    slackUserId: text("slack_user_id").notNull(),
    botUserId: text("bot_user_id"),
    /** Sealed bot token (xoxb-…). */
    botToken: text("bot_token").notNull(),
    scopes: text("scopes").notNull().default(""),
    status: text("status").$type<"active" | "error">().notNull(),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("slack_accounts_team_user_idx").on(t.teamId, t.slackUserId)],
);

/** The Slack DM sent about an approval, per recipient, so it can be updated once decided. */
export const slackMessages = pgTable(
  "slack_messages",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    /** The Synapse user it was sent to. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    ts: text("ts").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.toolCallId, t.userId] })],
);

/**
 * Web Push subscriptions: one per browser or installed app. The endpoint is the push
 * service URL for that device; the keys encrypt payloads to it and are sealed at rest.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    /** Sealed. */
    p256dh: text("p256dh").notNull(),
    /** Sealed. */
    auth: text("auth").notNull(),
    /** A readable device name, e.g. "Safari on iPhone". */
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
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
    /** "style": the writing-style profile learned from sent mail (one per user, editable). */
    source: text("source").$type<"user" | "agent" | "style">().notNull().default("user"),
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

// ── Skills ──────────────────────────────────────────────────────────────────

/**
 * A user's own skill, in the Agent Skills shape: SKILL.md frontmatter fields, a markdown
 * body and optional reference files. Built-in skills ship with the server, not in here.
 */
export const skills = pgTable(
  "skills",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    body: text("body").notNull(),
    /** Reference files by relative path. */
    files: jsonb("files").$type<Record<string, string>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("skills_user_name_idx").on(t.userId, t.name)],
);

// ── Automations ────────────────────────────────────────────────────────────

/** What starts an automation. */
export type AutomationTrigger =
  /** Five-field cron in `schedule`. */
  | { type: "schedule" }
  /** New Gmail messages matching `query` (Gmail search syntax; empty = whole inbox). */
  | { type: "gmail"; query: string }
  /** POST to the automation's secret webhook URL. */
  | { type: "webhook" };

/** Poll state for event triggers. */
export interface TriggerCursor {
  /** Newest message time seen, in ms. */
  after: number;
  /** Message ids at exactly `after`, so ties are not fired twice. */
  seen: string[];
}

/**
 * A prompt that runs in its own chat when its trigger fires: on a schedule, on new email,
 * or on a webhook. Approvals land in the inbox.
 */
export const automations = pgTable(
  "automations",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    trigger: jsonb("trigger").$type<AutomationTrigger>().notNull().default({ type: "schedule" }),
    /** Five-field cron expression, evaluated in `timezone`. Empty for event triggers. */
    schedule: text("schedule").notNull().default(""),
    timezone: text("timezone").notNull().default("UTC"),
    enabled: boolean("enabled").notNull().default(true),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    /** Next fire (schedule) or next poll (gmail). */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    cursor: jsonb("cursor").$type<TriggerCursor>(),
    /** Sealed webhook token; the URL is /api/hooks/<id>/<token>. */
    webhookSecret: text("webhook_secret"),
    lastError: text("last_error"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("automations_user_idx").on(t.userId),
    index("automations_due_idx").on(t.nextRunAt).where(sql`enabled`),
  ],
);
