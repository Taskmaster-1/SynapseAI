import { membershipOf, schema, workspaceAdminIds } from "@synapse/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { log } from "../log";
import type { Services } from "../services";
import type { NotificationChannel, PendingApproval, ResolvedApproval } from "./types";

/**
 * Tells people about new approvals through every registered channel. Each awaiting call is
 * announced once: `notified_at` is claimed with a compare-and-set, so several workers
 * finishing steps of the same run never double-notify.
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

  /** Announces the run's awaiting calls that haven't been announced yet. */
  async announce(runId: string): Promise<PendingApproval[]> {
    const { database, config } = this.services();
    const { db } = database;
    const claimed = await db
      .update(schema.toolCalls)
      .set({ notifiedAt: new Date() })
      .where(
        and(
          eq(schema.toolCalls.runId, runId),
          eq(schema.toolCalls.status, "awaiting_approval"),
          isNull(schema.toolCalls.notifiedAt),
        ),
      )
      .returning({ id: schema.toolCalls.id });
    if (claimed.length === 0) return [];

    const rows = await db
      .select({
        userId: schema.toolCalls.userId,
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
        createdAt: schema.toolCalls.createdAt,
      })
      .from(schema.toolCalls)
      .innerJoin(schema.runs, eq(schema.runs.id, schema.toolCalls.runId))
      .innerJoin(schema.chats, eq(schema.chats.id, schema.runs.chatId))
      .where(
        and(
          eq(schema.toolCalls.runId, runId),
          inArray(
            schema.toolCalls.id,
            claimed.map((c) => c.id),
          ),
        ),
      );
    // Team workspaces: a call a team rule reserves for an admin goes to the requester's
    // workspace owners and admins (the requester too, if they are one), not to the
    // requester. Everything else goes to the requester. Admins open it from their inbox.
    // If the requester has left the team since, its rules no longer govern them: theirs again.
    const recipientsFor = async (userId: string, approver: "admin" | null): Promise<string[]> => {
      if (approver !== "admin") return [userId];
      const membership = await membershipOf(db, userId);
      return membership ? workspaceAdminIds(db, membership.workspaceId) : [userId];
    };
    const approvals: PendingApproval[] = await Promise.all(
      rows.map(async ({ approver, ...r }) => ({
        ...r,
        recipients: await recipientsFor(r.userId, approver),
        // Admins can't open a member's task (tasks stay personal); they decide in the inbox.
        url:
          approver === "admin"
            ? `${config.PUBLIC_URL}/inbox`
            : `${config.PUBLIC_URL}/t/${r.chatId}`,
      })),
    );
    await this.each("notify", (c) => c.notify(approvals));
    return approvals;
  }

  async resolved(decided: ResolvedApproval[]) {
    if (decided.length === 0) return;
    await this.each("resolved", (c) => c.resolved?.(decided));
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
