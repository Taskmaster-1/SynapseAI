import { afterAll, beforeAll, expect, test } from "bun:test";
import type { SeqEvent } from "@synapse/core";
import { type ScriptedStep, scriptedModel } from "@synapse/core/testing";
import { schema } from "@synapse/db";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createServices, type Services } from "./services";
import { Worker } from "./worker";

let services: Services;
let app: ReturnType<typeof createApp>;
let model = scriptedModel([]);
/** Each test scripts its own model; it persists across worker.process calls like a real one. */
function script(steps: ScriptedStep[]) {
  model = scriptedModel(steps);
}
let worker: Worker;
const ORIGIN = "http://localhost:3000";

beforeAll(async () => {
  services = await createServices(
    loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "pglite://memory",
      SYNAPSE_SECRET: "t".repeat(40),
      PUBLIC_URL: ORIGIN,
    }),
  );
  app = createApp(services);
  worker = new Worker(services, () => [model]);
});
afterAll(() => services.close());

async function signUp(email: string) {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password: "correct horse battery", name: email.split("@")[0] }),
  });
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

function api(cookie: string) {
  return async (path: string, init: { method?: string; json?: unknown } = {}) => {
    const res = await app.request(path, {
      method: init.method ?? "GET",
      headers: {
        cookie,
        origin: ORIGIN,
        ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    const text = await res.text();
    // biome-ignore lint/suspicious/noExplicitAny: test responses are loosely typed JSON
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, any>) : null };
  };
}

async function sse(cookie: string, runId: string, after = 0): Promise<SeqEvent[]> {
  const res = await app.request(`/api/runs/${runId}/events?after=${after}`, {
    headers: { cookie },
  });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
}

test("unauthenticated requests are rejected", async () => {
  expect((await app.request("/api/chats")).status).toBe(401);
  expect((await app.request("/api/health")).status).toBe(200);
});

test("chat → approval → decision → completion, end to end", async () => {
  const ada = api(await signUp("ada@example.com"));
  const mallory = api(await signUp("mallory@example.com"));

  // memory_save is auto-allowed in an untainted run.
  script([
    {
      text: "Noting that.",
      toolCalls: [{ name: "memory_save", input: { note: "Bob is Ada's manager" }, id: "m1" }],
    },
    { text: "Saved. I'll remember that." },
  ]);
  const created = await ada("/api/chats", {
    method: "POST",
    json: { content: "Remember that Bob is my manager" },
  });
  expect(created.status).toBe(201);
  const { runId } = created.json!;
  const chatId = created.json!.chat.id;

  await worker.processNow(runId);
  expect((await app.request(`/api/runs/${runId}/events`)).status).toBe(401);

  const chat = await ada(`/api/chats/${chatId}`);
  expect(chat.json!.run.status).toBe("completed");
  const parts = chat.json!.messages.flatMap((m: { parts: unknown[] }) => m.parts);
  expect(parts).toContainEqual(
    expect.objectContaining({ type: "tool", name: "memory_save", status: "succeeded" }),
  );
  expect((await ada("/api/memories")).json!.memories[0].content).toBe("Bob is Ada's manager");

  // Mallory cannot see Ada's chat, run, or events.
  expect((await mallory(`/api/chats/${chatId}`)).status).toBe(404);
  expect((await mallory(`/api/runs/${runId}`)).status).toBe(404);
  expect(
    (await mallory(`/api/chats/${chatId}/messages`, { method: "POST", json: { content: "hi" } }))
      .status,
  ).toBe(404);
});

test("policy block, approvals inbox and decisions over HTTP", async () => {
  const cookie = await signUp("grace@example.com");
  const grace = api(cookie);
  const other = api(await signUp("eve@example.com"));

  // Make memory saves require approval via a policy rule.
  const put = await grace("/api/policy", {
    method: "PUT",
    json: {
      defaults: { read: "allow", write: "ask", send: "ask", destructive: "ask" },
      rules: [{ tool: "memory_save", decision: "ask" }],
    },
  });
  expect(put.json!.rules).toHaveLength(1);

  script([
    { toolCalls: [{ name: "memory_save", input: { note: "likes tea" }, id: "a1" }] },
    { text: "Noted." },
  ]);
  const { json } = await grace("/api/chats", { method: "POST", json: { content: "I like tea" } });
  const runId = json!.runId;
  await worker.processNow(runId);

  const inbox = await grace("/api/approvals");
  expect(inbox.json!.approvals).toEqual([
    expect.objectContaining({ runId, toolCallId: "a1", name: "memory_save" }),
  ]);
  expect((await other("/api/approvals")).json!.approvals).toEqual([]);

  // Live events so far, then resume from the middle.
  const events = await sse(cookie, runId);
  expect(events.find((e) => e.type === "approval.requested")).toBeTruthy();
  expect(events.at(-1)).toMatchObject({ type: "run.status", status: "waiting" });
  const tail = await sse(cookie, runId, events[2]!.seq);
  expect(tail[0]!.seq).toBe(events[3]!.seq);

  // Another user cannot decide; the owner can, once.
  const path = `/api/runs/${runId}/tool-calls/a1/decision`;
  expect((await other(path, { method: "POST", json: { approved: true } })).status).toBe(404);
  expect(
    (
      await grace(path, {
        method: "POST",
        json: { approved: true, input: { note: "likes green tea" } },
      })
    ).status,
  ).toBe(204);
  expect((await grace(path, { method: "POST", json: { approved: true } })).status).toBe(409);

  await worker.processNow(runId);
  const detail = await grace(`/api/runs/${runId}`);
  expect(detail.json!.run.status).toBe("completed");
  expect(detail.json!.toolCalls[0]).toMatchObject({
    status: "succeeded",
    inputEdited: true,
    decidedBy: expect.any(String),
  });
  expect(
    (await grace("/api/memories")).json!.memories.map((m: { content: string }) => m.content),
  ).toEqual(["likes green tea"]);
});

test("cross-origin writes are rejected", async () => {
  const cookie = await signUp("lin@example.com");
  const res = await app.request("/api/chats", {
    method: "POST",
    headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(403);
});

test("settings keep provider keys write-only and encrypted", async () => {
  const cookie = await signUp("kim@example.com");
  const kim = api(cookie);
  const res = await kim("/api/settings", {
    method: "PUT",
    json: {
      providerKeys: { anthropic: "sk-ant-test-1234" },
      budgets: { perRunUsd: 1, perDayUsd: 5 },
    },
  });
  expect(res.json!.providerKeys).toEqual({ anthropic: true, openai: false, google: false });
  expect(JSON.stringify(res.json)).not.toContain("sk-ant");
  const [row] = await services.database.db.select().from(schema.userSettings);
  expect(JSON.stringify(row)).not.toContain("sk-ant-test");
});

test("automations: validation, creation in their own chat, run now", async () => {
  const cookie = await signUp("ops@example.com");
  const ops = api(cookie);
  const bad = await ops("/api/automations", {
    method: "POST",
    json: { name: "x", prompt: "y", schedule: "* * * * *" },
  });
  expect(bad.status).toBe(422);
  const created = await ops("/api/automations", {
    method: "POST",
    json: {
      name: "Daily digest",
      prompt: "Summarise my open issues",
      schedule: "0 9 * * 1-5",
      timezone: "Asia/Kolkata",
    },
  });
  expect(created.status).toBe(201);
  const auto = created.json!.automation;
  expect(new Date(auto.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  const chats = (await ops("/api/chats")).json!.chats;
  expect(chats.map((c: { id: string }) => c.id)).toContain(auto.chatId);

  const ran = await ops(`/api/automations/${auto.id}/run`, { method: "POST" });
  expect(ran.status).toBe(202);
  expect(
    (
      await api(await signUp("other@example.com"))(`/api/automations/${auto.id}/run`, {
        method: "POST",
      })
    ).status,
  ).toBe(404);
});

test("chat list shows latest run status and pending approvals per chat", async () => {
  const cookie = await signUp("list@example.com");
  const me = api(cookie);
  await me("/api/policy", {
    method: "PUT",
    json: {
      defaults: { read: "allow", write: "ask", send: "ask", destructive: "ask" },
      rules: [{ tool: "memory_save", decision: "ask" }],
    },
  });
  script([{ toolCalls: [{ name: "memory_save", input: { note: "x" }, id: "p1" }] }]);
  const { json } = await me("/api/chats", { method: "POST", json: { content: "remember x" } });
  await worker.processNow(json!.runId);
  await me("/api/chats", { method: "POST", json: {} });
  const list = (await me("/api/chats")).json!.chats;
  expect(list).toHaveLength(2);
  expect(list.find((c: { id: string }) => c.id === json!.chat.id)).toMatchObject({
    status: "waiting",
    pendingApprovals: 1,
  });
  expect(list.find((c: { id: string }) => c.id !== json!.chat.id)).toMatchObject({
    status: null,
    pendingApprovals: 0,
  });
});

test("SSE keeps streaming past an earlier pause", async () => {
  const cookie = await signUp("sse@example.com");
  const me = api(cookie);
  await me("/api/policy", {
    method: "PUT",
    json: {
      defaults: { read: "allow", write: "ask", send: "ask", destructive: "ask" },
      rules: [{ tool: "memory_save", decision: "ask" }],
    },
  });
  script([
    { toolCalls: [{ name: "memory_save", input: { note: "y" }, id: "q1" }] },
    { text: "All set." },
  ]);
  const { json } = await me("/api/chats", { method: "POST", json: { content: "remember y" } });
  const runId = json!.runId;
  await worker.processNow(runId);
  await me(`/api/runs/${runId}/tool-calls/q1/decision`, {
    method: "POST",
    json: { approved: true },
  });
  await worker.processNow(runId);

  // From the start, the stream must not stop at the old "waiting" status.
  const all = await sse(cookie, runId, 0);
  expect(all.at(-1)).toMatchObject({ type: "run.status", status: "completed" });
  expect(
    all.filter((e) => e.type === "run.status").map((e) => (e as { status: string }).status),
  ).toContain("waiting");
});

test("edited approvals are re-checked against block rules; unsafe patterns are refused", async () => {
  const cookie = await signUp("edit@example.com");
  const me = api(cookie);
  const bad = await me("/api/policy", {
    method: "PUT",
    json: {
      defaults: { read: "allow", write: "ask", send: "ask", destructive: "ask" },
      rules: [
        { tool: "*", decision: "block", when: [{ path: "q", op: "matches", value: "(a+)+$" }] },
      ],
    },
  });
  expect(bad.status).toBe(422);
  await me("/api/policy", {
    method: "PUT",
    json: {
      defaults: { read: "allow", write: "ask", send: "ask", destructive: "ask" },
      rules: [
        {
          tool: "memory_save",
          decision: "block",
          when: [{ path: "note", op: "matches", value: "password" }],
        },
        { tool: "memory_save", decision: "ask" },
      ],
    },
  });
  script([
    { toolCalls: [{ name: "memory_save", input: { note: "likes jazz" }, id: "e1" }] },
    { text: "ok" },
  ]);
  const { json } = await me("/api/chats", { method: "POST", json: { content: "remember jazz" } });
  await worker.processNow(json!.runId);
  const res = await me(`/api/runs/${json!.runId}/tool-calls/e1/decision`, {
    method: "POST",
    json: { approved: true, input: { note: "my password is hunter2" } },
  });
  expect(res.status).toBe(422);
});

test("user budgets can only tighten the operator cap", async () => {
  const { capBudget } = await import("./worker");
  expect(capBudget(undefined, 2)).toBe(2);
  expect(capBudget(0, 2)).toBe(2);
  expect(capBudget(1, 2)).toBe(1);
  expect(capBudget(50, 2)).toBe(2);
  expect(capBudget(5, 0)).toBe(5);
  expect(capBudget(0, 0)).toBe(0);
});
