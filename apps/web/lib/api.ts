/**
 * Tiny fetch wrapper typed against docs/api.md. All calls are same-origin; Next rewrites
 * /api/* to the API server so the Better Auth session cookie is sent.
 */
import type {
  Decision,
  Effect,
  PolicyDefaults,
  PolicyRule,
  RuleSuggestion,
  RunStatus,
  ToolCallStatus,
  ToolOutput,
} from "@synapse/core";
import type { UiMessage, UiRun } from "@synapse/core/ui";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Body = unknown;

function onUnauthorized() {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  if (path.startsWith("/sign-in") || path.startsWith("/sign-up")) return;
  const next = encodeURIComponent(path + window.location.search);
  window.location.replace(`/sign-in?next=${next}`);
}

export async function request<T>(
  method: string,
  path: string,
  body?: Body,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: payload,
      credentials: "same-origin",
      cache: "no-store",
      signal: init?.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Can't reach the server. Check your connection.");
  }
  if (res.status === 401) onUnauthorized();
  if (!res.ok) {
    let code = "http_error";
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } };
      if (data.error?.code) code = data.error.code;
      if (data.error?.message) message = data.error.message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const get = <T>(path: string, init?: { signal?: AbortSignal }) =>
  request<T>("GET", path, undefined, init);
export const post = <T = void>(path: string, body?: Body) => request<T>("POST", path, body ?? {});
export const put = <T>(path: string, body: Body) => request<T>("PUT", path, body);
export const patch = <T>(path: string, body: Body) => request<T>("PATCH", path, body);
export const del = (path: string) => request<void>("DELETE", path);

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

const enc = encodeURIComponent;

// ---------- Contract types ----------

export interface AppConfig {
  auth: { emailPassword: boolean; github: boolean; google: boolean; signup?: boolean };
  features: { webSearch: boolean; embeddings: boolean; push?: boolean; emailAlerts?: boolean };
  models: string[];
}

export type Trigger = "chat" | "schedule" | "manual";

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
  status: RunStatus | null;
  pendingApprovals: number;
  costUsd: number;
  tainted: boolean;
  trigger: Trigger | null;
  /** Latest assistant text (markdown, ≤ 200 chars). */
  snippet: string | null;
}

/** Run fields that the event stream doesn't carry; refreshed from snapshots. */
export interface RunMeta {
  model: string | null;
  tainted: boolean;
  steps: number;
  trigger: Trigger | null;
  createdAt: string | null;
  finishedAt: string | null;
}

export type TaskRun = UiRun & Partial<RunMeta>;

export interface ChatDetail {
  chat: { id: string; title: string };
  messages: UiMessage[];
  run: TaskRun | null;
}

export interface RunRow {
  id: string;
  chatId: string;
  chatTitle: string;
  status: RunStatus;
  trigger: Trigger | string;
  model: string | null;
  tainted?: boolean;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AuditToolCall {
  id: string;
  name: string;
  effect: Effect;
  status: ToolCallStatus;
  decision: Decision | null;
  decisionReason: string | null;
  input: unknown;
  output: ToolOutput | null;
  inputEdited?: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Where it was decided: web, push, slack, email, or expiry (nobody did in time). */
  decidedVia?: string | null;
  decidedByName?: string | null;
  /** Two-person sign-off: the first of the two approvals. */
  firstApprovedBy?: string | null;
  firstApprovedByName?: string | null;
  firstApprovedAt?: string | null;
  remindedAt?: string | null;
  escalatedAt?: string | null;
  expiresAt?: string | null;
  /** Undo window: when an approved call runs (ISO), if it had to wait. */
  executeAfter?: string | null;
  createdAt: string;
}

export interface Approval {
  runId: string;
  chatId: string;
  chatTitle: string;
  toolCallId: string;
  name: string;
  effect: Effect;
  input: unknown;
  /** Human sentence: why this needs approval. */
  reason: string | null;
  /** One-line human summary from the tool. */
  preview: string | null;
  createdAt: string;
  /** "admin": the person's team requires a team admin to decide it. */
  approver?: "admin" | null;
  /** Team inbox only: the member whose task asked. */
  requester?: { id: string; name: string; email: string };
  /** The input was changed by whoever approved first (two-person sign-off). */
  inputEdited?: boolean;
  /** The task had read outside content when this was proposed. */
  tainted?: boolean;
  /** Plain-language risk facts, e.g. "Sends to 2 people outside acme.com". */
  facts?: string[];
  /** Denied as expired if nobody decides by then (ISO); null: never. */
  expiresAt?: string | null;
  /** When nobody decided in time and it went to the team's admins too. */
  escalatedAt?: string | null;
  /** Two-person sign-off: approvals needed, and the first one if given. */
  signoffs?: ApprovalSignoffs;
}

export interface ApprovalSignoffs {
  needed: 1 | 2;
  first: { id: string; name: string; at?: string | null } | null;
}

/** What the inbox knows about an approval beyond the call itself. */
export type ApprovalMeta = Pick<
  Approval,
  "facts" | "expiresAt" | "escalatedAt" | "signoffs" | "approver"
>;

export type TwoPersonRule = "destructive" | "destructive_send";

// ---------- Team workspaces ----------

export type WorkspaceRole = "owner" | "admin" | "member";

export interface WorkspaceMember {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface WorkspaceApprovalSettings {
  /** Minutes before a member's undecided approval also goes to admins; 0 is off. */
  escalateMinutes: number;
  /** Team-wide expiry in hours, instead of each person's own; null: each person's own. */
  expireHours: number | null;
  /** Which actions need two different people to approve; null: off. */
  twoPerson: TwoPersonRule | null;
}

export interface WorkspaceInfo {
  workspace: ({ id: string; name: string; createdAt: string } & WorkspaceApprovalSettings) | null;
  role: WorkspaceRole | null;
  members: WorkspaceMember[];
}

export interface WorkspaceInvite {
  id: string;
  role: Exclude<WorkspaceRole, "owner">;
  expiresAt: string;
  createdAt: string;
  usedAt?: string | null;
  revokedAt?: string | null;
  usedByEmail?: string | null;
  status: "active" | "used" | "revoked" | "expired";
}

/** A team rule: a policy rule, plus who must decide an Ask. */
export type TeamRule = PolicyRule & { approver?: "admin" | null };

export const isTeamAdmin = (role: WorkspaceRole | null | undefined) =>
  role === "owner" || role === "admin";

export interface ConnectionTool {
  name: string;
  title: string | null;
  description: string | null;
  effect: Effect;
}

export type ConnectionStatus = "active" | "needs_auth" | "error" | "disabled" | (string & {});

export interface Connection {
  id: string;
  name: string;
  url: string;
  status: ConnectionStatus;
  authType: string;
  lastError: string | null;
  tools: ConnectionTool[] | null;
}

export interface Preset {
  name: string;
  url: string;
  description: string;
  docs: string;
}

export interface Memory {
  id: string;
  content: string;
  /** "style": the writing-style profile learned from sent mail. */
  source: "user" | "agent" | "style";
  createdAt: string;
}

export interface KnowledgeDocument {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  status: string;
  error: string | null;
  createdAt: string;
}

/** A file attached in chat (photo, video, PDF, anything), stored privately on the server. */
export interface ChatFile {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  documentId: string | null;
  createdAt: string;
}

export interface SearchResult {
  document: string;
  documentId: string;
  position: number;
  content: string;
  score: number;
}

export type ProviderName = "anthropic" | "openai" | "google" | "gateway";

export interface Settings {
  instructions: string | null;
  models: { chain: string[]; defaultChain?: string[] };
  budgets: { perRunUsd: number | null; perDayUsd: number | null };
  providerKeys: Record<ProviderName, boolean>;
  /** Seconds an approved send or delete waits, with an Undo, before it runs. 0 is off. */
  undoSeconds: number;
  /** Email the account address when something needs approval. */
  emailAlerts: boolean;
  /** Re-notify once about an undecided approval after this many minutes; 0 is off. */
  remindMinutes: number;
  /** Deny an undecided approval after this many hours; 0 is never. */
  expireHours: number;
  /** IANA time zone for scheduled tasks and the agent's "today"; null until set. */
  timezone: string | null;
}

export interface SettingsUpdate {
  remindMinutes?: number;
  expireHours?: number;
  instructions?: string | null;
  models?: { chain: string[] };
  budgets?: { perRunUsd: number | null; perDayUsd: number | null };
  providerKeys?: Partial<Record<ProviderName, string | null>>;
  undoSeconds?: number;
  emailAlerts?: boolean;
  timezone?: string | null;
}

export interface PushConfig {
  enabled: boolean;
  /** VAPID public key (base64url), for PushManager.subscribe. */
  publicKey: string | null;
}

export interface PushDevice {
  id: string;
  endpoint: string;
  /** e.g. "Safari on iPhone". */
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ModelInfo {
  /** "provider:model-id", what goes in the fallback chain. */
  ref: string;
  name: string;
  provider: "anthropic" | "openai" | "google" | "gateway" | "openai-compatible";
  /** Who made the model, e.g. "anthropic", "openai", "xai". */
  creator: string;
  contextWindow: number | null;
  /** USD per million tokens. */
  price: { input: number; output: number; cacheRead?: number } | null;
  /** A key exists for this model's provider. */
  available: boolean;
  tags: string[];
  released: string | null;
}

export interface Policy {
  defaults: PolicyDefaults;
  rules: PolicyRule[];
}

export interface UsageDay {
  date: string;
  costUsd: number;
  runs: number;
  inputTokens: number;
  outputTokens: number;
}

export type AutomationTrigger =
  | { type: "schedule" }
  | { type: "gmail"; query: string }
  | { type: "webhook" };

export interface Automation {
  id: string;
  name: string;
  prompt: string;
  trigger: AutomationTrigger;
  /** Cron; empty for event triggers and one-offs. */
  schedule: string;
  /** One-offs: the single time it fires (then it turns itself off). */
  runAt: string | null;
  /** `reminder` only notifies; `task` runs the prompt. */
  kind: "task" | "reminder";
  /** Secret URL for webhook triggers. */
  webhookUrl: string | null;
  lastError: string | null;
  timezone: string;
  enabled: boolean;
  chatId: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

export interface AutomationInput {
  name: string;
  prompt: string;
  trigger?: AutomationTrigger;
  schedule?: string;
  timezone?: string;
  enabled?: boolean;
  runAt?: string | null;
  kind?: "task" | "reminder";
  rotateWebhook?: boolean;
}

export type TemplateRequirement = "google" | "github" | "linear";

/** A ready-made automation from the gallery. */
export interface AutomationTemplate {
  id: string;
  name: string;
  /** One line: what you get. */
  outcome: string;
  category: string;
  trigger: AutomationTrigger;
  schedule?: string;
  prompt: string;
  requires: TemplateRequirement[];
  /** What the user still has to connect to use it. */
  missing: TemplateRequirement[];
}

export interface Onboarding {
  /** False when the server has no Google OAuth app configured. */
  googleAvailable: boolean;
  steps: { google: boolean; writingStyle: boolean; automation: boolean; approved: boolean };
}

export interface GoogleIntegration {
  /** False when the server has no Google OAuth app configured. */
  available: boolean;
  /** `group` is the scope group a tool needs: gmail, calendar, drive, contacts or sheets. */
  tools: { name: string; group: string; effect: Effect; title: string }[];
  connection: {
    account: string;
    status: "active" | "needs_auth" | "error";
    lastError: string | null;
    connectedAt: string;
    /** Tool groups the grant lacks (it predates them, or a box was unticked). */
    missing: { group: string; label: string }[];
  } | null;
}

export interface SlackIntegration {
  /** False when the server has no Slack app configured. */
  available: boolean;
  /** What the agent can do in Slack as the person once connected. */
  tools: { name: string; effect: Effect; title: string }[];
  connection: {
    /** Workspace name. */
    team: string;
    status: "active" | "error";
    lastError: string | null;
    connectedAt: string;
    /** False for installs from before the agent tools: approvals work, tools need a reconnect. */
    agentTools: boolean;
  } | null;
}

export interface GitHubIntegration {
  /** False when the server has no GitHub OAuth app configured. */
  available: boolean;
  /** What the agent can do on GitHub as the person once connected. */
  tools: { name: string; effect: Effect; title: string }[];
  connection: {
    /** Their GitHub login. */
    account: string;
    status: "active" | "needs_auth" | "error";
    lastError: string | null;
    connectedAt: string;
    scopes: string;
  } | null;
}

export interface LinearIntegration {
  /** False when the server has no Linear OAuth app configured. */
  available: boolean;
  tools: { name: string; effect: Effect; title: string }[];
  connection: {
    /** The Linear account's email. */
    account: string;
    name: string | null;
    workspace: string | null;
    status: "active" | "needs_auth" | "error";
    lastError: string | null;
    connectedAt: string;
  } | null;
}

// ---------- Endpoints ----------

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export const api = {
  config: () => get<AppConfig>("/api/config"),
  session: () => get<{ user: SessionUser } | null>("/api/auth/get-session"),

  chats: () => get<{ chats: ChatSummary[] }>("/api/chats"),
  chat: (id: string, signal?: AbortSignal) => get<ChatDetail>(`/api/chats/${enc(id)}`, { signal }),
  createChat: (content?: string) =>
    post<{ chat: { id: string; title: string }; runId?: string }>("/api/chats", { content }),
  renameChat: (id: string, title: string) =>
    patch<{ chat: { id: string; title: string } }>(`/api/chats/${enc(id)}`, { title }),
  deleteChat: (id: string) => del(`/api/chats/${enc(id)}`),
  sendMessage: (chatId: string, content: string) =>
    post<{ runId: string; queued: "new_run" | "pending_input" }>(
      `/api/chats/${enc(chatId)}/messages`,
      { content },
    ),

  decide: (
    runId: string,
    toolCallId: string,
    body: { approved: boolean; reason?: string; input?: unknown },
  ) =>
    /** `partial`: the first of two approvals is in; it waits for a second person. */
    post<{ executeAfter: string | null; partial?: boolean }>(
      `/api/runs/${enc(runId)}/tool-calls/${enc(toolCallId)}/decision`,
      body,
    ),
  /** Decides several calls of one run at once; all or nothing (409 if any moved on). */
  decideMany: (
    runId: string,
    decisions: { toolCallId: string; approved: boolean; reason?: string; input?: unknown }[],
  ) =>
    post<{ executeAfter: Record<string, string> }>(`/api/runs/${enc(runId)}/tool-calls/decisions`, {
      decisions,
    }),
  /** Takes back an approved send or delete while its undo window is open (409 once it ran). */
  undo: (runId: string, toolCallId: string) =>
    post(`/api/runs/${enc(runId)}/tool-calls/${enc(toolCallId)}/undo`),
  cancel: (runId: string, mode: "now" | "after_step" = "now") =>
    post(`/api/runs/${enc(runId)}/cancel`, { mode }),
  runs: (limit = 50) => get<{ runs: RunRow[] }>(`/api/runs?limit=${limit}`),
  run: (id: string) => get<{ run: RunRow; toolCalls: AuditToolCall[] }>(`/api/runs/${enc(id)}`),
  approvals: () => get<{ approvals: Approval[] }>("/api/approvals"),

  connections: () => get<{ connections: Connection[] }>("/api/connections"),
  presets: () => get<{ presets: Preset[] }>("/api/connections/presets"),
  addConnection: (body: { name: string; url: string; token?: string }) =>
    post<{ connection: Connection; authorizationUrl?: string }>("/api/connections", body),
  checkConnection: (id: string) =>
    post<{ status: ConnectionStatus; authorizationUrl?: string; error?: string }>(
      `/api/connections/${enc(id)}/check`,
    ),
  updateConnection: (
    id: string,
    body: { toolEffects?: Record<string, Effect>; status?: "active" | "disabled" },
  ) => patch<{ connection: Connection }>(`/api/connections/${enc(id)}`, body),
  deleteConnection: (id: string) => del(`/api/connections/${enc(id)}`),

  policy: () => get<Policy>("/api/policy"),
  savePolicy: (body: Policy) => put<Policy>("/api/policy", body),
  suggestions: () => get<{ suggestions: RuleSuggestion[] }>("/api/policy/suggestions"),
  acceptSuggestion: (id: string) => post<Policy>(`/api/policy/suggestions/${enc(id)}/accept`),
  dismissSuggestion: (id: string) => post(`/api/policy/suggestions/${enc(id)}/dismiss`),

  memories: () => get<{ memories: Memory[] }>("/api/memories"),
  addMemory: (content: string) => post<{ memory: Memory }>("/api/memories", { content }),
  updateMemory: (id: string, content: string) =>
    patch<{ memory: Memory }>(`/api/memories/${enc(id)}`, { content }),
  deleteMemory: (id: string) => del(`/api/memories/${enc(id)}`),
  /** Learns how you write from your recent sent mail; stores only the profile. */
  learnWritingStyle: () =>
    post<{ memory: Memory; samples: number }>("/api/writing-style/learn", {}),
  onboarding: () => get<Onboarding>("/api/onboarding"),

  documents: () => get<{ documents: KnowledgeDocument[] }>("/api/documents"),
  uploadDocument: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ document: KnowledgeDocument }>("POST", "/api/documents", form);
  },
  deleteDocument: (id: string) => del(`/api/documents/${enc(id)}`),
  uploadFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ file: ChatFile }>("POST", "/api/files", form);
  },
  file: (id: string) => get<{ file: ChatFile }>(`/api/files/${enc(id)}`),
  deleteFile: (id: string) => del(`/api/files/${enc(id)}`),
  searchDocuments: (q: string, signal?: AbortSignal) =>
    get<{ results: SearchResult[] }>(`/api/documents/search?q=${enc(q)}`, { signal }),

  integrations: () =>
    get<{
      google: GoogleIntegration;
      slack: SlackIntegration;
      github: GitHubIntegration;
      linear: LinearIntegration;
    }>("/api/integrations"),
  connectGoogle: () => post<{ url: string }>("/api/integrations/google/connect", {}),
  disconnectGoogle: () => del("/api/integrations/google"),
  connectSlack: () => post<{ url: string }>("/api/integrations/slack/connect", {}),
  testSlack: () => post<{ ok: true }>("/api/integrations/slack/test", {}),
  disconnectSlack: () => del("/api/integrations/slack"),
  connectGitHub: () => post<{ url: string }>("/api/integrations/github/connect", {}),
  disconnectGitHub: () => del("/api/integrations/github"),
  connectLinear: () => post<{ url: string }>("/api/integrations/linear/connect", {}),
  disconnectLinear: () => del("/api/integrations/linear"),
  automations: () => get<{ automations: Automation[] }>("/api/automations"),
  automationTemplates: () =>
    get<{ categories: string[]; googleAvailable: boolean; templates: AutomationTemplate[] }>(
      "/api/automations/templates",
    ),
  createAutomation: (body: AutomationInput) =>
    post<{ automation: Automation }>("/api/automations", body),
  updateAutomation: (id: string, body: Partial<AutomationInput>) =>
    patch<{ automation: Automation }>(`/api/automations/${enc(id)}`, body),
  deleteAutomation: (id: string) => del(`/api/automations/${enc(id)}`),
  runAutomation: (id: string) =>
    post<{ runId: string; queued: "new_run" | "pending_input"; chatId: string }>(
      `/api/automations/${enc(id)}/run`,
    ),

  settings: () => get<Settings>("/api/settings"),
  models: () => get<{ models: ModelInfo[]; updatedAt: string | null }>("/api/models"),
  saveSettings: (body: SettingsUpdate) => put<Settings>("/api/settings", body),
  usage: (days = 30) => get<{ days: UsageDay[] }>(`/api/usage?days=${days}`),

  pushConfig: () => get<PushConfig>("/api/push/config"),
  pushDevices: () => get<{ subscriptions: PushDevice[] }>("/api/push/subscriptions"),
  /** Body is the browser's PushSubscription.toJSON(); re-subscribing a device is an upsert. */
  addPushDevice: (subscription: PushSubscriptionJSON) =>
    post<{ subscription: PushDevice }>("/api/push/subscriptions", subscription),
  removePushDevice: (id: string) => del(`/api/push/subscriptions/${enc(id)}`),
  testPush: () => post<{ sent: number; removed: number }>("/api/push/test"),
  workspace: () => get<WorkspaceInfo>("/api/workspace"),
  createWorkspace: (name: string) => post<WorkspaceInfo>("/api/workspace", { name }),
  renameWorkspace: (name: string) => patch<WorkspaceInfo>("/api/workspace", { name }),
  updateWorkspace: (body: Partial<WorkspaceApprovalSettings>) =>
    patch<WorkspaceInfo>("/api/workspace", body),
  /** The link holds the token and is only returned here, once. */
  createInvite: (role: "admin" | "member") =>
    post<{ invite: WorkspaceInvite; link: string }>("/api/workspace/invites", { role }),
  invites: () => get<{ invites: WorkspaceInvite[] }>("/api/workspace/invites"),
  revokeInvite: (id: string) => del(`/api/workspace/invites/${enc(id)}`),
  joinWorkspace: (token: string) => post<WorkspaceInfo>("/api/workspace/join", { token }),
  setMemberRole: (userId: string, role: WorkspaceRole) =>
    patch<WorkspaceInfo>(`/api/workspace/members/${enc(userId)}`, { role }),
  removeMember: (userId: string) => del(`/api/workspace/members/${enc(userId)}`),
  teamRules: () => get<{ rules: TeamRule[]; canEdit: boolean }>("/api/workspace/rules"),
  saveTeamRules: (rules: TeamRule[]) =>
    put<{ rules: TeamRule[]; canEdit: boolean }>("/api/workspace/rules", { rules }),
  /** Team members' calls waiting for an admin (owners and admins only). */
  teamApprovals: () => get<{ approvals: Approval[] }>("/api/workspace/approvals"),
  auditCsvUrl: (from: string, to: string) =>
    `/api/workspace/audit.csv?from=${enc(from)}&to=${enc(to)}`,
};
