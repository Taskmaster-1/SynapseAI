# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/Taskmaster-1/SynapseAI/security/advisories/new).
Do not open a public issue. We aim to acknowledge reports within three working days.

## Threat model in brief

SynapseAI runs an LLM that can act in third-party services with the user's credentials.
The main threats and how they are handled:

| Threat | Mitigation |
|---|---|
| Prompt injection from emails, web pages, documents or MCP results | Approval policy is enforced in code. Runs that have read untrusted content are tainted and cannot auto-approve writes or sends. The system prompt tells the model tool output is data. The eval suite includes injection scenarios. |
| Data exfiltration through rendered output | The web UI never loads remote images from model output and shows link destinations. |
| One user acting on another's data | Every query is scoped by the session user; decisions are compare-and-set on owner and status. Covered by tests. |
| Replayed or double approvals | Decisions only apply to calls still `awaiting_approval`. |
| Repeating side effects after a crash | Interrupted side-effecting calls become `unknown` and are never retried automatically. |
| SSRF via MCP URLs or `web_fetch` | Hosts are resolved and private, loopback, link-local and metadata ranges refused, on every redirect. `SYNAPSE_ALLOW_PRIVATE_NETWORK=true` disables this for self-hosted setups that need it. DNS rebinding between check and connect is not prevented; use an egress proxy if that matters. |
| Credential theft from the database | OAuth tokens and provider keys are encrypted with AES-256-GCM using a key derived from `SYNAPSE_SECRET`. Keys are write-only through the API. |
| Cross-site request forgery | State-changing API requests with a foreign `Origin` are rejected; session cookies are `SameSite=Lax`. |
| Runaway spend | Per-run step, token and cost limits and a per-day cost limit, checked before every model call. Users can only tighten the operator's caps. |
| Mis-annotated MCP tools | MCP `readOnlyHint`/`destructiveHint` are server-supplied hints. Users can override any tool's effect; MCP reads are never re-run after a crash; all MCP output taints the run. |
| Taint laundering across turns | Taint is per chat: once any run in a chat has read untrusted content, every later run in it starts tainted. |
| Regex denial of service in policy rules | Patterns with nested quantifiers or backreferences are refused, and matching input is capped. |
| Two workers driving one run | Status writes are fenced by lease owner; a worker that cannot renew its lease stops before it expires. |

Approvals reduce risk; they do not remove it. Review what you approve.
