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
   * "admin" when a team rule says a workspace admin (not the requester) must decide.
   * Null or absent: the requester decides.
   */
  approver?: "admin" | null;
  /**
   * Undo window (ISO time): an approved call does not run before this. Set when a person
   * approves a send or destructive action; null or absent means it may run now.
   */
  executeAfter?: string | null;
  /**
   * Skills loaded in this run when the call was proposed, each with the content hash of the
   * version that was read. For audit: which instructions were in play. Null or absent: none.
   */
  skills?: SkillUse[] | null;
}

/** A skill the agent loaded, by name and content hash (see `skillVersion`). */
export interface SkillUse {
  name: string;
  version: string;
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
  /** Exact calls the user approved through `propose_plan`; each runs once without asking. */
  planGrants: PlanGrant[];
  /** Skills loaded with `load_skill` during this run, in load order. */
  skills: SkillUse[];
}

/** One approved plan step: a tool name and the hash of its canonical input. */
export interface PlanGrant {
  tool: string;
  inputHash: string;
  /** Id of the tool call that used this grant. Unset while the grant is still open. */
  usedBy?: string;
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
  /**
   * A user-role row that quotes third-party content (an event trigger's email or webhook
   * payload). It taints like a tool result would, and names no trusted destinations.
   */
  untrusted?: boolean;
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
      /** Skills loaded in the run when this call was proposed. */
      skills?: SkillUse[];
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
      /** "admin": a workspace admin must decide; the requester sees it as waiting. */
      approver?: "admin" | null;
    }
  | { type: "usage"; inputTokens: number; outputTokens: number; costUsd: number }
  | { type: "compacted"; messageId: string }
  | { type: "error"; message: string; retryable: boolean };

export type SeqEvent = RunEvent & { seq: number; runId: string };
