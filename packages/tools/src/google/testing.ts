/**
 * An in-memory stand-in for the slice of Google's OAuth, Gmail and Calendar APIs the
 * integration uses. Pass `fake.fetch` as `GoogleAppConfig.fetch` in tests.
 */
export interface FakeMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  internalDate: number;
  labelIds: string[];
  messageId?: string;
  /** Raw RFC 2822 text for messages sent through the API. */
  raw?: string;
}

export interface FakeEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: { email: string; responseStatus?: string; self?: boolean }[];
  status?: string;
}

export function fakeGoogle(opts: { email?: string } = {}) {
  const state = {
    email: opts.email ?? "ada@example.com",
    messages: [] as FakeMessage[],
    drafts: [] as { id: string; raw: string; threadId?: string }[],
    events: [] as FakeEvent[],
    labels: [
      { id: "INBOX", name: "INBOX" },
      { id: "UNREAD", name: "UNREAD" },
      { id: "STARRED", name: "STARRED" },
      { id: "Label_1", name: "Receipts" },
    ],
    /** Requests seen, as "METHOD path". */
    calls: [] as string[],
    /** Set to make the next refresh fail with invalid_grant. */
    revoked: false,
    tokenExchanges: 0,
    refreshes: 0,
    lastAuthCode: null as string | null,
    lastVerifier: null as string | null,
    grantedScope:
      "openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events",
  };
  let n = 0;
  const nextId = (p: string) => `${p}${++n}`;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const header = (name: string, value: string) => ({ name, value });
  const asGmail = (m: FakeMessage) => ({
    id: m.id,
    threadId: m.threadId,
    labelIds: m.labelIds,
    snippet: m.body.slice(0, 80),
    internalDate: String(m.internalDate),
    payload: {
      mimeType: "text/plain",
      headers: [
        header("From", m.from),
        header("To", m.to),
        header("Subject", m.subject),
        ...(m.messageId ? [header("Message-ID", m.messageId)] : []),
      ],
      body: { data: Buffer.from(m.body).toString("base64url") },
    },
  });

  /** Gmail search, just enough of it: `in:sent`, `after:<sec>`, `from:x`, `-from:me`, free words. */
  const matches = (m: FakeMessage, q: string) =>
    q
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => {
        if (term === "in:inbox") return m.labelIds.includes("INBOX");
        if (term === "in:sent") return m.labelIds.includes("SENT");
        if (term === "is:unread") return m.labelIds.includes("UNREAD");
        if (term === "-from:me") return !m.from.includes(state.email);
        if (term.startsWith("after:")) return m.internalDate / 1000 > Number(term.slice(6)) - 1;
        if (term.startsWith("from:")) return m.from.includes(term.slice(5));
        return `${m.subject} ${m.body}`.toLowerCase().includes(term.toLowerCase());
      });

  async function handle(url: URL, init: RequestInit): Promise<Response> {
    const method = init.method ?? "GET";
    const path = url.pathname;
    state.calls.push(`${method} ${url.host}${path}`);
    const body = typeof init.body === "string" ? init.body : init.body?.toString();

    if (url.host === "oauth2.googleapis.com" && path === "/token") {
      const p = new URLSearchParams(body);
      if (p.get("grant_type") === "authorization_code") {
        state.tokenExchanges++;
        state.lastAuthCode = p.get("code");
        state.lastVerifier = p.get("code_verifier");
        return json({
          access_token: "at-1",
          refresh_token: "rt-1",
          expires_in: 3600,
          scope: state.grantedScope,
        });
      }
      state.refreshes++;
      if (state.revoked)
        return json({ error: "invalid_grant", error_description: "Token has been revoked." }, 400);
      return json({ access_token: `at-r${state.refreshes}`, expires_in: 3600 });
    }
    if (url.host === "oauth2.googleapis.com" && path === "/revoke") return json({});
    if (url.host === "openidconnect.googleapis.com") return json({ email: state.email });

    const gmail = path.match(/^\/gmail\/v1\/users\/me\/(.*)$/);
    if (gmail) {
      const rest = gmail[1]!;
      if (rest === "messages" && method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        const max = Number(url.searchParams.get("maxResults") ?? 100);
        const hits = state.messages
          .filter((m) => matches(m, q))
          .sort((a, b) => b.internalDate - a.internalDate)
          .slice(0, max);
        return json(
          hits.length ? { messages: hits.map((m) => ({ id: m.id, threadId: m.threadId })) } : {},
        );
      }
      if (rest === "messages/send") {
        const { raw, threadId } = JSON.parse(body!) as { raw: string; threadId?: string };
        const m: FakeMessage = {
          id: nextId("sent"),
          threadId: threadId ?? nextId("t"),
          from: state.email,
          to: "",
          subject: "",
          body: "",
          internalDate: Date.now(),
          labelIds: ["SENT"],
          raw: Buffer.from(raw, "base64url").toString("utf8"),
        };
        state.messages.push(m);
        return json({ id: m.id, threadId: m.threadId });
      }
      if (rest === "drafts") {
        const { message } = JSON.parse(body!) as { message: { raw: string; threadId?: string } };
        const d = {
          id: nextId("d"),
          raw: Buffer.from(message.raw, "base64url").toString("utf8"),
          ...(message.threadId ? { threadId: message.threadId } : {}),
        };
        state.drafts.push(d);
        return json({ id: d.id });
      }
      if (rest === "messages/batchModify") {
        const b = JSON.parse(body!) as {
          ids: string[];
          addLabelIds: string[];
          removeLabelIds: string[];
        };
        for (const m of state.messages.filter((x) => b.ids.includes(x.id))) {
          m.labelIds = [
            ...m.labelIds.filter((l) => !b.removeLabelIds.includes(l)),
            ...b.addLabelIds.filter((l) => !m.labelIds.includes(l)),
          ];
        }
        return new Response(null, { status: 204 });
      }
      if (rest === "labels") return json({ labels: state.labels });
      const trash = rest.match(/^messages\/([^/]+)\/trash$/);
      if (trash) {
        const m = state.messages.find((x) => x.id === trash[1]);
        if (m) m.labelIds = ["TRASH"];
        return json({ id: trash[1] });
      }
      const one = rest.match(/^messages\/([^/]+)$/);
      if (one) {
        const m = state.messages.find((x) => x.id === decodeURIComponent(one[1]!));
        return m ? json(asGmail(m)) : json({ error: { message: "Not Found" } }, 404);
      }
      const thread = rest.match(/^threads\/([^/]+)$/);
      if (thread) {
        const id = decodeURIComponent(thread[1]!);
        const msgs = state.messages.filter((x) => x.threadId === id);
        return msgs.length
          ? json({ id, messages: msgs.map(asGmail) })
          : json({ error: { message: "Not Found" } }, 404);
      }
    }

    const cal = path.match(/^\/calendar\/v3\/calendars\/primary\/events(?:\/([^/]+))?$/);
    if (cal) {
      const id = cal[1] ? decodeURIComponent(cal[1]) : null;
      if (!id && method === "GET")
        return json({
          timeZone: "UTC",
          items: state.events.filter((e) => e.status !== "cancelled"),
        });
      if (!id && method === "POST") {
        const b = JSON.parse(body!) as Omit<FakeEvent, "id">;
        const e = { ...b, id: nextId("ev") };
        state.events.push(e);
        return json(e);
      }
      const e = state.events.find((x) => x.id === id);
      if (!e) return json({ error: { message: "Not Found" } }, 404);
      if (method === "GET") return json(e);
      if (method === "PATCH") {
        Object.assign(e, JSON.parse(body!));
        return json(e);
      }
      if (method === "DELETE") {
        e.status = "cancelled";
        return new Response(null, { status: 204 });
      }
    }
    return json({ error: { message: `fake google: no route for ${method} ${url}` } }, 404);
  }

  const f = (async (input: string | URL | Request, init: RequestInit = {}) =>
    handle(new URL(input instanceof Request ? input.url : input.toString()), init)) as typeof fetch;

  return {
    state,
    fetch: f,
    /** Adds an incoming message to the inbox. */
    receive(m: Partial<FakeMessage> & Pick<FakeMessage, "from" | "subject">): FakeMessage {
      const msg: FakeMessage = {
        id: nextId("m"),
        threadId: nextId("t"),
        to: state.email,
        body: "",
        internalDate: Date.now(),
        labelIds: ["INBOX", "UNREAD"],
        messageId: `<${n}@mail.example.com>`,
        ...m,
      };
      state.messages.push(msg);
      return msg;
    },
    /** Adds a message the user sent (for reading their sent mail). */
    sent(m: Partial<FakeMessage> & Pick<FakeMessage, "to" | "subject" | "body">): FakeMessage {
      const msg: FakeMessage = {
        id: nextId("s"),
        threadId: nextId("t"),
        from: state.email,
        internalDate: Date.now(),
        labelIds: ["SENT"],
        ...m,
      };
      state.messages.push(msg);
      return msg;
    },
  };
}
