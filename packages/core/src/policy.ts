import type { JSONValue } from "ai";
import type { Decision, Effect } from "./types";

/**
 * Approval policy. Evaluated in code for every tool call — never left to the prompt.
 *
 * Order:
 *  1. The first matching `block` rule wins outright.
 *  2. Otherwise the first matching `allow`/`ask` rule decides, else the effect default.
 *  3. Rule of Two: once a run is tainted by untrusted content, `send`, `destructive`
 *     and `write` calls are never auto-allowed, whatever the rules say.
 */
export interface PolicyRule {
  id: string;
  /** Glob over tool names: `*`, `gmail_*`, `github_create_issue`. */
  tool: string;
  decision: Decision;
  /** All matchers must hold. Paths are dot-separated into the tool input. */
  when?: ArgMatcher[];
  note?: string;
}

export type ArgMatcher =
  | { path: string; op: "equals"; value: JSONValue }
  | { path: string; op: "in"; value: JSONValue[] }
  /** Every string at `path` (scalar or array) ends with one of `value`. Handy for email domains. */
  | { path: string; op: "allEndWith"; value: string[] }
  | { path: string; op: "matches"; value: string };

export interface PolicyDefaults {
  read: Decision;
  write: Decision;
  send: Decision;
  destructive: Decision;
}

export const SAFE_DEFAULTS: PolicyDefaults = {
  read: "allow",
  write: "ask",
  send: "ask",
  destructive: "ask",
};

export interface PolicyInput {
  tool: string;
  effect: Effect;
  input: JSONValue;
  tainted: boolean;
  /** Tool-specific default used when no rule matches, e.g. "allow" for memory notes. */
  defaultDecision?: Decision;
}

export interface PolicyResult {
  decision: Decision;
  reason: string;
  ruleId: string | null;
}

export function evaluatePolicy(
  call: PolicyInput,
  rules: PolicyRule[],
  defaults: PolicyDefaults = SAFE_DEFAULTS,
): PolicyResult {
  const matching = rules.filter(
    (r) => globMatch(r.tool, call.tool) && matchesAll(r.when, call.input),
  );

  const blocked = matching.find((r) => r.decision === "block");
  if (blocked) {
    return {
      decision: "block",
      reason: blocked.note ?? `blocked by rule ${blocked.id}`,
      ruleId: blocked.id,
    };
  }

  const rule = matching[0];
  const result: PolicyResult = rule
    ? { decision: rule.decision, reason: rule.note ?? `rule ${rule.id}`, ruleId: rule.id }
    : call.defaultDecision
      ? { decision: call.defaultDecision, reason: `default for ${call.tool}`, ruleId: null }
      : {
          decision: defaults[call.effect],
          reason: `default for ${call.effect} tools`,
          ruleId: null,
        };

  if (result.decision === "allow" && call.tainted && call.effect !== "read") {
    return {
      decision: "ask",
      reason:
        "This run has read untrusted content (e.g. an email or web page), so actions that change or send data need your approval.",
      ruleId: result.ruleId,
    };
  }
  return result;
}

export function globMatch(pattern: string, name: string): boolean {
  const re = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`);
  return re.test(name);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function matchesAll(matchers: ArgMatcher[] | undefined, input: JSONValue): boolean {
  return (matchers ?? []).every((m) => matches(m, getPath(input, m.path)));
}

function matches(m: ArgMatcher, value: JSONValue | undefined): boolean {
  switch (m.op) {
    case "equals":
      return deepEqual(value, m.value);
    case "in":
      return m.value.some((v) => deepEqual(value, v));
    case "allEndWith": {
      const values = Array.isArray(value) ? value : [value];
      return (
        values.length > 0 &&
        values.every(
          (v) =>
            typeof v === "string" &&
            m.value.some((suffix) => v.toLowerCase().endsWith(suffix.toLowerCase())),
        )
      );
    }
    case "matches":
      return typeof value === "string" && safeRegExp(m.value)?.test(value) === true;
  }
}

function safeRegExp(source: string): RegExp | null {
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

export function getPath(value: JSONValue, path: string): JSONValue | undefined {
  let current: JSONValue | undefined = value;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = Array.isArray(current)
      ? current[Number(key)]
      : (current as Record<string, JSONValue>)[key];
  }
  return current;
}

function deepEqual(a: JSONValue | undefined, b: JSONValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
