import type { JSONValue } from "ai";
import { emailsIn } from "./policy";
import type { Effect } from "./types";

/**
 * Plain-language risk facts for an action waiting on a person: one to three short lines
 * ("Sends to 2 people outside acme.com", "Can't be undone") shown as chips on approval
 * cards and in push, Slack and email text. Pure and dependency-free, so the web app
 * imports it directly (`@synapse/core/risk`). The tool's own `preview` stays as it is;
 * these are about consequences, not content.
 */
export interface RiskInput {
  name: string;
  effect: Effect;
  input: unknown;
  /** The task had read outside content (an email, a web page) when this was proposed. */
  tainted?: boolean;
  /**
   * The organisation's email domain (e.g. "acme.com"), when known. Addresses outside it
   * are called out. Use `orgDomain` to derive it from an address.
   */
  domain?: string | null;
}

export const MAX_RISK_FACTS = 4;

/** Webmail domains say nothing about who is "inside": everyone is at gmail.com. */
const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "web.de",
  "yandex.ru",
  "mail.ru",
  "qq.com",
  "163.com",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "example.com",
]);

/** The organisation domain of an address, or null for webmail and unparseable input. */
export function orgDomain(email: string | null | undefined): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  if (!email || at < 0) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null;
  return PERSONAL_DOMAINS.has(domain) ? null : domain;
}

/** Input fields that name who an action reaches. Body text is not a recipient list. */
const RECIPIENT_KEY =
  /^(to|cc|bcc|recipients?|attendees|guests|invitees|participants|emails?|addresses|share_?with|users?)$/i;

/** Distinct addresses in recipient-like fields, at any depth (e.g. attendees[].email). */
export function recipientsIn(input: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown, inRecipients: boolean) => {
    if (typeof v === "string") {
      if (inRecipients) for (const e of emailsIn(v)) found.add(e);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, inRecipients);
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, inRecipients || RECIPIENT_KEY.test(k));
    }
  };
  walk(input, false);
  return [...found];
}

function inside(email: string, domain: string) {
  const d = email.slice(email.lastIndexOf("@") + 1);
  return d === domain || d.endsWith(`.${domain}`);
}

const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

const IRREVERSIBLE = /delete|remove|trash|purge|destroy|drop|erase|archive|cancel|revoke/i;

/** Up to four short facts about what approving this would do. */
export function riskFacts(call: RiskInput): string[] {
  const facts: string[] = [];
  const domain = call.domain?.toLowerCase() || null;
  const recipients = recipientsIn(call.input as JSONValue);

  if (recipients.length > 0 && (call.effect === "send" || call.effect === "write")) {
    if (domain) {
      const outside = recipients.filter((e) => !inside(e, domain));
      if (outside.length > 0) facts.push(`Sends to ${people(outside.length)} outside ${domain}`);
      else facts.push(`Only people at ${domain}`);
    } else {
      facts.push(`Reaches ${people(recipients.length)}`);
    }
  } else if (call.effect === "send") {
    facts.push("Reaches other people");
  }

  const attached = (call.input as { attachments?: unknown } | null)?.attachments;
  if (Array.isArray(attached) && attached.length > 0 && call.effect !== "read")
    facts.push(`Attaches ${attached.length === 1 ? "1 file" : `${attached.length} files`}`);

  if (call.effect === "destructive") facts.push("Can't be undone");
  else if (call.effect === "send") facts.push("Can't be unsent once it goes");
  else if (call.effect === "write" && IRREVERSIBLE.test(call.name))
    facts.push("May not be reversible");

  if (call.tainted) facts.push("After reading outside content");

  return facts.slice(0, MAX_RISK_FACTS);
}
