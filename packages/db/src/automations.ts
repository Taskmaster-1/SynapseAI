import { Cron } from "croner";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "./client";
import { sendMessage } from "./runs";
import { automations, chats, messages, runs } from "./schema";

/** Next fire time for a cron expression, or throws on an invalid expression/timezone. */
export function nextRun(schedule: string, timezone: string, after = new Date()): Date | null {
  return new Cron(schedule, { timezone, paused: true }).nextRun(after);
}

/** Validates a schedule and requires at least `minMinutes` between consecutive runs. */
export function validateSchedule(
  schedule: string,
  timezone: string,
  minMinutes = 15,
): string | null {
  try {
    const first = nextRun(schedule, timezone);
    if (!first) return "This schedule never fires.";
    const second = nextRun(schedule, timezone, first);
    if (second && second.getTime() - first.getTime() < minMinutes * 60_000) {
      return `Runs must be at least ${minMinutes} minutes apart.`;
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid schedule.";
  }
}

export function isTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of `at` in `timezone`. */
export function wallClock(at: Date, timezone: string) {
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  });
  for (const p of format.formatToParts(at)) parts[p.type] = p.value;
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? ""),
  };
}

export const REPEATS = ["none", "daily", "weekdays", "weekly", "monthly"] as const;
export type Repeat = (typeof REPEATS)[number];

/** A one-off fire time, or a cron with its first fire time. */
export type SchedulePlan =
  | { runAt: Date; schedule: ""; nextRunAt: Date; timezone: string }
  | { runAt: null; schedule: string; nextRunAt: Date; timezone: string };

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_AHEAD_MS = 366 * 24 * 3600_000;

/**
 * Turns "when, and how often" into automation fields. `when` must be an ISO time with an
 * offset (the model resolves "Friday at 9" itself), in the future and within a year.
 * `repeat` is a keyword, anchored on `when`'s wall-clock time in `timezone` (so "weekly"
 * from a Friday at 09:00 fires Fridays at 09:00, through DST changes), or a five-field cron
 * whose first fire is at or after `when`. Returns the plan, or an error for the model.
 */
export function planSchedule(
  args: { when: string; repeat?: string | null; timezone: string },
  now = new Date(),
): SchedulePlan | string {
  const { timezone } = args;
  if (!isTimeZone(timezone)) return `Unknown time zone "${timezone}". Use an IANA name.`;
  const when = args.when.trim();
  const at = new Date(when);
  if (!ISO_WITH_OFFSET.test(when) || Number.isNaN(at.getTime()))
    return `"${args.when}" is not an ISO 8601 time with an offset, like 2026-11-07T09:00:00+01:00.`;
  if (at.getTime() <= now.getTime())
    return `${when} is in the past (it is now ${now.toISOString()}).`;
  if (at.getTime() - now.getTime() > MAX_AHEAD_MS) return "That is more than a year away.";
  const repeat = (args.repeat ?? "none").trim() || "none";
  if (repeat === "none") return { runAt: at, schedule: "", nextRunAt: at, timezone };
  let schedule: string;
  if ((REPEATS as readonly string[]).includes(repeat)) {
    const w = wallClock(at, timezone);
    const hm = `${w.minute} ${w.hour}`;
    schedule =
      repeat === "daily"
        ? `${hm} * * *`
        : repeat === "weekdays"
          ? `${hm} * * 1-5`
          : repeat === "weekly"
            ? `${hm} * * ${w.weekday}`
            : `${hm} ${w.day} * *`;
  } else {
    if (repeat.split(/\s+/).length !== 5)
      return `repeat must be one of ${REPEATS.join(", ")}, or a five-field cron expression.`;
    schedule = repeat;
  }
  const problem = validateSchedule(schedule, timezone);
  if (problem) return problem;
  // The first fire is `when` itself for keywords, else the first cron time from then on.
  const first = nextRun(schedule, timezone, new Date(at.getTime() - 1000));
  if (!first) return "This schedule never fires.";
  return { runAt: null, schedule, nextRunAt: first, timezone };
}

/** A one-off whose chat is busy (a run going, or waiting on the user) retries after this. */
const RETRY_BUSY_MS = 60_000;

/**
 * Fires every due automation once. Safe with many schedulers: each row is claimed with
 * SKIP LOCKED and its next fire time is advanced in the same transaction as the message.
 * Missed fires (e.g. while down) collapse into one run. One-offs turn off once they fire.
 */
export async function fireDueAutomations(db: Db, now = new Date()): Promise<string[]> {
  const fired: string[] = [];
  for (;;) {
    const runId = await db.transaction(async (tx) => {
      const [due] = await tx
        .select()
        .from(automations)
        .where(
          and(
            eq(automations.enabled, true),
            lte(automations.nextRunAt, now),
            eq(automations.kind, "task"),
            sql`${automations.trigger}->>'type' = 'schedule'`,
          ),
        )
        .orderBy(asc(automations.nextRunAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!due) return null;
      const sent = await sendMessage(tx as unknown as Db, {
        userId: due.userId,
        chatId: due.chatId,
        content: `[Scheduled: ${due.name}]\n\n${due.prompt}`,
        trigger: "schedule",
      });
      // A one-off that finds its chat busy tries again shortly instead of being lost.
      if (sent.queued === "skipped" && due.runAt) {
        await tx
          .update(automations)
          .set({ nextRunAt: new Date(now.getTime() + RETRY_BUSY_MS) })
          .where(eq(automations.id, due.id));
        return "skipped";
      }
      await advance(tx as unknown as Db, due, now);
      return sent.queued === "skipped" ? "skipped" : sent.runId;
    });
    if (!runId) return fired;
    if (runId !== "skipped") fired.push(runId);
  }
}

/** Moves a fired automation to its next time; one-offs, and schedules that end, turn off. */
async function advance(tx: Db, due: typeof automations.$inferSelect, now: Date) {
  let next: Date | null = null;
  if (!due.runAt) {
    try {
      next = nextRun(due.schedule, due.timezone, now);
    } catch {
      next = null;
    }
  }
  await tx
    .update(automations)
    .set({ nextRunAt: next, lastRunAt: now, ...(next ? {} : { enabled: false }) })
    .where(eq(automations.id, due.id));
}

/** A reminder that just fired, for the notification channels. */
export interface FiredReminder {
  automationId: string;
  userId: string;
  chatId: string;
  title: string;
  text: string;
}

/**
 * Fires due reminders: no model call, just a note from the assistant in the chat the
 * reminder belongs to, and the returned list, which the caller hands to the notifier. Like
 * fireDueAutomations, each row is claimed with SKIP LOCKED and advanced in the same
 * transaction, so a reminder is delivered at most once. A chat with a run going (or waiting
 * on an approval) is never written to mid-turn: the reminder is still delivered on time,
 * through the notifier only.
 */
export async function fireDueReminders(db: Db, now = new Date()): Promise<FiredReminder[]> {
  const fired: FiredReminder[] = [];
  for (;;) {
    const more = await db.transaction(async (tx) => {
      const [due] = await tx
        .select()
        .from(automations)
        .where(
          and(
            eq(automations.enabled, true),
            lte(automations.nextRunAt, now),
            eq(automations.kind, "reminder"),
            sql`${automations.trigger}->>'type' = 'schedule'`,
          ),
        )
        .orderBy(asc(automations.nextRunAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!due) return false;
      const [busy] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(eq(runs.chatId, due.chatId), inArray(runs.status, ["queued", "running", "waiting"])),
        )
        .limit(1);
      if (!busy) {
        await tx.insert(messages).values({
          chatId: due.chatId,
          message: { role: "assistant", content: [{ type: "text", text: reminderText(due) }] },
        });
        await tx.update(chats).set({ updatedAt: now }).where(eq(chats.id, due.chatId));
      }
      await advance(tx as unknown as Db, due, now);
      fired.push({
        automationId: due.id,
        userId: due.userId,
        chatId: due.chatId,
        title: due.name,
        text: due.prompt,
      });
      return true;
    });
    if (!more) return fired;
  }
}

/** How a fired reminder reads in its chat. */
export function reminderText(a: { name: string; prompt: string }) {
  return a.prompt.trim() === a.name.trim()
    ? `Reminder: ${a.name}`
    : `Reminder: ${a.name}\n\n${a.prompt}`;
}

/**
 * Claims the gmail-triggered automations that are due a poll and pushes their next poll
 * `intervalMs` out, so concurrent schedulers never poll the same automation twice.
 */
export async function claimDuePolls(
  db: Db,
  intervalMs: number,
  now = new Date(),
): Promise<(typeof automations.$inferSelect)[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.enabled, true),
          lte(automations.nextRunAt, now),
          sql`${automations.trigger}->>'type' = 'gmail'`,
        ),
      )
      .orderBy(asc(automations.nextRunAt))
      .limit(20)
      .for("update", { skipLocked: true });
    for (const row of due) {
      await tx
        .update(automations)
        .set({ nextRunAt: new Date(now.getTime() + intervalMs) })
        .where(eq(automations.id, row.id));
    }
    return due;
  });
}
