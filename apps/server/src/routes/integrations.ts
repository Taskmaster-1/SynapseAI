import { schema } from "@synapse/db";
import {
  completeGoogleAuth,
  disconnectGoogle,
  GoogleAuthError,
  googleAuthorizationUrl,
} from "@synapse/tools";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { type AppEnv, apiError } from "../http";
import { slackStatus } from "./slack";

/** What the Google integration adds, for the Connections page. */
const GOOGLE_TOOLS = [
  { name: "gmail_search", effect: "read", title: "Search email" },
  { name: "gmail_read_thread", effect: "read", title: "Read a conversation" },
  { name: "gmail_create_draft", effect: "write", title: "Save a draft" },
  { name: "gmail_organize", effect: "write", title: "Label, archive, mark read" },
  { name: "gmail_send", effect: "send", title: "Send email" },
  { name: "gmail_trash", effect: "destructive", title: "Move to trash" },
  { name: "calendar_list_events", effect: "read", title: "See your calendar" },
  { name: "calendar_create_event", effect: "send", title: "Create events and invite" },
  { name: "calendar_update_event", effect: "send", title: "Change events" },
  { name: "calendar_respond", effect: "send", title: "Answer invitations" },
  { name: "calendar_delete_event", effect: "destructive", title: "Delete events" },
] as const;

export const integrations = new Hono<AppEnv>()
  .get("/", async (c) => {
    const [google] = await c.var.services.database.db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.userId, c.var.user.id),
          eq(schema.integrations.provider, "google"),
        ),
      );
    return c.json({
      google: {
        available: Boolean(c.var.services.config.google),
        tools: GOOGLE_TOOLS,
        connection: google
          ? {
              account: google.account,
              status: google.status,
              lastError: google.lastError,
              connectedAt: google.createdAt,
            }
          : null,
      },
      slack: await slackStatus(c),
    });
  })

  .post("/google/connect", async (c) => {
    const google = c.var.services.config.google;
    if (!google)
      apiError(
        422,
        "not_configured",
        "Google isn't set up on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see docs/google.md).",
      );
    const url = await googleAuthorizationUrl(
      google,
      c.var.services.box,
      c.var.user.id,
      c.var.user.email,
    );
    return c.json({ url });
  })

  .delete("/google", async (c) => {
    await disconnectGoogle(
      c.var.services.config.google,
      c.var.services.database.db,
      c.var.services.box,
      c.var.user.id,
    );
    return c.body(null, 204);
  });

/**
 * Google's redirect target. Behind requireUser: it must land in the browser session that
 * started the flow, and the sealed state names that user.
 */
export const googleCallback = new Hono<AppEnv>().get("/", async (c) => {
  const { config, database, box } = c.var.services;
  const web = config.PUBLIC_URL;
  const back = (q: string) => c.redirect(`${web}/connections?${q}`);
  const code = c.req.query("code");
  const error = c.req.query("error");
  if (!config.google) return back("error=not_configured");
  if (error || !code)
    return back(
      `error=${encodeURIComponent(error === "access_denied" ? "You cancelled the Google sign-in." : (error ?? "missing_code"))}`,
    );
  try {
    await completeGoogleAuth(config.google, database.db, box, {
      userId: c.var.user.id,
      code,
      state: c.req.query("state") ?? "",
    });
    return back("connected=google");
  } catch (e) {
    const message = e instanceof GoogleAuthError ? e.message : "Google sign-in failed. Try again.";
    return back(`error=${encodeURIComponent(message)}`);
  }
});
