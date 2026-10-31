/**
 * An in-memory stand-in for the slice of Slack's Web API Synapse uses: OAuth v2 (bot and
 * user tokens), the bot's DMs (conversations.open, chat.postMessage, chat.update,
 * auth.revoke, response_url posts) and what the agent's tools read as the user (search,
 * history, replies, channels, people). Pass `fake.fetch` as the Slack config's `fetch`.
 */
export interface FakeSlackMessage {
  channel: string;
  ts: string;
  text: string;
  // biome-ignore lint/suspicious/noExplicitAny: Block Kit JSON, inspected loosely in tests
  blocks: any[];
  updates: number;
  /** Author's Slack user id (messages seeded with `say` or posted with a user token). */
  user?: string;
  thread_ts?: string;
  /** The token that posted it, to tell bot posts from posts as the user. */
  token?: string;
}

export interface FakeSlackUser {
  id: string;
  name: string;
  real_name: string;
  email: string;
}

export interface FakeSlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
  /** Slack user ids in the channel. */
  members: string[];
}

export function fakeSlackApi(opts: { teamId?: string; teamName?: string } = {}) {
  const state = {
    teamId: opts.teamId ?? "T1",
    teamName: opts.teamName ?? "Acme",
    /** The Slack user the next OAuth exchange returns as `authed_user`. */
    nextUser: "U1",
    /** Scopes the next OAuth exchange grants. */
    grantedScope: "chat:write,im:write,users:read",
    /** User scopes the next OAuth exchange grants; null: no user token (an old install). */
    grantedUserScope:
      "search:read,channels:history,groups:history,im:history,mpim:history,channels:read,groups:read,im:read,mpim:read,users:read,users:read.email,chat:write" as
        | string
        | null,
    tokens: new Set<string>(),
    /** User tokens, mapped to the Slack user they act as. */
    userTokens: new Map<string, string>(),
    revoked: [] as string[],
    messages: [] as FakeSlackMessage[],
    users: [] as FakeSlackUser[],
    channels: [] as FakeSlackChannel[],
    /** Bodies posted to response_url. */
    responses: [] as Record<string, unknown>[],
    /** Requests seen, as "method" (e.g. "chat.postMessage"). */
    calls: [] as string[],
  };
  let n = 0;
  const nextTs = () => `${1700000000 + ++n}.000100`;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const asUser = (u: FakeSlackUser) => ({
    id: u.id,
    name: u.name,
    real_name: u.real_name,
    profile: { display_name: u.name, real_name: u.real_name, email: u.email },
  });
  const asMessage = (m: FakeSlackMessage) => ({
    type: "message",
    user: m.user,
    text: m.text,
    ts: m.ts,
    ...(m.thread_ts ? { thread_ts: m.thread_ts } : {}),
    ...(!m.thread_ts && state.messages.some((r) => r.thread_ts === m.ts)
      ? { reply_count: state.messages.filter((r) => r.thread_ts === m.ts).length }
      : {}),
  });
  /** A simple offset cursor over a list. */
  const page = <T>(items: T[], p: Record<string, string>) => {
    const start = Number(p.cursor || 0);
    const limit = Number(p.limit || 100);
    const next = start + limit < items.length ? String(start + limit) : "";
    return { items: items.slice(start, start + limit), meta: { next_cursor: next } };
  };

  async function handle(url: URL, init: RequestInit): Promise<Response> {
    const raw = typeof init.body === "string" ? init.body : (init.body?.toString() ?? "");
    if (url.host === "hooks.slack.com") {
      state.calls.push("response_url");
      state.responses.push(JSON.parse(raw) as Record<string, unknown>);
      return new Response("ok");
    }
    if (url.host !== "slack.com") return json({ ok: false, error: "unknown_host" }, 404);
    const method = url.pathname.replace(/^\/api\//, "");
    state.calls.push(method);

    if (method === "oauth.v2.access") {
      const p = new URLSearchParams(raw);
      if (!p.get("code") || !p.get("client_secret"))
        return json({ ok: false, error: "invalid_code" });
      const token = `xoxb-${state.teamId}-${++n}`;
      state.tokens.add(token);
      const user: Record<string, string> = { id: state.nextUser };
      if (state.grantedUserScope !== null) {
        user.access_token = `xoxp-${state.teamId}-${++n}`;
        user.scope = state.grantedUserScope;
        user.token_type = "user";
        state.tokens.add(user.access_token);
        state.userTokens.set(user.access_token, state.nextUser);
      }
      return json({
        ok: true,
        access_token: token,
        token_type: "bot",
        scope: state.grantedScope,
        bot_user_id: "B1",
        app_id: "A1",
        team: { id: state.teamId, name: state.teamName },
        authed_user: user,
      });
    }

    const auth = new Headers(init.headers).get("authorization") ?? "";
    const token = auth.replace(/^Bearer /, "");
    if (!state.tokens.has(token)) return json({ ok: false, error: "invalid_auth" });
    const type = new Headers(init.headers).get("content-type") ?? "";
    const body: Record<string, string> = type.startsWith("application/x-www-form-urlencoded")
      ? Object.fromEntries(new URLSearchParams(raw))
      : ((raw ? JSON.parse(raw) : {}) as Record<string, string>);
    const me = state.userTokens.get(token);

    if (method === "auth.revoke") {
      state.tokens.delete(token);
      state.userTokens.delete(token);
      state.revoked.push(token);
      return json({ ok: true, revoked: true });
    }
    if (method === "conversations.open")
      return json({ ok: true, channel: { id: `D-${String(body.users)}` } });
    if (method === "chat.postMessage") {
      const m: FakeSlackMessage = {
        channel: String(body.channel),
        ts: nextTs(),
        text: String(body.text ?? ""),
        blocks: (body.blocks as unknown as unknown[]) ?? [],
        updates: 0,
        token,
        ...(me ? { user: me } : {}),
        ...(body.thread_ts ? { thread_ts: String(body.thread_ts) } : {}),
      };
      state.messages.push(m);
      return json({ ok: true, channel: m.channel, ts: m.ts });
    }
    if (method === "chat.update") {
      const m = state.messages.find((x) => x.channel === body.channel && x.ts === body.ts);
      if (!m) return json({ ok: false, error: "message_not_found" });
      m.text = String(body.text ?? "");
      m.blocks = (body.blocks as unknown as unknown[]) ?? [];
      m.updates++;
      return json({ ok: true, channel: m.channel, ts: m.ts });
    }

    // Everything below reads as the user; a bot token can't.
    if (!me) return json({ ok: false, error: "not_allowed_token_type" });
    const visible = (channel: string) =>
      channel.startsWith("D-") ||
      state.channels.some((c) => c.id === channel && c.members.includes(me));
    if (method === "search.messages") {
      const words = String(body.query ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const hits = state.messages
        .filter((m) => visible(m.channel) && words.every((w) => m.text.toLowerCase().includes(w)))
        .slice(0, Number(body.count ?? 20));
      return json({
        ok: true,
        messages: {
          total: hits.length,
          matches: hits.map((m) => {
            const ch = state.channels.find((c) => c.id === m.channel);
            return {
              ...asMessage(m),
              channel: ch
                ? { id: ch.id, name: ch.name, is_private: ch.is_private ?? false }
                : { id: m.channel, name: m.channel, is_im: true },
              permalink: `https://acme.slack.com/archives/${m.channel}/p${m.ts.replace(".", "")}`,
            };
          }),
        },
      });
    }
    if (method === "conversations.history" || method === "conversations.replies") {
      if (!visible(body.channel!)) return json({ ok: false, error: "channel_not_found" });
      const inChannel = state.messages.filter((m) => m.channel === body.channel);
      const list =
        method === "conversations.history"
          ? inChannel.filter((m) => !m.thread_ts).reverse()
          : inChannel.filter((m) => m.ts === body.ts || m.thread_ts === body.ts);
      const { items, meta } = page(list, body);
      return json({ ok: true, messages: items.map(asMessage), response_metadata: meta });
    }
    if (method === "users.conversations") {
      const mine = state.channels.filter((c) => c.members.includes(me));
      const { items, meta } = page(mine, body);
      return json({
        ok: true,
        channels: items.map((c) => ({ id: c.id, name: c.name, is_private: c.is_private ?? false })),
        response_metadata: meta,
      });
    }
    if (method === "users.list") {
      const { items, meta } = page(state.users, body);
      return json({ ok: true, members: items.map(asUser), response_metadata: meta });
    }
    if (method === "users.info") {
      const u = state.users.find((x) => x.id === body.user);
      return u ? json({ ok: true, user: asUser(u) }) : json({ ok: false, error: "user_not_found" });
    }
    if (method === "users.lookupByEmail") {
      const u = state.users.find((x) => x.email === body.email);
      return u
        ? json({ ok: true, user: asUser(u) })
        : json({ ok: false, error: "users_not_found" });
    }
    return json({ ok: false, error: "unknown_method" });
  }

  const f = (async (input: string | URL | Request, init: RequestInit = {}) =>
    handle(new URL(input instanceof Request ? input.url : input.toString()), init)) as typeof fetch;

  return {
    state,
    fetch: f,
    /** Messages sent to a Slack user's DM. */
    dms: (slackUserId: string) => state.messages.filter((m) => m.channel === `D-${slackUserId}`),
    /** Adds a person to the workspace. */
    person(u: FakeSlackUser) {
      state.users.push(u);
      return u;
    },
    /** Adds a channel. */
    channel(c: FakeSlackChannel) {
      state.channels.push(c);
      return c;
    },
    /** Someone posts in a channel (or a thread, with `thread_ts`). */
    say(channel: string, user: string, text: string, thread_ts?: string): FakeSlackMessage {
      const m: FakeSlackMessage = {
        channel,
        ts: nextTs(),
        text,
        blocks: [],
        updates: 0,
        user,
        ...(thread_ts ? { thread_ts } : {}),
      };
      state.messages.push(m);
      return m;
    },
  };
}
