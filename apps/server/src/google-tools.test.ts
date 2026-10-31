import { afterAll, beforeAll, expect, test } from "bun:test";
import { type ScriptedStep, scriptedModel } from "@synapse/core/testing";
import { schema } from "@synapse/db";
import { fakeGoogle, LEGACY_GOOGLE_SCOPE } from "@synapse/tools/testing";
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
    { models: () => [model] },
  );
  services.config.google!.fetch = google.fetch;
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
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return async (path: string, init: { method?: string; json?: unknown } = {}) => {
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
    // biome-ignore lint/suspicious/noExplicitAny: test responses are loosely typed JSON
    return { status: r.status, json: text ? (JSON.parse(text) as any) : null };
  };
}
type Call = Awaited<ReturnType<typeof signUp>>;

async function connectGoogle(me: Call, scope?: string) {
  const before = google.state.grantedScope;
  if (scope) google.state.grantedScope = scope;
  const start = await me("/api/integrations/google/connect", { method: "POST", json: {} });
  const state = new URL(start.json.url).searchParams.get("state")!;
  await me(`/api/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`);
  google.state.grantedScope = before;
}

async function toolCall(runId: string, id: string) {
  const [row] = await services.database.db
    .select()
    .from(schema.toolCalls)
    .where(and(eq(schema.toolCalls.runId, runId), eq(schema.toolCalls.id, id)));
  return row!;
}

async function run(runId: string) {
  const [row] = await services.database.db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, runId));
  return row!;
}

test("a grant from before Drive and Contacts keeps working and asks for a reconnect", async () => {
  const ada = await signUp("legacy@gtools.test");
  await connectGoogle(ada, LEGACY_GOOGLE_SCOPE);
  const status = await ada("/api/integrations");
  expect(status.json.google.connection.status).toBe("active");
  expect(status.json.google.connection.missing.map((m: { label: string }) => m.label)).toEqual([
    "Drive",
    "Contacts",
  ]);
  expect(
    status.json.google.tools.find((t: { name: string }) => t.name === "drive_create_doc").group,
  ).toBe("drive");

  // Gmail still works; asking for Drive fails as an unknown tool, and the prompt says why.
  const chat = await ada("/api/chats", { method: "POST", json: { content: "Find the Q3 doc" } });
  script([
    { toolCalls: [{ name: "drive_search", id: "d1", input: { query: "Q3" } }] },
    { text: "Reconnect Google to give me Drive." },
  ]);
  await worker.processNow(chat.json.runId);
  expect((await toolCall(chat.json.runId, "d1")).status).not.toBe("succeeded");
  const prompt = JSON.stringify(model.calls[0]?.prompt);
  expect(prompt).toContain("Drive and Contacts: not granted yet");

  await connectGoogle(ada);
  expect((await ada("/api/integrations")).json.google.connection.missing).toEqual([]);
});

test("“email Sam”: a contact's address goes through the normal approval, no extra warning", async () => {
  const ada = await signUp("contacts@gtools.test");
  await connectGoogle(ada);
  google.state.contacts.push({ name: "Sam Rivera", emails: ["sam@rivera.example"] });
  const chat = await ada("/api/chats", {
    method: "POST",
    json: { content: "Email Sam that the offsite moved to Friday" },
  });
  const send = {
    to: ["sam@rivera.example"],
    subject: "Offsite moved",
    body: "Hi Sam, the offsite is now on Friday.",
  };
  script([
    { toolCalls: [{ name: "contacts_search", id: "c1", input: { query: "Sam" } }] },
    { toolCalls: [{ name: "gmail_send", id: "s1", input: send }] },
    { text: "Sent." },
  ]);
  await worker.processNow(chat.json.runId);
  expect((await toolCall(chat.json.runId, "c1")).status).toBe("succeeded");
  expect(google.state.peopleQueries.slice(0, 2)).toEqual(["contacts:", "other:"]);
  const waiting = await toolCall(chat.json.runId, "s1");
  expect(waiting.status).toBe("awaiting_approval");
  expect(waiting.decisionReason ?? "").not.toContain("New recipient");
  expect((await run(chat.json.runId)).tainted).toBe(false);
});

test("creating a Doc asks first, then uploads it as a Google Doc", async () => {
  const ada = await signUp("docs@gtools.test");
  await connectGoogle(ada);
  await ada("/api/settings", { method: "PUT", json: { undoSeconds: 0 } });
  const chat = await ada("/api/chats", {
    method: "POST",
    json: { content: "Write up the launch plan as a doc" },
  });
  const input = { title: "Launch plan", body: "# Launch\n\n- QA\n- Announce" };
  script([{ toolCalls: [{ name: "drive_create_doc", id: "w1", input }] }, { text: "Created." }]);
  await worker.processNow(chat.json.runId);
  const waiting = await toolCall(chat.json.runId, "w1");
  expect(waiting.status).toBe("awaiting_approval");
  expect(waiting.preview).toBe("Create Google Doc “Launch plan”");
  expect(google.state.createdDocs).toHaveLength(0);

  await ada(`/api/runs/${chat.json.runId}/tool-calls/w1/decision`, {
    method: "POST",
    json: { approved: true },
  });
  await worker.processNow(chat.json.runId);
  const done = await toolCall(chat.json.runId, "w1");
  expect(done.status).toBe("succeeded");
  expect(JSON.stringify(done.output)).toContain("https://docs.google.com/document/d/");
  expect(google.state.createdDocs.map((d) => d.name)).toEqual(["Launch plan"]);
  expect(google.state.createdDocs[0]!.html).toContain("<h1>Launch</h1>");
});
