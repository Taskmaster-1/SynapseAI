import { createDatabase, type Database, EVENTS_CHANNEL, EventLog, SecretBox } from "@synapse/db";
import { createEmbedder, type ToolsetConfig } from "@synapse/tools";
import { type Auth, createAuth } from "./auth";
import type { Config } from "./config";

export const RUNS_CHANNEL = "synapse_runs";

/** Live fan-out of persisted run events to SSE subscribers on this instance. */
export class EventBus {
  private readonly subs = new Map<string, Set<(seq: number) => void>>();

  static async create(database: Database): Promise<{ bus: EventBus; stop: () => Promise<void> }> {
    const bus = new EventBus();
    const stop = await database.listen(EVENTS_CHANNEL, (payload) => {
      try {
        const { runId, seq } = JSON.parse(payload) as { runId: string; seq: number };
        for (const fn of bus.subs.get(runId) ?? []) fn(seq);
      } catch {
        // ignore malformed payloads
      }
    });
    return { bus, stop };
  }

  subscribe(runId: string, fn: (seq: number) => void): () => void {
    let set = this.subs.get(runId);
    if (!set) this.subs.set(runId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.subs.delete(runId);
    };
  }
}

export interface Services {
  config: Config;
  database: Database;
  box: SecretBox;
  auth: Auth;
  events: EventLog;
  bus: EventBus;
  toolset: ToolsetConfig;
  /** Wakes idle workers (on any instance) when a run becomes runnable. */
  wake: (runId: string) => Promise<void>;
  close: () => Promise<void>;
}

export async function createServices(config: Config): Promise<Services> {
  const database = await createDatabase(config.DATABASE_URL);
  await database.migrate();
  const box = await SecretBox.fromSecret(config.secret);
  const { bus, stop } = await EventBus.create(database);
  return {
    config,
    database,
    box,
    auth: createAuth(database.db, config),
    events: new EventLog(database),
    bus,
    toolset: {
      db: database.db,
      box,
      app: { publicUrl: config.PUBLIC_URL, appName: "SynapseAI" },
      webSearch: config.webSearch,
      embedder: config.embedding ? createEmbedder(config.embedding) : null,
    },
    wake: (runId) => database.notify(RUNS_CHANNEL, runId),
    close: async () => {
      await stop();
      await database.close();
    },
  };
}
