import { afterAll, beforeAll, expect, test } from "bun:test";
import { UNDO_DENIAL } from "@synapse/core";
import { type ScriptedStep, scriptedModel } from "@synapse/core/testing";
import { readEvents, schema } from "@synapse/db";
import { fakeGoogle } from "@synapse/tools/testing";
import { and, eq } from "drizzle-orm";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createServices, type Services } from "./services";
import { Worker } from "./worker";

const ORIGIN = "http://localhost:3000";
const google = fakeGoogle({ email: "ada@example.com" });
let services: Services;
let app: ReturnType<typeof createApp>;
let worker: Worker;
let model = scriptedModel([]);
const script = (steps: ScriptedStep[]) => {
  model = scriptedModel(steps);
};

beforeAll(async () => {
  services = await createServices(
    loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "pglite://memory",
      SYNAPSE_SECRET: "t".repeat(40),
      PUBLIC_URL: ORIGIN,
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "secret",
    }),
  );
  services.config.google!.fetch = google.fetch;
  app = createApp(services);
  worker = new Worker(services, () => [model]);
});
afterAll(() => services.close());

type Call = (
  path: string,
  init?: { method?: string; json?: unknown },
) => Promise<{
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: test responses are loosely typed JSON
  json: any;
}>;

async function signUp(email: string): Promise<Call> {
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
  return async (path, init = {}) => {
    const r = await app.request(path, {
      method: init.method ?? "GET",
      headers: {
        cookie,
        origin: ORIGIN,
        ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null };
  };
}

async function connectedUser(email: string, undoSeconds?: number): Promise<Call> {
  const me = await signUp(email);
  const start = await me("/api/integrations/google/connect", { method: "POST", json: {} });
  const state = new URL(start.json.url).searchParams.get("state")!;
  await me(`/api/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`);
  if (undoSeconds !== undefined) {
    const res = await me("/api/settings", { method: "PUT", json: { undoSeconds } });
    expect(res.json.undoSeconds).toBe(undoSeconds);
  }
  return me;
}

const sentTo = (to: string) =>
  google.state.messages.filter((m) => m.labelIds.includes("SENT") && JSON.stringify(m).includes(to))
    .length;

const sendStep = (to: string, id: string): ScriptedStep => ({
  toolCalls: [{ name: "gmail_send", id, input: { to: [to], subject: "Hi", body: "Hello" } }],
});

async function runOf(runId: string) {
  const [run] = await services.database.db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, runId));
  return run!;
}

async function callOf(runId: string, id: string) {
  const [call] = await services.database.db
    .select()
    .from(schema.toolCalls)
    .where(and(eq(schema.toolCalls.runId, runId), eq(schema.toolCalls.id, id)));
  return call!;
}

/** Fast-forwards the undo window: the call is due and the run is claimable. */
async function endWindow(runId: string, id: string) {
  const past = new Date(Date.now() - 1000);
  const { db } = services.database;
  await db
    .update(schema.toolCalls)
    .set({ executeAfter: past })
    .where(and(eq(schema.toolCalls.runId, runId), eq(schema.toolCalls.id, id)));
  await db.update(schema.runs).set({ leaseExpiresAt: past }).where(eq(schema.runs.id, runId));
}

/** Starts a task whose first step proposes one call, and drives it to the approval. */
async function proposed(me: Call, first: ScriptedStep, then = "Done.") {
  script([first, { text: then }]);
  const { json } = await me("/api/chats", { method: "POST", json: { content: "Go" } });
  await worker.processNow(json.runId);
  expect((await runOf(json.runId)).status).toBe("waiting");
  return json.runId as string;
}

test("settings expose the undo window, default 10s, capped at 60", async () => {
  const me = await signUp("settings@example.com");
  expect((await me("/api/settings")).json.undoSeconds).toBe(10);
  expect((await me("/api/settings", { method: "PUT", json: { undoSeconds: 61 } })).status).toBe(
    422,
  );
  expect(
    (await me("/api/settings", { method: "PUT", json: { undoSeconds: 0 } })).json.undoSeconds,
  ).toBe(0);
});

test("an approved send waits out its window, then runs exactly once", async () => {
  const me = await connectedUser("wait@example.com");
  const runId = await proposed(me, sendStep("wait@x.test", "s1"));

  const decided = await me(`/api/runs/${runId}/tool-calls/s1/decision`, {
    method: "POST",
    json: { approved: true },
  });
  expect(decided.status).toBe(200);
  const executeAfter = Date.parse(decided.json.executeAfter);
  expect(executeAfter - Date.now()).toBeGreaterThan(8_000);
  expect(executeAfter - Date.now()).toBeLessThanOrEqual(10_500);

  // Re-queued for when the window ends, so no worker takes it early.
  const parked = await runOf(runId);
  expect(parked.status).toBe("queued");
  expect(parked.leaseExpiresAt!.getTime()).toBe(executeAfter);
  expect(await worker.processNow(runId)).toBe(false);
  expect(sentTo("wait@x.test")).toBe(0);

  // The run detail and the event stream carry the deadline for a countdown.
  const detail = await me(`/api/runs/${runId}`);
  expect(detail.json.toolCalls[0]).toMatchObject({ status: "approved" });
  expect(Date.parse(detail.json.toolCalls[0].executeAfter)).toBe(executeAfter);
  const chat = await me(`/api/chats/${parked.chatId}`);
  const part = chat.json.messages
    .flatMap((m: { parts: unknown[] }) => m.parts)
    .find((p: { toolCallId?: string }) => p.toolCallId === "s1");
  expect(Date.parse(part.executeAfter)).toBe(executeAfter);
  const log = await readEvents(services.database, runId, 0);
  expect(log.slice(-2)).toMatchObject([
    { type: "tool.status", toolCallId: "s1", status: "approved", executeAfter: expect.any(String) },
    { type: "run.status", status: "queued" },
  ]);

  await endWindow(runId, "s1");
  expect(await worker.processNow(runId)).toBe(true);
  expect(sentTo("wait@x.test")).toBe(1);
  expect(await callOf(runId, "s1")).toMatchObject({ status: "succeeded" });
  expect((await runOf(runId)).status).toBe("completed");
  expect(await worker.processNow(runId)).toBe(false);
  expect(sentTo("wait@x.test")).toBe(1);

  // Too late now.
  const late = await me(`/api/runs/${runId}/tool-calls/s1/undo`, { method: "POST", json: {} });
  expect(late.status).toBe(409);
  expect(late.json.error.message).toContain("Too late to undo");
});

test("a worker that reaches a call early parks the run until the window ends", async () => {
  const me = await connectedUser("early@example.com", 1);
  const runId = await proposed(me, sendStep("early@x.test", "s1"));
  await me(`/api/runs/${runId}/tool-calls/s1/decision`, {
    method: "POST",
    json: { approved: true },
  });
  // Something re-queued the run before the window ended (e.g. a stop-after-step request).
  await services.database.db
    .update(schema.runs)
    .set({ leaseExpiresAt: null })
    .where(eq(schema.runs.id, runId));
  expect(await worker.processNow(runId)).toBe(true);
  expect(sentTo("early@x.test")).toBe(0);
  const parked = await runOf(runId);
  expect(parked).toMatchObject({ status: "queued", leaseOwner: null, attempts: 0 });
  const call = await callOf(runId, "s1");
  expect(parked.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  expect(parked.leaseExpiresAt!.getTime()).toBeLessThanOrEqual(call.executeAfter!.getTime() + 50);

  await Bun.sleep(Math.max(0, parked.leaseExpiresAt!.getTime() - Date.now()) + 20);
  expect(await worker.processNow(runId)).toBe(true);
  expect(sentTo("early@x.test")).toBe(1);
  expect((await runOf(runId)).status).toBe("completed");
});

test("undo inside the window denies the send and the agent hears why", async () => {
  const me = await connectedUser("undo@example.com");
  const other = await connectedUser("other@example.com");
  const runId = await proposed(me, sendStep("undo@x.test", "s1"), "Okay, I won't send it.");
  await me(`/api/runs/${runId}/tool-calls/s1/decision`, {
    method: "POST",
    json: { approved: true },
  });

  const path = `/api/runs/${runId}/tool-calls/s1/undo`;
  expect((await other(path, { method: "POST", json: {} })).status).toBe(404);
  expect((await me(path, { method: "POST", json: {} })).status).toBe(204);
  expect((await me(path, { method: "POST", json: {} })).status).toBe(409);

  // Re-queued right away so the agent can respond.
  expect((await runOf(runId)).leaseExpiresAt).toBeNull();
  expect(await worker.processNow(runId)).toBe(true);
  expect(sentTo("undo@x.test")).toBe(0);
  expect(await callOf(runId, "s1")).toMatchObject({
    status: "denied",
    output: { type: "denied", reason: UNDO_DENIAL },
  });
  expect(JSON.stringify(model.calls[1]!.prompt)).toContain(UNDO_DENIAL);
  expect((await runOf(runId)).status).toBe("completed");
});

test("undo window 0 runs approved sends at once", async () => {
  const me = await connectedUser("off@example.com", 0);
  const runId = await proposed(me, sendStep("off@x.test", "s1"));
  const decided = await me(`/api/runs/${runId}/tool-calls/s1/decision`, {
    method: "POST",
    json: { approved: true },
  });
  expect(decided.json.executeAfter).toBeNull();
  expect(await worker.processNow(runId)).toBe(true);
  expect(sentTo("off@x.test")).toBe(1);
  expect(
    (await me(`/api/runs/${runId}/tool-calls/s1/undo`, { method: "POST", json: {} })).status,
  ).toBe(409);
});

test("auto-allowed sends and approved writes are not delayed", async () => {
  const me = await connectedUser("allow@example.com");
  await me("/api/policy", {
    method: "PUT",
    json: {
      defaults: { read: "allow", write: "ask", send: "ask", destructive: "ask" },
      rules: [
        { tool: "gmail_send", decision: "allow" },
        { tool: "gmail_create_draft", decision: "ask" },
      ],
    },
  });
  script([sendStep("allow@x.test", "s1"), { text: "Sent." }]);
  const { json } = await me("/api/chats", { method: "POST", json: { content: "Go" } });
  await worker.processNow(json.runId);
  expect(sentTo("allow@x.test")).toBe(1);
  expect(await callOf(json.runId, "s1")).toMatchObject({ status: "succeeded", executeAfter: null });

  const runId = await proposed(me, {
    toolCalls: [
      {
        name: "gmail_create_draft",
        id: "d1",
        input: { to: ["draft@x.test"], subject: "Hi", body: "Hello" },
      },
    ],
  });
  const decided = await me(`/api/runs/${runId}/tool-calls/d1/decision`, {
    method: "POST",
    json: { approved: true },
  });
  expect(decided.json.executeAfter).toBeNull();
  expect(await worker.processNow(runId)).toBe(true);
  expect(await callOf(runId, "d1")).toMatchObject({ status: "succeeded", executeAfter: null });
  expect(google.state.drafts.length).toBeGreaterThan(0);
});

test("stopping a task inside the window cancels the send at once", async () => {
  const me = await connectedUser("stop@example.com");
  const runId = await proposed(me, sendStep("stop@x.test", "s1"));
  await me(`/api/runs/${runId}/tool-calls/s1/decision`, {
    method: "POST",
    json: { approved: true },
  });
  expect(
    (await me(`/api/runs/${runId}/cancel`, { method: "POST", json: { mode: "now" } })).status,
  ).toBe(204);
  expect(await worker.processNow(runId)).toBe(true);
  expect((await runOf(runId)).status).toBe("cancelled");
  expect(await callOf(runId, "s1")).toMatchObject({ status: "denied" });
  expect(sentTo("stop@x.test")).toBe(0);
});
