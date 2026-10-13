import {
  type CatalogModel,
  catalogModelFor,
  DEFAULT_PRICES,
  directRefFor,
  getCatalog,
  type Price,
  type ProviderName,
  parseModelRef,
  priceFor,
} from "@synapse/core";
import { schema } from "@synapse/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../http";

export interface ModelEntry {
  ref: string;
  name: string;
  provider: ProviderName;
  creator: string;
  contextWindow: number | null;
  price: Price | null;
  available: boolean;
  tags: string[];
  released: string | null;
}

/**
 * Every model a user can put in their chain: the gateway catalog (as `gateway:` refs and,
 * for Anthropic/OpenAI/Google models, direct refs), the built-in price table and the
 * server's configured chain. `available` means a key for that provider is configured.
 */
export const models = new Hono<AppEnv>().get("/", async (c) => {
  const { config, database } = c.var.services;
  const [settings] = await database.db
    .select({ providerKeys: schema.userSettings.providerKeys })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, c.var.user.id));
  const keys = config.serverKeys;
  const userKeys = settings?.providerKeys ?? {};
  const available = (provider: ProviderName) =>
    provider === "openai-compatible"
      ? Boolean(keys.openaiCompatible)
      : Boolean(keys[provider] || userKeys[provider]);

  const out = new Map<string, ModelEntry>();
  const add = (ref: string, model?: CatalogModel) => {
    if (out.has(ref) || ref.includes("batch")) return;
    let spec: ReturnType<typeof parseModelRef>;
    try {
      spec = parseModelRef(ref);
    } catch {
      return;
    }
    const m = model ?? catalogModelFor(ref);
    out.set(ref, {
      ref,
      name: m?.name ?? spec.modelId,
      provider: spec.provider,
      creator:
        m?.creator ?? (spec.provider === "gateway" ? spec.modelId.split("/")[0]! : spec.provider),
      contextWindow: m?.contextWindow ?? null,
      price: priceFor(ref) ?? null,
      available: available(spec.provider),
      tags: m?.tags ?? [],
      released: m?.released ?? null,
    });
  };

  const catalog = getCatalog();
  for (const m of catalog.models) {
    add(`gateway:${m.id}`, m);
    const direct = directRefFor(m);
    if (direct) add(direct, m);
  }
  for (const ref of [...config.SYNAPSE_MODELS, ...Object.keys(DEFAULT_PRICES)]) add(ref);

  const list = [...out.values()].sort(
    (a, b) =>
      Number(b.available) - Number(a.available) ||
      (b.released ?? "").localeCompare(a.released ?? "") ||
      a.ref.localeCompare(b.ref),
  );
  return c.json({ models: list, updatedAt: catalog.updatedAt?.toISOString() ?? null });
});
