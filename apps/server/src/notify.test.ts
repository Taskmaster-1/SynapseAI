import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ScriptedStep, scriptedModel } from "@synapse/core/testing";
import { schema } from "@synapse/db";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { createApp } from "./app";
import { loadConfig } from "./config";
import type { MailMessage } from "./notify/email";
import type { PushMessage, PushSender } from "./notify/push";
import { createServices } from "./services";
import { Worker } from "./worker";

const ORIGIN = "http://localhost:3000";
const vapid = webpush.generateVAPIDKeys();

interface Sent {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  message: PushMessage;
  ttlSeconds: number;
}

/** A server with fake delivery: pushes and emails are recorded, never sent. */
async function harness(env: Record<string, string>) {
  const pushes: Sent[] = [];
  const mails: MailMessage[] = [];
  /** Status the fake push service answers with, per endpoint (default 201). */
  const status = new Map<string, number>();
  const sender: PushSender = async (target, payload, options) => {
    pushes.push({
      endpoint: target.endpoint,
      keys: target.keys,
      message: JSON.parse(payload),
      ttlSeconds: options.ttlSeconds,
    });
    return { statusCode: status.get(target.endpoint) ?? 201 };
  };
  const services = await createServices(
    loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "pglite://memory",
      SYNAPSE_SECRET: "t".repeat(40),
      PUBLIC_URL: ORIGIN,
      ...env,
    }),
    {
      pushSender: sender,
      mailTransport: {
        sendMail: async (m) => {
          mails.push(m);
        },
      },
    },
  );
  const app = createApp(services);
  let model = scriptedModel([]);
  const worker = new Worker(services, () => [model]);

  async function signUp(email: string) {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email, password: "correct horse battery", name: email.split("@")[0] }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const call = async (path: string, init: { method?: string; json?: unknown } = {}) => {
      const r = await app.request(path, {
        method: init.method ?? "GET",
        headers: {
          cookie,
          origin: ORIGIN,
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
          ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
      });
      const text = await r.text();
      // biome-ignore lint/suspicious/noExplicitAny: test responses are loosely typed JSON
      return { status: r.status, json: text ? (JSON.parse(text) as any) : null };
    };
    // Every memory_save asks, so a task stops for approval.
    await call("/api/policy", {
      method: "PUT",
      json: {
        defaults: { read: "allow", write: "ask", send: "ask", destructive: "ask" },
        rules: [{ tool: "memory_save", decision: "ask" }],
      },
    });
    return call;
  }

  /** Starts a task whose first step proposes these calls, and drives it to the approval. */
  async function asks(me: Awaited<ReturnType<typeof signUp>>, step: ScriptedStep) {
    model = scriptedModel([step, { text: "Done." }]);
    const { json } = await me("/api/chats", { method: "POST", json: { content: "Remember" } });
    await worker.processNow(json.runId);
    const [run] = await services.database.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, json.runId));
    expect(run!.status).toBe("waiting");
    return { runId: json.runId as string, chatId: json.chat.id as string };
  }

  return { services, pushes, mails, status, signUp, asks };
}

let n = 0;
/** A browser PushSubscription.toJSON() on a real push service host. */
function device(host = "fcm.googleapis.com") {
  n++;
  return {
    endpoint: `https://${host}/fcm/send/device-${n}-${crypto.randomUUID()}`,
    keys: {
      p256dh: webpush.generateVAPIDKeys().publicKey,
      auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url"),
    },
  };
}

const save = (id: string, note = "likes tea"): ScriptedStep => ({
  toolCalls: [{ name: "memory_save", input: { note }, id }],
});

describe("configured: push and email", () => {
  let h: Awaited<ReturnType<typeof harness>>;
  beforeAll(async () => {
    h = await harness({
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:ops@example.com",
      SMTP_URL: "smtp://mail.example.com:2525",
      EMAIL_FROM: "Synapse <synapse@example.com>",
    });
  });
  afterAll(() => h.services.close());

  test("config exposes the public key; the app reports both channels", async () => {
    const me = await h.signUp("config@example.com");
    expect((await me("/api/push/config")).json).toEqual({
      enabled: true,
      publicKey: vapid.publicKey,
    });
    expect((await me("/api/config")).json.features).toMatchObject({
      push: true,
      emailAlerts: true,
    });
    expect(h.services.notifier.names).toEqual(["push", "email"]);
  });

  test("subscriptions: create (upsert), list, keys sealed at rest, remove", async () => {
    const me = await h.signUp("subs@example.com");
    const phone = device();
    const created = await me("/api/push/subscriptions", { method: "POST", json: phone });
    expect(created.status).toBe(201);
    expect(created.json.subscription).toMatchObject({
      endpoint: phone.endpoint,
      label: "Safari on iPhone",
      lastUsedAt: null,
    });
    // Same device again: still one row.
    const again = await me("/api/push/subscriptions", {
      method: "POST",
      json: { ...phone, label: "My phone" },
    });
    expect(again.json.subscription.id).toBe(created.json.subscription.id);
    const list = await me("/api/push/subscriptions");
    expect(list.json.subscriptions).toHaveLength(1);
    expect(list.json.subscriptions[0].label).toBe("My phone");
    expect(JSON.stringify(list.json)).not.toContain(phone.keys.auth);

    const [row] = await h.services.database.db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.endpoint, phone.endpoint));
    expect(row!.p256dh).not.toBe(phone.keys.p256dh);
    expect(await h.services.box.open(row!.auth)).toBe(phone.keys.auth);

    // Someone else can't remove it.
    const other = await h.signUp("subs-other@example.com");
    await other(`/api/push/subscriptions/${row!.id}`, { method: "DELETE" });
    expect((await me("/api/push/subscriptions")).json.subscriptions).toHaveLength(1);
    expect((await me(`/api/push/subscriptions/${row!.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await me("/api/push/subscriptions")).json.subscriptions).toEqual([]);
  });

  test("only real push services are accepted as endpoints", async () => {
    const me = await h.signUp("ssrf@example.com");
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost:8787/api/health",
      "https://fcm.googleapis.com.evil.test/x",
      "https://fcm.googleapis.com:8443/x",
    ]) {
      const res = await me("/api/push/subscriptions", {
        method: "POST",
        json: { ...device(), endpoint },
      });
      expect(res.status).toBe(422);
    }
    for (const host of ["web.push.apple.com", "updates.push.services.mozilla.com"]) {
      const res = await me("/api/push/subscriptions", { method: "POST", json: device(host) });
      expect(res.status).toBe(201);
    }
  });

  test("a run asks → one push to each of the recipient's devices; others untouched", async () => {
    const me = await h.signUp("ada@example.com");
    const other = await h.signUp("bob@example.com");
    const phone = device();
    const laptop = device("updates.push.services.mozilla.com");
    const bobs = device();
    await me("/api/push/subscriptions", { method: "POST", json: phone });
    await me("/api/push/subscriptions", { method: "POST", json: laptop });
    await other("/api/push/subscriptions", { method: "POST", json: bobs });

    h.pushes.length = 0;
    const { runId, chatId } = await h.asks(me, save("p1"));
    expect(h.pushes.map((p) => p.endpoint).sort()).toEqual(
      [laptop.endpoint, phone.endpoint].sort(),
    );
    const sent = h.pushes.find((p) => p.endpoint === phone.endpoint)!;
    // Keys were unsealed for encryption.
    expect(sent.keys).toEqual(phone.keys);
    expect(sent.ttlSeconds).toBeGreaterThan(0);
    expect(sent.message).toEqual({
      title: "Synapse needs your OK",
      body: "Remember: likes tea\nExpires in 24 h",
      tag: "p1",
      data: { url: `${ORIGIN}/t/${chatId}`, runId, toolCallId: "p1", effect: "write" },
      actions: [
        { action: "approve", title: "Approve" },
        { action: "deny", title: "Deny" },
      ],
    });
    expect(h.pushes.some((p) => p.endpoint === bobs.endpoint)).toBe(false);

    const subs = (await me("/api/push/subscriptions")).json.subscriptions;
    expect(subs.every((s: { lastUsedAt: string | null }) => s.lastUsedAt !== null)).toBe(true);
    const bobSubs = (await other("/api/push/subscriptions")).json.subscriptions;
    expect(bobSubs).toHaveLength(1);
    expect(bobSubs[0].lastUsedAt).toBeNull();

    // Announced once: another pass sends nothing.
    await h.services.notifier.announce(runId);
    expect(h.pushes).toHaveLength(2);
  });

  test("several approvals at once → one summary per device", async () => {
    const me = await h.signUp("summary@example.com");
    const phone = device();
    await me("/api/push/subscriptions", { method: "POST", json: phone });
    h.pushes.length = 0;
    const { chatId } = await h.asks(me, {
      toolCalls: [
        { name: "memory_save", input: { note: "a" }, id: "s1" },
        { name: "memory_save", input: { note: "b" }, id: "s2" },
      ],
    });
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]!.message).toMatchObject({
      title: "Synapse needs your OK on 2 actions",
      data: { url: `${ORIGIN}/t/${chatId}` },
    });
    expect(h.pushes[0]!.message.actions).toBeUndefined();
  });

  test("a push service answering 410 or 404 forgets that device only", async () => {
    const me = await h.signUp("gone@example.com");
    const gone = device();
    const missing = device();
    const fine = device();
    for (const d of [gone, missing, fine])
      await me("/api/push/subscriptions", { method: "POST", json: d });
    h.status.set(gone.endpoint, 410);
    h.status.set(missing.endpoint, 404);
    const test = await me("/api/push/test", { method: "POST", json: {} });
    expect(test.json).toEqual({ sent: 1, removed: 2 });
    const left = (await me("/api/push/subscriptions")).json.subscriptions;
    expect(left.map((s: { endpoint: string }) => s.endpoint)).toEqual([fine.endpoint]);

    // A 5xx is logged, not a reason to forget the device.
    h.status.set(fine.endpoint, 503);
    expect((await me("/api/push/test", { method: "POST", json: {} })).json).toEqual({
      sent: 0,
      removed: 0,
    });
    expect((await me("/api/push/subscriptions")).json.subscriptions).toHaveLength(1);
  });

  test("approving from a notification is recorded as via push; other sources are refused", async () => {
    const me = await h.signUp("lockscreen@example.com");
    const { runId } = await h.asks(me, save("v1"));
    const bad = await me(`/api/runs/${runId}/tool-calls/v1/decision`, {
      method: "POST",
      json: { approved: true, via: "slack" },
    });
    expect(bad.status).toBe(422);
    const ok = await me(`/api/runs/${runId}/tool-calls/v1/decision`, {
      method: "POST",
      json: { approved: true, via: "push" },
    });
    expect(ok.status).toBe(200);
    const [row] = await h.services.database.db
      .select({ via: schema.toolCalls.decidedVia, status: schema.toolCalls.status })
      .from(schema.toolCalls)
      .where(eq(schema.toolCalls.id, "v1"));
    expect(row).toEqual({ via: "push", status: "approved" });
  });

  test("nothing is pushed for an approval already decided", async () => {
    const me = await h.signUp("decided@example.com");
    await me("/api/push/subscriptions", { method: "POST", json: device() });
    const { runId } = await h.asks(me, save("d1"));
    await me(`/api/runs/${runId}/tool-calls/d1/decision`, {
      method: "POST",
      json: { approved: false },
    });
    h.pushes.length = 0;
    const [userRow] = await h.services.database.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, "decided@example.com"));
    await h.services.push!.notify([
      {
        userId: userRow!.id,
        recipients: [userRow!.id],
        runId,
        chatId: "c",
        chatTitle: null,
        toolCallId: "d1",
        name: "memory_save",
        effect: "write",
        preview: null,
        input: {},
        reason: null,
        tainted: false,
        kind: "new",
        facts: [],
        expiresAt: null,
        escalated: false,
        signoffs: { needed: 1, first: null },
        createdAt: new Date(),
        url: `${ORIGIN}/t/c`,
      },
    ]);
    expect(h.pushes).toEqual([]);
  });

  test("email alerts go out only when the person turned them on, with no approve link", async () => {
    const me = await h.signUp("mail@example.com");
    expect((await me("/api/settings")).json.emailAlerts).toBe(false);
    h.mails.length = 0;
    await h.asks(me, save("e0"));
    expect(h.mails).toEqual([]);

    const on = await me("/api/settings", { method: "PUT", json: { emailAlerts: true } });
    expect(on.json.emailAlerts).toBe(true);
    const { chatId } = await h.asks(me, save("e1", "Ada's <b>birthday</b> is in May"));
    expect(h.mails).toHaveLength(1);
    const mail = h.mails[0]!;
    expect(mail.to).toBe("mail@example.com");
    expect(mail.from).toBe("Synapse <synapse@example.com>");
    expect(mail.subject).toStartWith("Synapse needs your OK");
    expect(mail.text).toContain(`${ORIGIN}/t/${chatId}`);
    expect(mail.text).toContain("Why it's asking:");
    // Only the task link: nothing a mail scanner could "click" to approve.
    const links = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual([`${ORIGIN}/t/${chatId}`]);
    for (const body of [mail.text, mail.html]) {
      expect(body).not.toContain("/decision");
      expect(body).not.toContain("approved=");
      expect(body).not.toMatch(/\/api\//);
    }
    expect(mail.html).not.toContain("<b>birthday</b>");
  });
});

describe("not configured", () => {
  let h: Awaited<ReturnType<typeof harness>>;
  beforeAll(async () => {
    h = await harness({});
  });
  afterAll(() => h.services.close());

  test("no channels; push routes explain; nothing is sent", async () => {
    expect(h.services.notifier.names).toEqual([]);
    const me = await h.signUp("plain@example.com");
    expect((await me("/api/push/config")).json).toEqual({ enabled: false, publicKey: null });
    expect((await me("/api/config")).json.features).toMatchObject({
      push: false,
      emailAlerts: false,
    });
    const sub = await me("/api/push/subscriptions", { method: "POST", json: device() });
    expect(sub.status).toBe(503);
    expect(sub.json.error.message).toContain("VAPID_PUBLIC_KEY");
    expect((await me("/api/push/test", { method: "POST", json: {} })).status).toBe(503);

    await me("/api/settings", { method: "PUT", json: { emailAlerts: true } });
    await h.asks(me, save("q1"));
    expect(h.pushes).toEqual([]);
    expect(h.mails).toEqual([]);
  });
});

describe("config", () => {
  test("VAPID keys come in pairs; production needs a subject; tests never generate keys", () => {
    const base = { NODE_ENV: "test", SYNAPSE_SECRET: "x".repeat(32) };
    expect(loadConfig(base).push).toBeNull();
    expect(() => loadConfig({ ...base, VAPID_PUBLIC_KEY: vapid.publicKey })).toThrow();
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
      }),
    ).toThrow("VAPID_SUBJECT");
    expect(() => loadConfig({ ...base, VAPID_SUBJECT: "ops@example.com" })).toThrow();
    expect(
      loadConfig({
        ...base,
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_SUBJECT: "mailto:ops@example.com",
      }).push,
    ).toEqual({ ...vapid, subject: "mailto:ops@example.com" });
    expect(loadConfig({ ...base, SMTP_URL: "smtp://x.test" }).email).toBeNull();
  });
});
