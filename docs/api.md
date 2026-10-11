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
| GET | `/api/config` | `{ auth: { emailPassword: boolean, github: boolean, google: boolean }, features: { webSearch: boolean, embeddings: boolean }, models: string[] }` |
| GET | `/oauth/client-metadata.json` | OAuth client metadata document for MCP servers |

## Chats

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/chats` | | `{ chats: { id, title, updatedAt, status: RunStatus \| null, pendingApprovals: number }[] }` |
| POST | `/api/chats` | `{ content?: string }` | `{ chat: { id, title }, runId?: string }` (creates a chat; if `content` is given, also sends it) |
| GET | `/api/chats/:id` | | `{ chat: { id, title }, messages: UiMessage[], run: UiRun \| null }` — `run` is the latest run; `run.lastSeq` is where to resume the event stream |
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
| POST | `/api/runs/:id/tool-calls/:toolCallId/decision` | `{ approved: boolean, reason?: string, input?: unknown }` | `204`; `409` if no longer awaiting approval. `input` replaces the arguments (edited on the approval card) |
| POST | `/api/runs/:id/cancel` | `{ mode: "now" \| "after_step" }` | `204` |
| GET | `/api/runs?limit=50` | | `{ runs: { id, chatId, chatTitle, status, trigger, model, steps, inputTokens, outputTokens, costUsd, error, createdAt, finishedAt }[] }` |
| GET | `/api/runs/:id` | | `{ run, toolCalls: { id, name, effect, status, decision, decisionReason, input, output, decidedBy, decidedAt, createdAt }[] }` (audit view) |
| GET | `/api/approvals` | | `{ approvals: { runId, chatId, chatTitle, toolCallId, name, effect, input, reason, createdAt }[] }` — everything awaiting the user |

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

## Policy

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/policy` | | `{ defaults: PolicyDefaults, rules: PolicyRule[] }` |
| PUT | `/api/policy` | `{ defaults, rules }` (rules in priority order) | same |

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
| GET | `/api/settings` | | `{ instructions: string \| null, models: { chain: string[] }, budgets: { perRunUsd, perDayUsd }, providerKeys: Record<"anthropic"\|"openai"\|"google", boolean> }` — keys are write-only |
| PUT | `/api/settings` | partial of the above; `providerKeys` values are strings to set, `null` to clear | same as GET |
| GET | `/api/usage?days=30` | | `{ days: { date, costUsd, runs, inputTokens, outputTokens }[] }` |
