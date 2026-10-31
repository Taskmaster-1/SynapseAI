import { createHmac, timingSafeEqual } from "node:crypto";
import { type Db, type SecretBox, schema } from "@synapse/db";
import { SLACK_USER_SCOPES } from "@synapse/tools";
import { and, eq, ne } from "drizzle-orm";

/** Bot scopes: post and update DMs, open the DM with the person who connected. */
export const SLACK_SCOPES = ["chat:write", "im:write", "users:read"];

const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const API = "https://slack.com/api";

export interface SlackAppConfig {
  clientId: string;
  clientSecret: string;
  /** Verifies that interactions really come from Slack. */
  signingSecret: string;
  /** Slack redirects to <publicUrl>/api/integrations/slack/callback. */
  publicUrl: string;
  /** Test hook. Defaults to global fetch. */
  fetch?: typeof fetch;
}

export class SlackAuthError extends Error {}

/** A Slack Web API call that came back `ok: false`. */
export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
  ) {
    super(`Slack ${method} failed: ${code}`);
  }
}

interface FlowState {
  userId: string;
  exp: number;
}

export function slackRedirectUri(app: SlackAppConfig): string {
  return `${app.publicUrl}/api/integrations/slack/callback`;
}

/** The URL that starts the install. The user it belongs to is sealed into `state`. */
export async function slackAuthorizationUrl(
  app: SlackAppConfig,
  box: SecretBox,
  userId: string,
): Promise<string> {
  const state = await box.seal(
    JSON.stringify({ userId, exp: Date.now() + 10 * 60_000 } satisfies FlowState),
  );
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: app.clientId,
    scope: SLACK_SCOPES.join(","),
    // A user token too, so the agent's Slack tools can search, read and post as this person.
    user_scope: SLACK_USER_SCOPES.join(","),
    redirect_uri: slackRedirectUri(app),
    state,
  }).toString();
  return url.toString();
}

interface OAuthAccess {
  ok: boolean;
  error?: string;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  team?: { id: string; name: string };
  authed_user?: { id: string; scope?: string; access_token?: string };
}

/** Exchanges the callback code and saves the Slack account for the user who started it. */
export async function completeSlackAuth(
  app: SlackAppConfig,
  db: Db,
  box: SecretBox,
  args: { userId: string; code: string; state: string },
): Promise<{ team: string }> {
  let flow: FlowState;
  try {
    flow = JSON.parse(await box.open(args.state)) as FlowState;
  } catch {
    throw new SlackAuthError("This Slack link is invalid. Try connecting again.");
  }
  if (flow.userId !== args.userId)
    throw new SlackAuthError("This Slack link belongs to another user.");
  if (flow.exp < Date.now())
    throw new SlackAuthError("This Slack link expired. Try connecting again.");

  const res = await (app.fetch ?? fetch)(`${API}/oauth.v2.access`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: args.code,
      redirect_uri: slackRedirectUri(app),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = (await res.json()) as OAuthAccess;
  if (!token.ok || !token.access_token || !token.team || !token.authed_user?.id)
    throw new SlackAuthError(`Slack sign-in failed: ${token.error ?? `HTTP ${res.status}`}`);
  const granted = (token.scope ?? "").split(",");
  if (SLACK_SCOPES.some((s) => !granted.includes(s)))
    throw new SlackAuthError("Slack did not grant the permissions Synapse needs. Try again.");

  // One Slack person answers for one Synapse user.
  const [taken] = await db
    .select({ userId: schema.slackAccounts.userId })
    .from(schema.slackAccounts)
    .where(
      and(
        eq(schema.slackAccounts.teamId, token.team.id),
        eq(schema.slackAccounts.slackUserId, token.authed_user.id),
        ne(schema.slackAccounts.userId, args.userId),
      ),
    );
  if (taken)
    throw new SlackAuthError("That Slack account is already connected to another Synapse user.");

  // Without every user scope the agent's Slack tools stay off; approvals in Slack still work.
  const user = token.authed_user;
  const userGranted = (user.scope ?? "").split(",");
  const userToken =
    user.access_token && SLACK_USER_SCOPES.every((s) => userGranted.includes(s))
      ? await box.seal(user.access_token)
      : null;

  const values = {
    teamId: token.team.id,
    teamName: token.team.name,
    slackUserId: token.authed_user.id,
    botUserId: token.bot_user_id ?? null,
    botToken: await box.seal(token.access_token),
    scopes: token.scope ?? "",
    userToken,
    userScopes: userToken ? (user.scope ?? "") : "",
    status: "active" as const,
    lastError: null,
  };
  await db
    .insert(schema.slackAccounts)
    .values({ userId: args.userId, ...values })
    .onConflictDoUpdate({ target: schema.slackAccounts.userId, set: values });
  return { team: token.team.name };
}

/**
 * Deletes the user's Slack account. The user token is always revoked at Slack; the bot token
 * is too unless someone else on this server uses the same workspace install (Slack issues
 * one bot token per workspace).
 */
export async function disconnectSlack(
  app: SlackAppConfig | null,
  db: Db,
  box: SecretBox,
  userId: string,
) {
  const [row] = await db
    .select()
    .from(schema.slackAccounts)
    .where(eq(schema.slackAccounts.userId, userId));
  if (!row) return;
  const [shared] = await db
    .select({ userId: schema.slackAccounts.userId })
    .from(schema.slackAccounts)
    .where(
      and(eq(schema.slackAccounts.teamId, row.teamId), ne(schema.slackAccounts.userId, userId)),
    );
  const revoke = [...(row.userToken ? [row.userToken] : []), ...(shared ? [] : [row.botToken])];
  if (app)
    for (const sealed of revoke) {
      try {
        await slackCall(app, await box.open(sealed), "auth.revoke", {});
      } catch {
        // Revocation is a courtesy; the token is deleted either way.
      }
    }
  await db.delete(schema.slackAccounts).where(eq(schema.slackAccounts.userId, userId));
}

/** Calls a Slack Web API method with a bot token; throws SlackApiError when `ok` is false. */
export async function slackCall<T = Record<string, unknown>>(
  app: SlackAppConfig,
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await (app.fetch ?? fetch)(`${API}/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))) as {
    ok: boolean;
    error?: string;
  };
  if (!json.ok) throw new SlackApiError(method, json.error ?? `http_${res.status}`);
  return json as T;
}

/** Posts to an interaction's `response_url` (no token; Slack scopes the URL to the message). */
export async function slackRespond(app: SlackAppConfig, responseUrl: string, body: unknown) {
  const url = new URL(responseUrl);
  // Only ever post back to Slack, whatever the (signed) payload says.
  if (url.protocol !== "https:" || !/(^|\.)slack\.com$/.test(url.hostname)) return;
  await (app.fetch ?? fetch)(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

/** Requests older than this are refused, so a captured request can't be replayed later. */
export const MAX_SKEW_SECONDS = 5 * 60;

/**
 * Checks Slack's request signature: `v0=` + hex HMAC-SHA256 of `v0:<timestamp>:<raw body>`
 * keyed with the signing secret, compared in constant time.
 */
export function verifySlackSignature(
  signingSecret: string,
  args: { timestamp: string | undefined; signature: string | undefined; body: string },
  now = Date.now(),
): boolean {
  const { timestamp, signature, body } = args;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(
    `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`,
  );
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Signs a request body the way Slack does. For tests and the fake. */
export function signSlackRequest(signingSecret: string, body: string, timestamp: number) {
  return `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}
