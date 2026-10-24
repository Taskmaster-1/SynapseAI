import { Cron } from "croner";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "./client";
import { sendMessage } from "./runs";
import { automations } from "./schema";

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

/**
 * Fires every due automation once. Safe with many schedulers: each row is claimed with
 * SKIP LOCKED and its next fire time is advanced in the same transaction as the message.
 * Missed fires (e.g. while down) collapse into one run.
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
            sql`${automations.trigger}->>'type' = 'schedule'`,
          ),
        )
        .orderBy(asc(automations.nextRunAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!due) return null;
      let next: Date | null = null;
      try {
        next = nextRun(due.schedule, due.timezone, now);
      } catch {
        next = null;
      }
      await tx
        .update(automations)
        .set({ nextRunAt: next, lastRunAt: now, ...(next ? {} : { enabled: false }) })
        .where(eq(automations.id, due.id));
      const sent = await sendMessage(tx as unknown as Db, {
        userId: due.userId,
        chatId: due.chatId,
        content: `[Scheduled: ${due.name}]\n\n${due.prompt}`,
        trigger: "schedule",
      });
      return sent.queued === "skipped" ? "skipped" : sent.runId;
    });
    if (!runId) return fired;
    if (runId !== "skipped") fired.push(runId);
  }
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
