import { schema } from "@synapse/db";
import {
  completeLinearAuth,
  disconnectLinear,
  LinearAuthError,
  type LinearTokens,
  linearAuthorizationUrl,
} from "@synapse/tools";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { type AppEnv, apiError } from "../http";
import { log } from "../log";

const NOT_CONFIGURED =
  "Linear isn't set up on this server. Set LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET (see docs/linear.md).";

/** What the Linear integration adds for the agent, for the Connections page. */
const LINEAR_TOOLS = [
  { name: "linear_search", effect: "read", title: "Search issues" },
  { name: "linear_read", effect: "read", title: "Read issues and comments" },
  { name: "linear_my_issues", effect: "read", title: "See your issues" },
  { name: "linear_list_teams", effect: "read", title: "List teams, states, labels" },
  { name: "linear_create_issue", effect: "write", title: "Create issues" },
  { name: "linear_update_issue", effect: "write", title: "Move, assign, relabel" },
  { name: "linear_comment", effect: "send", title: "Comment as you" },
] as const;

/** The signed-in user's Linear connection, for GET /api/integrations. */
export async function linearStatus(c: { var: AppEnv["Variables"] }) {
  const { database, box, config } = c.var.services;
  const [row] = await database.db
    .select()
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.userId, c.var.user.id),
        eq(schema.integrations.provider, "linear"),
      ),
    );
  let workspace: string | null = null;
  let name: string | null = null;
  if (row) {
    try {
      const tokens = JSON.parse(await box.open(row.secret)) as LinearTokens;
      workspace = tokens.workspace;
      name = tokens.userName;
    } catch {
      // Sealed with an older secret: the card still shows the account and asks to reconnect.
    }
  }
  return {
    available: Boolean(config.linear),
    tools: LINEAR_TOOLS,
    connection: row
      ? {
          account: row.account,
          name,
          workspace,
          status: row.status,
          lastError: row.lastError,
          connectedAt: row.createdAt,
        }
      : null,
  };
}

/** Connect and disconnect; behind requireUser. */
export const linearIntegration = new Hono<AppEnv>()
  .post("/connect", async (c) => {
    const linear = c.var.services.config.linear;
    if (!linear) apiError(422, "not_configured", NOT_CONFIGURED);
    return c.json({ url: await linearAuthorizationUrl(linear, c.var.services.box, c.var.user.id) });
  })

  /**
   * Linear's redirect target. It must land in the browser session that started the flow,
   * and the sealed state names that user.
   */
  .get("/callback", async (c) => {
    const { config, database, box } = c.var.services;
    const back = (q: string) => c.redirect(`${config.PUBLIC_URL}/connections?${q}`);
    const code = c.req.query("code");
    const error = c.req.query("error");
    if (!config.linear) return back("error=not_configured");
    if (error || !code)
      return back(
        `error=${encodeURIComponent(error === "access_denied" ? "You cancelled the Linear sign-in." : (error ?? "missing_code"))}`,
      );
    try {
      await completeLinearAuth(config.linear, database.db, box, {
        userId: c.var.user.id,
        code,
        state: c.req.query("state") ?? "",
      });
      return back("connected=linear");
    } catch (e) {
      const message =
        e instanceof LinearAuthError ? e.message : "Linear sign-in failed. Try again.";
      if (!(e instanceof LinearAuthError)) log.warn("linear: oauth failed", { error: String(e) });
      return back(`error=${encodeURIComponent(message)}`);
    }
  })

  .delete("/", async (c) => {
    await disconnectLinear(
      c.var.services.config.linear,
      c.var.services.database.db,
      c.var.services.box,
      c.var.user.id,
    );
    return c.body(null, 204);
  });
