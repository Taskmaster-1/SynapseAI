import {
  createModel,
  type ModelSpec,
  type ProviderKeys,
  parseModelRef,
  runAgent,
} from "@synapse/core";
import { claimRun, PgRunStore, releaseRun, renewLease, resetAttempts, schema } from "@synapse/db";
import { buildToolset, loadMemoryBlock } from "@synapse/tools";
import type { LanguageModel } from "ai";
import { and, eq, gte, sql } from "drizzle-orm";
import { log } from "./log";
import { buildSystemPrompt } from "./prompt";
import { RUNS_CHANNEL, type Services } from "./services";

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

  constructor(
    private readonly s: Services,
    /** Test hook: replaces model resolution (e.g. with scripted models). */
    private readonly modelOverride?: () => { spec: ModelSpec; model: LanguageModel }[],
  ) {}

  async start(concurrency: number) {
    this.unlisten = await this.s.database.listen(RUNS_CHANNEL, () => this.wakeOne());
    for (let i = 0; i < concurrency; i++) this.loops.push(this.loop());
    log.info("worker started", { worker: this.id, concurrency });
  }

  async stop() {
    this.stopped = true;
    for (const w of this.wakers.splice(0)) w();
    await this.unlisten?.();
    await Promise.allSettled(this.loops);
  }

  private wakeOne() {
    this.wakers.shift()?.();
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
      let runId: string | null = null;
      try {
        runId = await claimRun(this.s.database.db, this.id, LEASE_MS);
      } catch (error) {
        log.error("claim failed", { error: String(error) });
      }
      if (!runId) {
        await this.idle();
        continue;
      }
      await this.process(runId);
    }
  }

  /** Drives one run until it pauses or finishes. Exposed for tests. */
  async process(runId: string) {
    const { database, events } = this.s;
    const db = database.db;
    const controller = new AbortController();
    let toolset: Awaited<ReturnType<typeof buildToolset>> | null = null;

    const heartbeat = setInterval(async () => {
      try {
        if (!(await renewLease(db, runId, this.id, LEASE_MS)))
          controller.abort(new Error("lease lost"));
        const [r] = await db
          .select({ c: schema.runs.cancelRequested })
          .from(schema.runs)
          .where(eq(schema.runs.id, runId));
        if (r?.c === "now") controller.abort(new Error("cancelled"));
      } catch (error) {
        log.warn("heartbeat failed", { runId, error: String(error) });
      }
    }, 5_000);

    try {
      const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
      if (!run) return;
      const [user] = await db.select().from(schema.user).where(eq(schema.user.id, run.userId));
      const [settings] = await db
        .select()
        .from(schema.userSettings)
        .where(eq(schema.userSettings.userId, run.userId));

      const overBudget = await this.dailySpendExceeded(run.userId, settings?.budgets?.perDayUsd);
      const models = this.modelOverride?.() ?? (await this.resolveModels(settings));
      if (overBudget || models.length === 0) {
        const message = overBudget
          ? "Daily spending limit reached. Raise it in Settings → Budgets or try again tomorrow."
          : "No model is configured with an API key. Add a provider key in Settings.";
        await db
          .update(schema.runs)
          .set({ status: "failed", error: message, finishedAt: new Date() })
          .where(eq(schema.runs.id, runId));
        await events.emit(runId, { type: "error", message, retryable: false });
        await events.emit(runId, { type: "run.status", status: "failed", error: message });
        return;
      }

      toolset = await buildToolset(this.s.toolset, run.userId);
      const conns = await db
        .select({ name: schema.connections.name })
        .from(schema.connections)
        .where(
          and(eq(schema.connections.userId, run.userId), eq(schema.connections.status, "active")),
        );
      const system = buildSystemPrompt({
        userName: user?.name ?? "there",
        instructions: settings?.instructions ?? null,
        memory: await loadMemoryBlock(db, run.userId),
        connections: conns.map((c) => c.name),
      });

      const summary = this.modelOverride
        ? []
        : await this.resolveModels(settings, [this.s.config.SYNAPSE_SUMMARY_MODEL]);
      const status = await runAgent({
        runId,
        store: new PgRunStore(db),
        events,
        tools: toolset.registry,
        models,
        ...(summary[0] ? { summaryModel: summary[0] } : {}),
        system,
        signal: controller.signal,
        limits: {
          maxSteps: this.s.config.RUN_MAX_STEPS,
          maxCostUsd: settings?.budgets?.perRunUsd ?? this.s.config.RUN_MAX_COST_USD,
        },
      });
      if (status !== "running") await resetAttempts(db, runId);
      await events.flush(runId);
      await releaseRun(db, runId, this.id);
    } catch (error) {
      // Retryable failure (provider outage, network): back off and let any worker retry.
      const [r] = await db
        .select({ attempts: schema.runs.attempts })
        .from(schema.runs)
        .where(eq(schema.runs.id, runId));
      const delay = Math.min(5_000 * 2 ** ((r?.attempts ?? 1) - 1), 120_000);
      log.warn("run will be retried", { runId, delayMs: delay, error: String(error) });
      await events.flush(runId).catch(() => {});
      await releaseRun(db, runId, this.id, delay);
    } finally {
      clearInterval(heartbeat);
      events.forget(runId);
      await toolset?.close();
    }
  }

  private async resolveModels(
    settings: typeof schema.userSettings.$inferSelect | undefined,
    refs = settings?.models?.chain?.length ? settings.models.chain : this.s.config.SYNAPSE_MODELS,
  ) {
    const keys: ProviderKeys = { ...this.s.config.serverKeys };
    for (const [provider, sealed] of Object.entries(settings?.providerKeys ?? {})) {
      const key = await this.s.box.open(sealed);
      if (provider === "anthropic" || provider === "openai" || provider === "google")
        keys[provider] = key;
    }
    const out: { spec: ModelSpec; model: LanguageModel }[] = [];
    for (const ref of refs) {
      try {
        const spec = parseModelRef(ref);
        out.push({ spec, model: createModel(spec, keys) });
      } catch (error) {
        log.warn("skipping model", { ref, error: String(error) });
      }
    }
    return out;
  }

  private async dailySpendExceeded(
    userId: string,
    perDayUsd: number | undefined,
  ): Promise<boolean> {
    const limit = perDayUsd ?? this.s.config.DAY_MAX_COST_USD;
    if (limit <= 0) return false;
    const since = new Date(Date.now() - 24 * 3600_000);
    const [row] = await this.s.database.db
      .select({ total: sql<number>`coalesce(sum(${schema.runs.costUsd}), 0)::float` })
      .from(schema.runs)
      .where(and(eq(schema.runs.userId, userId), gte(schema.runs.createdAt, since)));
    return (row?.total ?? 0) >= limit;
  }
}
