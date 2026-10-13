import { afterEach, describe, expect, test } from "bun:test";
import { costUsd, hasKnownPrice } from "./models";
import {
  catalogIdsFor,
  clearCatalog,
  directRefFor,
  getCatalog,
  parseCatalog,
  priceFor,
  refreshCatalog,
  setCatalog,
} from "./prices";

const FIXTURE = {
  object: "list",
  data: [
    {
      id: "anthropic/claude-sonnet-5.5",
      owned_by: "anthropic",
      name: "Claude Sonnet 5.5",
      type: "language",
      context_window: 1_000_000,
      released: 1790035200,
      tags: ["tool-use", "reasoning"],
      pricing: {
        input: "0.000002",
        output: "0.00001",
        input_cache_read: "0.0000001",
        input_cache_write: "0.0000025",
      },
    },
    {
      id: "openai/gpt-9",
      owned_by: "openai",
      name: "GPT-9",
      type: "language",
      pricing: { input: "0.000005", output: "0.00003" },
    },
    { id: "acme/no-price", owned_by: "acme", name: "No price", type: "language" },
    { id: "openai/image-1", type: "image", pricing: { input: "1", output: "1" } },
  ],
};

afterEach(() => clearCatalog());

describe("price catalog", () => {
  test("parses language models into per-million prices", () => {
    const models = parseCatalog(FIXTURE);
    expect(models.map((m) => m.id)).toEqual([
      "anthropic/claude-sonnet-5.5",
      "openai/gpt-9",
      "acme/no-price",
    ]);
    expect(models[0]).toEqual({
      id: "anthropic/claude-sonnet-5.5",
      name: "Claude Sonnet 5.5",
      creator: "anthropic",
      contextWindow: 1_000_000,
      tags: ["tool-use", "reasoning"],
      released: new Date(1790035200 * 1000).toISOString(),
      price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    });
    expect(models[2]!.price).toBeNull();
    expect(() => parseCatalog({ nope: true })).toThrow();
  });

  test("maps direct refs to gateway ids, including Anthropic's dashed versions", () => {
    expect(catalogIdsFor("anthropic:claude-sonnet-5-5")).toEqual([
      "anthropic/claude-sonnet-5-5",
      "anthropic/claude-sonnet-5.5",
    ]);
    expect(catalogIdsFor("openai:gpt-9")).toEqual(["openai/gpt-9"]);
    expect(catalogIdsFor("gateway:xai/grok-5")).toEqual(["xai/grok-5"]);
    expect(catalogIdsFor("openai-compatible:llama")).toEqual([]);
    expect(directRefFor({ id: "anthropic/claude-sonnet-5.5", creator: "anthropic" })).toBe(
      "anthropic:claude-sonnet-5-5",
    );
    expect(directRefFor({ id: "openai/gpt-9", creator: "openai" })).toBe("openai:gpt-9");
    expect(directRefFor({ id: "xai/grok-5", creator: "xai" })).toBeNull();
  });

  test("synced prices override the built-in table and price every route to a model", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0 } as Parameters<typeof costUsd>[1];
    expect(hasKnownPrice("openai:gpt-9")).toBe(false);
    setCatalog(parseCatalog(FIXTURE));
    expect(costUsd("openai:gpt-9", usage)).toBeCloseTo(5);
    expect(costUsd("gateway:openai/gpt-9", usage)).toBeCloseTo(5);
    expect(priceFor("anthropic:claude-sonnet-5-5")).toEqual({
      input: 2,
      output: 10,
      cacheRead: 0.1,
      cacheWrite: 2.5,
    });
    expect(hasKnownPrice("gateway:acme/no-price")).toBe(false);
    // Explicit tables still win when passed.
    expect(costUsd("openai:gpt-9", usage, {})).toBe(0);
  });

  test("refresh fetches without credentials and fails without touching prices", async () => {
    let seen: RequestInit | undefined;
    const ok = (async (_url: string, init?: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify(FIXTURE));
    }) as unknown as typeof fetch;
    expect(await refreshCatalog({ fetch: ok })).toBe(3);
    expect(new Headers(seen?.headers).has("authorization")).toBe(false);
    expect(getCatalog().updatedAt).toBeInstanceOf(Date);

    const failing = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    await expect(refreshCatalog({ fetch: failing })).rejects.toThrow("503");
    expect(getCatalog().models).toHaveLength(3);
  });
});
