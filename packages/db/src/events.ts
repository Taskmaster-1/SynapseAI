import type { EventSink, RunEvent, SeqEvent } from "@synapse/core";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Database } from "./client";
import { runEvents } from "./schema";

export const EVENTS_CHANNEL = "synapse_run_events";

/**
 * Durable, ordered event log per run, used for streaming to clients and for replay.
 *
 * Text deltas are coalesced for up to `flushMs` so a streaming answer costs a handful of
 * rows per second instead of one per token. Every persisted event is announced on a
 * Postgres channel so any API instance can push it to its connected clients.
 */
export class EventLog implements EventSink {
  private readonly nextSeq = new Map<string, number>();
  private readonly buffers = new Map<
    string,
    { event: Extract<RunEvent, { delta: string }>; timer: Timer }
  >();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly database: Database,
    private readonly flushMs = 60,
  ) {}

  emit(runId: string, event: RunEvent): Promise<void> {
    if (event.type === "text.delta" || event.type === "reasoning.delta") {
      const buf = this.buffers.get(runId);
      if (buf && buf.event.type === event.type && buf.event.messageId === event.messageId) {
        buf.event = { ...buf.event, delta: buf.event.delta + event.delta };
        return Promise.resolve();
      }
      const flushed = this.flush(runId);
      this.buffers.set(runId, {
        event,
        timer: setTimeout(() => {
          this.flush(runId).catch((error) => console.error("event flush failed", runId, error));
        }, this.flushMs),
      });
      return flushed;
    }
    return this.flush(runId).then(() => this.write(runId, event));
  }

  /** Writes any buffered delta for the run. */
  flush(runId: string): Promise<void> {
    const buf = this.buffers.get(runId);
    if (!buf) return this.chain.then(() => undefined);
    clearTimeout(buf.timer);
    this.buffers.delete(runId);
    return this.write(runId, buf.event);
  }

  /** Serialised so seq numbers stay dense and ordered. */
  private write(runId: string, event: RunEvent): Promise<void> {
    const next = this.chain.then(async () => {
      const { db } = this.database;
      let seq = this.nextSeq.get(runId);
      if (seq === undefined) {
        const [row] = await db
          .select({ max: sql<number>`coalesce(max(${runEvents.seq}), 0)::int` })
          .from(runEvents)
          .where(eq(runEvents.runId, runId));
        seq = row!.max + 1;
      }
      // Another writer may have appended since our cache was filled (a previous worker of
      // this run); on a seq conflict, re-read the tail and retry once.
      const inserted = await db
        .insert(runEvents)
        .values({ runId, seq, event: event as unknown as Record<string, unknown> })
        .onConflictDoNothing()
        .returning({ seq: runEvents.seq });
      if (inserted.length === 0) {
        const [row] = await db
          .select({ max: sql<number>`coalesce(max(${runEvents.seq}), 0)::int` })
          .from(runEvents)
          .where(eq(runEvents.runId, runId));
        seq = row!.max + 1;
        await db
          .insert(runEvents)
          .values({ runId, seq, event: event as unknown as Record<string, unknown> });
      }
      this.nextSeq.set(runId, seq + 1);
      await this.database.notify(EVENTS_CHANNEL, JSON.stringify({ runId, seq }));
    });
    this.chain = next.catch(() => {});
    return next;
  }

  /** Forget cached seq for a run (on lease release) so another worker can continue it. */
  forget(runId: string) {
    this.nextSeq.delete(runId);
  }
}

export async function readEvents(
  database: Database,
  runId: string,
  afterSeq: number,
  limit = 1000,
): Promise<SeqEvent[]> {
  const rows = await database.db
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
    .orderBy(asc(runEvents.seq))
    .limit(limit);
  return rows.map((r) => ({ ...(r.event as unknown as RunEvent), seq: r.seq, runId: r.runId }));
}
