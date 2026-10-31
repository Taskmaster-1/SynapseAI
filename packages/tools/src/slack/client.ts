import { type Db, type SecretBox, schema } from "@synapse/db";
import { eq } from "drizzle-orm";

/**
 * User scopes: search and read the conversations the person is in, look people up, and
 * post as them. Requested next to the bot scopes when they connect Slack.
 */
export const SLACK_USER_SCOPES = [
  "search:read",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "users:read",
  "users:read.email",
  "chat:write",
];

const API = "https://slack.com/api";

/** Errors that mean the user token no longer works; the person has to reconnect. */
const REVOKED = new Set(["invalid_auth", "token_revoked", "account_inactive", "not_authed"]);

export interface SlackToolsConfig {
  /** Test hook. Defaults to global fetch. */
  fetch?: typeof fetch;
}

/** Most distinct people looked up to resolve mentions in one tool result. */
const MAX_LOOKUPS = 25;

/**
 * Slack Web API access as the person who connected Slack, with their user token. A revoked
 * token is cleared, so the tools stop being offered and Connections asks to reconnect.
 */
export class SlackUserClient {
  private readonly names = new Map<string, string>();

  constructor(
    private readonly token: string,
    private readonly f: typeof fetch,
    /** Their own Slack user id. */
    readonly slackUserId: string,
    private readonly onRevoked: () => Promise<void> = async () => {},
  ) {}

  static async forUser(
    cfg: SlackToolsConfig,
    db: Db,
    box: SecretBox,
    userId: string,
  ): Promise<SlackUserClient | null> {
    const [row] = await db
      .select()
      .from(schema.slackAccounts)
      .where(eq(schema.slackAccounts.userId, userId));
    if (!row?.userToken || row.status !== "active") return null;
    return new SlackUserClient(
      await box.open(row.userToken),
      cfg.fetch ?? fetch,
      row.slackUserId,
      async () => {
        await db
          .update(schema.slackAccounts)
          .set({ userToken: null, userScopes: "", lastError: "Slack access was revoked." })
          .where(eq(schema.slackAccounts.userId, userId));
      },
    );
  }

  /** Calls a Web API method (form-encoded, which every method accepts). */
  async call<T>(
    method: string,
    params: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ): Promise<T> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, String(v));
    const res = await this.f(`${API}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))) as {
      ok: boolean;
      error?: string;
    };
    if (!json.ok) {
      const code = json.error ?? `http_${res.status}`;
      if (REVOKED.has(code)) {
        await this.onRevoked();
        throw new Error("Slack access was revoked. Reconnect Slack under Connections.");
      }
      throw new Error(`Slack ${method} failed: ${code}`);
    }
    return json as T;
  }

  /** A person's display name, looked up once per run. Falls back to the id. */
  async userName(id: string, signal?: AbortSignal): Promise<string> {
    const known = this.names.get(id);
    if (known) return known;
    let name = id;
    try {
      const { user } = await this.call<{ user: SlackUser }>("users.info", { user: id }, signal);
      name = displayName(user) || id;
    } catch {
      // A name is a nicety; the id still identifies them.
    }
    this.names.set(id, name);
    return name;
  }

  /** Remembers names already in hand (e.g. from users.list) so mentions resolve for free. */
  rememberName(id: string, name: string) {
    if (name) this.names.set(id, name);
  }

  /**
   * Slack markup as plain text: `<@U1>` → `@Ada`, `<#C1|general>` → `#general`,
   * `<https://x|label>` → `label (https://x)`. Looks up at most MAX_LOOKUPS new people.
   */
  async plainText(texts: string[], signal?: AbortSignal): Promise<string[]> {
    const ids = new Set<string>();
    for (const t of texts)
      for (const m of t.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)) ids.add(m[1]!);
    const unknown = [...ids].filter((id) => !this.names.has(id)).slice(0, MAX_LOOKUPS);
    await Promise.all(unknown.map((id) => this.userName(id, signal)));
    return texts.map((t) =>
      t
        .replace(
          /<@([UW][A-Z0-9]+)(?:\|([^>]*))?>/g,
          (_, id: string, label?: string) => `@${this.names.get(id) ?? label ?? id}`,
        )
        .replace(/<#([CGD][A-Z0-9]+)(?:\|([^>]*))?>/g, (_, id: string, name?: string) =>
          name ? `#${name}` : `<#${id}>`,
        )
        .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, "@$1")
        .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2 ($1)")
        .replace(/<(https?:\/\/[^>]+)>/g, "$1")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&"),
    );
  }
}

export interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { display_name?: string; real_name?: string; email?: string };
}

export function displayName(u: SlackUser): string {
  return u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || "";
}
