import { schema } from "@synapse/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { type AppEnv, apiError } from "../http";
import { log } from "../log";
import type { SlackInteraction } from "../notify/slack";
import {
  completeSlackAuth,
  disconnectSlack,
  SlackApiError,
  SlackAuthError,
  slackAuthorizationUrl,
  verifySlackSignature,
} from "../notify/slack-api";

const NOT_CONFIGURED =
  "Slack isn't set up on this server. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET (see docs/slack.md).";

/** The signed-in user's Slack connection, for GET /api/integrations. */
export async function slackStatus(c: { var: AppEnv["Variables"] }) {
  const [row] = await c.var.services.database.db
    .select()
    .from(schema.slackAccounts)
    .where(eq(schema.slackAccounts.userId, c.var.user.id));
  return {
    available: Boolean(c.var.services.config.slack),
    connection: row
      ? {
          team: row.teamName,
          status: row.status,
          lastError: row.lastError,
          connectedAt: row.createdAt,
        }
      : null,
  };
}

/** Connect, disconnect and test; behind requireUser. */
export const slackIntegration = new Hono<AppEnv>()
  .post("/connect", async (c) => {
    const slack = c.var.services.config.slack;
    if (!slack) apiError(422, "not_configured", NOT_CONFIGURED);
    return c.json({ url: await slackAuthorizationUrl(slack, c.var.services.box, c.var.user.id) });
  })

  /**
   * Slack's redirect target. It must land in the browser session that started the flow,
   * and the sealed state names that user.
   */
  .get("/callback", async (c) => {
    const { config, database, box } = c.var.services;
    const back = (q: string) => c.redirect(`${config.PUBLIC_URL}/connections?${q}`);
    const code = c.req.query("code");
    const error = c.req.query("error");
    if (!config.slack) return back("error=not_configured");
    if (error || !code)
      return back(
        `error=${encodeURIComponent(error === "access_denied" ? "You cancelled the Slack install." : (error ?? "missing_code"))}`,
      );
    try {
      await completeSlackAuth(config.slack, database.db, box, {
        userId: c.var.user.id,
        code,
        state: c.req.query("state") ?? "",
      });
      return back("connected=slack");
    } catch (e) {
      const message = e instanceof SlackAuthError ? e.message : "Slack sign-in failed. Try again.";
      if (!(e instanceof SlackAuthError)) log.warn("slack: oauth failed", { error: String(e) });
      return back(`error=${encodeURIComponent(message)}`);
    }
  })

  .post("/test", async (c) => {
    const slack = c.var.services.slack;
    if (!slack) apiError(422, "not_configured", NOT_CONFIGURED);
    try {
      if (!(await slack.sendTest(c.var.user.id)))
        apiError(422, "slack_not_connected", "Connect Slack first.");
    } catch (e) {
      if (e instanceof SlackApiError)
        apiError(422, "slack_error", `Slack refused the message (${e.code}). Try reconnecting.`);
      throw e;
    }
    return c.json({ ok: true });
  })

  .delete("/", async (c) => {
    await disconnectSlack(
      c.var.services.config.slack,
      c.var.services.database.db,
      c.var.services.box,
      c.var.user.id,
    );
    return c.body(null, 204);
  });

/** Button clicks are small; anything bigger is not from Slack. */
const MAX_BODY = 64 * 1024;

/**
 * Slack's interactivity Request URL. Public: authenticated by Slack's request signature,
 * checked over the raw body before anything is parsed. Answers at once and does the work
 * afterwards, since Slack gives up after 3 seconds.
 */
export const slackInteractions = new Hono<AppEnv>().post("/", async (c) => {
  const { config, slack: channel } = c.var.services;
  if (!config.slack || !channel) return c.json({ error: { code: "not_configured" } }, 404);
  if (Number(c.req.header("content-length") ?? 0) > MAX_BODY)
    return c.json({ error: { code: "too_large" } }, 413);
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return c.json({ error: { code: "too_large" } }, 413);
  const ok = verifySlackSignature(config.slack.signingSecret, {
    timestamp: c.req.header("x-slack-request-timestamp"),
    signature: c.req.header("x-slack-signature"),
    body: raw,
  });
  if (!ok) return c.json({ error: { code: "unauthorized", message: "Bad signature." } }, 401);

  let payload: SlackInteraction;
  try {
    payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "") as SlackInteraction;
  } catch {
    return c.json({ error: { code: "invalid_request" } }, 400);
  }
  channel.later(() => channel.handleInteraction(payload));
  return c.body(null, 200);
});
