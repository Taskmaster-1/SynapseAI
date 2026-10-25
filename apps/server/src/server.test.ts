import { afterAll, beforeAll, expect, test } from "bun:test";
import type { SeqEvent } from "@synapse/core";
import { type ScriptedStep, scriptedModel } from "@synapse/core/testing";
import { schema } from "@synapse/db";
import { eq } from "drizzle-orm";
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
  ).toBe(200);
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
  expect(res.json!.providerKeys).toEqual({
    anthropic: true,
    openai: false,
    google: false,
    gateway: false,
  });
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

const ASK_MEMORY = {
  defaults: { read: "allow", write: "ask", send: "ask", destructive: "ask" },
  rules: [{ tool: "memory_save", decision: "ask" }],
};
const notes = (call: ReturnType<typeof api>) =>
  call("/api/memories").then((r) =>
    (r.json!.memories as { content: string }[]).map((m) => m.content).sort(),
  );

test("batch decisions: several calls in one step, decided atomically", async () => {
  const cookie = await signUp("batch@example.com");
  const me = api(cookie);
  const other = api(await signUp("batch-eve@example.com"));
  await me("/api/policy", { method: "PUT", json: ASK_MEMORY });
  script([
    {
      toolCalls: [
        { name: "memory_save", input: { note: "one" }, id: "b1" },
        { name: "memory_save", input: { note: "two" }, id: "b2" },
        { name: "memory_save", input: { note: "three" }, id: "b3" },
      ],
    },
    { text: "Saved what you approved." },
  ]);
  const { json } = await me("/api/chats", { method: "POST", json: { content: "save 3" } });
  const runId = json!.runId;
  await worker.processNow(runId);
  expect((await me("/api/approvals")).json!.approvals).toHaveLength(3);

  const path = `/api/runs/${runId}/tool-calls/decisions`;
  const decisions = [
    { toolCallId: "b1", approved: true },
    { toolCallId: "b2", approved: true, input: { note: "two, edited" } },
    { toolCallId: "b3", approved: false, reason: "not this one" },
  ];
  // Another user's run is invisible; duplicates and unknown ids change nothing.
  expect((await other(path, { method: "POST", json: { decisions } })).status).toBe(404);
  expect(
    (
      await me(path, {
        method: "POST",
        json: { decisions: [decisions[0], { toolCallId: "b1", approved: false }] },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await me(path, {
        method: "POST",
        json: { decisions: [decisions[0], { toolCallId: "nope", approved: true }] },
      })
    ).status,
  ).toBe(409);
  expect((await me("/api/approvals")).json!.approvals).toHaveLength(3);

  expect((await me(path, { method: "POST", json: { decisions } })).status).toBe(200);
  expect((await me(`/api/runs/${runId}`)).json!.run.status).toBe("queued");
  // A second submit (double click, replay) conflicts.
  expect((await me(path, { method: "POST", json: { decisions } })).status).toBe(409);

  await worker.processNow(runId);
  const detail = await me(`/api/runs/${runId}`);
  expect(detail.json!.run.status).toBe("completed");
  expect(
    detail.json!.toolCalls.map((c: { id: string; status: string }) => [c.id, c.status]),
  ).toEqual([
    ["b1", "succeeded"],
    ["b2", "succeeded"],
    ["b3", "denied"],
  ]);
  expect(await notes(me)).toEqual(["one", "two, edited"]);
  // Re-queued once: one pause, then straight through to the end.
  const statuses = (await sse(cookie, runId)).flatMap((e) =>
    e.type === "run.status" ? [e.status] : [],
  );
  expect(statuses).toEqual(["running", "waiting", "running", "completed"]);
});

test("propose_plan: approve with a step removed; the kept call runs, the other asks", async () => {
  const me = api(await signUp("plan@example.com"));
  await me("/api/policy", { method: "PUT", json: ASK_MEMORY });
  const keep = { tool: "memory_save", input: { note: "likes tea" }, why: "You said so." };
  const drop = { tool: "memory_save", input: { note: "likes coffee" }, why: "A guess." };
  script([
    {
      toolCalls: [
        {
          name: "propose_plan",
          input: { summary: "Save two notes", steps: [keep, drop] },
          id: "plan1",
        },
      ],
    },
    {
      toolCalls: [
        { name: "memory_save", input: { note: "likes tea" }, id: "k1" },
        { name: "memory_save", input: { note: "likes coffee" }, id: "u1" },
      ],
    },
    { text: "Saved the note you approved." },
  ]);
  const { json } = await me("/api/chats", { method: "POST", json: { content: "save notes" } });
  const runId = json!.runId;
  await worker.processNow(runId);
  const [asked] = (await me("/api/approvals")).json!.approvals;
  expect(asked).toMatchObject({ toolCallId: "plan1", preview: "Save two notes" });

  // Untick the second step: approve with an input holding only the kept one.
  const res = await me(`/api/runs/${runId}/tool-calls/plan1/decision`, {
    method: "POST",
    json: { approved: true, input: { summary: "Save two notes", steps: [keep] } },
  });
  expect(res.status).toBe(200);
  await worker.processNow(runId);

  let detail = await me(`/api/runs/${runId}`);
  expect(detail.json!.run.status).toBe("waiting");
  expect(detail.json!.run.planGrants).toEqual([
    { tool: "memory_save", inputHash: expect.any(String), usedBy: "k1" },
  ]);
  const byId = (id: string) =>
    detail.json!.toolCalls.find((c: { id: string }) => c.id === id) as Record<string, unknown>;
  expect(byId("plan1")).toMatchObject({ status: "succeeded", inputEdited: true });
  expect(JSON.stringify(byId("plan1").output)).toContain("do not do them");
  expect(byId("k1")).toMatchObject({
    status: "approved",
    decision: "allow",
    decisionReason: "Part of the plan you approved",
  });
  expect(byId("u1")).toMatchObject({ status: "awaiting_approval", decision: "ask" });
  expect((await me("/api/approvals")).json!.approvals).toEqual([
    expect.objectContaining({ toolCallId: "u1" }),
  ]);

  await me(`/api/runs/${runId}/tool-calls/u1/decision`, {
    method: "POST",
    json: { approved: false },
  });
  await worker.processNow(runId);
  detail = await me(`/api/runs/${runId}`);
  expect(detail.json!.run.status).toBe("completed");
  expect(byId("k1")!.status).toBe("succeeded");
  expect(byId("u1")!.status).toBe("denied");
  expect(await notes(me)).toEqual(["likes tea"]);
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

test("task list carries snippet, cost and taint; approvals carry previews", async () => {
  const cookie = await signUp("meta@example.com");
  const me = api(cookie);
  script([{ text: "Hello **there**." }]);
  const { json } = await me("/api/chats", { method: "POST", json: { content: "hi" } });
  await worker.processNow(json!.runId);
  const [chat] = (await me("/api/chats")).json!.chats;
  expect(chat).toMatchObject({ snippet: "Hello **there**.", tainted: false, trigger: "chat" });
  expect(chat.costUsd).toBeGreaterThan(0);
  const detail = await me(`/api/chats/${json!.chat.id}`);
  expect(detail.json!.run).toMatchObject({
    model: "anthropic:claude-sonnet-5-5",
    tainted: false,
    steps: 1,
  });
});

test("model list covers the catalog, direct refs and the chain, with availability per key", async () => {
  const { clearCatalog, parseCatalog, setCatalog } = await import("@synapse/core");
  setCatalog(
    parseCatalog({
      data: [
        {
          id: "openai/gpt-9",
          owned_by: "openai",
          name: "GPT-9",
          type: "language",
          released: 1790000000,
          context_window: 400_000,
          tags: ["tool-use"],
          pricing: { input: "0.000005", output: "0.00003" },
        },
        { id: "xai/grok-5", owned_by: "xai", name: "Grok 5", type: "language" },
        { id: "openai/gpt-9-batch", owned_by: "openai", name: "GPT-9 Batch", type: "language" },
      ],
    }),
  );
  try {
    const call = api(await signUp("models@example.com"));
    const before = await call("/api/models");
    expect(before.status).toBe(200);
    const byRef = (res: typeof before) =>
      new Map(
        (res.json!.models as { ref: string }[]).map((m) => [m.ref, m as Record<string, unknown>]),
      );
    const refs = byRef(before);
    expect(refs.get("gateway:openai/gpt-9")).toEqual({
      ref: "gateway:openai/gpt-9",
      name: "GPT-9",
      provider: "gateway",
      creator: "openai",
      contextWindow: 400_000,
      price: { input: 5, output: 30 },
      available: false,
      tags: ["tool-use"],
      released: new Date(1790000000 * 1000).toISOString(),
    });
    expect(refs.get("openai:gpt-9")?.provider).toBe("openai");
    expect(refs.get("gateway:xai/grok-5")?.price).toBeNull();
    expect(refs.has("xai:grok-5")).toBe(false);
    expect([...refs.keys()].some((r) => r.includes("batch"))).toBe(false);
    // The configured chain is always listed.
    expect(refs.get("anthropic:claude-opus-5-5")?.price).toEqual({
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite: 5,
    });
    expect(typeof before.json!.updatedAt).toBe("string");

    await call("/api/settings", {
      method: "PUT",
      json: { providerKeys: { openai: "sk-test-1234" } },
    });
    const after = await call("/api/models");
    const list = after.json!.models as { ref: string; available: boolean }[];
    expect(byRef(after).get("openai:gpt-9")?.available).toBe(true);
    expect(byRef(after).get("gateway:openai/gpt-9")?.available).toBe(false);
    // Available models sort first.
    const firstUnavailable = list.findIndex((m) => !m.available);
    expect(list.slice(firstUnavailable).every((m) => !m.available)).toBe(true);
  } finally {
    clearCatalog();
  }
});

test("approvals that learn: suggest, accept, dismiss", async () => {
  const me = api(await signUp("learner@example.com"));
  const other = api(await signUp("bystander@example.com"));
  const askForNotes = {
    defaults: { read: "allow", write: "ask", send: "ask", destructive: "ask" },
    rules: [{ tool: "memory_save", decision: "ask" }],
  };
  await me("/api/policy", { method: "PUT", json: askForNotes });
  await other("/api/policy", { method: "PUT", json: askForNotes });

  let n = 0;
  async function startNote(who: typeof me, opts: { tainted?: boolean } = {}) {
    const id = `learn${++n}`;
    script([
      { toolCalls: [{ name: "memory_save", input: { note: `fact ${n}` }, id }] },
      { text: "Noted." },
    ]);
    const { json } = await who("/api/chats", { method: "POST", json: { content: "remember" } });
    const runId = json!.runId as string;
    if (opts.tainted)
      await services.database.db
        .update(schema.runs)
        .set({ tainted: true })
        .where(eq(schema.runs.id, runId));
    await worker.processNow(runId);
    return { runId, id };
  }
  async function approveNote(who: typeof me) {
    const { runId, id } = await startNote(who);
    const res = await who(`/api/runs/${runId}/tool-calls/${id}/decision`, {
      method: "POST",
      json: { approved: true },
    });
    expect(res.status).toBe(200);
    await worker.processNow(runId);
  }

  for (let i = 0; i < 4; i++) await approveNote(me);
  expect((await me("/api/policy/suggestions")).json!.suggestions).toEqual([]);
  await approveNote(me);
  const [s] = (await me("/api/policy/suggestions")).json!.suggestions;
  expect(s).toMatchObject({ tool: "memory_save", effect: "write", count: 5, when: [] });
  expect(s.sentence).toContain("You approved 5");
  expect((await other("/api/policy/suggestions")).json!.suggestions).toEqual([]);

  // Someone else can neither accept nor dismiss it.
  const accept = `/api/policy/suggestions/${s.id}/accept`;
  const dismiss = `/api/policy/suggestions/${s.id}/dismiss`;
  expect((await other(accept, { method: "POST" })).status).toBe(404);
  expect((await other(dismiss, { method: "POST" })).status).toBe(404);

  const accepted = await me(accept, { method: "POST" });
  expect(accepted.status).toBe(200);
  expect(accepted.json!.rules).toEqual([
    expect.objectContaining({
      tool: "memory_save",
      decision: "allow",
      note: "Learned: you approved 5 of these",
    }),
    expect.objectContaining({ tool: "memory_save", decision: "ask" }),
  ]);
  expect((await me("/api/policy")).json!.rules).toHaveLength(2);
  expect((await me("/api/policy/suggestions")).json!.suggestions).toEqual([]);

  // Untainted: allowed without asking. Tainted: still asks.
  const clean = await startNote(me);
  expect((await me(`/api/runs/${clean.runId}`)).json!.run.status).toBe("completed");
  const tainted = await startNote(me, { tainted: true });
  expect((await me(`/api/runs/${tainted.runId}`)).json!.run.status).toBe("waiting");
  expect((await me("/api/approvals")).json!.approvals).toEqual([
    expect.objectContaining({ runId: tainted.runId, name: "memory_save" }),
  ]);

  // Dismissing hides it, also after more approvals.
  for (let i = 0; i < 5; i++) await approveNote(other);
  const [o] = (await other("/api/policy/suggestions")).json!.suggestions;
  expect(o.id).toBe(s.id);
  expect((await other(dismiss, { method: "POST" })).status).toBe(204);
  expect((await other("/api/policy/suggestions")).json!.suggestions).toEqual([]);
  await approveNote(other);
  expect((await other("/api/policy/suggestions")).json!.suggestions).toEqual([]);
  expect((await other("/api/policy")).json!.rules).toHaveLength(1);
});
