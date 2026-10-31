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

  test("the GitHub tools share the sign-in app unless a dedicated one is set", () => {
    expect(loadConfig(base).github).toBeNull();
    const signIn = { ...base, GITHUB_CLIENT_ID: "a", GITHUB_CLIENT_SECRET: "b" };
    expect(loadConfig(signIn).github).toMatchObject({ clientId: "a", sharedWithSignIn: true });
    const own = { ...signIn, GITHUB_TOOLS_CLIENT_ID: "c", GITHUB_TOOLS_CLIENT_SECRET: "d" };
    expect(loadConfig(own).github).toEqual({
      clientId: "c",
      clientSecret: "d",
      publicUrl: "http://localhost:3000",
    });
    expect(() => loadConfig({ ...signIn, GITHUB_TOOLS_CLIENT_ID: "c" })).toThrow(
      "Set both GITHUB_TOOLS_CLIENT_ID",
    );
  });
});
