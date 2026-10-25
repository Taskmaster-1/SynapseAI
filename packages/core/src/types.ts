import type { JSONValue, ModelMessage } from "ai";

/** What a tool can do to the outside world. Drives default approval policy. */
export type Effect = "read" | "write" | "send" | "destructive";

export type RunStatus =
  | "queued"
  | "running"
  | "waiting" // paused on approvals or ask-user
  | "completed"
  | "failed"
  | "cancelled";

export type ToolCallStatus =
  | "proposed"
  | "awaiting_approval"
  | "approved"
  | "denied"
  | "executing"
  | "succeeded"
  | "failed"
  /** Crashed mid-execution of a side-effecting call. Never retried automatically. */
  | "unknown";

export type Decision = "allow" | "ask" | "block";

export interface ToolCallRecord {
  id: string;
  runId: string;
  messageId: string;
  name: string;
  input: JSONValue;
  /** True when the user edited the input on the approval card. */
  inputEdited: boolean;
  effect: Effect;
  status: ToolCallStatus;
  decision: Decision;
  decisionReason: string | null;
  /** Human-readable one-line summary of this call (from the tool), e.g. "Email bob@acme.com". */
  preview: string | null;
  /** Output as given back to the model (already size-capped). */
  output: ToolOutput | null;
  decidedBy: string | null;
  /**
   * Undo window (ISO time): an approved call does not run before this. Set when a person
   * approves a send or destructive action; null or absent means it may run now.
   */
  executeAfter?: string | null;
}

export type ToolOutput =
  | { type: "text"; value: string }
  | { type: "json"; value: JSONValue }
  | { type: "error"; value: string }
  | { type: "denied"; reason: string };

export interface RunRecord {
  id: string;
  chatId: string;
  userId: string;
  status: RunStatus;
  /** Set once untrusted content (emails, web pages, files) entered the context. */
  tainted: boolean;
  steps: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error: string | null;
  cancelRequested: "now" | "after_step" | null;
}

export interface StoredMessage {
  id: string;
  chatId: string;
  runId: string | null;
  seq: number;
  /** Model that produced an assistant message; reasoning is only replayed to the same model. */
  model: string | null;
  message: ModelMessage;
  /**
   * "handover" rows are compaction summaries: the model sees history from the latest
   * handover onwards; the UI shows everything.
   */
  kind: "message" | "handover";
  /** For handovers: the summary covers rows with seq < cutoffSeq. */
  cutoffSeq: number | null;
}

/** Events streamed to clients. `seq` is assigned by the event log. */
export type RunEvent =
  | { type: "run.status"; status: RunStatus; error?: string }
  | { type: "message.start"; messageId: string; role: "assistant" }
  | { type: "text.delta"; messageId: string; delta: string }
  | { type: "reasoning.delta"; messageId: string; delta: string }
  | { type: "message.end"; messageId: string }
  | {
      type: "tool.call";
      toolCallId: string;
      messageId: string;
      name: string;
      input: JSONValue;
      effect: Effect;
    }
  | {
      type: "tool.status";
      toolCallId: string;
      status: ToolCallStatus;
      decision?: Decision;
      reason?: string | null;
      /** For approved calls in an undo window: when it will run (ISO time). */
      executeAfter?: string | null;
    }
  | { type: "tool.result"; toolCallId: string; output: ToolOutput }
  | {
      type: "approval.requested";
      toolCallId: string;
      name: string;
      input: JSONValue;
      effect: Effect;
      reason: string;
      preview: string | null;
    }
  | { type: "usage"; inputTokens: number; outputTokens: number; costUsd: number }
  | { type: "compacted"; messageId: string }
  | { type: "error"; message: string; retryable: boolean };

export type SeqEvent = RunEvent & { seq: number; runId: string };
