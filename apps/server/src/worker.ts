import { type ModelSpec, nextUndoWaitMs, runAgent, skillsPromptBlock } from "@synapse/core";
import {
  claimRun,
  continuePendingInputs,
  fireDueAutomations,
  PgRunStore,
  releaseRun,
  renewLease,
  resetAttempts,
  schema,
} from "@synapse/db";
import { buildToolset, loadMemoryBlock, loadWritingStyle } from "@synapse/tools";
import type { LanguageModel } from "ai";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { log } from "./log";
import { buildSystemPrompt } from "./prompt";
import { RUNS_CHANNEL, type Services } from "./services";
import { pollGmailTriggers } from "./triggers";
import { resolveModels } from "./user-models";

const LEASE_MS = 60_000;
const IDLE_POLL_MS = 5_000;

/**
 * Pulls runnable runs from Postgres and drives them with the agent runtime.
 * Any number of workers on any number of machines can run this; leases keep each run on
 * exactly one worker, and a crashed worker's runs are picked up when its lease expires.
 */
export class Worker {
  private readonly id = `w-${crypto.randomUUID().slice(0, 8)}`;
  private stopped = false;
  private wakers: (() => void)[] = [];
  private loops: Promise<void>[] = [];
  private unlisten: (() => Promise<void>) | null = null;
  private scheduler: Timer | null = null;

  constructor(
    private readonly s: Services,
    /** Test hook: replaces model resolution (e.g. with scripted models). */
    private readonly modelOverride?: () => { spec: ModelSpec; model: LanguageModel }[],
  ) {}

  async start(concurrency: number) {
    this.unlisten = await this.s.database.listen(RUNS_CHANNEL, () => this.wakeOne());
    for (let i = 0; i < concurrency; i++) this.loops.push(this.loop());
    this.scheduler = setInterval(() => void this.fireAutomations(), 30_000);
    void this.fireAutomations();
    log.info("worker started", { worker: this.id, concurrency });
  }

  async stop() {
    this.stopped = true;
    if (this.scheduler) clearInterval(this.scheduler);
    for (const w of this.wakers.splice(0)) w();
    await this.unlisten?.();
    await Promise.allSettled(this.loops);
  }

  private async fireAutomations() {
    try {
      const fired = await fireDueAutomations(this.s.database.db);
      for (const runId of fired) await this.s.wake(runId);
      if (fired.length) log.info("automations fired", { count: fired.length });
    } catch (error) {
      log.error("automation scheduler failed", { error: String(error) });
    }
    try {
      const fired = await pollGmailTriggers(this.s);
      for (const runId of fired) await this.s.wake(runId);
      if (fired.length) log.info("email triggers fired", { count: fired.length });
    } catch (error) {
      log.error("email trigger poll failed", { error: String(error) });
    }
  }

  private wakeOne() {
    this.wakers.shift()?.();
  }

  /** Nudges idle workers when a parked run becomes claimable, instead of waiting for a poll. */
  private wakeLater(runId: string, ms: number) {
    const timer = setTimeout(() => {
      if (!this.stopped) void this.s.wake(runId).catch(() => {});
    }, ms + 25);
    timer.unref?.();
  }

  private idle(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wakers = this.wakers.filter((w) => w !== done);
        resolve();
      };
      const timer = setTimeout(done, IDLE_POLL_MS);
      this.wakers.push(done);
    });
  }

  private async loop() {
    while (!this.stopped) {
      try {
        const claim = await claimRun(this.s.database.db, this.id, LEASE_MS);
        if (!claim) {
          await this.idle();
          continue;
        }
        if (claim.exhausted) {
          await this.fail(
            claim.runId,
            "This run kept failing and was stopped. Try sending your message again.",
          );
          await releaseRun(this.s.database.db, claim.runId, this.id);
          continue;
        }
        await this.process(claim.runId);
      } catch (error) {
        log.error("worker loop error", { error: String(error) });
        await Bun.sleep(1_000);
      }
    }
  }

  /**
   * Fails a run visibly: events first (so a connected client sees why before the stream
   * closes), then status, then anything left awaiting approval is closed.
   */
  private async fail(runId: string, message: string) {
    const { db } = this.s.database;
    await this.s.events.emit(runId, { type: "error", message, retryable: false });
    await db
      .update(schema.toolCalls)
      .set({
        status: "denied",
        output: { type: "denied", reason: "The run failed before this action ran." },
      })
      .where(
        and(
          eq(schema.toolCalls.runId, runId),
          inArray(schema.toolCalls.status, ["proposed", "awaiting_approval", "approved"]),
        ),
      );
    await db
      .update(schema.runs)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(schema.runs.id, runId));
    await this.s.events.emit(runId, { type: "run.status", status: "failed", error: message });
    await this.s.events.flush(runId);
  }

  /** Takes the lease on a specific run (if free) and drives it. Used by tests. */
  async processNow(runId: string): Promise<boolean> {
    const taken = await this.s.database.db
      .update(schema.runs)
      .set({ leaseOwner: this.id, leaseExpiresAt: new Date(Date.now() + LEASE_MS) })
      .where(
        and(
          eq(schema.runs.id, runId),
          inArray(schema.runs.status, ["queued", "running"]),
          sql`(${schema.runs.leaseExpiresAt} is null or ${schema.runs.leaseExpiresAt} < now())`,
        ),
      )
      .returning({ id: schema.runs.id });
    if (taken.length === 0) return false;
    await this.process(runId);
    return true;
  }

  /** Drives one run the caller holds the lease for, until it pauses or finishes. */
  async process(runId: string) {
    const { database, events, config } = this.s;
    const db = database.db;
    const controller = new AbortController();
    let toolset: Awaited<ReturnType<typeof buildToolset>> | null = null;
    let chatId: string | null = null;

    // Renew the lease; if it cannot be renewed before it would expire, stop driving the run
    // so we never overlap with the worker that takes it over.
    let renewedAt = Date.now();
    const heartbeat = setInterval(async () => {
      try {
        if (await renewLease(db, runId, this.id, LEASE_MS)) renewedAt = Date.now();
        else controller.abort(new Error("lease lost"));
        const [r] = await db
          .select({ c: schema.runs.cancelRequested })
          .from(schema.runs)
          .where(eq(schema.runs.id, runId));
        if (r?.c === "now") controller.abort(new Error("cancelled"));
      } catch (error) {
        log.warn("heartbeat failed", { runId, error: String(error) });
      }
      if (Date.now() - renewedAt > LEASE_MS * 0.75) controller.abort(new Error("lease expiring"));
    }, 5_000);

    try {
      const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
      if (!run) return;
      chatId = run.chatId;
      const [user] = await db.select().from(schema.user).where(eq(schema.user.id, run.userId));
      const [settings] = await db
        .select()
        .from(schema.userSettings)
        .where(eq(schema.userSettings.userId, run.userId));

      const perDay = capBudget(settings?.budgets?.perDayUsd, config.DAY_MAX_COST_USD);
      const overBudget = await this.dailySpendExceeded(run.userId, perDay);
      const models = this.modelOverride?.() ?? (await this.resolveModels(settings));
      if (overBudget || models.length === 0) {
        await this.fail(
          runId,
          overBudget
            ? "Daily spending limit reached. Try again tomorrow or ask the operator to raise it."
            : "No model is configured with an API key. Add a provider key in Settings.",
        );
        return;
      }

      toolset = await buildToolset(this.s.toolset, run.userId);
      const conns = await db
        .select({ name: schema.connections.name })
        .from(schema.connections)
        .where(
          and(eq(schema.connections.userId, run.userId), eq(schema.connections.status, "active")),
        );
      if (toolset.registry.get("gmail_search"))
        conns.unshift({ name: "Gmail and Google Calendar" });
      const system = buildSystemPrompt({
        userName: user?.name ?? "there",
        instructions: settings?.instructions ?? null,
        memory: await loadMemoryBlock(db, run.userId),
        writingStyle: await loadWritingStyle(db, run.userId),
        connections: conns.map((c) => c.name),
        skills: skillsPromptBlock(toolset.skills),
      });

      const summary = this.modelOverride
        ? []
        : await this.resolveModels(settings, [config.SYNAPSE_SUMMARY_MODEL]);
      const status = await runAgent({
        runId,
        store: new PgRunStore(db, this.id),
        events,
        tools: toolset.registry,
        models,
        ...(summary[0] ? { summaryModel: summary[0] } : {}),
        system,
        signal: controller.signal,
        limits: {
          maxSteps: config.RUN_MAX_STEPS,
          maxCostUsd: capBudget(settings?.budgets?.perRunUsd, config.RUN_MAX_COST_USD),
        },
      });
      await events.flush(runId);
      await resetAttempts(db, runId);
      // "running" means parked on an undo window: come back exactly when it ends. Read
      // fresh so an undo that landed meanwhile resumes the run now.
      const wait =
        status === "running" ? nextUndoWaitMs(await new PgRunStore(db).listToolCalls(runId)) : 0;
      await releaseRun(db, runId, this.id, wait);
      if (wait > 0) this.wakeLater(runId, wait);
      // New approvals: tell the person wherever they are (phone, Slack…).
      if (status === "waiting")
        await this.s.notifier.announce(runId).catch((error) => {
          log.warn("announcing approvals failed", { runId, error: String(error) });
        });
    } catch (error) {
      await events.flush(runId).catch(() => {});
      if (controller.signal.aborted) {
        // Lease lost or expiring: another worker owns the run now. Touch nothing.
        log.warn("stopped driving run", { runId, reason: String(controller.signal.reason) });
      } else {
        // Retryable failure (provider outage, network): back off and let any worker retry.
        try {
          const [r] = await db
            .select({ attempts: schema.runs.attempts })
            .from(schema.runs)
            .where(eq(schema.runs.id, runId));
          const delay = Math.min(5_000 * 2 ** ((r?.attempts ?? 1) - 1), 120_000);
          log.warn("run will be retried", { runId, delayMs: delay, error: String(error) });
          await releaseRun(db, runId, this.id, delay);
        } catch (releaseError) {
          log.error("could not release run; its lease will expire", {
            runId,
            error: String(releaseError),
          });
        }
      }
    } finally {
      clearInterval(heartbeat);
      events.forget(runId);
      await toolset?.close().catch(() => {});
      // Messages that arrived as the run ended get a run of their own.
      if (chatId) {
        const next = await continuePendingInputs(db, chatId).catch(() => null);
        if (next) await this.s.wake(next).catch(() => {});
      }
    }
  }

  private resolveModels(
    settings: typeof schema.userSettings.$inferSelect | undefined,
    refs?: string[],
  ) {
    return resolveModels(this.s, settings, refs);
  }

  private async dailySpendExceeded(userId: string, limit: number): Promise<boolean> {
    if (limit <= 0) return false;
    const since = new Date(Date.now() - 24 * 3600_000);
    const [row] = await this.s.database.db
      .select({ total: sql<number>`coalesce(sum(${schema.runs.costUsd}), 0)::float` })
      .from(schema.runs)
      .where(and(eq(schema.runs.userId, userId), gte(schema.runs.createdAt, since)));
    return (row?.total ?? 0) >= limit;
  }
}

/**
 * A user's budget can only tighten the operator's cap. 0 or unset means "use the cap";
 * an operator cap of 0 means no cap, in which case the user's own limit applies.
 */
export function capBudget(user: number | undefined | null, operator: number): number {
  const mine = user && user > 0 ? user : 0;
  if (operator <= 0) return mine;
  return mine > 0 ? Math.min(mine, operator) : operator;
}
