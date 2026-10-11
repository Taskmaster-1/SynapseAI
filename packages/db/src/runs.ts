import type { JSONValue } from "ai";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./client";
import { chats, messages, pendingInputs, runs, toolCalls } from "./schema";

export class NotFoundError extends Error {}

/**
 * Creates a queued run in a locked chat. Taint carries over: once untrusted content is in
 * the chat history, every later run in that chat starts tainted. Messages left pending by
 * an earlier run that ended are moved in first, in order.
 */
async function startRun(tx: Db, chatId: string, userId: string, trigger: string): Promise<string> {
  const [run] = await tx
    .insert(runs)
    .values({
      chatId,
      userId,
      trigger,
      tainted: sql`exists (select 1 from runs r where r.chat_id = ${chatId} and r.tainted)`,
    })
    .returning({ id: runs.id });
  const orphans = await tx
    .select()
    .from(pendingInputs)
    .where(eq(pendingInputs.chatId, chatId))
    .orderBy(asc(pendingInputs.id));
  if (orphans.length > 0) {
    await tx.insert(messages).values(
      orphans.map((p) => ({
        chatId,
        runId: run!.id,
        message: { role: "user" as const, content: p.content },
      })),
    );
    await tx.delete(pendingInputs).where(
      inArray(
        pendingInputs.id,
        orphans.map((p) => p.id),
      ),
    );
  }
  await tx.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chatId));
  return run!.id;
}

/**
 * After a run ends, messages that arrived too late for it must not be stranded: if the
 * chat has pending inputs and no active run, start a new run for them.
 */
export async function continuePendingInputs(db: Db, chatId: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [chat] = await tx.select().from(chats).where(eq(chats.id, chatId)).for("update");
    if (!chat) return null;
    const [active] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.chatId, chatId), inArray(runs.status, [...ACTIVE])));
    if (active) return null;
    const [pending] = await tx
      .select({ id: pendingInputs.id })
      .from(pendingInputs)
      .where(eq(pendingInputs.chatId, chatId))
      .limit(1);
    if (!pending) return null;
    return startRun(tx as unknown as Db, chatId, chat.userId, "chat");
  });
}
export class ConflictError extends Error {}

const ACTIVE = ["queued", "running", "waiting"] as const;

/**
 * Sends a user message to a chat. Exactly one run is active per chat:
 *  - no active run: the message is appended and a new run is queued;
 *  - active run: the message is queued as a pending input and picked up at the next step.
 *    If the run is waiting on approvals, those are denied ("the user moved on") and the
 *    run is re-queued so it can respond to the new message.
 */
export async function sendMessage(
  db: Db,
  args: { userId: string; chatId: string; content: string; trigger?: string },
): Promise<{ runId: string; queued: "new_run" | "pending_input" | "skipped" }> {
  return db.transaction(async (tx) => {
    const [chat] = await tx
      .select({ id: chats.id })
      .from(chats)
      .where(and(eq(chats.id, args.chatId), eq(chats.userId, args.userId)))
      .for("update");
    if (!chat) throw new NotFoundError("chat not found");

    const [active] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.chatId, chat.id), inArray(runs.status, [...ACTIVE])));

    if (!active) {
      const runId = await startRun(
        tx as unknown as Db,
        chat.id,
        args.userId,
        args.trigger ?? "chat",
      );
      await tx.insert(messages).values({
        chatId: chat.id,
        runId,
        message: { role: "user", content: args.content },
      });
      return { runId, queued: "new_run" as const };
    }

    // Scheduled prompts never displace a run that is waiting on the user.
    if (args.trigger === "schedule") return { runId: active.id, queued: "skipped" as const };

    await tx.insert(pendingInputs).values({ chatId: chat.id, content: args.content });
    if (active.status === "waiting") {
      await tx
        .update(toolCalls)
        .set({
          status: "denied",
          decidedBy: args.userId,
          decidedAt: new Date(),
          output: {
            type: "denied",
            reason: "The user sent a new message instead of approving this action.",
          },
        })
        .where(and(eq(toolCalls.runId, active.id), eq(toolCalls.status, "awaiting_approval")));
      await tx
        .update(runs)
        .set({ status: "queued", leaseExpiresAt: null })
        .where(eq(runs.id, active.id));
    }
    return { runId: active.id, queued: "pending_input" as const };
  });
}

/**
 * Approves or denies one awaiting tool call. Compare-and-set on status and owner, so a
 * double click, a replayed request or another user's id is a no-op (ConflictError).
 * When no approvals remain, the run is re-queued.
 */
export async function decideToolCall(
  db: Db,
  args: {
    userId: string;
    runId: string;
    toolCallId: string;
    approved: boolean;
    reason?: string;
    editedInput?: JSONValue;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ id: runs.id, status: runs.status })
      .from(runs)
      .where(and(eq(runs.id, args.runId), eq(runs.userId, args.userId)))
      .for("update");
    if (!run) throw new NotFoundError("run not found");

    const updated = await tx
      .update(toolCalls)
      .set({
        status: args.approved ? "approved" : "denied",
        decidedBy: args.userId,
        decidedAt: new Date(),
        ...(args.approved && args.editedInput !== undefined
          ? { input: args.editedInput, inputEdited: true }
          : {}),
        ...(args.approved
          ? {}
          : {
              output: {
                type: "denied" as const,
                reason: args.reason
                  ? `The user denied this action: ${args.reason}`
                  : "The user denied this action.",
              },
            }),
      })
      .where(
        and(
          eq(toolCalls.runId, run.id),
          eq(toolCalls.id, args.toolCallId),
          eq(toolCalls.userId, args.userId),
          eq(toolCalls.status, "awaiting_approval"),
        ),
      )
      .returning({ id: toolCalls.id });
    if (updated.length === 0) throw new ConflictError("this action is no longer awaiting approval");

    const [{ remaining } = { remaining: 0 }] = await tx
      .select({ remaining: sql<number>`count(*)::int` })
      .from(toolCalls)
      .where(and(eq(toolCalls.runId, run.id), eq(toolCalls.status, "awaiting_approval")));
    if (remaining === 0 && run.status === "waiting") {
      await tx
        .update(runs)
        .set({ status: "queued", leaseExpiresAt: null })
        .where(eq(runs.id, run.id));
    }
  });
}

export async function requestCancel(
  db: Db,
  args: { userId: string; runId: string; mode: "now" | "after_step" },
) {
  const [run] = await db
    .update(runs)
    .set({ cancelRequested: args.mode })
    .where(
      and(eq(runs.id, args.runId), eq(runs.userId, args.userId), inArray(runs.status, [...ACTIVE])),
    )
    .returning({ id: runs.id, status: runs.status });
  if (!run) throw new ConflictError("run is not active");
  // A paused run has no worker; queue it so a worker records the cancellation.
  if (run.status === "waiting") {
    await db
      .update(runs)
      .set({ status: "queued", leaseExpiresAt: null })
      .where(eq(runs.id, run.id));
  }
}

// ── Worker leasing ──────────────────────────────────────────────────────────

export const MAX_ATTEMPTS = 5;

/**
 * Claims the oldest runnable run: queued, or running with an expired lease (its worker
 * died). SKIP LOCKED spreads runs across workers without contention.
 */
export type Claim = { runId: string; exhausted: boolean };

/**
 * Claims the oldest runnable run. `exhausted` means it has failed too often; the caller
 * must fail it (and tell the user) instead of driving it.
 */
export async function claimRun(db: Db, workerId: string, leaseMs: number): Promise<Claim | null> {
  const now = new Date();
  const [claimed] = await db
    .update(runs)
    .set({
      leaseOwner: workerId,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      attempts: sql`${runs.attempts} + 1`,
    })
    .where(
      eq(
        runs.id,
        sql`(${db
          .select({ id: runs.id })
          .from(runs)
          .where(
            and(
              inArray(runs.status, ["queued", "running"]),
              or(isNull(runs.leaseExpiresAt), lt(runs.leaseExpiresAt, now)),
            ),
          )
          .orderBy(asc(runs.createdAt))
          .limit(1)
          .for("update", { skipLocked: true })})`,
      ),
    )
    .returning({ id: runs.id, attempts: runs.attempts });
  if (!claimed) return null;
  return { runId: claimed.id, exhausted: claimed.attempts > MAX_ATTEMPTS };
}

export async function renewLease(
  db: Db,
  runId: string,
  workerId: string,
  leaseMs: number,
): Promise<boolean> {
  const rows = await db
    .update(runs)
    .set({ leaseExpiresAt: new Date(Date.now() + leaseMs) })
    .where(and(eq(runs.id, runId), eq(runs.leaseOwner, workerId)))
    .returning({ id: runs.id });
  return rows.length > 0;
}

/** Releases the lease. A run still "running" (retryable failure) is retried after `retryInMs`. */
export async function releaseRun(
  db: Db,
  runId: string,
  workerId: string,
  retryInMs = 0,
): Promise<void> {
  await db
    .update(runs)
    .set({
      leaseOwner: null,
      leaseExpiresAt: retryInMs > 0 ? new Date(Date.now() + retryInMs) : null,
      status: sql`case when ${runs.status} = 'running' then 'queued' else ${runs.status} end`,
    })
    .where(and(eq(runs.id, runId), eq(runs.leaseOwner, workerId)));
}

/** Successful completion resets the attempt counter so later turns get a fresh budget. */
export async function resetAttempts(db: Db, runId: string) {
  await db.update(runs).set({ attempts: 0 }).where(eq(runs.id, runId));
}
