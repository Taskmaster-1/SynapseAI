import type { Effect } from "@synapse/core";
import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  runs,
  type TwoPersonRule,
  toolCalls,
  userSettings,
  workspaceMembers,
  workspaces,
} from "./schema";

/**
 * Approvals that don't wait forever: a reminder, an escalation to team admins, then expiry
 * (an ordinary deny the agent sees). Plus two-person sign-off for a team's risky actions.
 * Every step is claimed with a compare-and-set on its own timestamp, so any number of
 * workers can sweep at once and each step happens exactly once.
 */

export const DEFAULT_REMIND_MINUTES = 30;
export const DEFAULT_EXPIRE_HOURS = 24;
export const DEFAULT_ESCALATE_MINUTES = 60;
export const MAX_REMIND_MINUTES = 24 * 60;
export const MAX_EXPIRE_HOURS = 24 * 14;
export const MAX_ESCALATE_MINUTES = 24 * 60;

/** What the agent is told when an approval expires. */
export const EXPIRY_DENIAL =
  "Expired: nobody decided in time. Don't retry it on your own; tell the user it wasn't approved.";
/** The short form people see. */
export const EXPIRY_REASON = "Expired: nobody decided in time";

/** How many distinct approvals an action needs under a team's two-person rule. */
export function approvalsNeeded(effect: Effect, rule: TwoPersonRule | null | undefined): 1 | 2 {
  if (rule === "destructive") return effect === "destructive" ? 2 : 1;
  if (rule === "destructive_send") return effect === "destructive" || effect === "send" ? 2 : 1;
  return 1;
}

export interface ApprovalTiming {
  /** 0: no reminder. */
  remindMinutes: number;
  /** 0: never expires. */
  expireHours: number;
  /** The requester's team, if any, and its rules. */
  workspaceId: string | null;
  /** 0 or no team: no escalation. */
  escalateMinutes: number;
  twoPerson: TwoPersonRule | null;
}

/** The reminder, escalation, expiry and two-person rules that govern a person's approvals. */
export async function approvalTiming(db: Db, userId: string): Promise<ApprovalTiming> {
  const [[settings], [team]] = await Promise.all([
    db
      .select({ remind: userSettings.remindMinutes, expire: userSettings.expireHours })
      .from(userSettings)
      .where(eq(userSettings.userId, userId)),
    db
      .select({
        id: workspaces.id,
        escalate: workspaces.escalateMinutes,
        expire: workspaces.expireHours,
        twoPerson: workspaces.twoPerson,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId)),
  ]);
  return {
    remindMinutes: settings?.remind ?? DEFAULT_REMIND_MINUTES,
    // A team-wide expiry replaces each member's own.
    expireHours: team?.expire ?? settings?.expire ?? DEFAULT_EXPIRE_HOURS,
    workspaceId: team?.id ?? null,
    escalateMinutes: team ? team.escalate : 0,
    twoPerson: team?.twoPerson ?? null,
  };
}

export interface DueCall {
  runId: string;
  toolCallId: string;
  userId: string;
}

/**
 * Claims the one reminder for every approval its owner's reminder delay has passed on.
 * Counted from when people were first told (`notified_at`).
 */
export async function claimReminders(db: Db, now: Date): Promise<DueCall[]> {
  const minutes = sql`coalesce(${userSettings.remindMinutes}, ${DEFAULT_REMIND_MINUTES})`;
  const due = await db
    .select({ runId: toolCalls.runId, toolCallId: toolCalls.id, userId: toolCalls.userId })
    .from(toolCalls)
    .leftJoin(userSettings, eq(userSettings.userId, toolCalls.userId))
    .where(
      and(
        eq(toolCalls.status, "awaiting_approval"),
        isNull(toolCalls.remindedAt),
        isNotNull(toolCalls.notifiedAt),
        sql`${minutes} > 0`,
        sql`${toolCalls.notifiedAt} + ${minutes} * interval '1 minute' <= ${now.toISOString()}::timestamptz`,
      ),
    )
    .limit(500);
  return claim(db, due, { remindedAt: now }, isNull(toolCalls.remindedAt));
}

/**
 * Claims escalation for team members' approvals that waited past the team's delay. Calls
 * that already need an admin are with the admins from the start, so they don't escalate.
 */
export async function claimEscalations(db: Db, now: Date): Promise<DueCall[]> {
  const due = await db
    .select({ runId: toolCalls.runId, toolCallId: toolCalls.id, userId: toolCalls.userId })
    .from(toolCalls)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, toolCalls.userId))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(toolCalls.status, "awaiting_approval"),
        isNull(toolCalls.escalatedAt),
        isNull(toolCalls.approver),
        isNotNull(toolCalls.notifiedAt),
        sql`${workspaces.escalateMinutes} > 0`,
        sql`${toolCalls.notifiedAt} + ${workspaces.escalateMinutes} * interval '1 minute' <= ${now.toISOString()}::timestamptz`,
      ),
    )
    .limit(500);
  return claim(db, due, { escalatedAt: now }, isNull(toolCalls.escalatedAt));
}

async function claim(
  db: Db,
  due: DueCall[],
  set: Partial<typeof toolCalls.$inferInsert>,
  unclaimed: ReturnType<typeof isNull>,
): Promise<DueCall[]> {
  const claimed: DueCall[] = [];
  for (const c of due) {
    const rows = await db
      .update(toolCalls)
      .set(set)
      .where(
        and(
          eq(toolCalls.runId, c.runId),
          eq(toolCalls.id, c.toolCallId),
          eq(toolCalls.status, "awaiting_approval"),
          unclaimed,
        ),
      )
      .returning({ id: toolCalls.id });
    if (rows.length) claimed.push(c);
  }
  return claimed;
}

export interface ExpiredCall extends DueCall {
  /** The run had nothing else to wait for and was re-queued. */
  requeued: boolean;
}

/**
 * Denies approvals past `expires_at`, like a person's deny: the agent sees why, and a run
 * with nothing left to wait for is re-queued. Locks the run first, as decisions do, so an
 * expiry and a click can't both land.
 */
export async function expireDue(db: Db, now: Date): Promise<ExpiredCall[]> {
  const due = await db
    .select({ runId: toolCalls.runId, toolCallId: toolCalls.id, userId: toolCalls.userId })
    .from(toolCalls)
    .where(and(eq(toolCalls.status, "awaiting_approval"), lte(toolCalls.expiresAt, now)))
    .limit(500);
  const out: ExpiredCall[] = [];
  for (const c of due) {
    const done = await db.transaction(async (tx) => {
      const [run] = await tx
        .select({ id: runs.id, status: runs.status })
        .from(runs)
        .where(eq(runs.id, c.runId))
        .for("update");
      if (!run) return null;
      const denied = await tx
        .update(toolCalls)
        .set({
          status: "denied",
          decidedBy: null,
          decidedAt: now,
          decidedVia: "expiry",
          output: { type: "denied" as const, reason: EXPIRY_DENIAL },
        })
        .where(
          and(
            eq(toolCalls.runId, c.runId),
            eq(toolCalls.id, c.toolCallId),
            eq(toolCalls.status, "awaiting_approval"),
            lte(toolCalls.expiresAt, now),
          ),
        )
        .returning({ id: toolCalls.id });
      if (denied.length === 0) return null;
      const [{ remaining } = { remaining: 0 }] = await tx
        .select({ remaining: sql<number>`count(*)::int` })
        .from(toolCalls)
        .where(and(eq(toolCalls.runId, c.runId), eq(toolCalls.status, "awaiting_approval")));
      if (remaining > 0 || run.status !== "waiting") return { ...c, requeued: false };
      await tx
        .update(runs)
        .set({ status: "queued", leaseExpiresAt: null })
        .where(eq(runs.id, c.runId));
      return { ...c, requeued: true };
    });
    if (done) out.push(done);
  }
  return out;
}

/**
 * When people are first told about a run's approvals: stamps `notified_at` (claimed once)
 * and sets each call's expiry from its owner's (or team's) rules. Returns the claimed ids.
 */
export async function claimAnnouncement(
  db: Db,
  runId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const [run] = await db.select({ userId: runs.userId }).from(runs).where(eq(runs.id, runId));
  if (!run) return [];
  const { expireHours } = await approvalTiming(db, run.userId);
  const claimed = await db
    .update(toolCalls)
    .set({
      notifiedAt: now,
      expiresAt: expireHours > 0 ? new Date(now.getTime() + expireHours * 3600_000) : null,
    })
    .where(
      and(
        eq(toolCalls.runId, runId),
        eq(toolCalls.status, "awaiting_approval"),
        isNull(toolCalls.notifiedAt),
      ),
    )
    .returning({ id: toolCalls.id });
  return claimed.map((c) => c.id);
}

/** Runs with approvals nobody was told about (an announcement that never happened). */
export async function unannouncedRuns(db: Db, olderThan: Date): Promise<string[]> {
  const rows = await db
    .selectDistinct({ runId: toolCalls.runId })
    .from(toolCalls)
    .innerJoin(runs, eq(runs.id, toolCalls.runId))
    .where(
      and(
        eq(toolCalls.status, "awaiting_approval"),
        isNull(toolCalls.notifiedAt),
        eq(runs.status, "waiting"),
        lte(toolCalls.createdAt, olderThan),
      ),
    )
    .limit(100);
  return rows.map((r) => r.runId);
}
