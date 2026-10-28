import { orgDomain, riskFacts } from "@synapse/core";
import {
  approvalsNeeded,
  approvalTiming,
  claimAnnouncement,
  type DueCall,
  membershipOf,
  schema,
  workspaceAdminIds,
} from "@synapse/db";
import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { log } from "../log";
import type { Services } from "../services";
import type { NoticeKind, NotificationChannel, PendingApproval, ResolvedApproval } from "./types";

/**
 * Tells people about approvals through every registered channel: when they start waiting,
 * once more as a reminder, when they escalate to team admins, and when a two-person
 * sign-off needs its second approver. Each of those is claimed with a compare-and-set on its
 * own timestamp (`notified_at`, `reminded_at`, `escalated_at`) or happens inside the single
 * decision that caused it, so several workers never double-notify.
 */
export class Notifier {
  private readonly channels: NotificationChannel[] = [];

  constructor(private readonly services: () => Services) {}

  add(channel: NotificationChannel) {
    this.channels.push(channel);
  }

  get names(): string[] {
    return this.channels.map((c) => c.name);
  }

  /** Announces the run's awaiting calls that haven't been announced yet, and sets their expiry. */
  async announce(runId: string): Promise<PendingApproval[]> {
    const claimed = await claimAnnouncement(this.services().database.db, runId);
    return this.deliver(runId, claimed, "new");
  }

  /** The one reminder for calls nobody decided (already claimed by the sweeper). */
  async remind(calls: DueCall[]): Promise<PendingApproval[]> {
    return this.byRun(calls, "reminder");
  }

  /** Calls escalated to the requester's team admins (already claimed by the sweeper). */
  async escalate(calls: DueCall[]): Promise<PendingApproval[]> {
    return this.byRun(calls, "escalated");
  }

  /** Two-person sign-off: one person approved; ask the others who may give the second. */
  async askSecond(runId: string, toolCallIds: string[]): Promise<PendingApproval[]> {
    return this.deliver(runId, toolCallIds, "second");
  }

  async resolved(decided: ResolvedApproval[]) {
    if (decided.length === 0) return;
    await this.each("resolved", (c) => c.resolved?.(decided));
  }

  private async byRun(calls: DueCall[], kind: NoticeKind) {
    const runs = new Map<string, string[]>();
    for (const c of calls) runs.set(c.runId, [...(runs.get(c.runId) ?? []), c.toolCallId]);
    const out: PendingApproval[] = [];
    for (const [runId, ids] of runs) out.push(...(await this.deliver(runId, ids, kind)));
    return out;
  }

  /** Loads the calls, works out who should hear about them, and hands them to the channels. */
  private async deliver(
    runId: string,
    toolCallIds: string[],
    kind: NoticeKind,
  ): Promise<PendingApproval[]> {
    if (toolCallIds.length === 0) return [];
    const { database, config } = this.services();
    const { db } = database;
    const first = alias(schema.user, "first_approver");
    const rows = await db
      .select({
        userId: schema.toolCalls.userId,
        email: schema.user.email,
        runId: schema.toolCalls.runId,
        chatId: schema.runs.chatId,
        chatTitle: schema.chats.title,
        toolCallId: schema.toolCalls.id,
        name: schema.toolCalls.name,
        effect: schema.toolCalls.effect,
        preview: schema.toolCalls.preview,
        input: schema.toolCalls.input,
        reason: schema.toolCalls.decisionReason,
        tainted: schema.runs.tainted,
        approver: schema.toolCalls.approver,
        escalatedAt: schema.toolCalls.escalatedAt,
        expiresAt: schema.toolCalls.expiresAt,
        firstId: schema.toolCalls.firstApprovedBy,
        firstName: first.name,
        createdAt: schema.toolCalls.createdAt,
      })
      .from(schema.toolCalls)
      .innerJoin(schema.runs, eq(schema.runs.id, schema.toolCalls.runId))
      .innerJoin(schema.chats, eq(schema.chats.id, schema.runs.chatId))
      .innerJoin(schema.user, eq(schema.user.id, schema.toolCalls.userId))
      .leftJoin(first, eq(first.id, schema.toolCalls.firstApprovedBy))
      .where(
        and(
          eq(schema.toolCalls.runId, runId),
          inArray(schema.toolCalls.id, toolCallIds),
          eq(schema.toolCalls.status, "awaiting_approval"),
        ),
      );
    if (rows.length === 0) return [];

    // All calls of a run belong to one person: their team decides who else may sign.
    const owner = rows[0]!.userId;
    const [membership, timing] = await Promise.all([
      membershipOf(db, owner),
      approvalTiming(db, owner),
    ]);
    const admins = membership ? await workspaceAdminIds(db, membership.workspaceId) : [];

    const approvals: PendingApproval[] = [];
    for (const { approver, escalatedAt, firstId, firstName, email, ...r } of rows) {
      const needed = approvalsNeeded(r.effect, timing.twoPerson);
      const escalated = escalatedAt !== null;
      // Team workspaces: a call a team rule reserves for an admin goes to the requester's
      // workspace owners and admins (the requester too, if they are one). Escalated calls
      // and two-person sign-offs may be decided by admins as well as the requester. If the
      // requester has left the team since, its rules no longer govern them: theirs again.
      const deciders =
        approver === "admin"
          ? membership
            ? admins
            : [r.userId]
          : membership && (escalated || needed === 2)
            ? [r.userId, ...admins]
            : [r.userId];
      const who =
        kind === "new"
          ? approver === "admin"
            ? deciders
            : [r.userId]
          : kind === "escalated"
            ? admins.filter((id) => id !== r.userId)
            : deciders;
      const recipients = [...new Set(who)].filter((id) => id !== firstId);
      if (recipients.length === 0) continue;
      approvals.push({
        ...r,
        kind,
        recipients,
        facts: riskFacts({
          name: r.name,
          effect: r.effect,
          input: r.input,
          tainted: r.tainted,
          domain: orgDomain(email),
        }),
        escalated,
        signoffs: {
          needed,
          first: firstId ? { id: firstId, name: firstName ?? "Someone" } : null,
        },
        // Admins can't open a member's task (tasks stay personal); they decide in the inbox.
        url: recipients.every((id) => id === r.userId)
          ? `${config.PUBLIC_URL}/t/${r.chatId}`
          : `${config.PUBLIC_URL}/inbox?id=${encodeURIComponent(r.toolCallId)}`,
      });
    }
    if (approvals.length) await this.each("notify", (c) => c.notify(approvals));
    return approvals;
  }

  private async each(what: string, fn: (c: NotificationChannel) => Promise<void> | undefined) {
    await Promise.all(
      this.channels.map(async (c) => {
        try {
          await fn(c);
        } catch (error) {
          log.warn("notification channel failed", { channel: c.name, what, error: String(error) });
        }
      }),
    );
  }
}
