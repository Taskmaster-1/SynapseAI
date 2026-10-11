import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Effect, ToolDefinition, ToolOutput } from "@synapse/core";
import { type Db, type SecretBox, schema } from "@synapse/db";
import type { JSONSchema7, JSONValue } from "ai";
import { and, eq } from "drizzle-orm";
import { guardedFetch } from "../ssrf";
import { ConnectionOAuthProvider, type OAuthAppConfig } from "./oauth";

type Connection = typeof schema.connections.$inferSelect;

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: JSONSchema7;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

/** Effect from MCP annotations. Per spec, a tool that is not read-only is assumed destructive. */
export function effectFromAnnotations(
  tool: McpToolInfo,
  overrides: Record<string, Effect>,
): Effect {
  if (overrides[tool.name]) return overrides[tool.name]!;
  if (tool.annotations?.readOnlyHint === true) return "read";
  if (tool.annotations?.destructiveHint === false) return "write";
  return "destructive";
}

export function toolName(connection: string, tool: string): string {
  const slug = (s: string) => s.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${slug(connection)}__${slug(tool)}`.slice(0, 64);
}

function toOutput(result: {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}): ToolOutput {
  const parts = Array.isArray(result.content)
    ? (result.content as {
        type: string;
        text?: string;
        resource?: { text?: string; uri?: string };
        mimeType?: string;
      }[])
    : [];
  const text = parts
    .map((p) =>
      p.type === "text"
        ? p.text
        : p.type === "resource"
          ? (p.resource?.text ?? `[resource ${p.resource?.uri ?? ""}]`)
          : `[${p.type}${p.mimeType ? ` ${p.mimeType}` : ""} omitted]`,
    )
    .join("\n");
  if (result.isError) return { type: "error", value: text || "The tool reported an error." };
  if (!text && result.structuredContent !== undefined)
    return { type: "json", value: result.structuredContent as JSONValue };
  return { type: "text", value: text };
}

export interface ConnectResult {
  status: "active" | "needs_auth" | "error";
  authorizationUrl?: string;
  tools?: McpToolInfo[];
  error?: string;
}

const listCache = new Map<string, { at: number; key: string; tools: McpToolInfo[] }>();
const LIST_TTL_MS = 5 * 60_000;

/** Opens MCP sessions for one user's connections. Close it when the run ends. */
export class McpSession {
  private readonly clients = new Map<string, Client>();

  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly app: OAuthAppConfig,
  ) {}

  private async open(
    conn: Connection,
  ): Promise<{ client: Client; provider: ConnectionOAuthProvider | null }> {
    const provider =
      conn.auth.type === "oauth"
        ? await ConnectionOAuthProvider.load(this.db, this.box, conn.id, this.app)
        : null;
    const headers: Record<string, string> = {};
    if (conn.auth.type === "bearer" && conn.auth.secret)
      headers.authorization = `Bearer ${await this.box.open(conn.auth.secret)}`;
    const transport = new StreamableHTTPClientTransport(new URL(conn.url), {
      ...(provider ? { authProvider: provider } : {}),
      requestInit: { headers },
      fetch: (url, init) => guardedFetch(url as string | URL, init),
    });
    const client = new Client({ name: this.app.appName, version: "2.0.0" });
    await client.connect(transport, { timeout: 15_000 });
    return { client, provider };
  }

  /** Connects (or re-checks) a connection and records its status. Used by the connections API. */
  async check(conn: Connection): Promise<ConnectResult> {
    let provider: ConnectionOAuthProvider | null = null;
    try {
      const opened = await this.open(conn);
      provider = opened.provider;
      const { tools } = await opened.client.listTools();
      await opened.client.close();
      await this.db
        .update(schema.connections)
        .set({ status: "active", lastError: null })
        .where(eq(schema.connections.id, conn.id));
      listCache.set(conn.id, {
        at: Date.now(),
        key: cacheKey(conn),
        tools: tools as McpToolInfo[],
      });
      return { status: "active", tools: tools as McpToolInfo[] };
    } catch (error) {
      if (
        error instanceof UnauthorizedError ||
        (conn.auth.type === "oauth" && provider?.authorizationUrl)
      ) {
        await this.db
          .update(schema.connections)
          .set({ status: "needs_auth" })
          .where(eq(schema.connections.id, conn.id));
        const fresh =
          provider ?? (await ConnectionOAuthProvider.load(this.db, this.box, conn.id, this.app));
        return {
          status: "needs_auth",
          ...(fresh.authorizationUrl
            ? { authorizationUrl: fresh.authorizationUrl.toString() }
            : {}),
        };
      }
      // A server that wants OAuth answers 401; switch the connection to OAuth and retry once.
      if (conn.auth.type === "none" && isHttp401(error)) {
        const auth = { type: "oauth" as const };
        await this.db
          .update(schema.connections)
          .set({ auth })
          .where(eq(schema.connections.id, conn.id));
        return this.check({ ...conn, auth });
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.db
        .update(schema.connections)
        .set({ status: "error", lastError: message })
        .where(eq(schema.connections.id, conn.id));
      return { status: "error", error: message };
    }
  }

  /** Completes the OAuth flow from the callback. */
  async finishAuth(conn: Connection, code: string, state: string): Promise<void> {
    const provider = await ConnectionOAuthProvider.load(this.db, this.box, conn.id, this.app);
    if (!state || provider.expectedState() !== state) throw new Error("OAuth state mismatch");
    const transport = new StreamableHTTPClientTransport(new URL(conn.url), {
      authProvider: provider,
      fetch: (url, init) => guardedFetch(url as string | URL, init),
    });
    await transport.finishAuth(code);
  }

  /** Tool definitions for all of a user's active connections. Failing servers are skipped. */
  async tools(userId: string): Promise<ToolDefinition[]> {
    const conns = await this.db
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.userId, userId), eq(schema.connections.status, "active")));
    const out: ToolDefinition[] = [];
    await Promise.all(
      conns.map(async (conn) => {
        try {
          const list = await this.listTools(conn);
          for (const t of list) out.push(this.define(conn, t));
        } catch (error) {
          await this.db
            .update(schema.connections)
            .set({
              status: error instanceof UnauthorizedError ? "needs_auth" : "error",
              lastError: String(error),
            })
            .where(eq(schema.connections.id, conn.id));
        }
      }),
    );
    return out;
  }

  private async client(conn: Connection): Promise<Client> {
    let client = this.clients.get(conn.id);
    if (!client) {
      client = (await this.open(conn)).client;
      this.clients.set(conn.id, client);
    }
    return client;
  }

  /** Tool list for a connection, served from a short-lived cache when fresh. */
  async listTools(conn: Connection): Promise<McpToolInfo[]> {
    const cached = listCache.get(conn.id);
    if (cached && cached.key === cacheKey(conn) && Date.now() - cached.at < LIST_TTL_MS)
      return cached.tools;
    const { tools } = await (await this.client(conn)).listTools();
    listCache.set(conn.id, { at: Date.now(), key: cacheKey(conn), tools: tools as McpToolInfo[] });
    return tools as McpToolInfo[];
  }

  private define(conn: Connection, t: McpToolInfo): ToolDefinition {
    return {
      name: toolName(conn.name, t.name),
      description: `[${conn.name}] ${t.annotations?.title ?? ""} ${t.description ?? ""}`
        .trim()
        .slice(0, 1024),
      inputSchema: t.inputSchema,
      effect: effectFromAnnotations(t, conn.toolEffects),
      untrustedOutput: true,
      source: `mcp:${conn.name}`,
      preview: (input) =>
        `${conn.name}: ${t.annotations?.title ?? t.name} ${JSON.stringify(input).slice(0, 200)}`,
      execute: async (input, ctx) => {
        const client = await this.client(conn);
        const result = await client.callTool(
          { name: t.name, arguments: input as Record<string, unknown> },
          undefined,
          {
            signal: ctx.abortSignal,
            timeout: 120_000,
          },
        );
        return toOutput(result as Parameters<typeof toOutput>[0]);
      },
    };
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
  }
}

function isHttp401(error: unknown): boolean {
  const e = error as { code?: number; message?: string };
  return e?.code === 401 || /\b401\b/.test(e?.message ?? "");
}

function cacheKey(conn: Connection): string {
  return `${conn.url}|${conn.updatedAt.getTime()}`;
}
