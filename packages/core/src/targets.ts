import type { JSONValue } from "ai";
import type { Effect, StoredMessage } from "./types";

/** Longest string scanned when matching rule input (it runs on model-generated text). */
export const MAX_MATCH_INPUT = 10_000;
const EMAIL = /[^\s@<>"',;:()[\]]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/** Every email address in any string anywhere in a value, lowercased. */
export function emailsIn(value: JSONValue | undefined, maxChars = MAX_MATCH_INPUT): string[] {
  const out: string[] = [];
  const walk = (v: JSONValue | undefined) => {
    if (typeof v === "string") {
      for (const m of v.slice(0, maxChars).matchAll(EMAIL)) out.push(m[0].toLowerCase());
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

/**
 * "A read never widens the write." Once a run has read outside content, a call that sends,
 * deletes or writes somewhere must only go to destinations that were already in play before
 * that content arrived: named in the user's own messages, the system prompt (their
 * instructions, memory and skills), or the run's history before the taint point.
 *
 * Everything here is pure. The runtime collects the trusted destinations from the chat
 * history, extracts each call's destinations, and hands the unseen ones to the policy.
 */

/** A destination named in a tool call. */
export interface Target {
  /** recipient: an email address. site: a host name. destination: any other named place. */
  kind: "recipient" | "site" | "destination";
  /** Lowercased: an address, a host, or a field value like a channel or repository. */
  value: string;
  /** The input field it came from, e.g. "to", "channel", "repo". */
  field: string;
}

/** Destinations already in play before outside content was read. */
export interface TrustedTargets {
  emails: Set<string>;
  hosts: Set<string>;
  /** Lowercased trusted text, searched for other destinations (channels, repositories…). */
  text: string;
}

const MAX_TEXT = 200_000;
const MAX_VALUE = 200;

/** Field names that say where a call goes, compared without case or punctuation. */
const DESTINATION_FIELDS = new Set([
  "to",
  "cc",
  "bcc",
  "recipient",
  "recipients",
  "attendee",
  "attendees",
  "guests",
  "email",
  "emails",
  "address",
  "channel",
  "channels",
  "channelid",
  "chat",
  "chatid",
  "conversation",
  "conversationid",
  "repo",
  "repository",
  "owner",
  "org",
  "organization",
  "domain",
  "host",
  "hostname",
  "phone",
  "phonenumber",
]);

const FIELD_NOUNS: Record<string, string> = {
  to: "recipient",
  cc: "recipient",
  bcc: "recipient",
  recipients: "recipient",
  attendee: "recipient",
  attendees: "recipient",
  guests: "recipient",
  email: "recipient",
  emails: "recipient",
  address: "recipient",
  channelid: "channel",
  channels: "channel",
  chatid: "chat",
  conversationid: "conversation",
  repository: "repository",
  repo: "repository",
  org: "organization",
  phonenumber: "phone number",
};

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isDestinationField(key: string): boolean {
  const k = normalizeKey(key);
  return (
    DESTINATION_FIELDS.has(k) ||
    k.endsWith("url") ||
    k.endsWith("uri") ||
    k.includes("webhook") ||
    k.includes("endpoint")
  );
}

const URL_RE = /\bhttps?:\/\/([^\s/?#<>"'`:@]+(?::\d+)?)/gi;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi;

function hostOf(raw: string): string {
  return raw.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** Hosts of every http(s) URL in a string. */
function urlHosts(s: string): string[] {
  return [...s.slice(0, MAX_TEXT).matchAll(URL_RE)].map((m) => hostOf(m[1]!));
}

/**
 * The destinations a call names. Reads have none. For sends and destructive calls, every
 * email address anywhere in the input counts (a `bcc` the agent adds, or an address in a
 * nested field), like the `emailsEndWith` matcher. For all non-read calls, so do the values
 * of fields that name a destination: `to`, `channel`, `repo`, `*_url`, `webhook`…
 */
export function callTargets(input: JSONValue | undefined, effect: Effect): Target[] {
  if (effect === "read") return [];
  const out = new Map<string, Target>();
  const add = (t: Target) => {
    if (t.value && t.value.length <= MAX_VALUE) out.set(`${t.kind}:${t.value}`, t);
  };
  const anywhere = effect === "send" || effect === "destructive";

  const visit = (v: JSONValue | undefined, field: string, destination: boolean) => {
    if (typeof v === "string") {
      const emails = emailsIn(v);
      if (destination || anywhere)
        for (const e of emails) add({ kind: "recipient", value: e, field });
      if (!destination) return;
      const hosts = urlHosts(v);
      for (const h of hosts) add({ kind: "site", value: h, field });
      if (emails.length === 0 && hosts.length === 0) {
        const value = v
          .trim()
          .replace(/^[#@]+/, "")
          .toLowerCase();
        add({ kind: "destination", value, field });
      }
    } else if (Array.isArray(v)) {
      for (const item of v) visit(item, field, destination);
    } else if (v && typeof v === "object") {
      for (const [k, item] of Object.entries(v)) visit(item, k, isDestinationField(k));
    } else if (destination && typeof v === "number") {
      add({ kind: "destination", value: String(v), field });
    }
  };
  visit(input, "", false);
  return [...out.values()];
}

/** Collects every string in a value (message content, tool inputs and outputs). */
function strings(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const item of v) strings(item, out);
  else if (v && typeof v === "object") for (const item of Object.values(v)) strings(item, out);
}

export function emptyTrustedTargets(): TrustedTargets {
  return { emails: new Set(), hosts: new Set(), text: "" };
}

/** Adds everything a piece of trusted text names to `trusted`. */
export function trustText(trusted: TrustedTargets, text: string): void {
  if (!text) return;
  for (const e of emailsIn(text, MAX_TEXT)) trusted.emails.add(e);
  for (const h of urlHosts(text)) trusted.hosts.add(h);
  for (const m of text.slice(0, MAX_TEXT).matchAll(DOMAIN_RE)) trusted.hosts.add(hostOf(m[0]));
  if (trusted.text.length < MAX_TEXT)
    trusted.text += `\n${text.slice(0, MAX_TEXT - trusted.text.length).toLowerCase()}`;
}

/**
 * Walks a chat's stored history in order and collects what it names before the first
 * outside content arrived, plus everything in the user's own messages at any point.
 *
 *  - User messages are the user's words, trusted wherever they sit, except rows marked
 *    `untrusted` (an event trigger quoting an email or webhook payload): those taint.
 *  - Assistant messages and tool results count until the first successful result of a tool
 *    whose output is untrusted. Taint is per chat and never clears, as for runs.
 *  - Handover summaries are written by a model from the whole history, so they never count.
 */
export function trustedTargets(
  rows: StoredMessage[],
  opts: {
    /** The system prompt: the user's instructions, memory notes and skills. */
    system?: string;
    /** True when a tool's output can carry third-party content. Unknown tools: true. */
    untrustedTool: (name: string) => boolean;
  },
): TrustedTargets {
  const trusted = emptyTrustedTargets();
  if (opts.system) trustText(trusted, opts.system);
  let tainted = false;
  const take = (v: unknown) => {
    const found: string[] = [];
    strings(v, found);
    for (const s of found) trustText(trusted, s);
  };

  for (const row of rows) {
    if (row.kind !== "message") continue;
    const m = row.message;
    if (m.role === "user") {
      if (row.untrusted) tainted = true;
      else take(m.content);
      continue;
    }
    if (m.role === "system") continue;
    if (m.role === "assistant") {
      if (!tainted) take(m.content);
      continue;
    }
    if (m.role === "tool") {
      // Results in one message arrived together: trusted ones count unless taint came earlier.
      let taints = false;
      for (const part of m.content) {
        if (part.type !== "tool-result") continue;
        const failed = part.output.type === "error-text" || part.output.type === "error-json";
        const denied = part.output.type === "execution-denied";
        if (opts.untrustedTool(part.toolName)) {
          if (!failed && !denied) taints = true;
        } else if (!tainted) take(part.output);
      }
      if (taints) tainted = true;
    }
  }
  return trusted;
}

function wordIn(text: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text);
}

/** The call's destinations that the trusted context never named. */
export function unseenTargets(targets: Target[], trusted: TrustedTargets): Target[] {
  return targets.filter((t) => {
    if (t.kind === "recipient") return !trusted.emails.has(t.value);
    if (t.kind === "destination") return !wordIn(trusted.text, t.value);
    const host = t.value.replace(/^www\./, "");
    for (const h of trusted.hosts) {
      const known = h.replace(/^www\./, "");
      if (host === known || host.endsWith(`.${known}`)) return false;
    }
    return true;
  });
}

function noun(t: Target, plural: boolean): string {
  const key = normalizeKey(t.field);
  const base =
    t.kind !== "destination"
      ? t.kind
      : (FIELD_NOUNS[key] ?? (DESTINATION_FIELDS.has(key) ? key : "destination"));
  return plural ? `${base}s` : base;
}

/**
 * Plain-language reason shown on the approval card, e.g. "New recipient
 * attacker@evil.example appeared only after reading outside content."
 */
export function newTargetReason(targets: Target[]): string {
  const groups = new Map<string, Target[]>();
  for (const t of targets) {
    const key = noun(t, false);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const phrases = [...groups.values()].map((group) => {
    const shown = group
      .slice(0, 3)
      .map((t) => (t.kind === "destination" ? `“${t.value}”` : t.value));
    const more = group.length > 3 ? ` and ${group.length - 3} more` : "";
    return `${noun(group[0]!, group.length > 1)} ${shown.join(", ")}${more}`;
  });
  return `New ${phrases.join(" and new ")} appeared only after reading outside content. Check ${targets.length > 1 ? "them" : "it"} before approving.`;
}
