import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";

const base = { NODE_ENV: "test", SYNAPSE_SECRET: "x".repeat(32) };

describe("config", () => {
  test("defaults to Claude direct", () => {
    const c = loadConfig({ ...base, ANTHROPIC_API_KEY: "a" });
    expect(c.SYNAPSE_MODELS).toEqual(["anthropic:claude-opus-5-5", "anthropic:claude-sonnet-5-5"]);
    expect(c.SYNAPSE_SUMMARY_MODEL).toBe("anthropic:claude-haiku-5-5");
  });

  test("defaults to Claude through the gateway when it is the only key", () => {
    const c = loadConfig({ ...base, AI_GATEWAY_API_KEY: "g" });
    expect(c.SYNAPSE_MODELS).toEqual([
      "gateway:anthropic/claude-opus-5.5",
      "gateway:anthropic/claude-sonnet-5.5",
    ]);
    expect(c.SYNAPSE_SUMMARY_MODEL).toBe("gateway:anthropic/claude-haiku-5.5");
    expect(c.serverKeys.gateway).toBe("g");
  });

  test("an explicit chain wins", () => {
    const c = loadConfig({ ...base, AI_GATEWAY_API_KEY: "g", SYNAPSE_MODELS: "openai:gpt-5" });
    expect(c.SYNAPSE_MODELS).toEqual(["openai:gpt-5"]);
  });
});
