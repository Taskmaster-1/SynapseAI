import { type Effect, type PlanGrant, UNDO_DENIAL } from "@synapse/core";
import type { JSONValue } from "ai";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./client";
import { chats, messages, pendingInputs, runs, toolCalls, userSettings } from "./schema";

export class NotFoundError extends Error {}

/**
 * Creates a queued run in a locked chat. Taint carries over: once untrusted content is in
 * the chat history, every later run in that chat starts tainted. Messages left pending by
 * an earlier run that ended are moved in first, in order.
 */
async function startRun(
  tx: Db,
  chatId: string,
  userId: string,
  trigger: string,
  tainted = false,
): Promise<string> {
  const [run] = await tx
    .insert(runs)
    .values({
      chatId,
      userId,
      trigger,
      tainted: tainted
        ? true
        : sql`exists (select 1 from runs r where r.chat_id = ${chatId} and r.tainted)`,
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
 *
 * `tainted` marks the run for messages that carry third-party content (event triggers).
 */
export async function sendMessage(
  db: Db,
  args: { userId: string; chatId: string; content: string; trigger?: string; tainted?: boolean },
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
        args.tainted,
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
    if (args.tainted) await tx.update(runs).set({ tainted: true }).where(eq(runs.id, active.id));
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

export const DEFAULT_UNDO_SECONDS = 10;
export const MAX_UNDO_SECONDS = 60;

/**
 * Seconds a person-approved call waits, with an Undo, before it runs. Only actions that
 * reach other people or can't be taken back (send, destructive) wait; 0 means run now.
 * Calls auto-allowed by policy never go through here.
 */
export function undoDelay(
  effect: Effect,
  settings: { undoSeconds?: number | null } | null | undefined,
): number {
  if (effect !== "send" && effect !== "destructive") return 0;
  const seconds = settings?.undoSeconds ?? DEFAULT_UNDO_SECONDS;
  return Math.max(0, Math.min(MAX_UNDO_SECONDS, Math.floor(seconds)));
}

/** Opens the undo window on an approved call. Uses the database clock, like undo does. */
export async function startUndoWindow(
  tx: Db,
  runId: string,
  toolCallId: string,
  seconds: number,
): Promise<Date | null> {
  if (seconds <= 0) return null;
  const [row] = await tx
    .update(toolCalls)
    .set({ executeAfter: sql`now() + (${seconds}::int * interval '1 second')` })
    .where(
      and(
        eq(toolCalls.runId, runId),
        eq(toolCalls.id, toolCallId),
        eq(toolCalls.status, "approved"),
      ),
    )
    .returning({ executeAfter: toolCalls.executeAfter });
  return row?.executeAfter ?? null;
}

/**
 * When a waiting run is re-queued: null if a worker can make progress now, otherwise the
 * end of the earliest undo window (so no worker picks the run up early).
 */
export async function runnableAt(tx: Db, runId: string): Promise<Date | null> {
  const [row] = await tx
    .select({
      ready: sql<boolean>`coalesce(bool_or(${toolCalls.executeAfter} is null or ${toolCalls.executeAfter} <= now()), true)`,
      next: sql<string | Date | null>`min(${toolCalls.executeAfter})`,
    })
    .from(toolCalls)
    .where(and(eq(toolCalls.runId, runId), eq(toolCalls.status, "approved")));
  return !row || row.ready || !row.next ? null : new Date(row.next);
}

export interface ToolCallDecision {
  toolCallId: string;
  approved: boolean;
  reason?: string;
  editedInput?: JSONValue;
}

export interface DecisionOutcome {
  /** End of the undo window each approval opened, by tool call id (only calls that wait). */
  executeAfter: Record<string, Date>;
  /** The run was re-queued (no approvals left)... */
  requeued: boolean;
  /** ...and no worker may take it before this time (null: now). */
  runnableAt: Date | null;
}

/**
 * Approves or denies one awaiting tool call. Compare-and-set on status and owner, so a
 * double click, a replayed request or another user's id is a no-op (ConflictError).
 * Approving a send or destructive action opens the user's undo window (`executeAfter`).
 * When no approvals remain, the run is re-queued, for after the window if it must wait.
 */
export async function decideToolCall(
  db: Db,
  args: { userId: string; runId: string } & ToolCallDecision,
): Promise<{ executeAfter: Date | null; requeued: boolean; runnableAt: Date | null }> {
  const { userId, runId, ...decision } = args;
  const outcome = await decideToolCalls(db, { userId, runId, decisions: [decision] });
  return {
    executeAfter: outcome.executeAfter[decision.toolCallId] ?? null,
    requeued: outcome.requeued,
    runnableAt: outcome.runnableAt,
  };
}

/**
 * Decides several awaiting calls of one run at once, all or nothing: if any call is not
 * awaiting approval (already decided, someone else's, unknown), nothing changes and a
 * ConflictError is thrown. Each approved send or destructive call opens its undo window.
 * The run is re-queued once, when none remain awaiting.
 */
export async function decideToolCalls(
  db: Db,
  args: { userId: string; runId: string; decisions: ToolCallDecision[] },
): Promise<DecisionOutcome> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ id: runs.id, status: runs.status })
      .from(runs)
      .where(and(eq(runs.id, args.runId), eq(runs.userId, args.userId)))
      .for("update");
    if (!run) throw new NotFoundError("run not found");

    const [settings] = await tx
      .select({ undoSeconds: userSettings.undoSeconds })
      .from(userSettings)
      .where(eq(userSettings.userId, args.userId));

    const executeAfter: Record<string, Date> = {};
    for (const d of args.decisions) {
      const updated = await tx
        .update(toolCalls)
        .set({
          status: d.approved ? "approved" : "denied",
          decidedBy: args.userId,
          decidedAt: new Date(),
          ...(d.approved && d.editedInput !== undefined
            ? { input: d.editedInput, inputEdited: true }
            : {}),
          ...(d.approved
            ? {}
            : {
                output: {
                  type: "denied" as const,
                  reason: d.reason
                    ? `The user denied this action: ${d.reason}`
                    : "The user denied this action.",
                },
              }),
        })
        .where(
          and(
            eq(toolCalls.runId, run.id),
            eq(toolCalls.id, d.toolCallId),
            eq(toolCalls.userId, args.userId),
            eq(toolCalls.status, "awaiting_approval"),
          ),
        )
        .returning({ id: toolCalls.id, effect: toolCalls.effect });
      if (updated.length === 0)
        throw new ConflictError("this action is no longer awaiting approval");
      if (d.approved) {
        const seconds = undoDelay(updated[0]!.effect, settings);
        const at = await startUndoWindow(tx as unknown as Db, run.id, d.toolCallId, seconds);
        if (at) executeAfter[d.toolCallId] = at;
      }
    }

    const [{ remaining } = { remaining: 0 }] = await tx
      .select({ remaining: sql<number>`count(*)::int` })
      .from(toolCalls)
      .where(and(eq(toolCalls.runId, run.id), eq(toolCalls.status, "awaiting_approval")));
    if (remaining === 0 && run.status === "waiting") {
      const at = await runnableAt(tx as unknown as Db, run.id);
      await tx
        .update(runs)
        .set({ status: "queued", leaseExpiresAt: at })
        .where(eq(runs.id, run.id));
      return { executeAfter, requeued: true, runnableAt: at };
    }
    return { executeAfter, requeued: false, runnableAt: null };
  });
}

/**
 * Undoes an approved call while its undo window is open: compare-and-set approved → denied
 * only while `execute_after` is still in the future (database clock). The worker's own
 * approved → executing transition is the other side of the race, so exactly one wins.
 * A parked run is re-queued at once so the agent can respond.
 */
export async function undoToolCall(
  db: Db,
  args: { userId: string; runId: string; toolCallId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.id, args.runId), eq(runs.userId, args.userId)))
      .for("update");
    if (!run) throw new NotFoundError("run not found");

    const undone = await tx
      .update(toolCalls)
      .set({
        status: "denied",
        decidedAt: new Date(),
        output: { type: "denied" as const, reason: UNDO_DENIAL },
      })
      .where(
        and(
          eq(toolCalls.runId, run.id),
          eq(toolCalls.id, args.toolCallId),
          eq(toolCalls.userId, args.userId),
          eq(toolCalls.status, "approved"),
          sql`${toolCalls.executeAfter} > now()`,
        ),
      )
      .returning({ id: toolCalls.id });
    if (undone.length === 0) {
      const [call] = await tx
        .select({ status: toolCalls.status })
        .from(toolCalls)
        .where(
          and(
            eq(toolCalls.runId, run.id),
            eq(toolCalls.id, args.toolCallId),
            eq(toolCalls.userId, args.userId),
          ),
        );
      if (!call) throw new NotFoundError("action not found");
      throw new ConflictError(
        call.status === "denied"
          ? "Nothing to undo: this action won't run."
          : "Too late to undo: it already ran.",
      );
    }

    // Only a run no worker holds: never hand a leased run to a second worker.
    await tx
      .update(runs)
      .set({ leaseExpiresAt: await runnableAt(tx as unknown as Db, run.id) })
      .where(and(eq(runs.id, run.id), eq(runs.status, "queued"), isNull(runs.leaseOwner)));
  });
}

/** Adds grants from an approved plan to the run; `propose_plan` calls this when it runs. */
export async function addPlanGrants(db: Db, runId: string, grants: PlanGrant[]): Promise<void> {
  if (grants.length === 0) return;
  await db
    .update(runs)
    .set({ planGrants: sql`${runs.planGrants} || ${JSON.stringify(grants)}::jsonb` })
    .where(eq(runs.id, runId));
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
    .returning({ id: runs.id, status: runs.status, leaseOwner: runs.leaseOwner });
  if (!run) throw new ConflictError("run is not active");
  // A paused run has no worker; queue it so a worker records the cancellation. That includes
  // a run parked on an undo window, which would otherwise only stop when the window ends.
  if (run.status === "waiting" || (run.status === "queued" && run.leaseOwner === null)) {
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

/**
 * Starts a task in a fresh chat for one trigger event (a new email, a webhook call). The
 * run starts tainted: the message carries third-party content, so nothing the agent does
 * in it is auto-allowed beyond reads.
 */
export async function startTriggeredTask(
  db: Db,
  args: { userId: string; title: string; content: string; trigger: string },
): Promise<{ chatId: string; runId: string }> {
  return db.transaction(async (tx) => {
    const [chat] = await tx
      .insert(chats)
      .values({ userId: args.userId, title: args.title.slice(0, 120) })
      .returning({ id: chats.id });
    const runId = await startRun(tx as unknown as Db, chat!.id, args.userId, args.trigger, true);
    await tx.insert(messages).values({
      chatId: chat!.id,
      runId,
      message: { role: "user", content: args.content },
    });
    return { chatId: chat!.id, runId };
  });
}
