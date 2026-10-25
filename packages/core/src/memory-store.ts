import type { PolicyDefaults, PolicyRule } from "./policy";
import { SAFE_DEFAULTS } from "./policy";
import { UNDO_DENIAL } from "./runtime";
import type { EventSink, RunStore } from "./store";
import type { RunEvent, RunRecord, StoredMessage, ToolCallRecord } from "./types";

/** In-memory RunStore for tests and evals. Mirrors the Postgres store's semantics. */
export class MemoryStore implements RunStore {
  runs = new Map<string, RunRecord>();
  messages: StoredMessage[] = [];
  toolCalls = new Map<string, ToolCallRecord & { fullOutput?: unknown }>();
  pendingInputs: { chatId: string; text: string }[] = [];
  rules: PolicyRule[] = [];
  defaults: PolicyDefaults = SAFE_DEFAULTS;
  private seq = 0;

  createRun(init: { chatId: string; userId: string; text?: string }): RunRecord {
    const run: RunRecord = {
      id: crypto.randomUUID(),
      chatId: init.chatId,
      userId: init.userId,
      status: "queued",
      tainted: false,
      steps: 0,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      error: null,
      cancelRequested: null,
    };
    this.runs.set(run.id, run);
    if (init.text) this.pushUser(init.chatId, run.id, init.text);
    return run;
  }

  pushUser(chatId: string, runId: string | null, text: string): StoredMessage {
    return this.push({ chatId, runId, model: null, message: { role: "user", content: text } });
  }

  async getRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    return { ...run };
  }

  async updateRun(runId: string, patch: Partial<RunRecord>) {
    Object.assign(this.runs.get(runId)!, patch);
  }

  async addUsage(runId: string, u: { inputTokens: number; outputTokens: number; costUsd: number }) {
    const run = this.runs.get(runId)!;
    run.inputTokens += u.inputTokens;
    run.outputTokens += u.outputTokens;
    run.costUsd += u.costUsd;
  }

  async listMessages(chatId: string) {
    return this.messages.filter((m) => m.chatId === chatId);
  }

  async appendMessage(msg: Parameters<RunStore["appendMessage"]>[0]) {
    return this.push(msg);
  }

  private push(msg: Parameters<RunStore["appendMessage"]>[0] & { id?: string }): StoredMessage {
    const row: StoredMessage = {
      id: msg.id ?? crypto.randomUUID(),
      seq: ++this.seq,
      chatId: msg.chatId,
      runId: msg.runId,
      model: msg.model,
      message: structuredClone(msg.message),
      kind: msg.kind ?? "message",
      cutoffSeq: msg.cutoffSeq ?? null,
    };
    this.messages.push(row);
    return row;
  }

  async appendAssistantStep(args: Parameters<RunStore["appendAssistantStep"]>[0]) {
    const row = this.push({
      id: args.id,
      chatId: args.chatId,
      runId: args.runId,
      model: args.model,
      message: args.message,
    });
    for (const c of args.toolCalls)
      this.toolCalls.set(c.id, { ...c, runId: args.runId, messageId: row.id });
    return row;
  }

  async listToolCalls(runId: string) {
    return [...this.toolCalls.values()].filter((c) => c.runId === runId).map((c) => ({ ...c }));
  }

  async transitionToolCall(
    runId: string,
    id: string,
    from: ToolCallRecord["status"][],
    patch: Parameters<RunStore["transitionToolCall"]>[3],
  ) {
    const call = this.toolCalls.get(id);
    if (!call || call.runId !== runId || !from.includes(call.status)) return false;
    call.status = patch.status;
    if (patch.output) call.output = patch.output;
    if (patch.fullOutput) call.fullOutput = patch.fullOutput;
    if (patch.decisionReason) call.decisionReason = patch.decisionReason;
    return true;
  }

  async hasPendingInputs(chatId: string) {
    return this.pendingInputs.some((p) => p.chatId === chatId);
  }

  async drainPendingInputs(chatId: string, runId: string) {
    const mine = this.pendingInputs.filter((p) => p.chatId === chatId);
    this.pendingInputs = this.pendingInputs.filter((p) => p.chatId !== chatId);
    for (const p of mine) this.pushUser(chatId, runId, p.text);
    return mine.length;
  }

  async getPolicy() {
    return { rules: this.rules, defaults: this.defaults };
  }

  /**
   * Test helper mirroring the decision endpoint: approve or deny one awaiting call.
   * `undoMs` opens an undo window on an approval.
   */
  decide(id: string, approved: boolean, reason?: string, undoMs = 0) {
    const call = this.toolCalls.get(id);
    if (call?.status !== "awaiting_approval") return false;
    call.status = approved ? "approved" : "denied";
    if (approved && undoMs > 0) call.executeAfter = new Date(Date.now() + undoMs).toISOString();
    if (!approved)
      call.output = { type: "denied", reason: reason ?? "The user denied this action." };
    return true;
  }

  /** Test helper mirroring the undo endpoint: approved → denied while the window is open. */
  undo(id: string) {
    const call = this.toolCalls.get(id);
    if (call?.status !== "approved" || !call.executeAfter) return false;
    if (Date.parse(call.executeAfter) <= Date.now()) return false;
    call.status = "denied";
    call.output = { type: "denied", reason: UNDO_DENIAL };
    return true;
  }
}

export class MemoryEvents implements EventSink {
  events: (RunEvent & { runId: string })[] = [];
  emit(runId: string, event: RunEvent) {
    this.events.push({ ...event, runId });
  }
}
