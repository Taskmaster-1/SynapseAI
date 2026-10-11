import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createDatabase, type Database, SecretBox, schema } from "@synapse/db";
import { z } from "zod";
import { chunkText, ingestDocument, searchKnowledge } from "./builtin/knowledge";
import { htmlToText } from "./builtin/web";
import { effectFromAnnotations, McpSession, toolName } from "./mcp/client";
import { assertPublicUrl, isBlockedAddress } from "./ssrf";

describe("ssrf", () => {
  test("blocks private and reserved addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "192.168.0.1",
      "::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "0.0.0.0",
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });

  test("rejects non-http protocols, credentials and literal private IPs", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicUrl("http://user:pw@example.com")).rejects.toThrow();
    await expect(assertPublicUrl("http://[::1]:8080/")).rejects.toThrow();
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
  });
});

test("htmlToText keeps content and drops scripts", () => {
  const text = htmlToText(
    '<html><script>alert(1)</script><h1>Title</h1><p>Hello &amp; <a href="https://x.y">link</a></p></html>',
  );
  expect(text).toContain("Title");
  expect(text).toContain("Hello & link (https://x.y)");
  expect(text).not.toContain("alert");
});

test("chunkText respects size and covers all text", () => {
  const para = "Sentence number one. ".repeat(40);
  const chunks = chunkText(`${para}\n\n${para}\n\n${"x".repeat(4000)}`, 1000, 100);
  expect(chunks.every((c) => c.length <= 1000 + 102)).toBe(true);
  expect(chunks.join("").replace(/\s/g, "").length).toBeGreaterThan(4000);
});

test("MCP effect mapping follows annotations, overrides win", () => {
  const t = (annotations?: object) => ({
    name: "t",
    inputSchema: {},
    ...(annotations ? { annotations } : {}),
  });
  expect(effectFromAnnotations(t({ readOnlyHint: true }), {})).toBe("read");
  expect(effectFromAnnotations(t({ destructiveHint: false }), {})).toBe("write");
  expect(effectFromAnnotations(t(), {})).toBe("destructive");
  expect(effectFromAnnotations(t(), { t: "send" })).toBe("send");
  expect(toolName("My GitHub!", "create.issue")).toBe("My-GitHub__create_issue");
  expect(toolName("github", "x")).not.toBe(toolName("github-", "x"));
});

describe("with a database", () => {
  let database: Database;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    process.env.SYNAPSE_ALLOW_PRIVATE_NETWORK = "true";
    database = await createDatabase("pglite://memory");
    await database.migrate();
    await database.db.insert(schema.user).values({ id: "u1", name: "Ada", email: "a@x.com" });

    // A real MCP server over Streamable HTTP, stateless, one transport per request.
    server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        if (req.headers.get("authorization") !== "Bearer secret-token")
          return new Response("unauthorized", { status: 401 });
        const mcp = new McpServer({ name: "test", version: "1.0.0" });
        mcp.registerTool(
          "list_issues",
          {
            description: "List issues",
            inputSchema: { repo: z.string() },
            annotations: { readOnlyHint: true },
          },
          async ({ repo }) => ({ content: [{ type: "text", text: `#1 bug in ${repo}` }] }),
        );
        mcp.registerTool(
          "close_issue",
          { description: "Close an issue", inputSchema: { id: z.number() } },
          async ({ id }) => ({ content: [{ type: "text", text: `closed #${id}` }] }),
        );
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await mcp.connect(transport);
        return transport.handleRequest(req);
      },
    });
  });

  afterAll(async () => {
    server.stop(true);
    await database.close();
    delete process.env.SYNAPSE_ALLOW_PRIVATE_NETWORK;
  });

  test("MCP tools are discovered, mapped and callable", async () => {
    const box = await SecretBox.fromSecret("s".repeat(32));
    await database.db.insert(schema.connections).values({
      userId: "u1",
      name: "tracker",
      url: `http://127.0.0.1:${server.port}/mcp`,
      status: "active",
      auth: { type: "bearer", secret: await box.seal("secret-token") },
    });
    const session = new McpSession(database.db, box, {
      publicUrl: "http://localhost:3000",
      appName: "SynapseAI test",
    });
    const tools = await session.tools("u1");
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(["tracker__close_issue", "tracker__list_issues"]);
    expect(byName.tracker__list_issues!.effect).toBe("read");
    expect(byName.tracker__close_issue!.effect).toBe("destructive");
    expect(byName.tracker__list_issues!.untrustedOutput).toBe(true);

    const ctx = {
      userId: "u1",
      chatId: "c",
      runId: "r",
      toolCallId: "t",
      abortSignal: new AbortController().signal,
    };
    expect(await byName.tracker__list_issues!.execute({ repo: "synapse" }, ctx)).toEqual({
      type: "text",
      value: "#1 bug in synapse",
    });
    await session.close();
  });

  test("a wrong token marks the connection as needing auth", async () => {
    const box = await SecretBox.fromSecret("s".repeat(32));
    const [conn] = await database.db
      .insert(schema.connections)
      .values({
        userId: "u1",
        name: "broken",
        url: `http://127.0.0.1:${server.port}/mcp`,
        status: "active",
        auth: { type: "bearer", secret: await box.seal("wrong") },
      })
      .returning();
    const session = new McpSession(database.db, box, {
      publicUrl: "http://localhost:3000",
      appName: "t",
    });
    const result = await session.check(conn!);
    expect(result.status).not.toBe("active");
  });

  test("knowledge search (full-text only) finds and ranks passages per user", async () => {
    await ingestDocument(database.db, null, {
      userId: "u1",
      name: "handbook.md",
      mimeType: "text/markdown",
      text: "Our refund policy allows returns within 30 days.\n\nThe office is closed on public holidays.",
    });
    const hits = await searchKnowledge(database.db, null, "u1", "refund policy");
    expect(hits[0]).toMatchObject({ document: "handbook.md" });
    expect(hits[0]!.content).toContain("30 days");
    expect(await searchKnowledge(database.db, null, "someone-else", "refund policy")).toEqual([]);
  });

  test("knowledge search fuses vector and text ranks", async () => {
    const fake = (s: string) => {
      const v = new Array(1536).fill(0);
      v[s.toLowerCase().includes("vacation") || s.toLowerCase().includes("holiday") ? 0 : 1] = 1;
      return v;
    };
    const embedder = {
      one: async (s: string) => fake(s),
      many: async (ss: string[]) => ss.map(fake),
    };
    await ingestDocument(database.db, embedder, {
      userId: "u1",
      name: "leave.md",
      mimeType: "text/markdown",
      text: "Employees get 25 days of paid holiday per year.",
    });
    const hits = await searchKnowledge(database.db, embedder, "u1", "vacation allowance");
    expect(hits[0]!.document).toBe("leave.md");
  });
});
