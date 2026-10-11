import { schema } from "@synapse/db";
import { assertPublicUrl, clientMetadata, effectFromAnnotations, McpSession } from "@synapse/tools";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, apiError, body } from "../http";

const Effect = z.enum(["read", "write", "send", "destructive"]);

/** Well-known remote MCP servers. Users can add any other URL. */
export const PRESETS = [
  {
    name: "github",
    url: "https://api.githubcopilot.com/mcp/",
    description: "Repositories, issues, pull requests",
    docs: "https://github.com/github/github-mcp-server",
  },
  {
    name: "linear",
    url: "https://mcp.linear.app/mcp",
    description: "Issues, projects, cycles",
    docs: "https://linear.app/docs/mcp",
  },
  {
    name: "notion",
    url: "https://mcp.notion.com/mcp",
    description: "Pages and databases",
    docs: "https://developers.notion.com/docs/mcp",
  },
  {
    name: "atlassian",
    url: "https://mcp.atlassian.com/v1/mcp",
    description: "Jira and Confluence",
    docs: "https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/",
  },
  {
    name: "sentry",
    url: "https://mcp.sentry.dev/mcp",
    description: "Errors and issues",
    docs: "https://docs.sentry.io/product/sentry-mcp/",
  },
];

export const connections = new Hono<AppEnv>()
  .get("/presets", (c) => c.json({ presets: PRESETS }))

  .get("/", async (c) => {
    const { db } = c.var.services.database;
    const rows = await db
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.userId, c.var.user.id))
      .orderBy(asc(schema.connections.createdAt));
    const session = new McpSession(db, c.var.services.box, c.var.services.toolset.app);
    const withTools = await Promise.all(
      rows.map(async (r) => {
        let tools:
          | {
              name: string;
              title: string | null;
              description: string | null;
              effect: z.infer<typeof Effect>;
            }[]
          | null = null;
        if (r.status === "active") {
          const list = await session.listTools(r).catch(() => null);
          tools =
            list?.map((t) => ({
              name: t.name,
              title: t.annotations?.title ?? null,
              description: t.description ?? null,
              effect: effectFromAnnotations(t, r.toolEffects),
            })) ?? null;
        }
        return {
          id: r.id,
          name: r.name,
          url: r.url,
          status: r.status,
          authType: r.auth.type,
          lastError: r.lastError,
          toolEffects: r.toolEffects,
          tools,
        };
      }),
    );
    await session.close();
    return c.json({ connections: withTools });
  })

  .post("/", async (c) => {
    const input = await body(
      c,
      z.object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(40)
          // No underscores: tool names are "<connection>__<tool>", so they must stay unambiguous.
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9 -]*$/, "letters, numbers, spaces and - only"),
        url: z.string().url(),
        token: z.string().min(1).max(4000).optional(),
      }),
    );
    try {
      await assertPublicUrl(input.url);
    } catch (error) {
      apiError(422, "blocked_url", error instanceof Error ? error.message : "URL not allowed");
    }
    const { db } = c.var.services.database;
    const box = c.var.services.box;
    const [existing] = await db
      .select({ id: schema.connections.id })
      .from(schema.connections)
      .where(
        and(eq(schema.connections.userId, c.var.user.id), eq(schema.connections.name, input.name)),
      );
    if (existing) apiError(409, "conflict", `A connection named "${input.name}" already exists.`);

    const [conn] = await db
      .insert(schema.connections)
      .values({
        userId: c.var.user.id,
        name: input.name,
        url: input.url,
        status: "needs_auth",
        auth: input.token
          ? { type: "bearer", secret: await box.seal(input.token) }
          : { type: "none" },
      })
      .returning();
    const session = new McpSession(db, box, c.var.services.toolset.app);
    const result = await session.check(conn!);
    await session.close();
    return c.json(
      {
        connection: {
          id: conn!.id,
          name: conn!.name,
          url: conn!.url,
          status: result.status,
          lastError: result.error ?? null,
        },
        ...(result.authorizationUrl ? { authorizationUrl: result.authorizationUrl } : {}),
      },
      201,
    );
  })

  .post("/:id/check", async (c) => {
    const conn = await ownConnection(c, c.req.param("id"));
    const session = new McpSession(
      c.var.services.database.db,
      c.var.services.box,
      c.var.services.toolset.app,
    );
    const result = await session.check(conn);
    await session.close();
    return c.json({
      status: result.status,
      ...(result.authorizationUrl ? { authorizationUrl: result.authorizationUrl } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  })

  .patch("/:id", async (c) => {
    const input = await body(
      c,
      z.object({
        toolEffects: z.record(z.string(), Effect).optional(),
        status: z.enum(["active", "disabled"]).optional(),
      }),
    );
    const conn = await ownConnection(c, c.req.param("id"));
    const [updated] = await c.var.services.database.db
      .update(schema.connections)
      .set({
        ...(input.toolEffects ? { toolEffects: input.toolEffects } : {}),
        ...(input.status ? { status: input.status } : {}),
      })
      .where(eq(schema.connections.id, conn.id))
      .returning();
    return c.json({
      connection: {
        id: updated!.id,
        name: updated!.name,
        status: updated!.status,
        toolEffects: updated!.toolEffects,
      },
    });
  })

  .delete("/:id", async (c) => {
    const conn = await ownConnection(c, c.req.param("id"));
    await c.var.services.database.db
      .delete(schema.connections)
      .where(eq(schema.connections.id, conn.id));
    return c.body(null, 204);
  });

/**
 * OAuth redirect target. Mounted behind requireUser: the callback must arrive in the same
 * browser session that started it, and `state` must match the connection's saved state.
 */
export const oauthCallback = new Hono<AppEnv>().get("/", async (c) => {
  const web = c.var.services.config.PUBLIC_URL;
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  const error = c.req.query("error");
  if (error || !code)
    return c.redirect(`${web}/connections?error=${encodeURIComponent(error ?? "missing_code")}`);
  const connectionId = state.split(".")[0] ?? "";
  try {
    const conn = await ownConnection(c, connectionId);
    const session = new McpSession(
      c.var.services.database.db,
      c.var.services.box,
      c.var.services.toolset.app,
    );
    await session.finishAuth(conn, code, state);
    await session.check({ ...conn, auth: { ...conn.auth, type: "oauth" } });
    await session.close();
    return c.redirect(`${web}/connections?connected=${encodeURIComponent(conn.id)}`);
  } catch (e) {
    return c.redirect(
      `${web}/connections?error=${encodeURIComponent(e instanceof Error ? e.message : "oauth_failed")}`,
    );
  }
});

export function clientMetadataDocument(c: { var: AppEnv["Variables"] }) {
  return clientMetadata(c.var.services.toolset.app);
}

async function ownConnection(c: { var: AppEnv["Variables"] }, id: string) {
  const [conn] = await c.var.services.database.db
    .select()
    .from(schema.connections)
    .where(and(eq(schema.connections.id, id), eq(schema.connections.userId, c.var.user.id)));
  if (!conn) apiError(404, "not_found", "Connection not found.");
  return conn;
}
