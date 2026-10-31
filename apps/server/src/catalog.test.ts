import { afterAll, beforeAll, expect, test } from "bun:test";
import { schema } from "@synapse/db";
import { createApp } from "./app";
import { APP_CATEGORIES, CATALOG, catalogAppFor, sameServer } from "./catalog";
import { loadConfig } from "./config";
import { createServices, type Services } from "./services";

let services: Services;
let app: ReturnType<typeof createApp>;
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
});
afterAll(() => services.close());

async function signUp(email: string) {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password: "correct horse battery", name: "Ada" }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const userId = ((await res.json()) as { user: { id: string } }).user.id;
  const call = async (path: string, method = "GET") => {
    const r = await app.request(path, { method, headers: { cookie, origin: ORIGIN } });
    const text = await r.text();
    // biome-ignore lint/suspicious/noExplicitAny: test responses are loosely typed JSON
    return { status: r.status, json: text ? (JSON.parse(text) as Record<string, any>) : null };
  };
  return { userId, call };
}

test("every directory entry is connectable as listed", () => {
  const ids = new Set<string>();
  for (const a of CATALOG) {
    // The id becomes the connection name: the same rule POST /api/connections enforces.
    expect(a.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(ids.has(a.id)).toBe(false);
    ids.add(a.id);
    expect(new URL(a.url).protocol).toBe("https:");
    expect(APP_CATEGORIES).toContain(a.category);
    expect(a.examples.length).toBeGreaterThan(0);
    expect(CATALOG.filter((b) => sameServer(a.url, b.url))).toHaveLength(1);
  }
  for (const c of APP_CATEGORIES) expect(CATALOG.some((a) => a.category === c)).toBe(true);
});

test("sameServer ignores host case and trailing slashes, nothing else", () => {
  expect(sameServer("https://mcp.notion.com/mcp", "https://MCP.notion.com/mcp/")).toBe(true);
  expect(sameServer("https://mcp.stripe.com", "https://mcp.stripe.com/")).toBe(true);
  expect(sameServer("https://mcp.notion.com/mcp", "https://mcp.notion.com/sse")).toBe(false);
  expect(sameServer("https://mcp.notion.com/mcp", "http://mcp.notion.com/mcp")).toBe(false);
  expect(catalogAppFor("https://mcp.notion.com/mcp/")?.id).toBe("notion");
});

test("directory marks what you've connected; connecting twice or unknown apps is refused", async () => {
  const ada = await signUp("ada-directory@example.com");
  const bob = await signUp("bob-directory@example.com");

  const before = await ada.call("/api/connections/catalog");
  expect(before.status).toBe(200);
  expect(before.json!.categories).toEqual(APP_CATEGORIES);
  expect(before.json!.apps).toHaveLength(CATALOG.length);
  expect(before.json!.apps.every((a: { connectionId: unknown }) => a.connectionId === null)).toBe(
    true,
  );

  // Connected earlier by hand, under another name and a slightly different URL.
  const [row] = await services.database.db
    .insert(schema.connections)
    .values({
      userId: ada.userId,
      name: "my notes",
      url: "https://MCP.notion.com/mcp/",
      status: "disabled",
      auth: { type: "none" },
    })
    .returning();

  const after = await ada.call("/api/connections/catalog");
  const notion = after.json!.apps.find((a: { id: string }) => a.id === "notion");
  expect(notion.connectionId).toBe(row!.id);
  // Someone else's connections don't count.
  const theirs = await bob.call("/api/connections/catalog");
  expect(theirs.json!.apps.find((a: { id: string }) => a.id === "notion").connectionId).toBe(null);

  const again = await ada.call("/api/connections/catalog/notion", "POST");
  expect(again.status).toBe(409);
  expect(again.json!.error.message).toContain("Notion is already connected");

  const unknown = await ada.call("/api/connections/catalog/not-an-app", "POST");
  expect(unknown.status).toBe(404);

  // The connection list names it the way the directory does and carries its starter asks.
  const list = await ada.call("/api/connections");
  expect(list.json!.connections[0]).toMatchObject({
    name: "my notes",
    title: "Notion",
    examples: CATALOG.find((a) => a.id === "notion")!.examples,
  });
});
