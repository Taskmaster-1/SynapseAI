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

const DEFAULT_REASONS: Record<Decision, string> = {
  allow: "Allowed by default for this tool.",
  ask: "This tool asks for approval by default.",
  block: "This tool is blocked by default.",
};

const EFFECT_REASONS: Record<Effect, Record<Decision, string>> = {
  read: {
    allow: "Reading is allowed by default.",
    ask: "Reading asks for approval under your defaults.",
    block: "Reading is blocked under your defaults.",
  },
  write: {
    allow: "Changes are allowed under your defaults.",
    ask: "Changes in your tools ask for approval by default.",
    block: "Changes are blocked under your defaults.",
  },
  send: {
    allow: "Sending is allowed under your defaults.",
    ask: "Sending anything on your behalf asks for approval by default.",
    block: "Sending is blocked under your defaults.",
  },
  destructive: {
    allow: "Irreversible actions are allowed under your defaults.",
    ask: "Deleting or irreversible actions ask for approval by default.",
    block: "Irreversible actions are blocked under your defaults.",
  },
};

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
      reason: blocked.note ?? `Blocked by your rule for “${blocked.tool}”.`,
      ruleId: blocked.id,
    };
  }

  const rule = matching[0];
  const result: PolicyResult = rule
    ? {
        decision: rule.decision,
        reason: rule.note ?? `Matches your rule for “${rule.tool}”.`,
        ruleId: rule.id,
      }
    : call.defaultDecision
      ? {
          decision: call.defaultDecision,
          reason: DEFAULT_REASONS[call.defaultDecision],
          ruleId: null,
        }
      : {
          decision: defaults[call.effect],
          reason: EFFECT_REASONS[call.effect][defaults[call.effect]],
          ruleId: null,
        };

  if (result.decision === "allow" && call.tainted && call.effect !== "read") {
    return {
      decision: "ask",
      reason:
        "This task has read outside content (an email, web page or document), so anything that changes or sends data needs your approval.",
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
      return (
        typeof value === "string" &&
        safeRegExp(m.value)?.test(value.slice(0, MAX_MATCH_INPUT)) === true
      );
  }
}

const MAX_MATCH_INPUT = 10_000;
const MAX_PATTERN = 500;

/**
 * Rule patterns run synchronously on model-generated input, so patterns prone to
 * catastrophic backtracking are refused: nested quantifiers like `(a+)+` and backreferences.
 */
export function unsafePatternReason(source: string): string | null {
  if (source.length > MAX_PATTERN) return `pattern longer than ${MAX_PATTERN} characters`;
  if (/\\[1-9]|\\k</.test(source)) return "backreferences are not allowed";
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(source)) {
    return "nested quantifiers (like (a+)+) are not allowed";
  }
  try {
    new RegExp(source);
  } catch (error) {
    return error instanceof Error ? error.message : "invalid pattern";
  }
  return null;
}

const compiled = new Map<string, RegExp | null>();

function safeRegExp(source: string): RegExp | null {
  let re = compiled.get(source);
  if (re === undefined) {
    re = unsafePatternReason(source) ? null : new RegExp(source);
    if (compiled.size > 1000) compiled.clear();
    compiled.set(source, re);
  }
  return re;
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
