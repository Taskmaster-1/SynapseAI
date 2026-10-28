import type { NoticeKind, PendingApproval } from "./types";

/** Notification titles, by why it is being sent. */
export const TITLE: Record<NoticeKind, string> = {
  new: "Synapse needs your OK",
  reminder: "Reminder: Synapse still needs your OK",
  escalated: "Escalated to you: a teammate's action needs an admin",
  second: "Needs a second approval",
};

/** "45 min", "3 h", "2 days": how long until `at`. */
export function timeLeft(at: Date, now = Date.now()): string {
  const min = Math.max(0, Math.round((at.getTime() - now) / 60_000));
  if (min < 1) return "less than a minute";
  if (min < 90) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/**
 * The plain-text lines under an approval in push and email: risk facts, two-person
 * progress, escalation, expiry. Empty when there is nothing to say.
 */
export function detailLines(a: PendingApproval, now = Date.now()): string[] {
  const lines: string[] = [];
  if (a.facts.length) lines.push(a.facts.join(" · "));
  const status: string[] = [];
  if (a.signoffs.needed === 2)
    status.push(
      a.signoffs.first
        ? `1 of 2 approvals (${a.signoffs.first.name} approved)`
        : "Needs 2 approvals from different people",
    );
  if (a.escalated) status.push("Escalated to admins");
  if (a.expiresAt) status.push(`Expires in ${timeLeft(a.expiresAt, now)}`);
  if (status.length) lines.push(status.join(" · "));
  return lines;
}
