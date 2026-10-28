import type { JSONValue } from "ai";
import { emailsIn, MAX_MATCH_INPUT, newTargetReason, type Target } from "./targets";

export {
  callTargets,
  emailsIn,
  emptyTrustedTargets,
  trustText,
  unseenTargets,
} from "./targets";

import type { Decision, Effect } from "./types";

/**
 * Approval policy. Evaluated in code for every tool call — never left to the prompt.
 *
 * Order:
 *  1. The first matching `block` rule wins outright.
 *  2. Otherwise the first matching `allow`/`ask` rule decides, else the effect default.
 *  3. Rule of Two: once a run is tainted by untrusted content, `send`, `destructive`
 *     and `write` calls are never auto-allowed, whatever the rules say.
 *  4. A read never widens the write: in a tainted run, a call naming a destination that
 *     first appeared in outside content (`newTargets`, see targets.ts) asks with a reason
 *     that names it, and no plan grant can stand in for that approval.
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
  | { path: string; op: "matches"; value: string }
  /**
   * Every email address anywhere in the input (to, cc, bcc, attendees, any field) ends with
   * one of `value`, and there is at least one. `path` is ignored. Safer than `allEndWith` on
   * `to` alone, which says nothing about a `bcc` the agent adds.
   */
  | { path: string; op: "emailsEndWith"; value: string[] };

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
  /**
   * Destinations in this call that the run's trusted context never named (only checked in
   * tainted runs). The runtime computes them with `callTargets` and `unseenTargets`.
   */
  newTargets?: Target[];
}

export interface PolicyResult {
  decision: Decision;
  reason: string;
  ruleId: string | null;
  /** Set when the call asks because of destinations that came from outside content. */
  newTargets?: Target[];
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

  return applyTaint(result, call);
}

/** Steps 3 and 4 above. Never loosens: a block stays a block, an admin's ask stays theirs. */
function applyTaint<T extends PolicyResult & { approver?: Approver | null }>(
  result: T,
  call: PolicyInput,
): T {
  if (!call.tainted || call.effect === "read" || result.decision === "block") return result;
  if (call.newTargets?.length) {
    const why = newTargetReason(call.newTargets);
    return {
      ...result,
      decision: "ask",
      // An admin who must decide sees why the call is unusual, after the team's reason.
      reason: result.approver === "admin" ? `${result.reason} ${why}` : why,
      newTargets: call.newTargets,
    };
  }
  if (result.decision === "allow") {
    return {
      ...result,
      decision: "ask",
      reason: TAINT_REASON,
      ...("approver" in result ? { approver: null } : {}),
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
  return (matchers ?? []).every((m) =>
    matches(m, m.op === "emailsEndWith" ? input : getPath(input, m.path)),
  );
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
    case "emailsEndWith": {
      const emails = emailsIn(value);
      return (
        emails.length > 0 &&
        emails.every((e) => m.value.some((suffix) => e.endsWith(suffix.toLowerCase())))
      );
    }
    case "matches":
      return (
        typeof value === "string" &&
        safeRegExp(m.value)?.test(value.slice(0, MAX_MATCH_INPUT)) === true
      );
  }
}

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

// ── Team policy composition ─────────────────────────────────────────────────

/** Who must decide an `ask`: `"admin"` means a workspace owner or admin, not the requester. */
export type Approver = "admin";

/** A rule set by a team workspace. Applies to every member, on top of their own rules. */
export interface TeamPolicyRule extends PolicyRule {
  /** Only meaningful on `ask` rules: a workspace admin must sign off, not the member. */
  approver?: Approver | null;
}

export interface ComposedPolicyResult extends PolicyResult {
  /** Set when a workspace admin (not the requester) must decide. */
  approver: Approver | null;
  /** Which rule set decided: the team's or the person's own (rules or defaults). */
  source: "team" | "personal";
}

export const ADMIN_APPROVAL_REASON = "Your team requires an admin to approve this.";

const TAINT_REASON =
  "This task has read outside content (an email, web page or document), so anything that changes or sends data needs your approval.";

/** Strictness order used to combine team and personal verdicts. */
function strictness(v: { decision: Decision; approver: Approver | null }): number {
  if (v.decision === "block") return 3;
  if (v.decision === "ask") return v.approver === "admin" ? 2 : 1;
  return 0;
}

/**
 * Evaluates a call against a person's own policy and their team's rules, and takes the
 * strictest: block > ask (an admin must decide) > ask > allow.
 *
 *  - Team rules have no defaults: a team rule that doesn't match has no opinion, and the
 *    personal policy (rules, then defaults) decides. So a team `allow` never loosens a
 *    personal `ask`, and a personal `allow` never loosens a team `ask` or `block`.
 *  - Among team rules, the first matching `block` wins, else the first matching rule.
 *  - Taint applies to the combined result: an `allow` of a non-read call in a tainted run
 *    becomes an ordinary `ask`. Stricter results (block, admin ask) are left as they are.
 *  - With no team rules this is exactly `evaluatePolicy`, plus `approver: null`.
 */
export function evaluateComposedPolicy(
  call: PolicyInput,
  personal: { rules: PolicyRule[]; defaults?: PolicyDefaults },
  teamRules: TeamPolicyRule[] = [],
): ComposedPolicyResult {
  if (teamRules.length === 0) {
    return {
      ...evaluatePolicy(call, personal.rules, personal.defaults),
      approver: null,
      source: "personal",
    };
  }

  const own: ComposedPolicyResult = {
    ...evaluatePolicy({ ...call, tainted: false }, personal.rules, personal.defaults),
    approver: null,
    source: "personal",
  };
  const team = evaluateTeamRules(call, teamRules);
  // Ties go to the personal verdict; only the team can be stricter than it.
  const result = team && strictness(team) > strictness(own) ? team : own;

  return applyTaint(result, call);
}

function evaluateTeamRules(
  call: PolicyInput,
  rules: TeamPolicyRule[],
): ComposedPolicyResult | null {
  const matching = rules.filter(
    (r) => globMatch(r.tool, call.tool) && matchesAll(r.when, call.input),
  );
  const rule = matching.find((r) => r.decision === "block") ?? matching[0];
  if (!rule) return null;
  const approver = rule.decision === "ask" && rule.approver === "admin" ? "admin" : null;
  let reason: string;
  if (rule.decision === "block")
    reason = rule.note ?? `Blocked by your team's rule for “${rule.tool}”.`;
  else if (approver)
    reason = rule.note ? `${ADMIN_APPROVAL_REASON} ${rule.note}` : ADMIN_APPROVAL_REASON;
  else if (rule.decision === "ask")
    reason = rule.note ?? `Your team asks for approval on “${rule.tool}”.`;
  else reason = rule.note ?? `Allowed by your team's rule for “${rule.tool}”.`;
  return { decision: rule.decision, reason, ruleId: rule.id, approver, source: "team" };
}

/**
 * Whether an exact-input plan grant may turn this verdict into an allow. A grant stands in
 * for the requester's own approval, so it satisfies an ordinary ask (theirs or their
 * team's) but never a block, nor an ask that an admin must decide, nor a call whose
 * destinations first appeared in outside content: a plan is signed off as a list, and a
 * new recipient in it deserves a look of its own.
 */
export function planGrantMaySatisfy(verdict: {
  decision: Decision;
  approver: Approver | null;
  newTargets?: Target[];
}): boolean {
  return (
    verdict.decision !== "block" && verdict.approver !== "admin" && !verdict.newTargets?.length
  );
}
