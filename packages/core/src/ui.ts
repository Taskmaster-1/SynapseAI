/**
 * Client-facing chat model and the reducer that applies run events to it.
 * Pure and dependency-free so the web app imports it directly (`@synapse/core/ui`).
 */
import type { ModelMessage } from "ai";
import type {
  Decision,
  Effect,
  RunStatus,
  SeqEvent,
  StoredMessage,
  ToolCallRecord,
  ToolCallStatus,
  ToolOutput,
} from "./types";

export type UiPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool";
      toolCallId: string;
      name: string;
      input: unknown;
      effect: Effect;
      status: ToolCallStatus;
      decision: Decision | null;
      reason: string | null;
      output: ToolOutput | null;
      preview: string | null;
      /** Undo window: an approved call waits until this time (ISO) before it runs. */
      executeAfter?: string | null;
    };

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "handover";
  parts: UiPart[];
  runId: string | null;
}

export interface UiRun {
  id: string;
  status: RunStatus;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  lastSeq: number;
}

export interface ChatState {
  messages: UiMessage[];
  run: UiRun | null;
}

function textOf(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** Folds stored rows plus tool call records into display messages. Tool rows are merged into their call parts. */
export function toUiMessages(rows: StoredMessage[], calls: ToolCallRecord[]): UiMessage[] {
  const byId = new Map(calls.map((c) => [c.id, c]));
  const out: UiMessage[] = [];
  for (const row of rows) {
    const m = row.message;
    if (row.kind === "handover") {
      out.push({
        id: row.id,
        role: "handover",
        parts: [{ type: "text", text: textOf(m.content) }],
        runId: row.runId,
      });
      continue;
    }
    if (m.role === "user") {
      out.push({
        id: row.id,
        role: "user",
        parts: [{ type: "text", text: textOf(m.content) }],
        runId: row.runId,
      });
    } else if (m.role === "assistant") {
      const content =
        typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
      const parts: UiPart[] = [];
      for (const p of content) {
        if (p.type === "text" && p.text) parts.push({ type: "text", text: p.text });
        else if (p.type === "reasoning" && p.text) parts.push({ type: "reasoning", text: p.text });
        else if (p.type === "tool-call") {
          const rec = byId.get(p.toolCallId);
          parts.push({
            type: "tool",
            toolCallId: p.toolCallId,
            name: p.toolName,
            input: rec?.input ?? p.input,
            effect: rec?.effect ?? "read",
            status: rec?.status ?? "failed",
            decision: rec?.decision ?? null,
            reason: rec?.decisionReason ?? null,
            output: rec?.output ?? null,
            preview: rec?.preview ?? null,
            ...(rec?.executeAfter ? { executeAfter: rec.executeAfter } : {}),
          });
        }
      }
      if (parts.length > 0) out.push({ id: row.id, role: "assistant", parts, runId: row.runId });
    }
  }
  return out;
}

function findTool(state: ChatState, toolCallId: string) {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msg = state.messages[i]!;
    const idx = msg.parts.findIndex((p) => p.type === "tool" && p.toolCallId === toolCallId);
    if (idx >= 0) return { i, idx };
  }
  return null;
}

function updateTool(
  state: ChatState,
  toolCallId: string,
  patch: Partial<Extract<UiPart, { type: "tool" }>>,
): ChatState {
  const at = findTool(state, toolCallId);
  if (!at) return state;
  const messages = [...state.messages];
  const msg = messages[at.i]!;
  const parts = [...msg.parts];
  parts[at.idx] = { ...(parts[at.idx] as Extract<UiPart, { type: "tool" }>), ...patch };
  messages[at.i] = { ...msg, parts };
  return { ...state, messages };
}

function appendDelta(
  state: ChatState,
  messageId: string,
  kind: "text" | "reasoning",
  delta: string,
  runId: string,
): ChatState {
  const messages = [...state.messages];
  let i = messages.findIndex((m) => m.id === messageId);
  if (i < 0) {
    messages.push({ id: messageId, role: "assistant", parts: [], runId });
    i = messages.length - 1;
  }
  const msg = messages[i]!;
  const parts = [...msg.parts];
  const last = parts.at(-1);
  if (last && last.type === kind) parts[parts.length - 1] = { ...last, text: last.text + delta };
  else parts.push({ type: kind, text: delta });
  messages[i] = { ...msg, parts };
  return { ...state, messages };
}

/**
 * Applies one run event. Idempotent per seq: events at or below `run.lastSeq` are ignored,
 * so replaying after a reconnect is safe.
 * Streamed deltas and tool calls carry the id of the stored message they belong to.
 */
export function applyEvent(state: ChatState, e: SeqEvent): ChatState {
  if (state.run && state.run.id === e.runId && e.seq <= state.run.lastSeq) return state;
  const run: UiRun =
    state.run && state.run.id === e.runId
      ? { ...state.run, lastSeq: e.seq }
      : {
          id: e.runId,
          status: "running",
          error: null,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          lastSeq: e.seq,
        };
  let next: ChatState = { ...state, run };

  switch (e.type) {
    case "run.status":
      next.run = { ...run, status: e.status, error: e.error ?? null };
      return next;
    case "usage":
      next.run = {
        ...run,
        inputTokens: run.inputTokens + e.inputTokens,
        outputTokens: run.outputTokens + e.outputTokens,
        costUsd: run.costUsd + e.costUsd,
      };
      return next;
    case "message.start":
      if (!next.messages.some((m) => m.id === e.messageId)) {
        next = {
          ...next,
          messages: [
            ...next.messages,
            { id: e.messageId, role: "assistant", parts: [], runId: e.runId },
          ],
        };
      }
      return next;
    case "text.delta":
      return appendDelta(next, e.messageId, "text", e.delta, e.runId);
    case "reasoning.delta":
      return appendDelta(next, e.messageId, "reasoning", e.delta, e.runId);
    case "tool.call": {
      if (findTool(next, e.toolCallId)) return next;
      const messages = [...next.messages];
      let i = messages.findIndex((m) => m.id === e.messageId);
      if (i < 0) {
        messages.push({ id: e.messageId, role: "assistant", parts: [], runId: e.runId });
        i = messages.length - 1;
      }
      const msg = messages[i]!;
      messages[i] = {
        ...msg,
        parts: [
          ...msg.parts,
          {
            type: "tool",
            toolCallId: e.toolCallId,
            name: e.name,
            input: e.input,
            effect: e.effect,
            status: "proposed",
            decision: null,
            reason: null,
            output: null,
            preview: null,
          },
        ],
      };
      return { ...next, messages };
    }
    case "tool.status":
      return updateTool(next, e.toolCallId, {
        status: e.status,
        ...(e.decision ? { decision: e.decision } : {}),
        ...(e.reason !== undefined ? { reason: e.reason } : {}),
        ...(e.executeAfter !== undefined ? { executeAfter: e.executeAfter } : {}),
      });
    case "approval.requested":
      return updateTool(next, e.toolCallId, {
        status: "awaiting_approval",
        reason: e.reason,
        preview: e.preview,
      });
    case "tool.result":
      return updateTool(next, e.toolCallId, { output: e.output });
    case "compacted":
    case "message.end":
    case "error":
      return next;
  }
}

export function isActive(status: RunStatus | undefined): boolean {
  return status === "queued" || status === "running";
}
