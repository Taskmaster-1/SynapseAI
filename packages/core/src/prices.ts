/**
 * Model prices and the live model catalog.
 *
 * Vercel AI Gateway publishes every model it serves, with list prices, at a public URL (no
 * key). Synced into memory, it prices `gateway:<creator>/<model>` refs and the same models
 * reached directly (`openai:gpt-5.5`, `anthropic:claude-sonnet-5-5`, …). The static table
 * below is the offline fallback; synced entries override it.
 */

/** USD per million tokens. */
export interface Price {
  input: number;
  output: number;
  cacheRead?: number;
  /** Writing a prompt-cache entry (Anthropic bills 1.25× input). Unset: billed as input. */
  cacheWrite?: number;
}

/**
 * Used when the provider does not report a cost itself and the catalog has not synced.
 * Unknown models cost 0 and budgets fall back to token limits (see `hasKnownPrice`).
 */
export const DEFAULT_PRICES: Record<string, Price> = {
  "anthropic:claude-fable-5-1": { input: 10, output: 50, cacheWrite: 12.5 },
  "anthropic:claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "anthropic:claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "anthropic:claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125 },
  "openai:gpt-5.5": { input: 5, output: 30, cacheRead: 0.5 },
  "openai:gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075 },
  "google:gemini-3.5-flash": { input: 1.5, output: 9, cacheRead: 0.15 },
  "google:gemini-3.1-pro-preview": { input: 2, output: 12, cacheRead: 0.2 },
  // Vercel AI Gateway list prices. A cost the gateway reports for a call wins over these.
  "gateway:anthropic/claude-fable-5.1": {
    input: 10,
    output: 50,
    cacheRead: 0.25,
    cacheWrite: 12.5,
  },
  "gateway:anthropic/claude-opus-5.5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "gateway:anthropic/claude-sonnet-5.5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "gateway:anthropic/claude-haiku-5.5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
  },
  "gateway:openai/gpt-5.5": { input: 5, output: 30, cacheRead: 0.5 },
  "gateway:openai/gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075 },
  "gateway:google/gemini-3.5-flash": { input: 1.5, output: 9, cacheRead: 0.15 },
  "gateway:google/gemini-3.1-pro-preview": { input: 2, output: 12, cacheRead: 0.2 },
};

export const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

/** A language model the gateway serves. `id` is "<creator>/<model>". */
export interface CatalogModel {
  id: string;
  name: string;
  creator: string;
  contextWindow: number | null;
  tags: string[];
  /** ISO date. */
  released: string | null;
  price: Price | null;
}

let catalog: { models: CatalogModel[]; byId: Map<string, CatalogModel>; updatedAt: Date } | null =
  null;

const perMillion = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0
    ? Math.round(n * 1e6 * 1e6) / 1e6
    : undefined;
};

/** Parses the gateway's `/v1/models` response, keeping language models only. */
export function parseCatalog(json: unknown): CatalogModel[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error("unexpected model catalog shape");
  const out: CatalogModel[] = [];
  for (const raw of data) {
    const m = raw as Record<string, unknown>;
    if (m.type !== "language" || typeof m.id !== "string" || !m.id.includes("/")) continue;
    const pricing = (m.pricing ?? {}) as Record<string, unknown>;
    const input = perMillion(pricing.input);
    const output = perMillion(pricing.output);
    const cacheRead = perMillion(pricing.input_cache_read);
    const cacheWrite = perMillion(pricing.input_cache_write);
    out.push({
      id: m.id,
      name: typeof m.name === "string" ? m.name : m.id,
      creator: typeof m.owned_by === "string" ? m.owned_by : m.id.split("/")[0]!,
      contextWindow: typeof m.context_window === "number" ? m.context_window : null,
      tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === "string") : [],
      released: typeof m.released === "number" ? new Date(m.released * 1000).toISOString() : null,
      price:
        input !== undefined && output !== undefined
          ? {
              input,
              output,
              ...(cacheRead !== undefined ? { cacheRead } : {}),
              ...(cacheWrite !== undefined ? { cacheWrite } : {}),
            }
          : null,
    });
  }
  return out;
}

export function setCatalog(models: CatalogModel[], updatedAt = new Date()) {
  catalog = { models, byId: new Map(models.map((m) => [m.id, m])), updatedAt };
}

export function clearCatalog() {
  catalog = null;
}

export function getCatalog(): { models: CatalogModel[]; updatedAt: Date | null } {
  return { models: catalog?.models ?? [], updatedAt: catalog?.updatedAt ?? null };
}

/** Fetches the public catalog. Never sends credentials. Throws on failure; callers fail soft. */
export async function refreshCatalog(
  opts: { url?: string; timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<number> {
  const res = await (opts.fetch ?? fetch)(opts.url ?? GATEWAY_MODELS_URL, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`model catalog returned ${res.status}`);
  const models = parseCatalog(await res.json());
  if (models.length === 0) throw new Error("model catalog is empty");
  setCatalog(models);
  return models.length;
}

/** Direct providers whose model ids match the gateway's "<creator>/<model>" ids. */
const DIRECT = ["anthropic", "openai", "google"] as const;

/**
 * The gateway ids a ref may correspond to. Direct Anthropic ids write the version with a
 * dash (claude-sonnet-5-5) where the gateway uses a dot (claude-sonnet-5.5).
 */
export function catalogIdsFor(ref: string): string[] {
  const i = ref.indexOf(":");
  const provider = ref.slice(0, i);
  const id = ref.slice(i + 1);
  if (provider === "gateway") return [id];
  if (!(DIRECT as readonly string[]).includes(provider)) return [];
  const exact = `${provider}/${id}`;
  const dotted = exact.replace(/-(\d+)-(\d+)$/, "-$1.$2");
  return dotted === exact ? [exact] : [exact, dotted];
}

/** The direct-provider ref for a catalog model, if its creator is a provider we call directly. */
export function directRefFor(model: Pick<CatalogModel, "id" | "creator">): string | null {
  const [creator, ...rest] = model.id.split("/");
  if (!creator || !(DIRECT as readonly string[]).includes(creator)) return null;
  const id = rest.join("/");
  return `${creator}:${creator === "anthropic" ? id.replace(/-(\d+)\.(\d+)$/, "-$1-$2") : id}`;
}

export function catalogModelFor(ref: string): CatalogModel | undefined {
  if (!catalog) return undefined;
  for (const id of catalogIdsFor(ref)) {
    const m = catalog.byId.get(id);
    if (m) return m;
  }
  return undefined;
}

/** Synced catalog price first, then the static table. */
export function priceFor(ref: string): Price | undefined {
  return catalogModelFor(ref)?.price ?? DEFAULT_PRICES[ref];
}
