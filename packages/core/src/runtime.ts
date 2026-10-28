import {
  type AssistantModelMessage,
  generateText,
  type JSONValue,
  jsonSchema,
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  streamText,
  type Tool,
  tool,
} from "ai";
import { jsonrepair } from "jsonrepair";
import { cachedInstructions, cachedMessages, cachedTools } from "./cache";
import {
  buildHistory,
  capToolOutput,
  clearOldToolOutputs,
  estimateTokens,
  HANDOVER_PROMPT,
  toModelOutput,
} from "./context";
import { costUsd, isRetryable, type ModelSpec } from "./models";
import { hashInput, PLAN_GRANT_REASON } from "./plan";
import { evaluateComposedPolicy, planGrantMaySatisfy } from "./policy";
import type { EventSink, RunStore } from "./store";
import { callTargets, type TrustedTargets, trustedTargets, unseenTargets } from "./targets";
import type { ToolDefinition, ToolRegistry } from "./tools";
import type {
  RunRecord,
  RunStatus,
  StoredMessage,
  ToolCallRecord,
  ToolCallStatus,
  ToolOutput,
} from "./types";

export interface RuntimeLimits {
  /** Model calls per run before the agent must stop and report. */
  maxSteps: number;
  /** Hard spend cap per run, checked before each model call. 0 disables. */
  maxCostUsd: number;
  /** Context window budget used for compaction decisions, in tokens. */
  contextTokens: number;
  maxToolOutputChars: number;
  maxOutputTokens: number;
  /** Token cap per run (input + output), the guard for models without a known price. */
  maxTokens: number;
}

export const DEFAULT_LIMITS: RuntimeLimits = {
  maxSteps: 25,
  maxCostUsd: 2,
  contextTokens: 200_000,
  maxToolOutputChars: 24_000,
  maxOutputTokens: 16_000,
  maxTokens: 3_000_000,
};

/** The signal aborted without a user cancel (e.g. the worker lost its lease). */
export class RunInterruptedError extends Error {
  constructor() {
    super("run interrupted");
  }
}

const NEW_MESSAGE_DENIAL = "The user sent a new message instead of approving this action.";

/** What the model is told when the person undoes an approved action inside its undo window. */
export const UNDO_DENIAL = "The user undid this action before it ran.";

export interface RunAgentOptions {
  runId: string;
  store: RunStore;
  events: EventSink;
  tools: ToolRegistry;
  /** Ordered fallback chain. The first model is preferred. */
  models: { spec: ModelSpec; model: LanguageModel }[];
  /** Cheap model for compaction summaries. Defaults to the first model. */
  summaryModel?: { spec: ModelSpec; model: LanguageModel };
  system: string;
  limits?: Partial<RuntimeLimits>;
  /** Aborts in-flight model and tool calls ("stop now"). */
  signal?: AbortSignal;
}

const TERMINAL: ToolCallStatus[] = ["succeeded", "failed", "denied", "unknown"];

/** How long until this approved call's undo window ends; 0 when it may run now. */
export function undoRemainingMs(call: Pick<ToolCallRecord, "executeAfter">, now = Date.now()) {
  if (!call.executeAfter) return 0;
  return Math.max(0, Date.parse(call.executeAfter) - now);
}

/**
 * When `runAgent` returns "running", the run is parked on an undo window: this is how long
 * until the earliest approved call may run. The caller re-queues the run for then.
 */
export function nextUndoWaitMs(calls: ToolCallRecord[], now = Date.now()): number {
  let wait = 0;
  for (const c of calls) {
    if (c.status !== "approved") continue;
    const ms = undoRemainingMs(c, now);
    if (ms > 0 && (wait === 0 || ms < wait)) wait = ms;
  }
  return wait;
}

/**
 * Advances a run until it completes, fails, is cancelled, or pauses for approvals.
 * Safe to call again at any point (after a crash, an approval, or a new message):
 * all progress lives in the store, nothing is held in memory between calls.
 *
 * Returns "running" when an approved action is still inside its undo window: nothing more
 * can happen until it ends, so the caller should come back after `nextUndoWaitMs`.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunStatus> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const { store, events, runId } = opts;
  const signal = opts.signal ?? new AbortController().signal;

  const setStatus = async (status: RunStatus, error?: string) => {
    await store.updateRun(runId, { status, error: error ?? null });
    await events.emit(runId, { type: "run.status", status, ...(error ? { error } : {}) });
    return status;
  };

  let run = await store.getRun(runId);
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled")
    return run.status;
  if (run.status !== "running") await setStatus("running");

  try {
    for (;;) {
      run = await store.getRun(runId);
      if (run.cancelRequested === "now") return await cancel(opts, run, setStatus);
      if (signal.aborted) throw new RunInterruptedError();

      // 1. Settle tool calls from the latest assistant step.
      const pending = await settleToolCalls(opts, run, limits, signal);
      if (pending === "waiting") {
        run = await store.getRun(runId);
        if (run.cancelRequested) return await cancel(opts, run, setStatus);
        // A message that arrived meanwhile replaces the pending approvals.
        if (await store.hasPendingInputs(run.chatId)) {
          await denyAwaiting(opts, run, NEW_MESSAGE_DENIAL);
          continue;
        }
        await setStatus("waiting");
        // Decisions or messages that landed between our check and the status write saw a
        // running run and did not re-queue it; pick them up here instead of stalling.
        const stillAwaiting = (await store.listToolCalls(runId)).some(
          (c) => c.status === "awaiting_approval",
        );
        if (stillAwaiting && !(await store.hasPendingInputs(run.chatId))) return "waiting";
        await setStatus("running");
        continue;
      }
      if (pending === "delayed") {
        run = await store.getRun(runId);
        if (run.cancelRequested === "now") return await cancel(opts, run, setStatus);
        return "running";
      }
      if (run.cancelRequested === "after_step") return await cancel(opts, run, setStatus);

      // 2. Steering: messages the user sent while we were busy join the conversation now.
      await store.drainPendingInputs(run.chatId, runId);

      const rows = await store.listMessages(run.chatId);
      const last = rows.at(-1)?.message;
      if (!last || last.role === "assistant") return await setStatus("completed");

      // 3. Guards before spending tokens.
      run = await store.getRun(runId);
      if (run.steps >= limits.maxSteps) {
        await say(
          opts,
          run,
          `I stopped after ${limits.maxSteps} steps. Tell me to continue if you want me to keep going.`,
        );
        return await setStatus("completed");
      }
      if (run.inputTokens + run.outputTokens >= limits.maxTokens) {
        await say(opts, run, "I stopped because this run reached its token limit.");
        return await setStatus("failed", "budget_exceeded");
      }
      if (limits.maxCostUsd > 0 && run.costUsd >= limits.maxCostUsd) {
        await say(
          opts,
          run,
          `I stopped because this run reached its $${limits.maxCostUsd.toFixed(2)} budget.`,
        );
        return await setStatus("failed", "budget_exceeded");
      }

      // 4. One model step.
      await modelStep(opts, run, rows, limits, signal);
      await store.updateRun(runId, { steps: run.steps + 1 });
    }
  } catch (error) {
    if (signal.aborted) {
      const current = await store.getRun(runId);
      if (current.cancelRequested === "now") return await cancel(opts, current, setStatus);
      // Not ours to finish (lease lost or shutting down): leave state for the next worker.
      throw error instanceof RunInterruptedError ? error : new RunInterruptedError();
    }
    const message = error instanceof Error ? error.message : String(error);
    await events.emit(runId, { type: "error", message, retryable: isRetryable(error) });
    if (isRetryable(error)) throw error; // the worker retries the whole run later
    return await setStatus("failed", message);
  }
}

async function cancel(
  opts: RunAgentOptions,
  run: RunRecord,
  setStatus: (s: RunStatus, e?: string) => Promise<RunStatus>,
): Promise<RunStatus> {
  for (const call of await opts.store.listToolCalls(run.id)) {
    if (
      call.status === "proposed" ||
      call.status === "awaiting_approval" ||
      call.status === "approved"
    ) {
      await resolve(opts, call, ["proposed", "awaiting_approval", "approved"], "denied", {
        type: "denied",
        reason: "The user stopped the run before this action ran.",
      });
    }
  }
  await writeToolResults(opts, run);
  return setStatus("cancelled");
}

async function denyAwaiting(opts: RunAgentOptions, run: RunRecord, reason: string) {
  for (const call of await opts.store.listToolCalls(run.id)) {
    if (call.status === "awaiting_approval") {
      await resolve(opts, call, ["awaiting_approval"], "denied", { type: "denied", reason });
    }
  }
}

async function say(opts: RunAgentOptions, run: RunRecord, text: string): Promise<void> {
  const message: AssistantModelMessage = { role: "assistant", content: [{ type: "text", text }] };
  const stored = await opts.store.appendMessage({
    chatId: run.chatId,
    runId: run.id,
    model: null,
    message,
  });
  await opts.events.emit(run.id, {
    type: "message.start",
    messageId: stored.id,
    role: "assistant",
  });
  await opts.events.emit(run.id, { type: "text.delta", messageId: stored.id, delta: text });
  await opts.events.emit(run.id, { type: "message.end", messageId: stored.id });
}

// ── Tool calls ──────────────────────────────────────────────────────────────

async function settleToolCalls(
  opts: RunAgentOptions,
  run: RunRecord,
  limits: RuntimeLimits,
  signal: AbortSignal,
): Promise<"waiting" | "delayed" | "settled"> {
  const calls = await opts.store.listToolCalls(run.id);

  // Crash recovery: a call left "executing" was interrupted. Reads are safe to repeat;
  // anything with side effects is marked unknown and reported, never retried.
  for (const call of calls.filter((c) => c.status === "executing")) {
    // Only built-in reads are known to be side-effect free; MCP annotations are hints.
    if (call.effect === "read" && opts.tools.get(call.name)?.source === "builtin") {
      await opts.store.transitionToolCall(call.runId, call.id, ["executing"], {
        status: "approved",
      });
      call.status = "approved";
    } else {
      await resolve(opts, call, ["executing"], "unknown", {
        type: "error",
        value:
          "The server restarted while this action was running. It may or may not have completed; it was not retried. Check before trying again.",
      });
      call.status = "unknown";
    }
  }

  if (calls.some((c) => c.status === "awaiting_approval")) return "waiting";

  const approved = calls.filter((c) => c.status === "approved");
  const reads = approved.filter((c) => c.effect === "read" && undoRemainingMs(c) === 0);
  const writes = approved.filter((c) => !reads.includes(c));
  await Promise.all(reads.map((c) => execute(opts, run, c, limits, signal)));

  // Writes proposed in the same step as an untrusted read were judged before the run was
  // tainted. Re-judge them now; anything auto-allowed goes back to the user. Steps of an
  // approved plan stay allowed: the user signed off on that exact input.
  if (run.tainted && reads.length > 0) {
    let asked = false;
    for (const c of writes.filter(
      (w) => w.decision === "allow" && w.decisionReason !== PLAN_GRANT_REASON,
    )) {
      const reason =
        "This step read untrusted content, so this action needs your approval before it runs.";
      if (
        await opts.store.transitionToolCall(run.id, c.id, ["approved"], {
          status: "awaiting_approval",
          decisionReason: reason,
        })
      ) {
        asked = true;
        await opts.events.emit(run.id, {
          type: "tool.status",
          toolCallId: c.id,
          status: "awaiting_approval",
          reason,
        });
        await opts.events.emit(run.id, {
          type: "approval.requested",
          toolCallId: c.id,
          name: c.name,
          input: c.input,
          effect: c.effect,
          reason,
          preview: c.preview,
        });
      }
    }
    if (asked) {
      await writeToolResults(opts, run);
      return "waiting";
    }
  }

  // Writes run in the order the model proposed them. One still inside its undo window holds
  // back the rest, so a later write never overtakes an earlier one.
  for (const c of writes) {
    if (signal.aborted) break;
    if (undoRemainingMs(c) > 0) {
      await opts.events.emit(run.id, {
        type: "tool.status",
        toolCallId: c.id,
        status: "approved",
        executeAfter: c.executeAfter ?? null,
      });
      return "delayed";
    }
    await execute(opts, run, c, limits, signal);
  }

  await writeToolResults(opts, run);
  return "settled";
}

async function execute(
  opts: RunAgentOptions,
  run: RunRecord,
  call: ToolCallRecord,
  limits: RuntimeLimits,
  signal: AbortSignal,
): Promise<void> {
  if (
    !(await opts.store.transitionToolCall(call.runId, call.id, ["approved"], {
      status: "executing",
    }))
  )
    return;
  await opts.events.emit(run.id, { type: "tool.status", toolCallId: call.id, status: "executing" });

  const def = opts.tools.get(call.name);
  let full: ToolOutput;
  if (!def) {
    full = { type: "error", value: `Tool ${call.name} is no longer available.` };
  } else {
    try {
      full = await def.execute(call.input, {
        userId: run.userId,
        chatId: run.chatId,
        runId: run.id,
        toolCallId: call.id,
        abortSignal: signal,
      });
    } catch (error) {
      full = { type: "error", value: error instanceof Error ? error.message : String(error) };
    }
    // Interrupted mid-flight: a side effect may already have happened.
    if (signal.aborted && call.effect !== "read") {
      await resolve(opts, call, ["executing"], "unknown", {
        type: "error",
        value:
          "This action was interrupted while running. It may or may not have completed; it was not retried. Check before trying again.",
      });
      return;
    }
    if (def.untrustedOutput && full.type !== "error" && !run.tainted) {
      run.tainted = true;
      await opts.store.updateRun(run.id, { tainted: true });
    }
  }
  if (call.inputEdited && full.type === "text") {
    full = {
      type: "text",
      value: `Note: the user edited the input before approving. Input used: ${JSON.stringify(call.input)}\n\n${full.value}`,
    };
  }

  const output = capToolOutput(full, limits.maxToolOutputChars);
  const status = full.type === "error" ? "failed" : "succeeded";
  await resolve(opts, call, ["executing"], status, output, full);
}

async function resolve(
  opts: RunAgentOptions,
  call: ToolCallRecord,
  from: ToolCallStatus[],
  status: ToolCallStatus,
  output: ToolOutput,
  fullOutput?: ToolOutput,
): Promise<void> {
  const ok = await opts.store.transitionToolCall(call.runId, call.id, from, {
    status,
    output,
    ...(fullOutput ? { fullOutput } : {}),
  });
  if (!ok) return;
  await opts.events.emit(call.runId, { type: "tool.status", toolCallId: call.id, status });
  await opts.events.emit(call.runId, { type: "tool.result", toolCallId: call.id, output });
}

/** Once every call from the latest assistant step is terminal, append one tool message with all results. */
async function writeToolResults(opts: RunAgentOptions, run: RunRecord): Promise<void> {
  const rows = await opts.store.listMessages(run.chatId);
  const last = rows.at(-1);
  if (last?.message.role !== "assistant" || !Array.isArray(last.message.content)) return;
  const callParts = last.message.content.filter((p) => p.type === "tool-call");
  if (callParts.length === 0) return;

  const records = new Map((await opts.store.listToolCalls(run.id)).map((c) => [c.id, c]));
  const settled = callParts.map((p) => records.get(p.toolCallId));
  if (settled.some((c) => !c || !TERMINAL.includes(c.status))) return;

  await opts.store.appendMessage({
    chatId: run.chatId,
    runId: run.id,
    model: null,
    message: {
      role: "tool",
      content: settled.map((c) => ({
        type: "tool-result" as const,
        toolCallId: c!.id,
        toolName: c!.name,
        output: toModelOutput(c!.output ?? { type: "error", value: "No output recorded." }),
      })),
    },
  });
}

// ── Model step ──────────────────────────────────────────────────────────────

/** `rows` is the chat history the caller just read, reused to save a query per step. */
async function modelStep(
  opts: RunAgentOptions,
  run: RunRecord,
  rows: StoredMessage[],
  limits: RuntimeLimits,
  signal: AbortSignal,
): Promise<void> {
  let lastError: unknown;
  for (const candidate of opts.models) {
    let messages = buildHistory(rows, candidate.spec.ref);
    messages = await compactIfNeeded(opts, run, candidate, messages, limits);

    const attempt = await streamOneStep(opts, run, rows, candidate, messages, limits, signal);
    if (attempt.ok) return;
    lastError = attempt.error;
    if (attempt.started || !isRetryable(attempt.error)) throw attempt.error;
    // Compaction may have stored a handover for this attempt; the next model should see it.
    rows = await opts.store.listMessages(run.chatId);
  }
  throw lastError ?? new Error("no model configured");
}

type StepAttempt = { ok: true } | { ok: false; started: boolean; error: unknown };

async function streamOneStep(
  opts: RunAgentOptions,
  run: RunRecord,
  rows: StoredMessage[],
  candidate: { spec: ModelSpec; model: LanguageModel },
  messages: ModelMessage[],
  limits: RuntimeLimits,
  signal: AbortSignal,
): Promise<StepAttempt> {
  const { store, events } = opts;
  const messageId = crypto.randomUUID();
  let started = false;
  let streamError: unknown;

  const result = streamText({
    model: candidate.model,
    instructions: cachedInstructions(candidate.spec, opts.system),
    messages: cachedMessages(candidate.spec, messages),
    tools: cachedTools(candidate.spec, toSdkTools(opts.tools)),
    stopWhen: stepCountIs(1),
    maxOutputTokens: limits.maxOutputTokens,
    maxRetries: 2,
    abortSignal: signal,
    repairToolCall: async ({ toolCall }) => {
      try {
        return { ...toolCall, input: jsonrepair(toolCall.input) };
      } catch {
        return null;
      }
    },
    onError: ({ error }) => {
      streamError = error;
    },
  });

  try {
    for await (const part of result.fullStream) {
      if (part.type === "text-delta" || part.type === "reasoning-delta") {
        if (!started) {
          started = true;
          await events.emit(run.id, { type: "message.start", messageId, role: "assistant" });
        }
        await events.emit(run.id, {
          type: part.type === "text-delta" ? "text.delta" : "reasoning.delta",
          messageId,
          delta: part.text,
        });
      } else if (part.type === "error") {
        streamError = part.error;
      }
    }
  } catch (error) {
    streamError ??= error;
  }
  if (streamError) {
    if (started) await events.emit(run.id, { type: "message.end", messageId });
    return { ok: false, started, error: streamError };
  }

  const response = await result.response;
  const usage = await result.totalUsage;
  const metadata = await result.providerMetadata;
  const message = response.messages.find(
    (m): m is AssistantModelMessage => m.role === "assistant",
  ) ?? {
    role: "assistant" as const,
    content: [],
  };
  const rawContent = Array.isArray(message.content)
    ? message.content
    : [{ type: "text" as const, text: message.content }];
  // Some models (often local ones) reuse ids like "call_0" across steps. Ids must be
  // unique within a run, so colliding ids are replaced before anything is stored.
  const seen = new Set((await store.listToolCalls(run.id)).map((c) => c.id));
  const content = rawContent.map((part) => {
    if (part.type !== "tool-call") return part;
    const id = seen.has(part.toolCallId)
      ? `${part.toolCallId}_${crypto.randomUUID().slice(0, 8)}`
      : part.toolCallId;
    seen.add(id);
    return id === part.toolCallId ? part : { ...part, toolCallId: id };
  });

  const policy = await store.getPolicy(run.userId);
  const toolCalls: Omit<ToolCallRecord, "messageId" | "runId">[] = [];
  const grants = run.planGrants.map((g) => ({ ...g }));
  let grantsUsed = false;
  // Destinations already in play before outside content arrived; only needed once tainted.
  let trusted: TrustedTargets | null = null;
  const skills = run.skills.length > 0 ? run.skills.map((u) => ({ ...u })) : null;
  for (const part of content) {
    if (part.type !== "tool-call") continue;
    const def = opts.tools.get(part.toolName);
    const input = (part.input ?? {}) as JSONValue;
    const base = {
      id: part.toolCallId,
      name: part.toolName,
      input,
      inputEdited: false,
      decidedBy: null,
      preview: safePreview(def, input),
      skills,
    };
    if (!def) {
      toolCalls.push({
        ...base,
        effect: "read",
        status: "failed",
        decision: "block",
        decisionReason: "unknown tool",
        output: { type: "error", value: `There is no tool named ${part.toolName}.` },
      });
      continue;
    }
    // A read never widens the write: destinations that first appeared in outside content.
    let newTargets: ReturnType<typeof unseenTargets> = [];
    if (run.tainted && def.effect !== "read") {
      trusted ??= trustedTargets(rows, {
        system: opts.system,
        untrustedTool: (name) => opts.tools.get(name)?.untrustedOutput ?? true,
      });
      newTargets = unseenTargets(callTargets(input, def.effect), trusted);
    }
    // The person's own policy plus their team's rules; the strictest verdict wins.
    let verdict = evaluateComposedPolicy(
      {
        tool: def.name,
        effect: def.effect,
        input,
        tainted: run.tainted,
        ...(def.defaultDecision ? { defaultDecision: def.defaultDecision } : {}),
        ...(newTargets.length > 0 ? { newTargets } : {}),
      },
      policy,
      policy.teamRules,
    );
    // A call matching a step of an approved plan, exactly, was already signed off by the
    // user: it runs without asking again, even in a tainted run. Block rules still win, and
    // so does a team rule that needs an admin: the user's own sign-off can't stand in for it.
    // Nor can it for a destination that first appeared in outside content.
    if (planGrantMaySatisfy(verdict) && grants.some((g) => !g.usedBy && g.tool === def.name)) {
      const hash = await hashInput(input);
      const grant = grants.find((g) => !g.usedBy && g.tool === def.name && g.inputHash === hash);
      if (grant) {
        grant.usedBy = part.toolCallId;
        grantsUsed = true;
        verdict = {
          decision: "allow",
          reason: PLAN_GRANT_REASON,
          ruleId: null,
          approver: null,
          source: "personal",
        };
      }
    }
    const status: ToolCallStatus =
      verdict.decision === "allow"
        ? "approved"
        : verdict.decision === "ask"
          ? "awaiting_approval"
          : "denied";
    toolCalls.push({
      ...base,
      effect: def.effect,
      status,
      decision: verdict.decision,
      decisionReason: verdict.reason,
      approver: status === "awaiting_approval" ? verdict.approver : null,
      output:
        status === "denied"
          ? { type: "denied", reason: `Blocked by policy: ${verdict.reason}` }
          : null,
    });
  }

  // Spend grants before recording the calls: a crash in between costs a grant (the call
  // asks instead), never lets one grant cover two calls.
  if (grantsUsed) await store.updateRun(run.id, { planGrants: grants });
  const stored = await store.appendAssistantStep({
    id: messageId,
    chatId: run.chatId,
    runId: run.id,
    model: candidate.spec.ref,
    message: { role: "assistant", content },
    toolCalls,
  });
  if (started) await events.emit(run.id, { type: "message.end", messageId });

  for (const call of toolCalls) {
    await events.emit(run.id, {
      type: "tool.call",
      toolCallId: call.id,
      messageId: stored.id,
      name: call.name,
      input: call.input,
      effect: call.effect,
      ...(call.skills ? { skills: call.skills } : {}),
    });
    await events.emit(run.id, {
      type: "tool.status",
      toolCallId: call.id,
      status: call.status,
      decision: call.decision,
      reason: call.decisionReason,
    });
    if (call.status === "awaiting_approval") {
      await events.emit(run.id, {
        type: "approval.requested",
        toolCallId: call.id,
        name: call.name,
        input: call.input,
        effect: call.effect,
        reason: call.decisionReason ?? "",
        preview: call.preview,
        ...(call.approver ? { approver: call.approver } : {}),
      });
    }
    if (call.output)
      await events.emit(run.id, { type: "tool.result", toolCallId: call.id, output: call.output });
  }

  const cost = costUsd(candidate.spec.ref, usage, undefined, metadata);
  await store.addUsage(run.id, {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    costUsd: cost,
  });
  if (run.model !== candidate.spec.ref)
    await store.updateRun(run.id, { model: candidate.spec.ref });
  await events.emit(run.id, {
    type: "usage",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    costUsd: cost,
  });
  return { ok: true };
}

function safePreview(def: ToolDefinition | undefined, input: JSONValue): string | null {
  try {
    return def?.preview?.(input)?.slice(0, 300) ?? null;
  } catch {
    return null;
  }
}

/** Tools as declared to the model. No `execute`: the runtime owns execution and approvals. */
function toSdkTools(registry: ToolRegistry): Record<string, Tool> {
  return Object.fromEntries(
    registry
      .list()
      .map((t) => [
        t.name,
        tool({ description: t.description, inputSchema: jsonSchema(t.inputSchema) }),
      ]),
  );
}

// ── Compaction ──────────────────────────────────────────────────────────────

/** Tool outputs are cleared in batches of this many messages (see `clearOldToolOutputs`). */
const CLEAR_CHUNK = 8;

async function compactIfNeeded(
  opts: RunAgentOptions,
  run: RunRecord,
  candidate: { spec: ModelSpec; model: LanguageModel },
  messages: ModelMessage[],
  limits: RuntimeLimits,
): Promise<ModelMessage[]> {
  if (estimateTokens(messages) <= limits.contextTokens * 0.6) return messages;

  // Chunked clearing keeps the cached prefix stable for several steps; clear everything old
  // only if that is not enough.
  const chunked = clearOldToolOutputs(messages, 4, CLEAR_CHUNK);
  if (estimateTokens(chunked) <= limits.contextTokens * 0.8) return chunked;
  const cleared = clearOldToolOutputs(messages);
  if (estimateTokens(cleared) <= limits.contextTokens * 0.8) return cleared;

  // Summarise everything before the latest user turn; that turn and later rows stay verbatim.
  const rows = await opts.store.listMessages(run.chatId);
  const cutoff = rows.findLast((r) => r.kind === "message" && r.message.role === "user");
  if (!cutoff) return cleared;
  // Already summarised up to this turn: summarising again would not shrink anything.
  if (rows.some((r) => r.kind === "handover" && r.cutoffSeq === cutoff.seq)) return cleared;
  const before = buildHistory(
    rows.filter((r) => r.seq < cutoff.seq),
    candidate.spec.ref,
  );
  if (before.length === 0) return cleared;

  const summarizer = opts.summaryModel ?? candidate;
  const { text, usage, providerMetadata } = await generateText({
    model: summarizer.model,
    instructions: HANDOVER_PROMPT,
    messages: [
      ...clearOldToolOutputs(before, 2),
      { role: "user", content: "Write the handover note now." },
    ],
    maxOutputTokens: 4_000,
  });
  await opts.store.addUsage(run.id, {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    costUsd: costUsd(summarizer.spec.ref, usage, undefined, providerMetadata),
  });
  const handover = await opts.store.appendMessage({
    chatId: run.chatId,
    runId: run.id,
    model: null,
    kind: "handover",
    cutoffSeq: cutoff.seq,
    message: { role: "user", content: `[Handover summary of the earlier conversation]\n\n${text}` },
  });
  await opts.events.emit(run.id, { type: "compacted", messageId: handover.id });
  return buildHistory(await opts.store.listMessages(run.chatId), candidate.spec.ref);
}
