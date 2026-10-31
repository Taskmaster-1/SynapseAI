import { type Db, type SecretBox, schema } from "@synapse/db";
import { and, eq } from "drizzle-orm";

/**
 * `write` covers everything the tools do (create, update, comment). Linear's finer scopes
 * (`issues:create`, `comments:create`) can't move or reassign an issue, so they don't fit.
 */
export const LINEAR_SCOPES = ["read", "write"];

const AUTH_URL = "https://linear.app/oauth/authorize";
const TOKEN_URL = "https://api.linear.app/oauth/token";
const REVOKE_URL = "https://api.linear.app/oauth/revoke";
export const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

export interface LinearAppConfig {
  clientId: string;
  clientSecret: string;
  /** Public URL users open; Linear redirects to <publicUrl>/api/integrations/linear/callback. */
  publicUrl: string;
  /** Test hook. Defaults to global fetch. */
  fetch?: typeof fetch;
}

/** Sealed into the integration row. Apps from before refresh tokens get none. */
export interface LinearTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number;
  scope: string;
  /** Who connected, in which workspace, for the Connections page. */
  workspace: string;
  workspaceKey: string;
  userName: string;
}

interface FlowState {
  userId: string;
  verifier: string;
  exp: number;
}

export class LinearAuthError extends Error {}

export function linearRedirectUri(app: LinearAppConfig): string {
  return `${app.publicUrl}/api/integrations/linear/callback`;
}

const b64url = (bytes: Uint8Array | ArrayBuffer) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

/** The consent URL. As for Google, the PKCE verifier and user are sealed into `state`. */
export async function linearAuthorizationUrl(
  app: LinearAppConfig,
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
    redirect_uri: linearRedirectUri(app),
    response_type: "code",
    scope: LINEAR_SCOPES.join(","),
    // Show the workspace picker on reconnects too, so a person can switch workspaces.
    prompt: "consent",
    actor: "user",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  /** Space-separated, or an array for apps created before Dec 2023. */
  scope?: string | string[];
  error?: string;
  error_description?: string;
}

const scopeString = (s: TokenResponse["scope"]) => (Array.isArray(s) ? s.join(" ") : (s ?? ""));

/** Access tokens without a stated lifetime (legacy apps) are treated as long-lived. */
const expiresAt = (t: TokenResponse) => Date.now() + (t.expires_in ?? 10 * 365 * 24 * 3600) * 1000;

/** Exchanges the callback code and saves the integration for the user who started the flow. */
export async function completeLinearAuth(
  app: LinearAppConfig,
  db: Db,
  box: SecretBox,
  args: { userId: string; code: string; state: string },
): Promise<{ account: string; workspace: string }> {
  let flow: FlowState;
  try {
    flow = JSON.parse(await box.open(args.state)) as FlowState;
  } catch {
    throw new LinearAuthError("This sign-in link is invalid. Try connecting again.");
  }
  if (flow.userId !== args.userId)
    throw new LinearAuthError("This sign-in belongs to another user.");
  if (flow.exp < Date.now())
    throw new LinearAuthError("This sign-in expired. Try connecting again.");

  const f = app.fetch ?? fetch;
  const res = await f(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      code_verifier: flow.verifier,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: linearRedirectUri(app),
    }),
  });
  const token = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !token.access_token)
    throw new LinearAuthError(token.error_description ?? token.error ?? "Linear sign-in failed.");
  const scope = scopeString(token.scope);
  if (!scope.split(/[\s,]+/).includes("write"))
    throw new LinearAuthError("Linear did not grant write access. Try connecting again.");

  const me = await f(LINEAR_GRAPHQL, {
    method: "POST",
    headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({
      operationName: "LinearWhoAmI",
      query: "query LinearWhoAmI { viewer { name email } organization { name urlKey } }",
    }),
  });
  const who = (await me.json().catch(() => ({}))) as {
    data?: {
      viewer: { name: string; email: string };
      organization: { name: string; urlKey: string };
    };
  };
  if (!who.data) throw new LinearAuthError("Could not read your Linear account. Try again.");
  const tokens: LinearTokens = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: expiresAt(token),
    scope,
    workspace: who.data.organization.name,
    workspaceKey: who.data.organization.urlKey,
    userName: who.data.viewer.name,
  };
  const values = {
    account: who.data.viewer.email,
    status: "active" as const,
    secret: await box.seal(JSON.stringify(tokens)),
    scopes: scope,
    lastError: null,
  };
  await db
    .insert(schema.integrations)
    .values({ userId: args.userId, provider: "linear", ...values })
    .onConflictDoUpdate({
      target: [schema.integrations.userId, schema.integrations.provider],
      set: values,
    });
  return { account: values.account, workspace: tokens.workspace };
}

/** Revokes the grant at Linear (best effort) and deletes the integration. */
export async function disconnectLinear(
  app: LinearAppConfig | null,
  db: Db,
  box: SecretBox,
  userId: string,
) {
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "linear")));
  if (!row) return;
  try {
    const tokens = JSON.parse(await box.open(row.secret)) as LinearTokens;
    const f = app?.fetch ?? fetch;
    const revoke = (token: string, hint: string) =>
      f(REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, token_type_hint: hint }),
      });
    if (tokens.refreshToken) await revoke(tokens.refreshToken, "refresh_token");
    await revoke(tokens.accessToken, "access_token");
  } catch {
    // Revocation is a courtesy; the tokens are deleted either way.
  }
  await db.delete(schema.integrations).where(eq(schema.integrations.id, row.id));
}

/** Linear answered, but not with data: a GraphQL error (bad input, not found, forbidden). */
export class LinearApiError extends Error {}

interface GraphQLError {
  message: string;
  extensions?: { code?: string; userPresentableMessage?: string; type?: string };
}

/**
 * Linear's GraphQL API as the person who connected it. Refreshes the access token before
 * it expires (Linear rotates the refresh token on every refresh, and replays the same
 * answer for 30 minutes, so two runs refreshing at once both succeed). A revoked grant
 * marks the integration `needs_auth`, which withholds the tools until a reconnect.
 */
export class LinearClient {
  private constructor(
    private readonly app: LinearAppConfig,
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly integrationId: string,
    private tokens: LinearTokens,
    readonly account: string,
  ) {}

  static async forUser(
    app: LinearAppConfig,
    db: Db,
    box: SecretBox,
    userId: string,
  ): Promise<LinearClient | null> {
    const [row] = await db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.userId, userId),
          eq(schema.integrations.provider, "linear"),
          eq(schema.integrations.status, "active"),
        ),
      );
    if (!row) return null;
    const tokens = JSON.parse(await box.open(row.secret)) as LinearTokens;
    return new LinearClient(app, db, box, row.id, tokens, row.account);
  }

  get workspace() {
    return this.tokens.workspace;
  }

  private get f() {
    return this.app.fetch ?? fetch;
  }

  private async markRevoked(reason: string): Promise<never> {
    await this.db
      .update(schema.integrations)
      .set({ status: "needs_auth", lastError: reason })
      .where(eq(schema.integrations.id, this.integrationId));
    throw new Error("Linear access was revoked or expired. Reconnect Linear under Connections.");
  }

  /** One refresh at a time: parallel calls in a tool share it. */
  private refreshing: Promise<string> | null = null;

  private async accessToken(): Promise<string> {
    if (this.tokens.expiresAt - Date.now() > 60_000) return this.tokens.accessToken;
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    if (!this.tokens.refreshToken) return this.markRevoked("The Linear access token expired.");
    const res = await this.f(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.tokens.refreshToken,
        client_id: this.app.clientId,
        client_secret: this.app.clientSecret,
      }),
    });
    const token = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || !token.access_token) {
      const reason = token.error_description ?? token.error ?? `HTTP ${res.status}`;
      // 4xx: the grant is gone (revoked, or the refresh token was replaced). 5xx: try later.
      if (res.status >= 400 && res.status < 500) return this.markRevoked(reason);
      await this.db
        .update(schema.integrations)
        .set({ lastError: reason })
        .where(eq(schema.integrations.id, this.integrationId));
      throw new Error(`Could not refresh Linear access: ${reason}`);
    }
    this.tokens = {
      ...this.tokens,
      accessToken: token.access_token,
      expiresAt: expiresAt(token),
      ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    };
    await this.db
      .update(schema.integrations)
      .set({ secret: await this.box.seal(JSON.stringify(this.tokens)), lastError: null })
      .where(eq(schema.integrations.id, this.integrationId));
    return this.tokens.accessToken;
  }

  /**
   * Runs one named GraphQL operation and returns its data. Errors come back as plain
   * sentences: auth failures switch the integration to "reconnect", rate limits say when
   * to retry, and anything else carries Linear's own message.
   */
  async graphql<T>(
    operationName: string,
    query: string,
    variables: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await this.f(LINEAR_GRAPHQL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ operationName, query, variables }),
      signal: signal ?? AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as {
      data?: T;
      errors?: GraphQLError[];
    } | null;
    const errors = body?.errors ?? [];
    const codes = errors.map((e) => e.extensions?.code ?? "");
    if (res.status === 401 || codes.includes("AUTHENTICATION_ERROR"))
      return this.markRevoked(errors[0]?.message ?? "Linear rejected the access token.");
    if (res.status === 429 || codes.includes("RATELIMITED")) {
      const after = Number(res.headers.get("retry-after"));
      throw new LinearApiError(
        `Linear's rate limit was reached. Try again ${after > 0 ? `in ${Math.ceil(after)} seconds` : "in a minute"}.`,
      );
    }
    if (errors.length > 0) {
      const e = errors[0]!;
      throw new LinearApiError(
        `Linear: ${e.extensions?.userPresentableMessage ?? e.message}`.slice(0, 400),
      );
    }
    if (!res.ok || !body?.data) throw new LinearApiError(`Linear API error (HTTP ${res.status}).`);
    return body.data;
  }
}
