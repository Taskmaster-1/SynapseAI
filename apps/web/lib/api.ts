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
  features: { webSearch: boolean; embeddings: boolean };
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
}

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
  source: "user" | "agent";
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
}

export interface SettingsUpdate {
  instructions?: string | null;
  models?: { chain: string[] };
  budgets?: { perRunUsd: number | null; perDayUsd: number | null };
  providerKeys?: Partial<Record<ProviderName, string | null>>;
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
  /** Cron; empty for event triggers. */
  schedule: string;
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
  rotateWebhook?: boolean;
}

export interface GoogleIntegration {
  /** False when the server has no Google OAuth app configured. */
  available: boolean;
  tools: { name: string; effect: Effect; title: string }[];
  connection: {
    account: string;
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
  ) => post(`/api/runs/${enc(runId)}/tool-calls/${enc(toolCallId)}/decision`, body),
  /** Decides several calls of one run at once; all or nothing (409 if any moved on). */
  decideMany: (
    runId: string,
    decisions: { toolCallId: string; approved: boolean; reason?: string; editedInput?: unknown }[],
  ) => post(`/api/runs/${enc(runId)}/tool-calls/decisions`, { decisions }),
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

  documents: () => get<{ documents: KnowledgeDocument[] }>("/api/documents"),
  uploadDocument: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ document: KnowledgeDocument }>("POST", "/api/documents", form);
  },
  deleteDocument: (id: string) => del(`/api/documents/${enc(id)}`),
  searchDocuments: (q: string, signal?: AbortSignal) =>
    get<{ results: SearchResult[] }>(`/api/documents/search?q=${enc(q)}`, { signal }),

  integrations: () => get<{ google: GoogleIntegration }>("/api/integrations"),
  connectGoogle: () => post<{ url: string }>("/api/integrations/google/connect", {}),
  disconnectGoogle: () => del("/api/integrations/google"),
  automations: () => get<{ automations: Automation[] }>("/api/automations"),
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
};
