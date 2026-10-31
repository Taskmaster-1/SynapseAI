import { afterAll, beforeAll, expect, test } from "bun:test";
import { type ScriptedStep, scriptedModel } from "@synapse/core/testing";
import { splitAttachments, withAttachments } from "@synapse/core/ui";
import { schema } from "@synapse/db";
import { buildMime } from "@synapse/tools";
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
  const call = async (
    path: string,
    init: { method?: string; json?: unknown; form?: FormData } = {},
  ) => {
    const r = await app.request(path, {
      method: init.method ?? "GET",
      headers: {
        cookie,
        origin: ORIGIN,
        ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
      ...(init.form ? { body: init.form } : {}),
    });
    const isJson = r.headers.get("content-type")?.includes("json");
    const bytes = new Uint8Array(await r.arrayBuffer());
    return {
      status: r.status,
      headers: r.headers,
      bytes,
      // biome-ignore lint/suspicious/noExplicitAny: test responses are loosely typed JSON
      json: isJson && bytes.length ? (JSON.parse(new TextDecoder().decode(bytes)) as any) : null,
    };
  };
  return call;
}
type Call = Awaited<ReturnType<typeof signUp>>;

async function connectGoogle(me: Call) {
  const start = await me("/api/integrations/google/connect", { method: "POST", json: {} });
  const state = new URL(start.json.url).searchParams.get("state")!;
  await me(`/api/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`);
}

async function upload(me: Call, name: string, type: string, data: Uint8Array | string) {
  const form = new FormData();
  form.append("file", new File([data], name, { type }));
  return me("/api/files", { method: "POST", form });
}

// A 1×1 PNG.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

async function toolCall(runId: string, id: string) {
  const [row] = await services.database.db
    .select()
    .from(schema.toolCalls)
    .where(and(eq(schema.toolCalls.runId, runId), eq(schema.toolCalls.id, id)));
  return row!;
}

test("attachment lines round-trip, and plain messages are left alone", () => {
  const files = [
    { fileId: "f1", name: "Beach (day 2).jpg", mimeType: "image/jpeg", bytes: 2048 },
    { fileId: "f2", name: "clip.mp4", mimeType: "video/mp4", bytes: 9 },
  ];
  const content = withAttachments("Send these to Sam", files);
  expect(splitAttachments(content)).toEqual({
    text: "Send these to Sam",
    files: [{ ...files[0]!, name: "Beach  day 2 .jpg" }, files[1]!],
  });
  expect(splitAttachments("Just text")).toEqual({ text: "Just text", files: [] });
  expect(splitAttachments(withAttachments("", files)).text).toBe("");
});

test("any file uploads, stays private, and only safe types show inline", async () => {
  const ada = await signUp("ada@files.test");
  const eve = await signUp("eve@files.test");

  const photo = await upload(ada, "photo.png", "image/png", PNG);
  expect(photo.status).toBe(201);
  expect(photo.json.file).toMatchObject({
    name: "photo.png",
    mimeType: "image/png",
    bytes: PNG.length,
    documentId: null,
  });
  const id = photo.json.file.id as string;

  const content = await ada(`/api/files/${id}/content`);
  expect(content.status).toBe(200);
  expect(content.headers.get("content-type")).toBe("image/png");
  expect(content.headers.get("content-disposition")).toStartWith("inline");
  expect([...content.bytes]).toEqual([...PNG]);

  // Someone else's file doesn't exist for you.
  expect((await eve(`/api/files/${id}`)).status).toBe(404);
  expect((await eve(`/api/files/${id}/content`)).status).toBe(404);
  expect((await eve(`/api/files/${id}`, { method: "DELETE" })).status).toBe(404);

  // A page someone uploads downloads instead of rendering as one of ours.
  const page = await upload(ada, "x.svg", "image/svg+xml", "<svg onload=alert(1)></svg>");
  const svg = await ada(`/api/files/${page.json.file.id}/content`);
  expect(svg.headers.get("content-type")).toBe("application/octet-stream");
  expect(svg.headers.get("content-disposition")).toStartWith("attachment");
  expect(svg.headers.get("x-content-type-options")).toBe("nosniff");

  expect((await upload(ada, "empty.txt", "text/plain", "")).status).toBe(422);
  const big = new Uint8Array(25 * 1024 * 1024 + 1);
  expect((await upload(ada, "big.mov", "video/quicktime", big)).status).toBe(413);

  expect((await ada(`/api/files/${id}`, { method: "DELETE" })).status).toBe(204);
  expect((await ada(`/api/files/${id}`)).status).toBe(404);
});

test("the agent reads an attached text file, which taints the run", async () => {
  const ada = await signUp("reader@files.test");
  const notes = await upload(
    ada,
    "notes.md",
    "text/markdown",
    "# Q3 plan\n\nShip the inbox redesign by September.",
  );
  expect(notes.json.file.documentId).toBeTruthy();
  const fileId = notes.json.file.id as string;

  const chat = await ada("/api/chats", {
    method: "POST",
    json: {
      content: withAttachments("Summarise this", [
        { fileId, name: "notes.md", mimeType: "text/markdown", bytes: notes.json.file.bytes },
      ]),
    },
  });
  script([
    { toolCalls: [{ name: "file_read", id: "r1", input: { file: fileId } }] },
    { text: "It's the Q3 plan." },
  ]);
  await worker.processNow(chat.json.runId);
  const read = await toolCall(chat.json.runId, "r1");
  expect(read.status).toBe("succeeded");
  expect(JSON.stringify(read.output)).toContain("Ship the inbox redesign");
  const [run] = await services.database.db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, chat.json.runId));
  expect(run!.tainted).toBe(true);
  // The message the model got names the file; its contents only arrive through the tool.
  expect(JSON.stringify(model.calls[0]?.prompt)).toContain(`file ${fileId}`);
  expect(JSON.stringify(model.calls[0]?.prompt)).not.toContain("Ship the inbox redesign");
});

test("an approved email carries the attached photo and document", async () => {
  const ada = await signUp("sender@files.test");
  await connectGoogle(ada);
  await ada("/api/settings", { method: "PUT", json: { undoSeconds: 0 } });
  const photo = (await upload(ada, "beach.png", "image/png", PNG)).json.file;
  const doc = (await upload(ada, "itinerary.txt", "text/plain", "Day 1: arrive")).json.file;

  const chat = await ada("/api/chats", { method: "POST", json: { content: "Send them to Sam" } });
  const input = {
    to: ["sam@x.com"],
    subject: "Trip",
    body: "Photos attached.",
    attachments: [photo.id, doc.id],
  };
  script([{ toolCalls: [{ name: "gmail_send", id: "s1", input }] }, { text: "Sent." }]);
  await worker.processNow(chat.json.runId);
  const waiting = await toolCall(chat.json.runId, "s1");
  expect(waiting.status).toBe("awaiting_approval");
  expect(waiting.preview).toBe("Email sam@x.com: Trip · 2 attachments");

  const before = google.state.uploads;
  await ada(`/api/runs/${chat.json.runId}/tool-calls/s1/decision`, {
    method: "POST",
    json: { approved: true },
  });
  await worker.processNow(chat.json.runId);
  const sent = await toolCall(chat.json.runId, "s1");
  expect(sent.status).toBe("succeeded");
  expect(JSON.stringify(sent.output)).toContain("beach.png");
  expect(google.state.uploads).toBe(before + 1);

  const raw = google.state.messages.at(-1)!.raw!;
  expect(raw).toContain("Content-Type: multipart/mixed");
  expect(raw).toContain('Content-Disposition: attachment; filename="beach.png"');
  expect(raw).toContain('Content-Disposition: attachment; filename="itinerary.txt"');
  expect(raw.replace(/\r\n/g, "")).toContain(Buffer.from(PNG).toString("base64"));
});

test("an email can't attach someone else's file", async () => {
  const eve = await signUp("eve2@files.test");
  const theirs = (
    await upload(await signUp("victim@files.test"), "secret.pdf", "application/pdf", "%PDF-1.4")
  ).json.file;
  await connectGoogle(eve);
  await eve("/api/settings", { method: "PUT", json: { undoSeconds: 0 } });
  const chat = await eve("/api/chats", { method: "POST", json: { content: "Send it" } });
  const input = { to: ["eve@evil.example"], subject: "x", body: "x", attachments: [theirs.id] };
  script([{ toolCalls: [{ name: "gmail_send", id: "s1", input }] }, { text: "Couldn't." }]);
  await worker.processNow(chat.json.runId);
  await eve(`/api/runs/${chat.json.runId}/tool-calls/s1/decision`, {
    method: "POST",
    json: { approved: true },
  });
  await worker.processNow(chat.json.runId);
  const call = await toolCall(chat.json.runId, "s1");
  expect(JSON.stringify(call.output)).toContain(`No attached file with id ${theirs.id}`);
});

test("plain emails still use the JSON API and a single text part", () => {
  const mime = buildMime({ to: ["a@b.c"], subject: "Hi", body: "Hello" });
  expect(mime).not.toContain("multipart");
  expect(mime).toContain("Content-Type: text/plain; charset=UTF-8");
});

test("browser types with parameters are stored plain", async () => {
  const ada = await signUp("types@files.test");
  const res = await upload(ada, "a.txt", "text/plain;charset=utf-8", "hello");
  expect(res.json.file.mimeType).toBe("text/plain");
  const line = withAttachments("x", [
    { fileId: "f", name: "a.txt", mimeType: "text/plain;charset=utf-8", bytes: 5 },
  ]);
  expect(splitAttachments(line).files[0]?.mimeType).toBe("text/plain");
});

test("the agent sees an attached photo; the stored history keeps only its id", async () => {
  const ada = await signUp("looker@files.test");
  const photo = (await upload(ada, "receipt.png", "image/png", PNG)).json.file;
  const clip = (await upload(ada, "clip.mp4", "video/mp4", "not really a video")).json.file;
  const chat = await ada("/api/chats", { method: "POST", json: { content: "What's this?" } });
  script([
    {
      toolCalls: [
        { name: "file_read", id: "p1", input: { file: photo.id } },
        { name: "file_read", id: "v1", input: { file: clip.id } },
      ],
    },
    { text: "A receipt." },
  ]);
  await worker.processNow(chat.json.runId);

  expect((await toolCall(chat.json.runId, "p1")).output).toEqual({
    type: "image",
    fileId: photo.id,
    name: "receipt.png",
    mimeType: "image/png",
    bytes: PNG.length,
  });
  expect(JSON.stringify((await toolCall(chat.json.runId, "v1")).output)).toContain(
    "can be attached to an email",
  );

  // The second model call got the photo's bytes as an image part.
  const prompt = model.calls[1]!.prompt as { role: string; content: unknown }[];
  const result = prompt
    .filter((m) => m.role === "tool")
    .flatMap((m) => m.content as { toolCallId: string; output: { type: string; value: unknown } }[])
    .find((r) => r.toolCallId === "p1")!;
  expect(result.output.type).toBe("content");
  const file = (result.output.value as { type: string; data?: unknown; mediaType?: string }[]).find(
    (p) => p.type === "file" || p.type === "image-data" || p.type === "file-data",
  )!;
  expect(file.mediaType).toBe("image/png");
  expect(file.data).toEqual({ type: "data", data: PNG });

  // Neither the database nor the event stream carries the image itself.
  const rows = await services.database.db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chat.json.chatId));
  expect(JSON.stringify(rows)).not.toContain(Buffer.from(PNG).toString("base64"));
});

test("run_code totals an attached CSV and saves a file the user can open", async () => {
  const ada = await signUp("coder@files.test");
  const eve = await signUp("eve3@files.test");
  const csv = 'item,amount\n"Hotel, 2 nights",412.30\nTaxi,38.75\n';
  const sheet = (await upload(ada, "expenses.csv", "text/csv", csv)).json.file;
  const chat = await ada("/api/chats", { method: "POST", json: { content: "Total these up" } });
  const code = [
    "const rows = csv(files['expenses.csv']).slice(1);",
    "const total = rows.reduce((s, r) => s + Math.round(Number(r[1]) * 100), 0) / 100;",
    "saveFile('total.txt', 'Total: ' + total);",
    "return total;",
  ].join("\n");
  script([
    { toolCalls: [{ name: "run_code", id: "c1", input: { code, files: [sheet.id] } }] },
    { text: "The total is 451.05." },
  ]);
  await worker.processNow(chat.json.runId);
  const call = await toolCall(chat.json.runId, "c1");
  expect(call.status).toBe("succeeded");
  expect(call.preview).toBe("Run code: const rows = csv(files['expenses.csv']).slice(1);");
  const value = (call.output as { value: unknown }).value as {
    result: number;
    files: { fileId: string }[];
  };
  expect(value.result).toBe(451.05);

  const saved = value.files[0]!.fileId;
  const content = await ada(`/api/files/${saved}/content`);
  expect(new TextDecoder().decode(content.bytes)).toBe("Total: 451.05");
  expect((await eve(`/api/files/${saved}`)).status).toBe(404);
  // The CSV's content flowed through, so the run counts as having read outside content.
  const [run] = await services.database.db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, chat.json.runId));
  expect(run!.tainted).toBe(true);
});
