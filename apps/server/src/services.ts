import { createDatabase, type Database, EVENTS_CHANNEL, EventLog, SecretBox } from "@synapse/db";
import { createEmbedder, type ToolsetConfig } from "@synapse/tools";
import { type Auth, createAuth } from "./auth";
import type { Config } from "./config";
import { EmailChannel, type MailTransport, smtpTransport } from "./notify/email";
import { Notifier } from "./notify/notifier";
import { PushChannel, type PushSender, webPushSender } from "./notify/push";

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
    if (!set) {
      set = new Set();
      this.subs.set(runId, set);
    }
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
  /** Tells people about approvals through push, Slack and other channels. */
  notifier: Notifier;
  /** Web Push, when VAPID keys are configured. */
  push: PushChannel | null;
  /** Email alerts, when SMTP is configured. */
  email: EmailChannel | null;
  /** Wakes idle workers (on any instance) when a run becomes runnable. */
  wake: (runId: string) => Promise<void>;
  close: () => Promise<void>;
}

/** Swappable delivery, so tests never touch the network. */
export interface ServiceOptions {
  pushSender?: PushSender;
  mailTransport?: MailTransport;
}

export async function createServices(
  config: Config,
  options: ServiceOptions = {},
): Promise<Services> {
  const database = await createDatabase(config.DATABASE_URL);
  await database.migrate();
  const box = await SecretBox.fromSecret(config.secret);
  const { bus, stop } = await EventBus.create(database);
  const services: Services = {
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
      google: config.google,
    },
    notifier: new Notifier(() => services),
    push: null,
    email: null,
    wake: (runId) => database.notify(RUNS_CHANNEL, runId),
    close: async () => {
      await stop();
      await database.close();
    },
  };
  if (config.push) {
    services.push = new PushChannel(
      () => services,
      config.push,
      options.pushSender ?? webPushSender,
    );
    services.notifier.add(services.push);
  }
  if (config.email) {
    services.email = new EmailChannel(
      () => services,
      config.email.from,
      options.mailTransport ?? smtpTransport(config.email.smtpUrl),
    );
    services.notifier.add(services.email);
  }
  return services;
}
