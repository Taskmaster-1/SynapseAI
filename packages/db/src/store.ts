import {
  type PolicyRule,
  type RunRecord,
  type RunStore,
  SAFE_DEFAULTS,
  type StoredMessage,
  type ToolCallRecord,
} from "@synapse/core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  chats,
  messages,
  pendingInputs,
  policyRules,
  runs,
  toolCalls,
  userSettings,
} from "./schema";

type MessageRow = typeof messages.$inferSelect;
type ToolCallRow = typeof toolCalls.$inferSelect;

function toStored(r: MessageRow): StoredMessage {
  return {
    id: r.id,
    chatId: r.chatId,
    runId: r.runId,
    seq: r.seq,
    model: r.model,
    message: r.message,
    kind: r.kind,
    cutoffSeq: r.cutoffSeq,
  };
}

function toRecord(r: ToolCallRow): ToolCallRecord {
  return {
    id: r.id,
    runId: r.runId,
    messageId: r.messageId,
    name: r.name,
    input: r.input,
    inputEdited: r.inputEdited,
    effect: r.effect,
    status: r.status,
    decision: r.decision,
    decisionReason: r.decisionReason,
    output: r.output,
    decidedBy: r.decidedBy,
  };
}

/** Postgres implementation of the runtime's persistence port. */
export class PgRunStore implements RunStore {
  constructor(private readonly db: Db) {}

  async getRun(runId: string): Promise<RunRecord> {
    const [r] = await this.db.select().from(runs).where(eq(runs.id, runId));
    if (!r) throw new Error(`run ${runId} not found`);
    return {
      id: r.id,
      chatId: r.chatId,
      userId: r.userId,
      status: r.status,
      tainted: r.tainted,
      steps: r.steps,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd,
      error: r.error,
      cancelRequested: r.cancelRequested,
    };
  }

  async updateRun(runId: string, patch: Parameters<RunStore["updateRun"]>[1]) {
    const terminal =
      patch.status === "completed" || patch.status === "failed" || patch.status === "cancelled";
    await this.db
      .update(runs)
      .set({ ...patch, ...(terminal ? { finishedAt: new Date() } : {}) })
      .where(eq(runs.id, runId));
  }

  async addUsage(runId: string, u: { inputTokens: number; outputTokens: number; costUsd: number }) {
    await this.db
      .update(runs)
      .set({
        inputTokens: sql`${runs.inputTokens} + ${u.inputTokens}`,
        outputTokens: sql`${runs.outputTokens} + ${u.outputTokens}`,
        costUsd: sql`${runs.costUsd} + ${u.costUsd}`,
      })
      .where(eq(runs.id, runId));
  }

  async listMessages(chatId: string): Promise<StoredMessage[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.seq));
    return rows.map(toStored);
  }

  async appendMessage(msg: Parameters<RunStore["appendMessage"]>[0]): Promise<StoredMessage> {
    const [row] = await this.db
      .insert(messages)
      .values({
        chatId: msg.chatId,
        runId: msg.runId,
        model: msg.model,
        message: msg.message,
        kind: msg.kind ?? "message",
        cutoffSeq: msg.cutoffSeq ?? null,
      })
      .returning();
    await this.db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, msg.chatId));
    return toStored(row!);
  }

  async appendAssistantStep(
    args: Parameters<RunStore["appendAssistantStep"]>[0],
  ): Promise<StoredMessage> {
    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .select({ userId: runs.userId })
        .from(runs)
        .where(eq(runs.id, args.runId));
      const [row] = await tx
        .insert(messages)
        .values({
          id: args.id,
          chatId: args.chatId,
          runId: args.runId,
          model: args.model,
          message: args.message,
        })
        .returning();
      if (args.toolCalls.length > 0) {
        await tx.insert(toolCalls).values(
          args.toolCalls.map((c) => ({
            ...c,
            runId: args.runId,
            userId: run!.userId,
            messageId: row!.id,
          })),
        );
      }
      return toStored(row!);
    });
  }

  async listToolCalls(runId: string): Promise<ToolCallRecord[]> {
    const rows = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.runId, runId))
      .orderBy(asc(toolCalls.createdAt));
    return rows.map(toRecord);
  }

  async transitionToolCall(
    ...[runId, id, from, patch]: Parameters<RunStore["transitionToolCall"]>
  ) {
    const updated = await this.db
      .update(toolCalls)
      .set({
        status: patch.status,
        ...(patch.output ? { output: patch.output } : {}),
        ...(patch.fullOutput ? { fullOutput: patch.fullOutput } : {}),
      })
      .where(and(eq(toolCalls.runId, runId), eq(toolCalls.id, id), inArray(toolCalls.status, from)))
      .returning({ id: toolCalls.id });
    return updated.length > 0;
  }

  async drainPendingInputs(chatId: string, runId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const pending = await tx
        .select()
        .from(pendingInputs)
        .where(eq(pendingInputs.chatId, chatId))
        .orderBy(asc(pendingInputs.id))
        .for("update");
      if (pending.length === 0) return 0;
      await tx.insert(messages).values(
        pending.map((p) => ({
          chatId,
          runId,
          model: null,
          message: { role: "user" as const, content: p.content },
        })),
      );
      await tx.delete(pendingInputs).where(
        inArray(
          pendingInputs.id,
          pending.map((p) => p.id),
        ),
      );
      return pending.length;
    });
  }

  async getPolicy(userId: string) {
    const rules = await this.db
      .select()
      .from(policyRules)
      .where(eq(policyRules.userId, userId))
      .orderBy(asc(policyRules.position), asc(policyRules.createdAt));
    const [settings] = await this.db
      .select({ defaults: userSettings.policyDefaults })
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return {
      rules: rules.map(
        (r): PolicyRule => ({
          id: r.id,
          tool: r.tool,
          decision: r.decision,
          ...(r.when ? { when: r.when } : {}),
          ...(r.note ? { note: r.note } : {}),
        }),
      ),
      defaults: { ...SAFE_DEFAULTS, ...settings?.defaults },
    };
  }
}
