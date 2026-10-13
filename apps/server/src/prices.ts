import { GATEWAY_MODELS_URL, hasKnownPrice, refreshCatalog } from "@synapse/core";
import type { Config } from "./config";
import { log } from "./log";

const DAY = 24 * 3600_000;

/**
 * Keeps model prices current from the gateway's public catalog: once at startup, then daily.
 * Failures keep the previous (or built-in) prices. Returns a stop function.
 */
export async function startPriceSync(config: Config): Promise<() => void> {
  const enabled = config.SYNAPSE_PRICE_SYNC && config.NODE_ENV !== "test";
  const sync = async () => {
    try {
      const count = await refreshCatalog();
      log.info("model prices synced", { models: count, source: GATEWAY_MODELS_URL });
    } catch (error) {
      log.warn("model price sync failed; using built-in prices", { error: String(error) });
    }
  };
  if (enabled) await sync();
  for (const ref of [...config.SYNAPSE_MODELS, config.SYNAPSE_SUMMARY_MODEL]) {
    if (!hasKnownPrice(ref))
      log.warn(
        "no price known for model; dollar budgets will not limit it, token limits still do",
        {
          model: ref,
        },
      );
  }
  if (!enabled) return () => {};
  const timer = setInterval(() => void sync(), DAY);
  timer.unref?.();
  return () => clearInterval(timer);
}
