import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel, LanguageModelUsage, ProviderMetadata } from "ai";

/**
 * Models are referenced as "provider:model-id", e.g. "anthropic:claude-opus-5-5".
 * `gateway` routes through Vercel AI Gateway with one key, e.g. "gateway:anthropic/claude-sonnet-5.5".
 * `openai-compatible` covers self-hosted or proxy endpoints (vLLM, Ollama, LiteLLM).
 */
export type ProviderName = "anthropic" | "openai" | "google" | "gateway" | "openai-compatible";

const PROVIDERS: readonly ProviderName[] = [
  "anthropic",
  "openai",
  "google",
  "gateway",
  "openai-compatible",
];

export interface ProviderKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  gateway?: string;
  openaiCompatible?: { baseURL: string; apiKey?: string };
}

export interface ModelSpec {
  provider: ProviderName;
  modelId: string;
  /** "provider:model-id" */
  ref: string;
}

export function parseModelRef(ref: string): ModelSpec {
  const i = ref.indexOf(":");
  const provider = ref.slice(0, i) as ProviderName;
  const modelId = ref.slice(i + 1);
  if (i < 1 || !modelId || !PROVIDERS.includes(provider)) {
    throw new Error(`invalid model ref "${ref}", expected provider:model-id`);
  }
  return { provider, modelId, ref };
}

export function createModel(spec: ModelSpec, keys: ProviderKeys): LanguageModel {
  switch (spec.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: requireKey(keys.anthropic, spec) })(spec.modelId);
    case "openai":
      return createOpenAI({ apiKey: requireKey(keys.openai, spec) })(spec.modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey: requireKey(keys.google, spec) })(spec.modelId);
    case "gateway":
      return createGateway({ apiKey: requireKey(keys.gateway, spec) })(spec.modelId);
    case "openai-compatible": {
      const cfg = keys.openaiCompatible;
      if (!cfg) throw new MissingKeyError(spec);
      return createOpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey ?? "none" }).chat(
        spec.modelId,
      );
    }
  }
}

export class MissingKeyError extends Error {
  constructor(spec: ModelSpec) {
    super(`no API key configured for ${spec.provider} (model ${spec.ref})`);
  }
}

function requireKey(key: string | undefined, spec: ModelSpec): string {
  if (!key) throw new MissingKeyError(spec);
  return key;
}

/**
 * USD per million tokens. Used when the provider does not report a cost itself.
 * Unknown models cost 0 and budgets fall back to token limits (see `hasKnownPrice`).
 */
export interface Price {
  input: number;
  output: number;
  cacheRead?: number;
}

export const DEFAULT_PRICES: Record<string, Price> = {
  "anthropic:claude-fable-5-1": { input: 10, output: 50 },
  "anthropic:claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "anthropic:claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "anthropic:claude-haiku-5-5": { input: 0.1, output: 0.5 },
  // Vercel AI Gateway list prices. A cost the gateway reports for a call wins over these.
  "gateway:anthropic/claude-fable-5.1": { input: 10, output: 50 },
  "gateway:anthropic/claude-opus-5.5": { input: 4, output: 20 },
  "gateway:anthropic/claude-sonnet-5.5": { input: 2, output: 10, cacheRead: 0.1 },
  "gateway:anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Whether spend for this model can be measured, so dollar budgets apply to it. */
export function hasKnownPrice(ref: string, prices = DEFAULT_PRICES): boolean {
  return ref in prices;
}

/** The cost a provider reported for the call, if any (Vercel AI Gateway does). */
export function reportedCost(metadata: ProviderMetadata | undefined): number | undefined {
  const raw = metadata?.gateway?.cost;
  const cost = typeof raw === "string" ? Number(raw) : raw;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

export function costUsd(
  ref: string,
  usage: LanguageModelUsage,
  prices = DEFAULT_PRICES,
  metadata?: ProviderMetadata,
): number {
  const reported = reportedCost(metadata);
  if (reported !== undefined) return reported;
  const price = prices[ref];
  if (!price) return 0;
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const freshInput = (usage.inputTokens ?? 0) - cacheRead;
  return (
    (freshInput * price.input +
      cacheRead * (price.cacheRead ?? price.input) +
      (usage.outputTokens ?? 0) * price.output) /
    1_000_000
  );
}

/**
 * Errors worth retrying on the same model, or switching to the next model in the chain.
 * Never applied once output has started streaming.
 */
export function isRetryable(error: unknown): boolean {
  const e = error as { statusCode?: number; isRetryable?: boolean; name?: string; cause?: unknown };
  if (e?.isRetryable === true) return true;
  if (typeof e?.statusCode === "number")
    return e.statusCode === 408 || e.statusCode === 429 || e.statusCode >= 500;
  if (e?.name === "AI_RetryError" && e.cause) return isRetryable(e.cause);
  return e?.name === "TimeoutError" || e?.name === "AI_StreamStallError";
}
