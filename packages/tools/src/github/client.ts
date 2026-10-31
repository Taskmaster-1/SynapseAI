import { type Db, type SecretBox, schema } from "@synapse/db";
import { and, eq } from "drizzle-orm";

/**
 * Classic OAuth scopes: `repo` reads and writes issues, pull requests and code in every
 * repository the person can reach (public and private); `read:org` lets organization
 * repositories and team review requests show up. OAuth apps have no narrower scope for
 * private issues; a fine-grained alternative would be a GitHub App (see docs/github.md).
 */
export const GITHUB_SCOPES = ["repo", "read:org"];

const AUTH_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export interface GitHubAppConfig {
  clientId: string;
  clientSecret: string;
  /** Public URL users open; GitHub redirects to <publicUrl>/api/integrations/github/callback. */
  publicUrl: string;
  /**
   * The same OAuth app also serves "Sign in with GitHub". Disconnecting then revokes only
   * this token, not the person's whole authorization of the app.
   */
  sharedWithSignIn?: boolean;
  /** Test hook. Defaults to global fetch. */
  fetch?: typeof fetch;
}

/** What is sealed into the integration row. OAuth app tokens don't expire. */
export interface GitHubTokens {
  accessToken: string;
  scope: string;
}

interface FlowState {
  userId: string;
  verifier: string;
  exp: number;
}

export class GitHubAuthError extends Error {}

export function githubRedirectUri(app: GitHubAppConfig): string {
  return `${app.publicUrl}/api/integrations/github/callback`;
}

const b64url = (bytes: Uint8Array | ArrayBuffer) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

/** Scopes GitHub reports, comma-separated in token responses and `X-OAuth-Scopes`. */
const scopeList = (s: string) =>
  s
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * The URL that starts the consent flow. The PKCE verifier and the user it belongs to are
 * sealed into `state`, so nothing is stored until GitHub sends the user back.
 */
export async function githubAuthorizationUrl(
  app: GitHubAppConfig,
  box: SecretBox,
  userId: string,
): Promise<string> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const state = await box.seal(
    JSON.stringify({ userId, verifier, exp: Date.now() + 10 * 60_000 } satisfies FlowState),
  );
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: githubRedirectUri(app),
    scope: GITHUB_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    allow_signup: "false",
  }).toString();
  return url.toString();
}

/** Exchanges the callback code and saves the integration for the user who started the flow. */
export async function completeGitHubAuth(
  app: GitHubAppConfig,
  db: Db,
  box: SecretBox,
  args: { userId: string; code: string; state: string },
): Promise<{ account: string }> {
  let flow: FlowState;
  try {
    flow = JSON.parse(await box.open(args.state)) as FlowState;
  } catch {
    throw new GitHubAuthError("This sign-in link is invalid. Try connecting again.");
  }
  if (flow.userId !== args.userId)
    throw new GitHubAuthError("This sign-in belongs to another user.");
  if (flow.exp < Date.now())
    throw new GitHubAuthError("This sign-in expired. Try connecting again.");

  const f = app.fetch ?? fetch;
  const res = await f(TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: args.code,
      redirect_uri: githubRedirectUri(app),
      code_verifier: flow.verifier,
    }),
  });
  // GitHub answers 200 with an `error` field when the exchange fails.
  const token = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !token.access_token)
    throw new GitHubAuthError(token.error_description ?? token.error ?? "GitHub sign-in failed.");
  if (!scopeList(token.scope ?? "").includes("repo"))
    throw new GitHubAuthError("GitHub did not grant repository access. Try connecting again.");

  const me = await f(`${GITHUB_API}/user`, { headers: apiHeaders(token.access_token) });
  const { login } = (await me.json().catch(() => ({}))) as { login?: string };
  if (!me.ok || !login) throw new GitHubAuthError("Could not read your GitHub account.");

  const tokens: GitHubTokens = { accessToken: token.access_token, scope: token.scope ?? "" };
  const values = {
    account: login,
    status: "active" as const,
    secret: await box.seal(JSON.stringify(tokens)),
    scopes: tokens.scope,
    lastError: null,
  };
  await db
    .insert(schema.integrations)
    .values({ userId: args.userId, provider: "github", ...values })
    .onConflictDoUpdate({
      target: [schema.integrations.userId, schema.integrations.provider],
      set: values,
    });
  return { account: login };
}

/**
 * Revokes access at GitHub (best effort) and deletes the integration. A dedicated app's
 * whole authorization is deleted; an app shared with sign-in loses only this token.
 */
export async function disconnectGitHub(
  app: GitHubAppConfig | null,
  db: Db,
  box: SecretBox,
  userId: string,
) {
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "github")));
  if (!row) return;
  if (app) {
    try {
      const tokens = JSON.parse(await box.open(row.secret)) as GitHubTokens;
      const what = app.sharedWithSignIn ? "token" : "grant";
      await (app.fetch ?? fetch)(`${GITHUB_API}/applications/${app.clientId}/${what}`, {
        method: "DELETE",
        headers: {
          ...apiHeaders(),
          authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ access_token: tokens.accessToken }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Revocation is a courtesy; the token is deleted either way.
    }
  }
  await db.delete(schema.integrations).where(eq(schema.integrations.id, row.id));
}

function apiHeaders(token?: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": API_VERSION,
    "user-agent": "SynapseAI",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** A GitHub API failure, with a message the agent can act on. */
export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** "14:05 UTC (in 12 min)" for a reset time in epoch seconds. */
function resetIn(epochSeconds: number, now = Date.now()): string {
  const at = new Date(epochSeconds * 1000);
  const mins = Math.max(1, Math.ceil((at.getTime() - now) / 60_000));
  return `${at.toISOString().slice(11, 16)} UTC (in ${mins} min)`;
}

/**
 * The agent-facing error for a failed response: rate limits with their reset time, missing
 * or invisible resources, and GitHub's own message otherwise. 401 is handled by the client.
 */
export function githubErrorMessage(
  status: number,
  headers: Headers,
  body: string,
  what: string,
  now = Date.now(),
): string {
  let message = body.slice(0, 300);
  let details = "";
  try {
    const json = JSON.parse(body) as { message?: string; errors?: unknown[] };
    message = json.message ?? message;
    if (Array.isArray(json.errors) && json.errors.length)
      details = ` (${json.errors
        .slice(0, 3)
        .map((e) =>
          typeof e === "string"
            ? e
            : ((e as { message?: string; field?: string; code?: string }).message ??
              [(e as { field?: string }).field, (e as { code?: string }).code]
                .filter(Boolean)
                .join(" ")),
        )
        .join("; ")})`;
  } catch {}
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = Number(headers.get("x-ratelimit-reset"));
  const retryAfter = Number(headers.get("retry-after"));
  if ((status === 403 || status === 429) && remaining === "0" && reset > 0)
    return `GitHub rate limit reached; it resets at ${resetIn(reset, now)}. Try again after that.`;
  if ((status === 403 || status === 429) && retryAfter > 0)
    return `GitHub is throttling requests (secondary rate limit). Try again in ${retryAfter} seconds.`;
  if (status === 429) return "GitHub rate limit reached. Try again in a few minutes.";
  if (status === 404)
    return `${what} was not found on GitHub, or the connected account has no access to it.`;
  if (status === 403)
    return `GitHub refused access to ${what}: ${message}. The repository may require SSO authorization for this app or more permissions.`;
  if (status === 422) return `GitHub rejected the request: ${message}${details}`;
  return `GitHub API error (${status}): ${message}`;
}

interface GitHubRequest {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  /** Names the resource in "not found" errors, e.g. "acme/web#12". */
  what?: string;
}

/**
 * REST API v3 access as the person who connected GitHub. A token GitHub no longer accepts
 * marks the integration `needs_auth`, so the tools stop being offered and Connections asks
 * to reconnect.
 */
export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly f: typeof fetch,
    /** Their GitHub login. */
    readonly login: string,
    private readonly onRevoked: () => Promise<void> = async () => {},
  ) {}

  static async forUser(
    app: GitHubAppConfig,
    db: Db,
    box: SecretBox,
    userId: string,
  ): Promise<GitHubClient | null> {
    const [row] = await db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.userId, userId),
          eq(schema.integrations.provider, "github"),
          eq(schema.integrations.status, "active"),
        ),
      );
    if (!row) return null;
    const tokens = JSON.parse(await box.open(row.secret)) as GitHubTokens;
    return new GitHubClient(tokens.accessToken, app.fetch ?? fetch, row.account, async () => {
      await db
        .update(schema.integrations)
        .set({ status: "needs_auth", lastError: "GitHub access was revoked or expired." })
        .where(eq(schema.integrations.id, row.id));
    });
  }

  /** Calls a REST endpoint (a path like `/repos/o/r/issues`) and returns its JSON. */
  async request<T>(path: string, init: GitHubRequest = {}): Promise<T> {
    const u = new URL(path, GITHUB_API);
    for (const [k, v] of Object.entries(init.query ?? {}))
      if (v !== undefined) u.searchParams.set(k, String(v));
    const res = await this.f(u, {
      method: init.method ?? "GET",
      headers: {
        ...apiHeaders(this.token),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    if (res.status === 401) {
      await this.onRevoked();
      throw new GitHubApiError(
        401,
        "GitHub access was revoked or expired. Reconnect GitHub under Connections.",
      );
    }
    const text = await res.text();
    if (!res.ok)
      throw new GitHubApiError(
        res.status,
        githubErrorMessage(res.status, res.headers, text, init.what ?? "That"),
      );
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
