import { describe, expect, test } from "bun:test";
import {
  costUsd,
  createModel,
  hasKnownPrice,
  MissingKeyError,
  parseModelRef,
  reportedCost,
} from "./models";

const usage = { inputTokens: 1_000, outputTokens: 100 } as Parameters<typeof costUsd>[1];

describe("models", () => {
  test("gateway refs keep the creator/model id intact", () => {
    expect(parseModelRef("gateway:anthropic/claude-sonnet-5.5")).toEqual({
      provider: "gateway",
      modelId: "anthropic/claude-sonnet-5.5",
      ref: "gateway:anthropic/claude-sonnet-5.5",
    });
    expect(() => parseModelRef("vercel:anthropic/claude-sonnet-5.5")).toThrow();
  });

  test("gateway models need a gateway key", () => {
    const spec = parseModelRef("gateway:anthropic/claude-sonnet-5.5");
    expect(() => createModel(spec, {})).toThrow(MissingKeyError);
    expect(createModel(spec, { gateway: "test-key" })).toBeDefined();
  });

  test("gateway calls are priced from the list when no cost is reported", () => {
    expect(costUsd("gateway:anthropic/claude-sonnet-5.5", usage)).toBeCloseTo(
      (1_000 * 2 + 100 * 10) / 1e6,
    );
    expect(costUsd("openai-compatible:local", usage)).toBe(0);
  });

  test("cache reads and writes are billed at their own rates", () => {
    const cached = {
      inputTokens: 1_000,
      outputTokens: 0,
      inputTokenDetails: { cacheReadTokens: 600, cacheWriteTokens: 300, noCacheTokens: 100 },
    } as Parameters<typeof costUsd>[1];
    // 100 fresh × $2 + 600 read × $0.2 + 300 written × $2.5 (1.25× input), per million.
    expect(costUsd("anthropic:claude-sonnet-5-5", cached)).toBeCloseTo(
      (100 * 2 + 600 * 0.2 + 300 * 2.5) / 1e6,
    );
    // Without a cache-write price, writes cost the same as input.
    expect(costUsd("x:y", cached, { "x:y": { input: 1, output: 1, cacheRead: 0.1 } })).toBeCloseTo(
      (100 + 60 + 300) / 1e6,
    );
  });

  test("reported cost accepts numbers and numeric strings only", () => {
    expect(reportedCost({ gateway: { cost: "0.5" } })).toBe(0.5);
    expect(reportedCost({ gateway: { cost: 0.25 } })).toBe(0.25);
    expect(reportedCost({ gateway: { cost: "n/a" } })).toBeUndefined();
    expect(reportedCost({ gateway: { cost: -1 } })).toBeUndefined();
    expect(reportedCost({ anthropic: { cost: 1 } })).toBeUndefined();
    expect(reportedCost(undefined)).toBeUndefined();
  });

  test("known prices decide whether dollar budgets apply", () => {
    expect(hasKnownPrice("anthropic:claude-sonnet-5-5")).toBe(true);
    expect(hasKnownPrice("gateway:anthropic/claude-sonnet-5.5")).toBe(true);
    expect(hasKnownPrice("openai-compatible:llama")).toBe(false);
  });
});
