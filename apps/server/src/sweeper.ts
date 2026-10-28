import {
  claimEscalations,
  claimReminders,
  EXPIRY_DENIAL,
  expireDue,
  unannouncedRuns,
} from "@synapse/db";
import { emitNow } from "./decisions";
import type { Services } from "./services";

/** Approvals nobody was told about after this long are announced by the sweeper instead. */
const ANNOUNCE_GRACE_MS = 2 * 60_000;

export interface SweepResult {
  announced: number;
  expired: number;
  reminded: number;
  escalated: number;
}

/**
 * One pass over waiting approvals: expire what ran out of time (a deny the agent sees; the
 * run continues), send the one reminder, escalate team members' calls to their admins.
 * Every step is claimed with a compare-and-set in the database, so this is idempotent and
 * safe to run from every worker at once. `now` is injectable for tests.
 */
export async function sweepApprovals(
  services: Services,
  now: Date = new Date(),
): Promise<SweepResult> {
  const { db } = services.database;
  const { notifier } = services;

  // A worker that died between pausing a run and announcing it: announce it now.
  const quiet = await unannouncedRuns(db, new Date(now.getTime() - ANNOUNCE_GRACE_MS));
  let announced = 0;
  for (const runId of quiet) announced += (await notifier.announce(runId)).length;

  const expired = await expireDue(db, now);
  for (const e of expired) {
    await emitNow(services, e.runId, {
      type: "tool.status",
      toolCallId: e.toolCallId,
      status: "denied",
    });
    await emitNow(services, e.runId, {
      type: "tool.result",
      toolCallId: e.toolCallId,
      output: { type: "denied", reason: EXPIRY_DENIAL },
    });
  }
  for (const runId of new Set(expired.filter((e) => e.requeued).map((e) => e.runId)))
    await services.wake(runId);
  await notifier.resolved(
    expired.map((e) => ({
      userId: e.userId,
      runId: e.runId,
      toolCallId: e.toolCallId,
      approved: false,
      via: "expiry" as const,
      executeAfter: null,
    })),
  );

  // Remind first: the requester hears "still waiting" before admins hear "escalated".
  const reminded = await claimReminders(db, now);
  await notifier.remind(reminded);
  const escalated = await claimEscalations(db, now);
  await notifier.escalate(escalated);

  return {
    announced,
    expired: expired.length,
    reminded: reminded.length,
    escalated: escalated.length,
  };
}
