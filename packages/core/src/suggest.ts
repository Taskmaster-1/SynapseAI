import type { JSONValue } from "ai";
import { type ArgMatcher, getPath, globMatch, type PolicyRule } from "./policy";
import type { Effect } from "./types";

/**
 * Approvals that learn. When a person keeps approving the same kind of action without
 * changing it, offer an ordinary allow rule for it. Pure: the caller fetches decisions.
 *
 * Learned rules never weaken the Rule of Two: a tainted run still asks for every
 * non-read call, whatever the rules say.
 */

/** One human decision on a non-read tool call. */
export interface PastDecision {
  tool: string;
  effect: Effect;
  input: JSONValue;
  inputEdited: boolean;
  approved: boolean;
  decidedAt: Date;
  /** One-line summary from the tool, if any. */
  preview?: string | null;
}

export interface RuleSuggestion {
  /** Stable: a hash of the tool and matchers. */
  id: string;
  tool: string;
  effect: Effect;
  when: ArgMatcher[];
  /** Note stored on the rule when accepted. */
  note: string;
  /** Unedited approvals behind this suggestion. */
  count: number;
  /** What the rule covers, e.g. "emails to @acme.com". */
  label: string;
  /** e.g. "You approved 7 emails to @acme.com without changes." */
  sentence: string;
  /** Up to three recent previews. */
  examples: string[];
}

export const SUGGEST_MIN_APPROVALS = 5;
export const SUGGEST_RECENT_WINDOW = 10;
export const SUGGEST_LOOKBACK_DAYS = 60;

const RECIPIENT_FIELDS = ["to", "cc", "bcc", "recipients", "email", "attendees"];
const SCOPE_FIELDS = ["repo", "repository", "project", "channel", "team"];

/** Anyone can have an address here, so a domain rule would allow nearly everyone. */
const PUBLIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
  "zoho.com",
  "fastmail.com",
]);

export function suggestRules(
  decisions: PastDecision[],
  rules: PolicyRule[],
  dismissed: readonly string[] = [],
): RuleSuggestion[] {
  const byTool = new Map<string, PastDecision[]>();
  for (const d of decisions) {
    if (d.effect === "read") continue;
    const list = byTool.get(d.tool) ?? [];
    list.push(d);
    byTool.set(d.tool, list);
  }

  const out: RuleSuggestion[] = [];
  for (const [tool, list] of byTool) {
    list.sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime());
    const recent = list.slice(0, SUGGEST_RECENT_WINDOW);
    if (recent.some((d) => !d.approved || d.inputEdited)) continue;
    const clean = list.filter((d) => d.approved && !d.inputEdited);
    if (clean.length < SUGGEST_MIN_APPROVALS) continue;

    const effect = clean[0]!.effect;
    const when = generalize(clean.map((d) => d.input));
    // Sending and irreversible actions are never allowed tool-wide.
    if (when.length === 0 && effect !== "write") continue;

    const id = suggestionId(tool, when);
    if (dismissed.includes(id)) continue;
    if (alreadyAllowed(tool, when, rules)) continue;

    const label = describe(tool, when);
    out.push({
      id,
      tool,
      effect,
      when,
      note: `Learned: you approved ${clean.length} of these`,
      count: clean.length,
      label,
      sentence: `You approved ${clean.length} ${label} without changes.`,
      examples: clean
        .slice(0, 3)
        .map((d) => d.preview?.trim() || clip(JSON.stringify(d.input)))
        .filter(Boolean),
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Matchers that cover every input, or [] when nothing safe generalizes. */
export function generalize(inputs: JSONValue[]): ArgMatcher[] {
  const when: ArgMatcher[] = [];

  for (const path of RECIPIENT_FIELDS) {
    const present = inputs.map((i) => getPath(i, path)).filter((v) => !isEmpty(v));
    if (present.length === 0) continue;
    // Seen on some calls but not others: a matcher would not fit, and dropping it would
    // leave the field unconstrained. Give up on recipients entirely.
    if (present.length !== inputs.length) return scopeOnly(inputs);
    const domains = new Set<string>();
    for (const v of present) {
      for (const item of Array.isArray(v) ? v : [v]) {
        const domain = typeof item === "string" ? emailDomain(item) : null;
        if (!domain) return scopeOnly(inputs);
        domains.add(domain);
      }
    }
    const [domain] = domains;
    if (domains.size !== 1 || !domain || PUBLIC_DOMAINS.has(domain)) return scopeOnly(inputs);
    when.push({ path, op: "allEndWith", value: [`@${domain}`] });
  }

  return [...when, ...scopeOnly(inputs)];
}

function scopeOnly(inputs: JSONValue[]): ArgMatcher[] {
  const when: ArgMatcher[] = [];
  for (const path of SCOPE_FIELDS) {
    const values = inputs.map((i) => getPath(i, path));
    const first = values[0];
    if (typeof first === "string" && first !== "" && values.every((v) => v === first)) {
      when.push({ path, op: "equals", value: first });
    }
  }
  return when;
}

function emailDomain(address: string): string | null {
  const m = /^[^@\s<>]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i.exec(address.trim());
  return m ? m[1]!.toLowerCase() : null;
}

function isEmpty(v: JSONValue | undefined): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * An existing allow rule for this tool whose matchers are all among ours (or none at all)
 * already covers everything the suggestion would.
 */
function alreadyAllowed(tool: string, when: ArgMatcher[], rules: PolicyRule[]): boolean {
  const keys = new Set(when.map(matcherKey));
  return rules.some(
    (r) =>
      r.decision === "allow" &&
      globMatch(r.tool, tool) &&
      (r.when ?? []).every((m) => keys.has(matcherKey(m))),
  );
}

function matcherKey(m: ArgMatcher): string {
  const value =
    m.op === "allEndWith" ? [...m.value].map((s) => s.toLowerCase()).sort() : (m.value as unknown);
  return JSON.stringify([m.path, m.op, value]);
}

export function suggestionId(tool: string, when: ArgMatcher[]): string {
  const key = JSON.stringify([tool, [...when.map(matcherKey)].sort()]);
  return `sg_${fnv1a(key, 0x811c9dc5)}${fnv1a(key, 0x01000193)}`;
}

function fnv1a(s: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const NOUNS: Record<string, string> = {
  gmail_send: "emails",
  gmail_create_draft: "drafts",
  calendar_create_event: "invites",
  calendar_update_event: "event changes",
};

function describe(tool: string, when: ArgMatcher[]): string {
  const noun = NOUNS[tool] ?? `${tool} actions`;
  const parts = when.map((m) => {
    if (m.op === "allEndWith") return `to ${m.value.join(", ")}`;
    if (m.op === "equals") return `in ${String(m.value)}`;
    return `with ${m.path}`;
  });
  const recipients = [...new Set(parts.filter((p) => p.startsWith("to ")))];
  const rest = parts.filter((p) => !p.startsWith("to "));
  return [noun, ...recipients, ...rest].join(" ");
}

function clip(s: string, max = 120): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
