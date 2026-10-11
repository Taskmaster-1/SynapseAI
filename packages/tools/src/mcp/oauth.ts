import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { type Db, type SecretBox, schema } from "@synapse/db";
import { eq } from "drizzle-orm";

interface FlowState {
  clientInformation?: OAuthClientInformationMixed;
  codeVerifier?: string;
  state?: string;
}

export interface OAuthAppConfig {
  /** Public base URL of the API, e.g. https://synapse.example.com */
  publicUrl: string;
  appName: string;
}

/**
 * OAuth 2.1 client for one MCP connection, persisted in the connections row (encrypted).
 * Uses a Client ID Metadata Document when served over HTTPS, otherwise dynamic client
 * registration. `state` is bound to the connection so callbacks cannot be swapped.
 */
export class ConnectionOAuthProvider implements OAuthClientProvider {
  /** Set when the server needs the user to authorize; read by the caller to redirect. */
  authorizationUrl: URL | null = null;
  private flow: FlowState = {};
  private tokenCache: OAuthTokens | undefined;

  private constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly connectionId: string,
    private readonly app: OAuthAppConfig,
  ) {}

  static async load(db: Db, box: SecretBox, connectionId: string, app: OAuthAppConfig) {
    const provider = new ConnectionOAuthProvider(db, box, connectionId, app);
    const [row] = await db
      .select({ auth: schema.connections.auth })
      .from(schema.connections)
      .where(eq(schema.connections.id, connectionId));
    if (row?.auth.oauthState) provider.flow = JSON.parse(await box.open(row.auth.oauthState));
    if (row?.auth.secret) provider.tokenCache = JSON.parse(await box.open(row.auth.secret));
    return provider;
  }

  get redirectUrl(): string {
    return `${this.app.publicUrl}/api/connections/oauth/callback`;
  }

  get clientMetadataUrl(): string | undefined {
    return this.app.publicUrl.startsWith("https://")
      ? `${this.app.publicUrl}/oauth/client-metadata.json`
      : undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    return clientMetadata(this.app);
  }

  state(): string {
    this.flow.state = `${this.connectionId}.${crypto.randomUUID()}`;
    return this.flow.state;
  }

  expectedState(): string | undefined {
    return this.flow.state;
  }

  clientInformation() {
    return this.flow.clientInformation;
  }

  async saveClientInformation(info: OAuthClientInformationMixed) {
    this.flow.clientInformation = info;
    await this.persistFlow();
  }

  tokens() {
    return this.tokenCache;
  }

  async saveTokens(tokens: OAuthTokens) {
    this.tokenCache = tokens;
    const [row] = await this.db
      .select({ auth: schema.connections.auth })
      .from(schema.connections)
      .where(eq(schema.connections.id, this.connectionId));
    await this.db
      .update(schema.connections)
      .set({
        auth: { ...row!.auth, type: "oauth", secret: await this.box.seal(JSON.stringify(tokens)) },
        status: "active",
        lastError: null,
      })
      .where(eq(schema.connections.id, this.connectionId));
  }

  async redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
    await this.persistFlow();
  }

  async saveCodeVerifier(codeVerifier: string) {
    this.flow.codeVerifier = codeVerifier;
    await this.persistFlow();
  }

  codeVerifier(): string {
    if (!this.flow.codeVerifier) throw new Error("no PKCE verifier saved for this connection");
    return this.flow.codeVerifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") delete this.flow.clientInformation;
    if (scope === "all" || scope === "verifier") delete this.flow.codeVerifier;
    if (scope === "all" || scope === "tokens") this.tokenCache = undefined;
    await this.persistFlow(scope === "all" || scope === "tokens");
  }

  private async persistFlow(clearTokens = false) {
    const [row] = await this.db
      .select({ auth: schema.connections.auth })
      .from(schema.connections)
      .where(eq(schema.connections.id, this.connectionId));
    const auth = {
      ...row!.auth,
      type: "oauth" as const,
      oauthState: await this.box.seal(JSON.stringify(this.flow)),
    };
    if (clearTokens) delete auth.secret;
    await this.db
      .update(schema.connections)
      .set({ auth })
      .where(eq(schema.connections.id, this.connectionId));
  }
}

export function clientMetadata(app: OAuthAppConfig): OAuthClientMetadata {
  return {
    client_name: app.appName,
    redirect_uris: [`${app.publicUrl}/api/connections/oauth/callback`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    ...(app.publicUrl.startsWith("https://")
      ? { client_id: `${app.publicUrl}/oauth/client-metadata.json` }
      : {}),
  } as OAuthClientMetadata;
}
