import { schema } from "@synapse/db";
import {
  completeGoogleAuth,
  disconnectGoogle,
  GOOGLE_SCOPE_GROUPS,
  GoogleAuthError,
  type GoogleScopeGroup,
  googleAuthorizationUrl,
  missingGoogleGroups,
} from "@synapse/tools";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { type AppEnv, apiError } from "../http";
import { slackStatus } from "./slack";

/** What the Google integration adds, for the Connections page, by the scope group it needs. */
const GOOGLE_TOOLS = [
  { name: "gmail_search", group: "gmail", effect: "read", title: "Search email" },
  { name: "gmail_read_thread", group: "gmail", effect: "read", title: "Read a conversation" },
  { name: "gmail_create_draft", group: "gmail", effect: "write", title: "Save a draft" },
  { name: "gmail_organize", group: "gmail", effect: "write", title: "Label, archive, mark read" },
  { name: "gmail_send", group: "gmail", effect: "send", title: "Send email" },
  { name: "gmail_trash", group: "gmail", effect: "destructive", title: "Move to trash" },
  { name: "calendar_list_events", group: "calendar", effect: "read", title: "See your calendar" },
  { name: "calendar_find_free_time", group: "calendar", effect: "read", title: "Find free time" },
  {
    name: "calendar_create_event",
    group: "calendar",
    effect: "send",
    title: "Create events and invite",
  },
  { name: "calendar_update_event", group: "calendar", effect: "send", title: "Change events" },
  { name: "calendar_respond", group: "calendar", effect: "send", title: "Answer invitations" },
  {
    name: "calendar_delete_event",
    group: "calendar",
    effect: "destructive",
    title: "Delete events",
  },
  { name: "drive_search", group: "drive", effect: "read", title: "Search Drive" },
  { name: "drive_read", group: "drive", effect: "read", title: "Read Docs, Sheets, PDFs" },
  { name: "drive_create_doc", group: "drive", effect: "write", title: "Create Google Docs" },
  { name: "contacts_search", group: "contacts", effect: "read", title: "Look up contacts" },
] as const satisfies readonly {
  name: string;
  group: GoogleScopeGroup;
  effect: string;
  title: string;
}[];

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
              // Granted before these tools existed (or a box was unticked): reconnect to add.
              missing: missingGoogleGroups(google.scopes).map((g) => ({
                group: g,
                label: GOOGLE_SCOPE_GROUPS[g].label,
              })),
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
