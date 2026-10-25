import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseModelRef } from "@synapse/core";
import type { GoogleAppConfig, WebSearchConfig } from "@synapse/tools";
import webpush from "web-push";
import { z } from "zod";

const csv = z.string().transform((s) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
);

/** An empty value (`KEY=` in a .env file) counts as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(8787),
  /** postgres://… or pglite://<dir> (embedded, single process). */
  DATABASE_URL: z.string().default("pglite://.data/pglite"),
  /** Encrypts tokens and keys at rest and signs sessions. ≥ 32 chars. */
  SYNAPSE_SECRET: z.string().min(32).optional(),
  /** Public URL users open (the web app; it proxies /api to this server). */
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  ROLE: z.enum(["all", "api", "worker"]).default("all"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  /** Fallback chain. Defaults to Claude, direct or through the gateway (see `defaultModels`). */
  SYNAPSE_MODELS: csv.optional(),
  SYNAPSE_SUMMARY_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Vercel AI Gateway: one key for many providers, models as "gateway:anthropic/claude-sonnet-5.5". */
  AI_GATEWAY_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  OPENAI_COMPATIBLE_BASE_URL: z.string().url().optional(),
  OPENAI_COMPATIBLE_API_KEY: z.string().optional(),
  /** Sync model list prices daily from the gateway's public catalog (no key is sent). */
  SYNAPSE_PRICE_SYNC: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  WEB_SEARCH_PROVIDER: z.enum(["tavily", "brave", "exa"]).optional(),
  WEB_SEARCH_API_KEY: z.string().optional(),
  /** "openai:text-embedding-3-small" or "google:gemini-embedding-001"; unset = keyword search only. */
  EMBEDDING_MODEL: z.string().optional(),

  RUN_MAX_STEPS: z.coerce.number().int().default(25),
  RUN_MAX_COST_USD: z.coerce.number().default(2),
  DAY_MAX_COST_USD: z.coerce.number().default(20),

  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  /** One Google OAuth app serves both "Sign in with Google" and the Gmail/Calendar integration. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** How often email triggers check for new mail. */
  TRIGGER_POLL_SECONDS: z.coerce.number().int().min(30).default(120),

  /** Web Push (VAPID). Generate with `bunx web-push generate-vapid-keys`; dev makes its own. */
  VAPID_PUBLIC_KEY: optional(z.string().min(40)),
  VAPID_PRIVATE_KEY: optional(z.string().min(20)),
  /** Who push services can contact about this sender: "mailto:you@example.com" or an https URL. */
  VAPID_SUBJECT: optional(
    z.string().regex(/^(mailto:.+@.+|https:\/\/.+)$/, "must be mailto:… or https://…"),
  ),
  /** Email alerts over SMTP, e.g. smtps://user:pass@smtp.example.com:465. */
  SMTP_URL: optional(z.string().url()),
  /** Sender for email alerts, e.g. "Synapse <synapse@example.com>". */
  EMAIL_FROM: optional(z.string().min(3)),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = Env.parse(env);
  const defaults = defaultModels(parsed);
  const models = parsed.SYNAPSE_MODELS?.length ? parsed.SYNAPSE_MODELS : defaults.chain;
  const summaryModel = parsed.SYNAPSE_SUMMARY_MODEL ?? defaults.summary;
  for (const ref of [...models, summaryModel]) parseModelRef(ref);

  const secret = parsed.SYNAPSE_SECRET ?? devSecret(parsed);

  const webSearch: WebSearchConfig | null =
    parsed.WEB_SEARCH_PROVIDER && parsed.WEB_SEARCH_API_KEY
      ? { provider: parsed.WEB_SEARCH_PROVIDER, apiKey: parsed.WEB_SEARCH_API_KEY }
      : null;

  const embeddingProvider = parsed.EMBEDDING_MODEL?.split(":")[0];
  const embeddingKey =
    embeddingProvider === "openai"
      ? parsed.OPENAI_API_KEY
      : embeddingProvider === "google"
        ? parsed.GOOGLE_GENERATIVE_AI_API_KEY
        : undefined;

  const google: GoogleAppConfig | null =
    parsed.GOOGLE_CLIENT_ID && parsed.GOOGLE_CLIENT_SECRET
      ? {
          clientId: parsed.GOOGLE_CLIENT_ID,
          clientSecret: parsed.GOOGLE_CLIENT_SECRET,
          publicUrl: parsed.PUBLIC_URL,
        }
      : null;

  return {
    ...parsed,
    google,
    push: pushConfig(parsed),
    email:
      parsed.SMTP_URL && parsed.EMAIL_FROM
        ? { smtpUrl: parsed.SMTP_URL, from: parsed.EMAIL_FROM }
        : null,
    SYNAPSE_MODELS: models,
    SYNAPSE_SUMMARY_MODEL: summaryModel,
    secret,
    webSearch,
    embedding:
      parsed.EMBEDDING_MODEL && embeddingKey
        ? { model: parsed.EMBEDDING_MODEL, apiKey: embeddingKey }
        : null,
    serverKeys: {
      ...(parsed.ANTHROPIC_API_KEY ? { anthropic: parsed.ANTHROPIC_API_KEY } : {}),
      ...(parsed.OPENAI_API_KEY ? { openai: parsed.OPENAI_API_KEY } : {}),
      ...(parsed.GOOGLE_GENERATIVE_AI_API_KEY
        ? { google: parsed.GOOGLE_GENERATIVE_AI_API_KEY }
        : {}),
      ...(parsed.AI_GATEWAY_API_KEY ? { gateway: parsed.AI_GATEWAY_API_KEY } : {}),
      ...(parsed.OPENAI_COMPATIBLE_BASE_URL
        ? {
            openaiCompatible: {
              baseURL: parsed.OPENAI_COMPATIBLE_BASE_URL,
              ...(parsed.OPENAI_COMPATIBLE_API_KEY
                ? { apiKey: parsed.OPENAI_COMPATIBLE_API_KEY }
                : {}),
            },
          }
        : {}),
    },
  };
}

/** Claude models, through the gateway when that is the only key configured. */
function defaultModels(parsed: z.infer<typeof Env>) {
  if (parsed.AI_GATEWAY_API_KEY && !parsed.ANTHROPIC_API_KEY) {
    return {
      chain: ["gateway:anthropic/claude-opus-5.5", "gateway:anthropic/claude-sonnet-5.5"],
      summary: "gateway:anthropic/claude-haiku-5.5",
    };
  }
  return {
    chain: ["anthropic:claude-opus-5-5", "anthropic:claude-sonnet-5-5"],
    summary: "anthropic:claude-haiku-5-5",
  };
}

/** In development, persist a random secret next to the embedded database. */
function devSecret(parsed: z.infer<typeof Env>): string {
  if (parsed.NODE_ENV === "production") throw new Error("SYNAPSE_SECRET is required in production");
  const path = ".data/secret";
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  mkdirSync(dirname(path), { recursive: true });
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  writeFileSync(path, secret, { mode: 0o600 });
  return secret;
}

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * VAPID keys from the environment. In development, unset keys are generated once and kept
 * in .data/vapid.json (like the dev secret) so subscriptions survive restarts; production
 * and tests never generate them, so push stays off until configured.
 */
function pushConfig(parsed: z.infer<typeof Env>): PushConfig | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = parsed;
  if (Boolean(publicKey) !== Boolean(privateKey))
    throw new Error("Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither");
  const fallbackSubject = parsed.PUBLIC_URL.startsWith("https://")
    ? parsed.PUBLIC_URL
    : "mailto:synapse@localhost.localdomain";
  if (publicKey && privateKey) {
    if (parsed.NODE_ENV === "production" && !parsed.VAPID_SUBJECT)
      throw new Error("VAPID_SUBJECT (mailto:you@example.com) is required with VAPID keys");
    return { publicKey, privateKey, subject: parsed.VAPID_SUBJECT ?? fallbackSubject };
  }
  if (parsed.NODE_ENV !== "development") return null;
  return { ...devVapidKeys(), subject: parsed.VAPID_SUBJECT ?? fallbackSubject };
}

function devVapidKeys(): { publicKey: string; privateKey: string } {
  const path = ".data/vapid.json";
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  mkdirSync(dirname(path), { recursive: true });
  const keys = webpush.generateVAPIDKeys();
  writeFileSync(path, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}
