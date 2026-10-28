import { signSlackRequest } from "./slack-api";

/**
 * An in-memory stand-in for the slice of Slack's Web API the integration uses: OAuth v2,
 * conversations.open, chat.postMessage, chat.update, auth.revoke and response_url posts.
 * Pass `fake.fetch` as `SlackAppConfig.fetch` in tests.
 */
export interface FakeSlackMessage {
  channel: string;
  ts: string;
  text: string;
  // biome-ignore lint/suspicious/noExplicitAny: Block Kit JSON, inspected loosely in tests
  blocks: any[];
  updates: number;
}

export function fakeSlack(opts: { teamId?: string; teamName?: string } = {}) {
  const state = {
    teamId: opts.teamId ?? "T1",
    teamName: opts.teamName ?? "Acme",
    /** The Slack user the next OAuth exchange returns as `authed_user`. */
    nextUser: "U1",
    /** Scopes the next OAuth exchange grants. */
    grantedScope: "chat:write,im:write,users:read",
    tokens: new Set<string>(),
    revoked: [] as string[],
    messages: [] as FakeSlackMessage[],
    /** Bodies posted to response_url. */
    responses: [] as Record<string, unknown>[],
    /** Requests seen, as "method" (e.g. "chat.postMessage"). */
    calls: [] as string[],
  };
  let n = 0;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

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
      return json({
        ok: true,
        access_token: token,
        token_type: "bot",
        scope: state.grantedScope,
        bot_user_id: "B1",
        app_id: "A1",
        team: { id: state.teamId, name: state.teamName },
        authed_user: { id: state.nextUser },
      });
    }

    const auth = new Headers(init.headers).get("authorization") ?? "";
    const token = auth.replace(/^Bearer /, "");
    if (!state.tokens.has(token)) return json({ ok: false, error: "invalid_auth" });
    const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;

    if (method === "auth.revoke") {
      state.tokens.delete(token);
      state.revoked.push(token);
      return json({ ok: true, revoked: true });
    }
    if (method === "conversations.open")
      return json({ ok: true, channel: { id: `D-${String(body.users)}` } });
    if (method === "chat.postMessage") {
      const m: FakeSlackMessage = {
        channel: String(body.channel),
        ts: `${1700000000 + ++n}.000100`,
        text: String(body.text ?? ""),
        blocks: (body.blocks as unknown[]) ?? [],
        updates: 0,
      };
      state.messages.push(m);
      return json({ ok: true, channel: m.channel, ts: m.ts });
    }
    if (method === "chat.update") {
      const m = state.messages.find((x) => x.channel === body.channel && x.ts === body.ts);
      if (!m) return json({ ok: false, error: "message_not_found" });
      m.text = String(body.text ?? "");
      m.blocks = (body.blocks as unknown[]) ?? [];
      m.updates++;
      return json({ ok: true, channel: m.channel, ts: m.ts });
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
    /**
     * The request Slack would send when `user` clicks `actionId` on `message`, signed with
     * `signingSecret` (pass another secret or an old timestamp to test rejection).
     */
    click(
      message: FakeSlackMessage,
      actionId: "approve" | "deny",
      o: { signingSecret: string; user?: string; team?: string; timestamp?: number },
    ) {
      const button = message.blocks
        .find((b) => b.type === "actions")
        ?.elements.find((e: { action_id: string }) => e.action_id === actionId);
      const payload = {
        type: "block_actions",
        team: { id: o.team ?? state.teamId },
        user: { id: o.user ?? "U1", team_id: o.team ?? state.teamId },
        channel: { id: message.channel },
        container: { type: "message", message_ts: message.ts, channel_id: message.channel },
        response_url: `https://hooks.slack.com/actions/${state.teamId}/1/abc`,
        actions: [{ action_id: actionId, block_id: "decision", value: button?.value }],
      };
      const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
      const ts = o.timestamp ?? Math.floor(Date.now() / 1000);
      return {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": String(ts),
          "x-slack-signature": signSlackRequest(o.signingSecret, body, ts),
        },
        body,
      };
    },
  };
}
