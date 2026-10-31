import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ToolContext, ToolOutput } from "@synapse/core";
import { createDatabase, type Database, schema } from "@synapse/db";
import type { JSONValue } from "ai";
import { runCodeTool } from "./builtin/code";
import { saveFile } from "./builtin/files";
import { runInSandbox, runSandboxed } from "./builtin/sandbox";
import { tinyPdf } from "./google/testing";

const ok = async (code: string, files: Record<string, string> = {}) => {
  const run = await runInSandbox({ code, files });
  if (!run.ok) throw new Error(run.error);
  return run;
};
const fails = async (code: string, limits?: Parameters<typeof runInSandbox>[0]["limits"]) => {
  const run = await runInSandbox({ code, files: {}, ...(limits ? { limits } : {}) });
  if (run.ok) throw new Error("expected an error");
  return run.error;
};

describe("sandbox", () => {
  test("does exact arithmetic and returns the last expression", async () => {
    expect((await ok("0.1 + 0.2 === 0.3")).result).toBe(false);
    expect((await ok("[19.99, 5.01, 75].reduce((a, b) => a + b, 0)")).result).toBe(100);
    expect(
      (await ok("const d = (new Date('2026-03-01') - new Date('2026-02-01')) / 864e5; d")).result,
    ).toBe(28);
    expect((await ok("({ total: 3, rows: [1, 2] })")).result).toEqual({ total: 3, rows: [1, 2] });
    expect((await ok("let x = 1")).result).toBeUndefined();
  });

  test("a top-level return works too, and its line numbers still match", async () => {
    expect((await ok("const a = 2;\nreturn a * 21;")).result).toBe(42);
    expect(await fails("const a = 1;\nreturn missing + a;")).toBe(
      "ReferenceError: 'missing' is not defined (line 2)",
    );
  });

  test("captures console output", async () => {
    const run = await ok("console.log('total', 3, { a: 1 }); console.error('warn'); 7");
    expect(run.output).toBe('total 3 {"a":1}\nwarn\n');
    expect(run.result).toBe(7);
  });

  test("errors come back with the message and line", async () => {
    expect(await fails("\n\nfoo.bar")).toBe("ReferenceError: 'foo' is not defined (line 3)");
    expect(await fails("x = (")).toStartWith("SyntaxError:");
    expect(await fails("throw new Error('bad row')")).toBe("Error: bad row (line 1)");
  });

  test("csv parses quoted fields, escaped quotes, newlines and CRLF", async () => {
    const text = 'name,amount,note\r\n"Smith, Jo",12.50,"said ""hi"""\r\n\r\nLee,7,"two\nlines"\n';
    expect((await ok("csv(files['a.csv'])", { "a.csv": text })).result).toEqual([
      ["name", "amount", "note"],
      ["Smith, Jo", "12.50", 'said "hi"'],
      ["Lee", "7", "two\nlines"],
    ]);
    expect((await ok("csv('a\\tb\\n1\\t2', '\\t')")).result).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("an infinite loop is interrupted", async () => {
    const start = Date.now();
    expect(await fails("while (true) {}", { timeMs: 300 })).toStartWith(
      "Stopped: the code ran past the time limit",
    );
    expect(Date.now() - start).toBeLessThan(3_000);
  });

  test("a memory blowup and runaway recursion are contained", async () => {
    expect(await fails("const a = []; while (true) a.push('x'.repeat(1000) + a.length)")).toBe(
      "Stopped: the code ran out of memory (64 MB)",
    );
    expect(await fails("'a'.repeat(1e9).length")).toContain("out of memory");
    expect(await fails("function f() { return f() } f()")).toStartWith(
      "InternalError: stack overflow",
    );
    // And the next run starts clean.
    expect((await ok("1 + 1")).result).toBe(2);
  });

  test("has no host globals and keeps no state between calls", async () => {
    const globals = [
      "fetch",
      "require",
      "process",
      "Bun",
      "setTimeout",
      "XMLHttpRequest",
      "std",
      "os",
    ];
    const run = await ok(`[${globals.map((g) => `typeof ${g}`).join(", ")}]`);
    expect(run.result).toEqual(globals.map(() => "undefined"));
    expect((await ok("typeof __print + typeof __save")).result).toBe("undefinedundefined");
    await ok("globalThis.leak = 1");
    expect((await ok("typeof leak")).result).toBe("undefined");
  });

  test("output and results are capped", async () => {
    const run = await ok("for (let i = 0; i < 1e5; i++) console.log('line ' + i)");
    expect(run.output.length).toBe(20_000);
    expect(run.truncated).toBe(true);
    const big = await ok("'y'.repeat(50000)");
    expect(String(big.result)).toEndWith("(truncated; 50002 chars)");
  });

  test("saveFile is capped in count and size", async () => {
    expect((await ok("saveFile('a/b.csv', 'x,y'); 1")).saved).toEqual([
      { name: "a_b.csv", text: "x,y", mimeType: "text/csv" },
    ]);
    expect(await fails("for (let i = 0; i < 6; i++) saveFile('f' + i + '.txt', 'x')")).toContain(
      "At most 5 files",
    );
    expect(await fails("saveFile('big.txt', 'x'.repeat(2 * 1024 * 1024))")).toContain(
      "at most 1048576 bytes",
    );
  });

  test("runs on a worker thread and can be cancelled", async () => {
    expect(await runSandboxed({ code: "6 * 7", files: {} })).toMatchObject({
      ok: true,
      result: 42,
    });
    const controller = new AbortController();
    const pending = runSandboxed({ code: "while (true) {}", files: {} }, controller.signal);
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toEqual({ ok: false, error: "Cancelled", output: "" });
  });
});

describe("run_code tool", () => {
  let database: Database;
  const ctx = (userId: string): ToolContext => ({
    userId,
    chatId: "c",
    runId: "r",
    toolCallId: "t",
    abortSignal: new AbortController().signal,
  });

  beforeAll(async () => {
    database = await createDatabase("pglite://memory");
    await database.migrate();
    await database.db.insert(schema.user).values([
      { id: "u1", name: "Ada", email: "a@x.com" },
      { id: "u2", name: "Eve", email: "e@x.com" },
    ]);
  });
  afterAll(() => database.close());

  const upload = async (
    userId: string,
    name: string,
    mimeType: string,
    data: Uint8Array | string,
  ) =>
    saveFile(database.db, null, {
      userId,
      name,
      mimeType,
      data: typeof data === "string" ? new TextEncoder().encode(data) : data,
    });
  const call = (userId: string, input: JSONValue): Promise<ToolOutput> =>
    runCodeTool(database.db, null).execute(input, ctx(userId));

  test("is a read whose output counts as untrusted, with a short preview", () => {
    const tool = runCodeTool(database.db, null);
    expect(tool.effect).toBe("read");
    expect(tool.untrustedOutput).toBe(true);
    expect(tool.preview!({ code: "\n  const rows = csv(files['sales.csv']);\nrows.length" })).toBe(
      "Run code: const rows = csv(files['sales.csv']);",
    );
  });

  test("sums a CSV the user attached, and reads PDF text", async () => {
    const sheet = await upload(
      "u1",
      "sales.csv",
      "text/csv",
      'item,amount\n"Desk, oak",120.10\nLamp,19.95\n',
    );
    const pdf = await upload("u1", "memo.pdf", "application/pdf", tinyPdf("Budget is 500"));
    const out = await call("u1", {
      code: "const rows = csv(files['sales.csv']).slice(1);\nconsole.log(files['memo.pdf']);\nreturn rows.reduce((s, r) => s + Number(r[1]) * 100, 0) / 100;",
      files: [sheet.id, pdf.id],
    });
    expect(out).toEqual({ type: "json", value: { result: 140.05, output: "Budget is 500\n" } });
  });

  test("someone else's file, and a file without text, are errors", async () => {
    const theirs = await upload("u2", "secret.csv", "text/csv", "a,b\n1,2");
    expect(await call("u1", { code: "files", files: [theirs.id] })).toEqual({
      type: "error",
      value: `No attached file with id ${theirs.id}.`,
    });
    const clip = await upload("u1", "clip.mp4", "video/mp4", new Uint8Array([0, 1, 2]));
    const out = await call("u1", { code: "1", files: [clip.id] });
    expect(out.type).toBe("error");
    expect(JSON.stringify(out)).toContain("clip.mp4 is a video with no text");
  });

  test("saveFile stores a private copy whose id works like an upload", async () => {
    const out = await call("u1", {
      code: "saveFile('totals.csv', 'item,total\\nDesk,120.10\\n'); 'saved'",
    });
    if (out.type !== "json") throw new Error(JSON.stringify(out));
    const value = out.value as { result: string; files: { fileId: string }[] };
    expect(value.result).toBe("saved");
    expect(value.files as unknown[]).toEqual([
      { fileId: expect.any(String), name: "totals.csv", mimeType: "text/csv", bytes: 23 },
    ]);
    const fileId = value.files[0]!.fileId;
    // Read it back through another run, and it's the user's own, not anyone else's.
    expect(await call("u1", { code: "files['totals.csv']", files: [fileId] })).toEqual({
      type: "json",
      value: { result: "item,total\nDesk,120.10" },
    });
    expect((await call("u2", { code: "1", files: [fileId] })).type).toBe("error");
  });

  test("a failing run returns the error and any output before it", async () => {
    expect(await call("u1", { code: "console.log('step 1');\nnull.x" })).toEqual({
      type: "error",
      value:
        "TypeError: cannot read property 'x' of null (line 2)\n\nOutput before the error:\nstep 1\n",
    });
    expect(await call("u1", { code: "let a = 1" })).toEqual({
      type: "json",
      value: { note: "The code ran, returned nothing and printed nothing." },
    });
  });
});
