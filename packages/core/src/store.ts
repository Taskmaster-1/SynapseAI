import type { AssistantModelMessage, ModelMessage } from "ai";
import type { PolicyDefaults, PolicyRule } from "./policy";
import type {
  RunEvent,
  RunRecord,
  StoredMessage,
  ToolCallRecord,
  ToolCallStatus,
  ToolOutput,
} from "./types";

/**
 * Persistence port for the runtime. The Postgres implementation lives in @synapse/db;
 * an in-memory one is used in tests and evals.
 *
 * Every method is scoped by run or chat id; the caller (worker) has already checked that
 * the run belongs to the user and holds its lease.
 */
export interface RunStore {
  getRun(runId: string): Promise<RunRecord>;
  updateRun(
    runId: string,
    patch: Partial<Pick<RunRecord, "status" | "tainted" | "model" | "error" | "steps">>,
  ): Promise<void>;
  addUsage(
    runId: string,
    usage: { inputTokens: number; outputTokens: number; costUsd: number },
  ): Promise<void>;

  listMessages(chatId: string): Promise<StoredMessage[]>;
  appendMessage(msg: {
    chatId: string;
    runId: string | null;
    model: string | null;
    message: ModelMessage;
    kind?: StoredMessage["kind"];
    cutoffSeq?: number;
  }): Promise<StoredMessage>;
  /** Writes the assistant message and its proposed tool calls atomically (record before execute). */
  appendAssistantStep(args: {
    /** Pre-assigned id, so streamed events and the stored row share it. */
    id: string;
    chatId: string;
    runId: string;
    model: string;
    message: AssistantModelMessage;
    toolCalls: Omit<ToolCallRecord, "messageId" | "runId">[];
  }): Promise<StoredMessage>;

  listToolCalls(runId: string): Promise<ToolCallRecord[]>;
  /** Compare-and-set on status. Returns false when the call was not in one of `from`. */
  transitionToolCall(
    runId: string,
    id: string,
    from: ToolCallStatus[],
    patch: {
      status: ToolCallStatus;
      output?: ToolOutput;
      fullOutput?: ToolOutput;
      decisionReason?: string;
    },
  ): Promise<boolean>;

  hasPendingInputs(chatId: string): Promise<boolean>;

  /** Moves user messages that arrived while the run was busy into the chat, in order. */
  drainPendingInputs(chatId: string, runId: string): Promise<number>;

  getPolicy(userId: string): Promise<{ rules: PolicyRule[]; defaults: PolicyDefaults }>;
}

export interface EventSink {
  emit(runId: string, event: RunEvent): Promise<void> | void;
}
