import { createModel, type ModelSpec, type ProviderKeys, parseModelRef } from "@synapse/core";
import type { schema } from "@synapse/db";
import type { LanguageModel } from "ai";
import { log } from "./log";
import type { Services } from "./services";

export type ResolvedModel = { spec: ModelSpec; model: LanguageModel };

/**
 * The user's model chain (or the server default), with their own provider keys over the
 * server's. Refs that can't be built (unknown provider, no key) are skipped.
 */
export async function resolveModels(
  s: Services,
  settings: typeof schema.userSettings.$inferSelect | undefined,
  refs = settings?.models?.chain?.length ? settings.models.chain : s.config.SYNAPSE_MODELS,
): Promise<ResolvedModel[]> {
  const keys: ProviderKeys = { ...s.config.serverKeys };
  for (const [provider, sealed] of Object.entries(settings?.providerKeys ?? {})) {
    const key = await s.box.open(sealed);
    if (
      provider === "anthropic" ||
      provider === "openai" ||
      provider === "google" ||
      provider === "gateway"
    )
      keys[provider] = key;
  }
  const out: ResolvedModel[] = [];
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
