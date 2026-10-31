import { afterAll, beforeAll, expect, test } from "bun:test";
import { type ScriptedStep, scriptedModel } from "@synapse/core/testing";
import { schema } from "@synapse/db";
import { fakeGoogle, LEGACY_GOOGLE_SCOPE, tinyPdf } from "@synapse/tools/testing";
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

test("a grant from before Drive, Contacts and Sheets keeps working and asks for a reconnect", async () => {
  const ada = await signUp("legacy@gtools.test");
  await connectGoogle(ada, LEGACY_GOOGLE_SCOPE);
  const status = await ada("/api/integrations");
  expect(status.json.google.connection.status).toBe("active");
  expect(status.json.google.connection.missing.map((m: { label: string }) => m.label)).toEqual([
    "Drive",
    "Contacts",
    "Sheets",
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
  expect(prompt).toContain("Drive, Contacts and Sheets: not granted yet");

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

test("“save the invoice PDF and add its total to my sheet”: reads run, the append asks", async () => {
  const ada = await signUp("sheets@gtools.test");
  await connectGoogle(ada);
  await ada("/api/settings", { method: "PUT", json: { undoSeconds: 0 } });
  const id = "1ExPeNsEs0123456789abcdefghij";
  google.state.spreadsheets.push({
    id,
    title: "Expenses",
    sheets: [{ sheetId: 0, title: "Sheet1", rows: [["Date", "Vendor", "Total"]] }],
  });
  const mail = google.receive({
    from: "billing@acme.example",
    subject: "Invoice 4471",
    body: "Your invoice is attached.",
    attachments: [
      { filename: "invoice-4471.pdf", mimeType: "application/pdf", data: tinyPdf("Total 1234.50") },
    ],
  });
  const link = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  const chat = await ada("/api/chats", {
    method: "POST",
    json: {
      content: `Save the invoice PDF from Acme's email and add its total to my sheet ${link}`,
    },
  });
  const append = {
    spreadsheet: link,
    spreadsheetTitle: "Expenses",
    range: "Sheet1",
    rows: [["2026-10-31", "Acme", 1234.5]],
  };
  script([
    { toolCalls: [{ name: "gmail_read_thread", id: "r1", input: { threadId: mail.threadId } }] },
    {
      toolCalls: [
        {
          name: "gmail_save_attachment",
          id: "a1",
          // An id from an earlier fetch: Gmail's change every time, the name still matches.
          input: { messageId: mail.id, attachmentId: "stale", filename: "invoice-4471.pdf" },
        },
        { name: "sheets_read", id: "q1", input: { spreadsheet: link, range: "Sheet1" } },
      ],
    },
    { toolCalls: [{ name: "sheets_append", id: "w1", input: append }] },
    { text: "Added Acme's 1,234.50 to Expenses." },
  ]);
  await worker.processNow(chat.json.runId);
  for (const read of ["r1", "a1", "q1"])
    expect((await toolCall(chat.json.runId, read)).status).toBe("succeeded");
  const saved = (await toolCall(chat.json.runId, "a1")).output as unknown as {
    value: { fileId: string; mimeType: string };
  };
  expect(saved.value.mimeType).toBe("application/pdf");
  const [file] = await services.database.db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, saved.value.fileId));
  expect(file?.text).toContain("Total 1234.50");
  expect((await ada(`/api/files/${saved.value.fileId}`)).status).toBe(200);
  expect((await run(chat.json.runId)).tainted).toBe(true);

  const waiting = await toolCall(chat.json.runId, "w1");
  expect(waiting.status).toBe("awaiting_approval");
  expect(waiting.preview).toBe("Add 1 row to “Expenses” › Sheet1");
  expect(google.state.sheetWrites).toHaveLength(0);
  const [approval] = (await ada("/api/approvals")).json.approvals;
  expect(approval.facts).toEqual(["After reading outside content"]);

  await ada(`/api/runs/${chat.json.runId}/tool-calls/w1/decision`, {
    method: "POST",
    json: { approved: true },
  });
  await worker.processNow(chat.json.runId);
  expect((await toolCall(chat.json.runId, "w1")).status).toBe("succeeded");
  expect(google.state.spreadsheets[0]!.sheets[0]!.rows).toEqual([
    ["Date", "Vendor", "Total"],
    ["2026-10-31", "Acme", 1234.5],
  ]);
  expect(google.state.sheetWrites).toEqual([
    { kind: "append", range: "Sheet1", valueInputOption: "USER_ENTERED" },
  ]);
});
