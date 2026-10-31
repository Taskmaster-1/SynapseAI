import { schema } from "@synapse/db";
import {
  completeGitHubAuth,
  disconnectGitHub,
  GitHubAuthError,
  githubAuthorizationUrl,
} from "@synapse/tools";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { type AppEnv, apiError } from "../http";
import { log } from "../log";

const NOT_CONFIGURED =
  "GitHub isn't set up on this server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (see docs/github.md).";

/** What the GitHub integration adds for the agent, for the Connections page. */
const GITHUB_TOOLS = [
  { name: "github_search", effect: "read", title: "Search issues and PRs" },
  { name: "github_read", effect: "read", title: "Read issues and PRs" },
  { name: "github_my_work", effect: "read", title: "See your reviews and assignments" },
  { name: "github_read_file", effect: "read", title: "Read code" },
  { name: "github_comment", effect: "send", title: "Comment as you" },
  { name: "github_create_issue", effect: "write", title: "Open issues" },
  { name: "github_update_issue", effect: "write", title: "Close, label and assign" },
] as const;

/** The signed-in user's GitHub connection, for GET /api/integrations. */
export async function githubStatus(c: { var: AppEnv["Variables"] }) {
  const [row] = await c.var.services.database.db
    .select()
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.userId, c.var.user.id),
        eq(schema.integrations.provider, "github"),
      ),
    );
  return {
    available: Boolean(c.var.services.config.github),
    tools: GITHUB_TOOLS,
    connection: row
      ? {
          /** Their GitHub login. */
          account: row.account,
          status: row.status,
          lastError: row.lastError,
          connectedAt: row.createdAt,
          scopes: row.scopes,
        }
      : null,
  };
}

/** Connect, callback and disconnect; behind requireUser. */
export const githubIntegration = new Hono<AppEnv>()
  .post("/connect", async (c) => {
    const github = c.var.services.config.github;
    if (!github) apiError(422, "not_configured", NOT_CONFIGURED);
    return c.json({
      url: await githubAuthorizationUrl(github, c.var.services.box, c.var.user.id),
    });
  })

  /**
   * GitHub's redirect target. It must land in the browser session that started the flow,
   * and the sealed state names that user.
   */
  .get("/callback", async (c) => {
    const { config, database, box } = c.var.services;
    const back = (q: string) => c.redirect(`${config.PUBLIC_URL}/connections?${q}`);
    const code = c.req.query("code");
    const error = c.req.query("error");
    if (!config.github) return back("error=not_configured");
    if (error || !code)
      return back(
        `error=${encodeURIComponent(
          error === "access_denied"
            ? "You cancelled the GitHub sign-in."
            : error === "redirect_uri_mismatch"
              ? "GitHub doesn't accept this server's callback URL. See docs/github.md."
              : (error ?? "missing_code"),
        )}`,
      );
    try {
      await completeGitHubAuth(config.github, database.db, box, {
        userId: c.var.user.id,
        code,
        state: c.req.query("state") ?? "",
      });
      return back("connected=github");
    } catch (e) {
      const message =
        e instanceof GitHubAuthError ? e.message : "GitHub sign-in failed. Try again.";
      if (!(e instanceof GitHubAuthError)) log.warn("github: oauth failed", { error: String(e) });
      return back(`error=${encodeURIComponent(message)}`);
    }
  })

  .delete("/", async (c) => {
    await disconnectGitHub(
      c.var.services.config.github,
      c.var.services.database.db,
      c.var.services.box,
      c.var.user.id,
    );
    return c.body(null, 204);
  });
