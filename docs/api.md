# HTTP API

All endpoints live under `/api`, return JSON, and require a session cookie (Better Auth,
mounted at `/api/auth/*`) unless noted. Every query is scoped to the signed-in user; ids
belonging to someone else return `404`.

Errors: `{ "error": { "code": string, "message": string } }` with status 400/401/404/409/422/500.

Types referenced below (`UiMessage`, `UiPart`, `SeqEvent`, `RunStatus`, `Effect`,
`ToolOutput`, `PolicyRule`, `PolicyDefaults`) are exported from `@synapse/core` and
`@synapse/core/ui`.

## Public

| Method | Path | Response |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` |
| GET | `/api/config` | `{ auth: { emailPassword: boolean, github: boolean, google: boolean }, integrations: { google: boolean, slack: boolean }, features: { webSearch: boolean, embeddings: boolean }, models: string[] }` |
| GET | `/oauth/client-metadata.json` | OAuth client metadata document for MCP servers |
| POST | `/api/slack/interactions` | Slack's interactivity endpoint (button clicks). Authenticated by Slack's `X-Slack-Signature` over the raw body, rejected (`401`) when wrong or more than 5 minutes old. Answers `200` at once and decides in the background |
| POST | `/api/hooks/:automationId/:token` | Starts a task for a webhook automation. Any body (JSON is pretty-printed for the agent, capped at 16 KB). `202 { ok, taskId }`; `404` for an unknown id or wrong token, `409` when paused, `413` over 256 KB, `429` over 60 per hour |

## Chats

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/chats` | | `{ chats: { id, title, updatedAt, status: RunStatus \| null, pendingApprovals: number, costUsd: number, tainted: boolean, trigger: "chat" \| "schedule" \| "manual" \| null, snippet: string \| null }[] }` — `snippet` is the latest assistant text (markdown, ≤ 200 chars) |
| POST | `/api/chats` | `{ content?: string }` | `{ chat: { id, title }, runId?: string }` (creates a chat; if `content` is given, also sends it) |
| GET | `/api/chats/:id` | | `{ chat: { id, title }, messages: UiMessage[], run: UiRun \| null }` — `run` is the latest run (`{ id, status, error, model, tainted, steps, trigger, inputTokens, outputTokens, costUsd, createdAt, finishedAt, lastSeq }`); resume the event stream after `run.lastSeq` |
| PATCH | `/api/chats/:id` | `{ title }` | `{ chat }` |
| DELETE | `/api/chats/:id` | | `204` |
| POST | `/api/chats/:id/messages` | `{ content: string }` | `{ runId, queued: "new_run" \| "pending_input" }` |

Only one run is active per chat. A message sent while a run is active is queued and the
agent reads it at its next step; if the run is waiting on approvals, those are denied
("the user moved on") and the run continues with the new message.

## Runs

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/runs/:id/events?after=<seq>` | | **SSE** stream (see below) |
| POST | `/api/runs/:id/tool-calls/:toolCallId/decision` | `{ approved: boolean, reason?: string, input?: unknown }` | `{ executeAfter: string \| null }`; `409` if no longer awaiting approval. `input` replaces the arguments (edited on the approval card). Approving a `send` or `destructive` call opens the user's undo window: it runs at `executeAfter`, not before |
| POST | `/api/runs/:id/tool-calls/:toolCallId/undo` | | `204`; `409` once the window has ended ("Too late to undo: it already ran."). The call is denied and the agent is told the user undid it |
| POST | `/api/runs/:id/tool-calls/decisions` | `{ decisions: { toolCallId, approved, reason?, input? }[] }` (`input`: approve with edited input, same as the single route) | `{ executeAfter: Record<toolCallId, string> }` for calls that opened an undo window; all or nothing in one transaction: `409` if any call is no longer awaiting approval, `400` on duplicate ids. The run is re-queued once when nothing is left awaiting |
| POST | `/api/runs/:id/cancel` | `{ mode: "now" \| "after_step" }` | `204` |
| GET | `/api/runs?limit=50` | | `{ runs: { id, chatId, chatTitle, status, trigger, model, steps, inputTokens, outputTokens, costUsd, error, createdAt, finishedAt }[] }` |
| GET | `/api/runs/:id` | | `{ run, toolCalls: { id, name, effect, status, decision, decisionReason, input, output, decidedBy, decidedAt, executeAfter, createdAt }[] }` (audit view) |
| GET | `/api/approvals` | | `{ approvals: { runId, chatId, chatTitle, toolCallId, name, effect, input, reason, preview, createdAt }[] }` — `preview` is a one-line human summary from the tool, `reason` explains why approval is needed — everything awaiting the user |

### Event stream

`GET /api/runs/:id/events` is `text/event-stream`. Each event:

```
id: 17
data: {"seq":17,"runId":"…","type":"text.delta","messageId":"…","delta":"Hel"}
```

- Resume with `Last-Event-ID` header or `?after=<seq>`; events are replayed from the log
  and then streamed live. Applying an event twice is harmless (`applyEvent` ignores
  `seq <= lastSeq`).
- The server closes the stream after a `run.status` event whose status is `waiting`,
  `completed`, `failed` or `cancelled`. Re-open it when a new run starts or after
  approving (the same run continues with new seqs).
- `: ping` comments every 15s keep proxies from closing idle streams.

Event types (`RunEvent` in `packages/core/src/types.ts`): `run.status`, `message.start`,
`text.delta`, `reasoning.delta`, `message.end`, `tool.call`, `tool.status`, `tool.result`,
`approval.requested`, `usage`, `compacted`, `error`.

## Connections (MCP)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/connections` | | `{ connections: { id, name, url, status, authType, lastError, tools: { name, title, description, effect }[] \| null }[] }` |
| POST | `/api/connections` | `{ name, url, token?: string }` | `{ connection, authorizationUrl?: string }` — open `authorizationUrl` in the browser to finish OAuth |
| POST | `/api/connections/:id/check` | | `{ status, authorizationUrl?, error? }` |
| PATCH | `/api/connections/:id` | `{ toolEffects?: Record<string, Effect>, status?: "active" \| "disabled" }` | `{ connection }` |
| DELETE | `/api/connections/:id` | | `204` |
| GET | `/api/connections/oauth/callback?code&state` | | redirects to `${WEB_URL}/connections?connected=<id>` or `?error=…` |
| GET | `/api/connections/presets` | | `{ presets: { name, url, description, docs }[] }` — well-known remote MCP servers |

## Integrations (built in)

Gmail and Google Calendar, without an MCP server. Needs `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` on the server ([setup](google.md)).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/integrations` | | `{ google: { available, tools: { name, effect, title }[], connection: { account, status, lastError, connectedAt } \| null }, slack: { available, connection: { team, status, lastError, connectedAt } \| null } }` |
| POST | `/api/integrations/google/connect` | | `{ url }` — open it in the browser; Google redirects back to the callback |
| GET | `/api/integrations/google/callback?code&state` | | redirects to `${PUBLIC_URL}/connections?connected=google` or `?error=<message>` |
| DELETE | `/api/integrations/google` | | `204` — revokes the grant at Google and deletes the tokens |
| POST | `/api/integrations/slack/connect` | | `{ url }` — Slack's install page; needs `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` ([setup](slack.md)), else `422 not_configured` |
| GET | `/api/integrations/slack/callback?code&state` | | redirects to `${PUBLIC_URL}/connections?connected=slack` or `?error=<message>` |
| POST | `/api/integrations/slack/test` | | `{ ok: true }` — sends a test DM (`422 slack_not_connected`, `422 slack_error`) |
| DELETE | `/api/integrations/slack` | | `204` — revokes the bot token at Slack and deletes it |

With Slack connected, each approval addressed to you arrives as a Slack DM with Approve and
Deny; decisions made there are recorded with `decidedVia: "slack"`.

## Policy

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/policy` | | `{ defaults: PolicyDefaults, rules: PolicyRule[] }` |
| PUT | `/api/policy` | `{ defaults, rules }` (rules in priority order) | same |
| GET | `/api/policy/suggestions` | | `{ suggestions: RuleSuggestion[] }` |
| POST | `/api/policy/suggestions/:id/accept` | | `{ defaults, rules }` — adds the allow rule first; `404` if not a current suggestion |
| POST | `/api/policy/suggestions/:id/dismiss` | | `204` — hidden for good |

Suggestions ("approvals that learn") come from your own decisions on non-read actions over the
last 60 days: at least 5 unedited approvals of a tool, and no denial or edit among its last 10
decisions. Recipients that all share one (non-public) email domain become an `allEndWith`
condition; a single `repo`/`project`/`channel`/`team` becomes `equals`. Sending and
destructive tools are only suggested with a condition. Learned rules are ordinary rules; a
task that read outside content still asks.

## Memory

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/memories` | | `{ memories: { id, content, source: "user" \| "agent", createdAt }[] }` |
| POST | `/api/memories` | `{ content }` | `{ memory }` |
| PATCH | `/api/memories/:id` | `{ content }` | `{ memory }` |
| DELETE | `/api/memories/:id` | | `204` |

## Documents (knowledge base)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/documents` | | `{ documents: { id, name, mimeType, bytes, status, error, createdAt }[] }` |
| POST | `/api/documents` | `multipart/form-data` with `file` (text, markdown, csv, json, html; ≤ 10 MB) | `{ document }` |
| DELETE | `/api/documents/:id` | | `204` |
| GET | `/api/documents/search?q=` | | `{ results: { document, documentId, position, content, score }[] }` |

## Settings

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/settings` | | `{ instructions: string \| null, models: { chain: string[] }, budgets: { perRunUsd, perDayUsd }, providerKeys: Record<"anthropic"\|"openai"\|"google"\|"gateway", boolean>, undoSeconds: number }` — keys are write-only; `undoSeconds` (0–60, default 10, 0 is off) is the undo window for sends and deletes |
| PUT | `/api/settings` | partial of the above; `providerKeys` values are strings to set, `null` to clear | same as GET |
| GET | `/api/usage?days=30` | | `{ days: { date, costUsd, runs, inputTokens, outputTokens }[] }` |
| GET | `/api/models` | | `{ models: ModelEntry[], updatedAt: string \| null }` |

`ModelEntry` is `{ ref, name, provider, creator, contextWindow: number | null, price: { input, output, cacheRead? } | null, tags: string[], released: string | null, available: boolean }`.
Prices are USD per million tokens. The list holds every language model in the Vercel AI Gateway
catalog as a `gateway:<creator>/<model>` ref, the same model as a direct ref when its creator is
Anthropic, OpenAI or Google (e.g. `openai:gpt-5.5`, `anthropic:claude-sonnet-5-5`), the built-in
price table and the server's configured chain. `available` means the server or the user has a key
for that provider. Available models come first, then newest. `updatedAt` is the last catalog sync
(`null` if it never synced; built-in prices are used then).

## Automations

Prompts that run when their trigger fires. Anything that needs approval waits in the
approvals inbox.

| `trigger` | Fires | Where it runs |
|---|---|---|
| `{ type: "schedule" }` | On the 5-field cron in `schedule` (≥ 15 min apart), in `timezone` | The automation's own chat |
| `{ type: "gmail", query }` | For each new Gmail message matching `query` (Gmail search syntax; empty = inbox). Polled every `TRIGGER_POLL_SECONDS` (120). Mail you send and mail that was there before the trigger was created never fire it. | A new task per email |
| `{ type: "webhook" }` | On `POST webhookUrl` | A new task per delivery |

Email and webhook tasks start **tainted**: their first message carries third-party content,
so no write, send or destructive call is auto-allowed, whatever your rules say.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/automations` | | `{ automations: { id, name, prompt, trigger, schedule, timezone, enabled, chatId, nextRunAt, lastRunAt, lastError, webhookUrl }[] }` |
| POST | `/api/automations` | `{ name, prompt, trigger?, schedule?, timezone?, enabled? }` — `trigger` defaults to schedule | `{ automation }` (`422 invalid_schedule`, `422 google_not_connected`) |
| PATCH | `/api/automations/:id` | any of the above, plus `rotateWebhook: true` for a new URL; omitted fields keep their value | `{ automation }` |
| DELETE | `/api/automations/:id` | | `204` |
| POST | `/api/automations/:id/run` | | `{ runId, queued, chatId }` — run it now |
