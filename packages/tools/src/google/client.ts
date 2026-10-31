import { type Db, type SecretBox, schema } from "@synapse/db";
import { and, eq } from "drizzle-orm";

const AUTH = "https://www.googleapis.com/auth/";

/**
 * Scopes by the tools they unlock. Gmail and Calendar are required to connect at all; the
 * rest are optional, so a connection made before they existed (or one where the user
 * unticked a box) keeps working and only those tools are withheld until a reconnect.
 */
export const GOOGLE_SCOPE_GROUPS = {
  gmail: { label: "Gmail", required: true, scopes: [`${AUTH}gmail.modify`] },
  calendar: { label: "Calendar", required: true, scopes: [`${AUTH}calendar.events`] },
  drive: {
    label: "Drive",
    required: false,
    scopes: [`${AUTH}drive.readonly`, `${AUTH}drive.file`],
  },
  contacts: {
    label: "Contacts",
    required: false,
    scopes: [`${AUTH}contacts.readonly`, `${AUTH}contacts.other.readonly`],
  },
} as const;

export type GoogleScopeGroup = keyof typeof GOOGLE_SCOPE_GROUPS;

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  ...Object.values(GOOGLE_SCOPE_GROUPS).flatMap((g) => g.scopes),
];

/** The tool groups a granted scope string (space-separated, as Google returns it) lacks. */
export function missingGoogleGroups(granted: string): GoogleScopeGroup[] {
  const have = new Set(granted.split(/\s+/));
  return (Object.keys(GOOGLE_SCOPE_GROUPS) as GoogleScopeGroup[]).filter((g) =>
    GOOGLE_SCOPE_GROUPS[g].scopes.some((s) => !have.has(s)),
  );
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleAppConfig {
  clientId: string;
  clientSecret: string;
  /** Public URL users open; Google redirects to <publicUrl>/api/integrations/google/callback. */
  publicUrl: string;
  /** Test hook. Defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scope: string;
}

/** Signed-in-browser state for one authorization attempt, sealed into the `state` param. */
interface FlowState {
  userId: string;
  verifier: string;
  exp: number;
}

export class GoogleAuthError extends Error {}

export function googleRedirectUri(app: GoogleAppConfig): string {
  return `${app.publicUrl}/api/integrations/google/callback`;
}

const b64url = (bytes: Uint8Array | ArrayBuffer) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

/**
 * The URL that starts the consent flow. The PKCE verifier and the user it belongs to are
 * sealed into `state`, so nothing is stored until Google sends the user back.
 */
export async function googleAuthorizationUrl(
  app: GoogleAppConfig,
  box: SecretBox,
  userId: string,
  loginHint?: string,
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
    redirect_uri: googleRedirectUri(app),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google returns a refresh token even on reconnects.
    prompt: "consent",
    include_granted_scopes: "true",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return url.toString();
}

/** Exchanges the callback code and saves the integration for the user who started the flow. */
export async function completeGoogleAuth(
  app: GoogleAppConfig,
  db: Db,
  box: SecretBox,
  args: { userId: string; code: string; state: string },
): Promise<{ account: string }> {
  let flow: FlowState;
  try {
    flow = JSON.parse(await box.open(args.state)) as FlowState;
  } catch {
    throw new GoogleAuthError("This sign-in link is invalid. Try connecting again.");
  }
  if (flow.userId !== args.userId)
    throw new GoogleAuthError("This sign-in belongs to another user.");
  if (flow.exp < Date.now())
    throw new GoogleAuthError("This sign-in expired. Try connecting again.");

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
      redirect_uri: googleRedirectUri(app),
    }),
  });
  const token = (await res.json()) as TokenResponse;
  if (!res.ok || !token.access_token)
    throw new GoogleAuthError(token.error_description ?? token.error ?? "Google sign-in failed.");
  if (!token.refresh_token)
    throw new GoogleAuthError("Google did not grant offline access. Try connecting again.");
  // Drive and Contacts are optional: without them those tools are simply left out.
  const missing = missingGoogleGroups(token.scope ?? "");
  if (missing.some((g) => GOOGLE_SCOPE_GROUPS[g].required))
    throw new GoogleAuthError(
      "Gmail and Calendar access were not granted. Tick both boxes on Google's consent screen.",
    );

  const info = await f(USERINFO_URL, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  const { email } = (await info.json()) as { email?: string };
  const tokens: GoogleTokens = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    scope: token.scope ?? "",
  };
  const values = {
    account: email ?? "Google account",
    status: "active" as const,
    secret: await box.seal(JSON.stringify(tokens)),
    scopes: tokens.scope,
    lastError: null,
  };
  await db
    .insert(schema.integrations)
    .values({ userId: args.userId, provider: "google", ...values })
    .onConflictDoUpdate({
      target: [schema.integrations.userId, schema.integrations.provider],
      set: values,
    });
  return { account: values.account };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Revokes the grant at Google (best effort) and deletes the integration. */
export async function disconnectGoogle(
  app: GoogleAppConfig | null,
  db: Db,
  box: SecretBox,
  userId: string,
) {
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, "google")));
  if (!row) return;
  try {
    const tokens = JSON.parse(await box.open(row.secret)) as GoogleTokens;
    await (app?.fetch ?? fetch)("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refreshToken }),
    });
  } catch {
    // Revocation is a courtesy; the tokens are deleted either way.
  }
  await db.delete(schema.integrations).where(eq(schema.integrations.id, row.id));
}

/**
 * Authenticated access to Google APIs for one user. Refreshes the access token when it is
 * about to expire; a revoked grant marks the integration `needs_auth`.
 */
export class GoogleClient {
  private constructor(
    private readonly app: GoogleAppConfig,
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly integrationId: string,
    private tokens: GoogleTokens,
    readonly account: string,
    /** Granted scopes, space-separated. */
    readonly scopes: string,
  ) {}

  /** True when the grant covers every scope a tool group needs. */
  has(group: GoogleScopeGroup): boolean {
    return !missingGoogleGroups(this.scopes).includes(group);
  }

  static async forUser(
    app: GoogleAppConfig,
    db: Db,
    box: SecretBox,
    userId: string,
  ): Promise<GoogleClient | null> {
    const [row] = await db
      .select()
      .from(schema.integrations)
      .where(
        and(
          eq(schema.integrations.userId, userId),
          eq(schema.integrations.provider, "google"),
          eq(schema.integrations.status, "active"),
        ),
      );
    if (!row) return null;
    const tokens = JSON.parse(await box.open(row.secret)) as GoogleTokens;
    return new GoogleClient(app, db, box, row.id, tokens, row.account, row.scopes || tokens.scope);
  }

  private get f() {
    return this.app.fetch ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.tokens.expiresAt - Date.now() > 60_000) return this.tokens.accessToken;
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
    const token = (await res.json()) as TokenResponse;
    if (!res.ok || !token.access_token) {
      const revoked = token.error === "invalid_grant";
      await this.db
        .update(schema.integrations)
        .set({
          status: revoked ? "needs_auth" : "error",
          lastError: token.error_description ?? token.error ?? `HTTP ${res.status}`,
        })
        .where(eq(schema.integrations.id, this.integrationId));
      throw new Error(
        revoked
          ? "Google access was revoked or expired. Reconnect Google under Connections."
          : `Could not refresh Google access: ${token.error ?? res.status}`,
      );
    }
    this.tokens = {
      ...this.tokens,
      accessToken: token.access_token,
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
      ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    };
    await this.db
      .update(schema.integrations)
      .set({ secret: await this.box.seal(JSON.stringify(this.tokens)), lastError: null })
      .where(eq(schema.integrations.id, this.integrationId));
    return this.tokens.accessToken;
  }

  /** Calls a Google REST endpoint and returns its JSON. Errors carry Google's message. */
  async request<T>(url: string, init: GoogleRequest = {}): Promise<T> {
    const res = await this.send(url, init);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Calls an endpoint that returns a file's bytes (a Drive download or export). */
  async download(url: string, init: GoogleRequest = {}): Promise<Uint8Array> {
    return new Uint8Array(await (await this.send(url, init)).arrayBuffer());
  }

  private async send(url: string, init: GoogleRequest): Promise<Response> {
    const u = new URL(url);
    for (const [k, v] of Object.entries(init.query ?? {}))
      if (v !== undefined) u.searchParams.set(k, String(v));
    const res = await this.f(u, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.raw ? { "content-type": init.raw.contentType } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(init.raw ? { body: init.raw.data } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });
    if (!res.ok) {
      const text = await res.text();
      let message = text.slice(0, 300);
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
      } catch {}
      throw new Error(`Google API error (${res.status}): ${message}`);
    }
    return res;
  }
}

interface GoogleRequest {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** A non-JSON body, e.g. a multipart upload. */
  raw?: { contentType: string; data: string | Uint8Array };
  signal?: AbortSignal;
}
