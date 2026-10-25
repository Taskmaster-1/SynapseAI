# Architecture

This document explains how a run works and why it is built this way. The design draws on
how Codex, the OpenAI Agents SDK, the Vercel AI SDK, LangGraph, opencode and Letta handle
approvals, persistence and streaming, keeping the parts that survive restarts and
multi-tenant use.

## The run loop

A **run** is the agent's work in response to user input in one chat. Exactly one run is
active per chat (a partial unique index enforces it). `runAgent` in `packages/core`
advances a run until it completes, fails, is cancelled, or pauses for approval:

```
loop:
  if cancel requested → deny unresolved calls, write their results, status=cancelled
  settle tool calls from the last assistant step:
      executing (crash recovery) → read: retry · side effect: mark unknown, never retry
      any awaiting_approval      → status=waiting, return
      approved                   → execute (reads in parallel, writes sequentially)
      all settled                → append one tool message with every result
  drain pending inputs (messages the user sent meanwhile) into the chat
  last message is the assistant's answer → status=completed
  check step and spend limits
  one model step (streamed) → store assistant message + proposed tool calls atomically
      → policy decides each call: approved · awaiting_approval · denied
```

The runtime holds **no state between calls**: everything is in the store. That is what
makes approvals survive restarts, lets any worker continue any run, and makes `runAgent`
safe to call again at any time. It also means the runtime is testable with an in-memory
store and scripted models — most of the test suite does exactly that.

The model is called **one step at a time** with tools declared but not executable. The AI
SDK handles providers, streaming and tool-call parsing; SynapseAI owns execution, so
approval, persistence and policy can't be bypassed by an SDK code path.

## Tool call state machine

```
proposed ──policy──▶ approved ─────────▶ executing ──▶ succeeded | failed
    │                   ▲                     │
    │                   │ user approves       └─ crash ─▶ unknown (side effects)
    ├──▶ awaiting_approval ──user denies / new message / cancel──▶ denied
    └──▶ denied (block rule)
```

Every transition is a compare-and-set on `(run_id, id, status)` (and on `user_id` for
decisions), so double clicks, replays and races are no-ops. Tool calls are written
**before** they execute; the full output is stored and a capped version goes to the model.

## Policy, effects and taint

Every tool declares an effect. The policy engine (`packages/core/src/policy.ts`) turns
`(tool, effect, input, tainted)` into allow / ask / block:

1. any matching `block` rule wins;
2. otherwise the first matching rule, else the tool's own default, else the effect default;
3. if the run is **tainted** and the result is `allow` for a non-read effect, it becomes `ask`.

A run becomes tainted the first time a tool with `untrustedOutput` returns: web search
and fetch, knowledge search, every MCP tool. This is a pragmatic form of the "Rule of Two":
an agent that has seen untrusted input and can act externally must have a human in the loop.

**Plans.** For multi-step jobs the agent calls the built-in `propose_plan` with the exact
calls it intends to make. The plan always asks; the person can untick steps, which approves
it with an edited input holding only the kept steps. When it runs (and only if a person
decided it), each kept step becomes a grant on the run (`runs.plan_grants`: tool name plus
SHA-256 of the canonical, key-sorted input JSON). A later call whose tool and input hash
match an unused grant is allowed with "Part of the plan you approved", even in a tainted
run, because the person signed off on that exact payload. Each grant is used once, block
rules still win, and anything that differs goes through normal policy.

## Streaming

Every runtime event is appended to `run_events` with a dense per-run `seq` (text deltas are
coalesced ~60 ms) and announced with `NOTIFY`. The SSE endpoint replays from the log after
the client's last seq and then tails it, so a client can disconnect at any point and resume
exactly. The client reducer (`@synapse/core/ui`) ignores events at or below the last seq,
and streamed messages use the id of the stored row, so live and reloaded views converge
(tested).

## Workers

Workers claim runs with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`, holding a
60 s lease renewed every 5 s. A run whose lease expires (worker died) is picked up by
another worker; after 5 failed attempts it is failed. Retryable provider errors release
the lease with exponential backoff. `NOTIFY synapse_runs` wakes idle workers immediately.

## Context management

- Tool outputs are capped at 24k characters before entering the context.
- History is rebuilt deterministically from stored rows each step (prompt-cache friendly);
  reasoning from a different model is dropped, orphaned tool calls get an "interrupted"
  result.
- At 60% of the context budget old tool outputs are replaced by stubs; at 80% the earlier
  conversation is summarised into a handover note (by the summary model) and the model
  sees the note plus everything from the latest user turn. The UI still shows everything.

## Models

Models are `provider:model-id` refs, resolved per run from the user's chain (or the server
default) with the user's own keys taking precedence. On a retryable error **before any
output**, the next model in the chain is tried; once output has streamed, the error fails
the step. Costs are computed from per-model prices and checked against per-run and per-day
budgets before each model call.

## Integrations

MCP over Streamable HTTP. OAuth 2.1 with PKCE is persisted per connection (encrypted with
AES-256-GCM, key derived from `SYNAPSE_SECRET`); the `state` parameter is bound to the
connection and the callback requires the same signed-in user. Connections and `web_fetch`
go through an SSRF guard that resolves hosts and refuses private, loopback, link-local and
metadata addresses, re-checking every redirect.

## Data model

`user/session/account/verification` (Better Auth) · `chats` · `runs` (status, lease, usage,
taint) · `messages` (AI SDK `ModelMessage` JSON, `seq`, handover rows) · `tool_calls`
(effect, status, decision, who decided, capped and full output) · `run_events` ·
`pending_inputs` · `policy_rules` · `user_settings` (encrypted provider keys, budgets,
model chain) · `connections` · `memories` · `documents` / `chunks` (tsvector + vector(1536)).

## Non-goals (for now)

Visual workflow builder, a hand-built connector catalog, browser/computer-use agents,
multi-agent "workforces", credit-based pricing.
