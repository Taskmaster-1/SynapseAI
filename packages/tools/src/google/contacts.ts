import type { ToolDefinition } from "@synapse/core";
import type { JSONValue } from "ai";
import type { GoogleClient } from "./client";

const API = "https://people.googleapis.com/v1";
const READ_MASK = "names,emailAddresses,phoneNumbers";
const EMAIL = /^[^\s@<>"',;:()[\]]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

interface Person {
  resourceName?: string;
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string }[];
}

export interface Contact {
  name: string | null;
  emails: string[];
  phones: string[];
  /** "contacts": saved by the user. "other": someone they've emailed, saved by Gmail. */
  source: "contacts" | "other";
}

/** One line, no control characters, short: a name is a label, not a place for prose. */
const clean = (s: string | undefined, max: number) =>
  s
    ?.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ")
    .trim()
    .slice(0, max) || null;

function contact(p: Person, source: Contact["source"]): Contact {
  return {
    name: clean(p.names?.[0]?.displayName, 80),
    emails: (p.emailAddresses ?? [])
      .map((e) => e.value?.trim().toLowerCase() ?? "")
      .filter((e) => EMAIL.test(e) && e.length <= 200),
    phones: (p.phoneNumbers ?? []).flatMap((n) => clean(n.value, 40) ?? []),
    source,
  };
}

/** Saved contacts first; an address in both lists shows once, with the saved name. */
export function mergeContacts(saved: Contact[], other: Contact[]): Contact[] {
  const out: Contact[] = [];
  const byEmail = new Map<string, Contact>();
  for (const c of [...saved, ...other]) {
    const known = c.emails.map((e) => byEmail.get(e)).find(Boolean);
    if (known) {
      for (const e of c.emails) if (!known.emails.includes(e)) known.emails.push(e);
      for (const n of c.phones) if (!known.phones.includes(n)) known.phones.push(n);
      known.name ??= c.name;
    } else {
      if (!c.name && c.emails.length === 0) continue;
      out.push(c);
    }
    for (const e of c.emails) if (!byEmail.has(e)) byEmail.set(e, known ?? c);
  }
  return out;
}

/** Google Contacts: look people up by name to find their address. */
export function contactsTools(client: () => Promise<GoogleClient>): ToolDefinition[] {
  // Google's search cache is lazy: both endpoints want one empty query first, or the next
  // search can come back empty. Once per toolset (one run) is enough.
  let warm: Promise<unknown> | null = null;
  const search = async (g: GoogleClient, query: string, pageSize: number, signal: AbortSignal) => {
    const q = { query, readMask: READ_MASK, pageSize };
    return Promise.all([
      g.request<{ results?: { person: Person }[] }>(`${API}/people:searchContacts`, {
        query: q,
        signal,
      }),
      g.request<{ results?: { person: Person }[] }>(`${API}/otherContacts:search`, {
        query: q,
        signal,
      }),
    ]);
  };

  return [
    {
      source: "builtin:google",
      name: "contacts_search",
      description:
        "Find people in the user's Google Contacts, and people they've emailed, by name or address. Use it to get an address before emailing or inviting someone the user named (\"email Sam\"). If several match, ask which one.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            minLength: 1,
            description: "A name, part of one, or an address",
          },
          limit: { type: "integer", minimum: 1, maximum: 30, default: 10 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      effect: "read",
      // Unlike calendar_list_events (event text is written by other people), this returns
      // only names, addresses and numbers from the user's own address book, cleaned to one
      // short line each. Marking it untrusted would taint every "email Sam" run and flag
      // Sam's address as a new recipient that appeared after outside content; trusted, the
      // addresses it returns count as destinations the user put in play, and gmail_send
      // gets the normal approval. A crafted display name is at most 80 characters of label.
      untrustedOutput: false,
      preview: (input) => `Look up "${(input as { query?: string }).query ?? ""}" in your contacts`,
      execute: async (input, ctx) => {
        const { query, limit = 10 } = input as { query: string; limit?: number };
        const g = await client();
        warm ??= search(g, "", 1, ctx.abortSignal).catch((e) => {
          warm = null;
          throw e;
        });
        await warm;
        const size = Math.min(Math.max(limit, 1), 30);
        const [saved, other] = await search(g, query.trim(), size, ctx.abortSignal);
        const contacts = mergeContacts(
          (saved.results ?? []).map((r) => contact(r.person, "contacts")),
          (other.results ?? []).map((r) => contact(r.person, "other")),
        ).slice(0, size);
        return { type: "json", value: { contacts } as unknown as JSONValue };
      },
    },
  ];
}
