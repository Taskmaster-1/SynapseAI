import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ToolContext, ToolDefinition } from "@synapse/core";
import { createDatabase, type Database, SecretBox, schema } from "@synapse/db";
import type { JSONValue } from "ai";
import { eq } from "drizzle-orm";
import { buildToolset } from "..";
import { calendarTools } from "./calendar";
import {
  completeGoogleAuth,
  disconnectGoogle,
  type GoogleAppConfig,
  GoogleClient,
  googleAuthorizationUrl,
} from "./client";
import { buildMime, gmailTools, newMessagesSince } from "./gmail";
import { fakeGoogle } from "./testing";

let database: Database;
let box: SecretBox;
let google: ReturnType<typeof fakeGoogle>;
let app: GoogleAppConfig;
const USER = "u-google";

const ctx: ToolContext = {
  userId: USER,
  chatId: "c",
  runId: "r",
  toolCallId: "t",
  abortSignal: new AbortController().signal,
};

beforeAll(async () => {
  database = await createDatabase("pglite://memory");
  await database.migrate();
  box = await SecretBox.fromSecret("g".repeat(40));
  for (const id of [USER, "u-other"])
    await database.db.insert(schema.user).values({ id, name: id, email: `${id}@example.com` });
});
afterAll(() => database.close());

beforeEach(async () => {
  google = fakeGoogle();
  app = {
    clientId: "cid",
    clientSecret: "csecret",
    publicUrl: "https://synapse.test",
    fetch: google.fetch,
  };
  await database.db.delete(schema.integrations);
});

async function connect(userId = USER) {
  const url = new URL(await googleAuthorizationUrl(app, box, userId));
  await completeGoogleAuth(app, database.db, box, {
    userId,
    code: "code-1",
    state: url.searchParams.get("state")!,
  });
  return url;
}

async function tools(): Promise<Map<string, ToolDefinition>> {
  const client = await GoogleClient.forUser(app, database.db, box, USER);
  if (!client) throw new Error("not connected");
  const get = async () => client;
  return new Map([...gmailTools(get), ...calendarTools(get)].map((t) => [t.name, t]));
}

const run = async (tool: ToolDefinition | undefined, input: unknown) =>
  tool!.execute(input as JSONValue, ctx);

describe("google oauth", () => {
  test("authorization url asks for offline access with PKCE", async () => {
    const url = new URL(await googleAuthorizationUrl(app, box, USER, "ada@example.com"));
    expect(url.origin).toBe("https://accounts.google.com");
    const p = url.searchParams;
    expect(p.get("redirect_uri")).toBe("https://synapse.test/api/integrations/google/callback");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("scope")).toContain("gmail.modify");
    expect(p.get("scope")).toContain("calendar.events");
    expect(p.get("login_hint")).toBe("ada@example.com");
    // The state is sealed: it does not reveal the user or the verifier.
    expect(p.get("state")).not.toContain(USER);
  });

  test("callback stores sealed tokens and the account email", async () => {
    await connect();
    expect(google.state.lastVerifier).toBeTruthy();
    const [row] = await database.db.select().from(schema.integrations);
    expect(row?.account).toBe("ada@example.com");
    expect(row?.status).toBe("active");
    expect(row?.secret).not.toContain("rt-1");
    expect(JSON.parse(await box.open(row!.secret)).refreshToken).toBe("rt-1");
  });

  test("a state minted for one user cannot complete for another", async () => {
    const url = new URL(await googleAuthorizationUrl(app, box, USER));
    await expect(
      completeGoogleAuth(app, database.db, box, {
        userId: "u-other",
        code: "c",
        state: url.searchParams.get("state")!,
      }),
    ).rejects.toThrow("another user");
    await expect(
      completeGoogleAuth(app, database.db, box, { userId: USER, code: "c", state: "forged" }),
    ).rejects.toThrow("invalid");
    expect(google.state.tokenExchanges).toBe(0);
  });

  test("refuses a grant without Gmail and Calendar scopes", async () => {
    google.state.grantedScope = "openid email";
    await expect(connect()).rejects.toThrow("not granted");
    expect(await database.db.select().from(schema.integrations)).toHaveLength(0);
  });

  test("refreshes expired access tokens and marks revoked grants", async () => {
    await connect();
    const [row] = await database.db.select().from(schema.integrations);
    const tokens = JSON.parse(await box.open(row!.secret));
    await database.db
      .update(schema.integrations)
      .set({ secret: await box.seal(JSON.stringify({ ...tokens, expiresAt: 0 })) });
    const t = await tools();
    await run(t.get("gmail_search"), { query: "in:inbox" });
    expect(google.state.refreshes).toBe(1);
    const [after] = await database.db.select().from(schema.integrations);
    expect(JSON.parse(await box.open(after!.secret)).accessToken).toBe("at-r1");

    await database.db
      .update(schema.integrations)
      .set({ secret: await box.seal(JSON.stringify({ ...tokens, expiresAt: 0 })) });
    google.state.revoked = true;
    const t2 = await tools();
    await expect(run(t2.get("gmail_search"), { query: "x" })).rejects.toThrow("Reconnect Google");
    const [revoked] = await database.db.select().from(schema.integrations);
    expect(revoked?.status).toBe("needs_auth");
    expect(await GoogleClient.forUser(app, database.db, box, USER)).toBeNull();
  });

  test("disconnect revokes at Google and deletes the row", async () => {
    await connect();
    await disconnectGoogle(app, database.db, box, USER);
    expect(google.state.calls).toContain("POST oauth2.googleapis.com/revoke");
    expect(await database.db.select().from(schema.integrations)).toHaveLength(0);
  });

  test("the toolset includes Google tools only once connected", async () => {
    const cfg = {
      db: database.db,
      box,
      app: { publicUrl: "https://synapse.test", appName: "t" },
      webSearch: null,
      embedder: null,
      google: app,
    };
    const before = await buildToolset(cfg, USER);
    expect(before.registry.get("gmail_send")).toBeUndefined();
    await before.close();
    await connect();
    const after = await buildToolset(cfg, USER);
    expect(after.registry.get("gmail_send")?.effect).toBe("send");
    expect(after.registry.get("gmail_search")?.untrustedOutput).toBe(true);
    expect(after.registry.get("calendar_delete_event")?.effect).toBe("destructive");
    await after.close();
    const noApp = await buildToolset({ ...cfg, google: null }, USER);
    expect(noApp.registry.get("gmail_send")).toBeUndefined();
    await noApp.close();
  });
});

describe("gmail", () => {
  beforeEach(() => connect());

  test("search and read a thread", async () => {
    const m = google.receive({
      from: "Bob <bob@acme.com>",
      subject: "Sync tomorrow?",
      body: "Does 3pm work?",
    });
    const t = await tools();
    const found = (await run(t.get("gmail_search"), { query: "from:bob" })) as unknown as {
      value: { messages: { id: string; subject: string; unread: boolean }[] };
    };
    expect(found.value.messages).toEqual([
      expect.objectContaining({ id: m.id, subject: "Sync tomorrow?", unread: true }),
    ]);
    const thread = (await run(t.get("gmail_read_thread"), { threadId: m.threadId })) as unknown as {
      value: { messages: { body: string }[] };
    };
    expect(thread.value.messages[0]?.body).toBe("Does 3pm work?");
  });

  test("replies stay in the thread with the right headers", async () => {
    const m = google.receive({ from: "bob@acme.com", subject: "Sync tomorrow?" });
    const t = await tools();
    await run(t.get("gmail_send"), {
      to: ["bob@acme.com"],
      subject: "Re: Sync tomorrow?",
      body: "3pm works.",
      replyToMessageId: m.id,
    });
    const sent = google.state.messages.find((x) => x.labelIds.includes("SENT"))!;
    expect(sent.threadId).toBe(m.threadId);
    expect(sent.raw).toContain(`In-Reply-To: ${m.messageId}`);
    expect(sent.raw).toContain("To: bob@acme.com");
    expect(Buffer.from(sent.raw!.split("\r\n\r\n")[1]!, "base64").toString()).toBe("3pm works.");
  });

  test("drafts are allowed by default; sending asks", async () => {
    const t = await tools();
    expect(t.get("gmail_create_draft")?.defaultDecision).toBe("allow");
    expect(t.get("gmail_send")?.defaultDecision).toBeUndefined();
    await run(t.get("gmail_create_draft"), { to: ["a@b.c"], subject: "Hi", body: "Draft" });
    expect(google.state.drafts).toHaveLength(1);
    expect(t.get("gmail_send")?.preview?.({ to: ["a@b.c"], subject: "Hi", body: "" })).toBe(
      "Email a@b.c: Hi",
    );
  });

  test("organize archives, labels by name and marks read", async () => {
    const m = google.receive({ from: "shop@x.com", subject: "Receipt" });
    const t = await tools();
    await run(t.get("gmail_organize"), {
      messageIds: [m.id],
      addLabels: ["receipts"],
      archive: true,
      markRead: true,
    });
    expect(m.labelIds).toEqual(["Label_1"]);
    await expect(
      run(t.get("gmail_organize"), { messageIds: [m.id], addLabels: ["Nope"] }),
    ).rejects.toThrow('No Gmail label "Nope"');
  });

  test("buildMime strips header injection and encodes non-ASCII subjects", () => {
    const mime = buildMime({
      to: ["bob@acme.com\r\nBcc: evil@x.com"],
      subject: "Café\nBcc: evil@x.com",
      body: "hi",
    });
    const head = mime.split("\r\n\r\n")[0]!;
    expect(head.split("\r\n").filter((l) => l.startsWith("Bcc:"))).toHaveLength(0);
    expect(head).toContain("Subject: =?UTF-8?B?");
  });

  test("new-message cursor never fires the same email twice", async () => {
    const t0 = Date.now() - 60_000;
    const g = (await GoogleClient.forUser(app, database.db, box, USER))!;
    google.receive({ from: "old@x.com", subject: "old", internalDate: t0 - 1000 });
    const a = google.receive({ from: "a@x.com", subject: "a", internalDate: t0 + 1000 });
    const b = google.receive({ from: "b@x.com", subject: "b", internalDate: t0 + 1000 });
    google.receive({ from: "ada@example.com", subject: "from me", internalDate: t0 + 2000 });

    const first = await newMessagesSince(g, "in:inbox", { after: t0, seen: [] });
    expect(first.messages.map((m) => m.subject).sort()).toEqual(["a", "b"]);
    expect(first.cursor).toEqual({ after: t0 + 1000, seen: expect.arrayContaining([a.id, b.id]) });

    const again = await newMessagesSince(g, "in:inbox", first.cursor);
    expect(again.messages).toHaveLength(0);

    const c = google.receive({ from: "c@x.com", subject: "c", internalDate: t0 + 1000 });
    const tie = await newMessagesSince(g, "in:inbox", first.cursor);
    expect(tie.messages.map((m) => m.id)).toEqual([c.id]);
    expect(tie.cursor.seen).toEqual(expect.arrayContaining([a.id, b.id, c.id]));
  });
});

describe("calendar", () => {
  beforeEach(() => connect());

  test("create invites guests and respond only changes your own answer", async () => {
    const t = await tools();
    const created = (await run(t.get("calendar_create_event"), {
      title: "Sync",
      start: "2026-10-25T15:00:00Z",
      end: "2026-10-25T15:30:00Z",
      attendees: ["bob@acme.com"],
    })) as unknown as { value: { id: string; attendees: { email: string }[] } };
    expect(created.value.attendees.map((a) => a.email)).toEqual(["bob@acme.com"]);
    expect(google.state.calls.at(-1)).toBe(
      "POST www.googleapis.com/calendar/v3/calendars/primary/events",
    );

    google.state.events.push({
      id: "inv",
      summary: "Board",
      start: { dateTime: "2026-10-26T10:00:00Z" },
      end: { dateTime: "2026-10-26T11:00:00Z" },
      attendees: [
        { email: "ada@example.com", self: true, responseStatus: "needsAction" },
        { email: "ceo@acme.com", responseStatus: "accepted" },
      ],
    });
    await run(t.get("calendar_respond"), { eventId: "inv", response: "declined" });
    const inv = google.state.events.find((e) => e.id === "inv")!;
    expect(inv.attendees?.map((a) => a.responseStatus)).toEqual(["declined", "accepted"]);

    const list = (await run(t.get("calendar_list_events"), {})) as unknown as {
      value: { events: { title: string }[] };
    };
    expect(list.value.events.map((e) => e.title)).toEqual(["Sync", "Board"]);
  });

  test("all-day dates and preview text", async () => {
    const t = await tools();
    const tool = t.get("calendar_create_event")!;
    expect(
      tool.preview?.({ title: "Offsite", start: "2026-11-02", end: "2026-11-03", attendees: [] }),
    ).toBe('Add "Offsite" on 2026-11-02');
    await run(tool, { title: "Offsite", start: "2026-11-02", end: "2026-11-03" });
    expect(google.state.events.at(-1)?.start).toEqual({ date: "2026-11-02" });
  });
});

test("integration rows cascade with the user", async () => {
  await database.db.insert(schema.user).values({ id: "u-gone", name: "g", email: "g@x.com" });
  await connect("u-gone");
  await database.db.delete(schema.user).where(eq(schema.user.id, "u-gone"));
  expect(
    await database.db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.userId, "u-gone")),
  ).toHaveLength(0);
});
