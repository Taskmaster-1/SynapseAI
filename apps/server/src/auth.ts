import { type Db, schema } from "@synapse/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Config } from "./config";

export function createAuth(db: Db, config: Config) {
  return betterAuth({
    appName: "SynapseAI",
    baseURL: config.PUBLIC_URL,
    basePath: "/api/auth",
    secret: config.secret,
    trustedOrigins: [config.PUBLIC_URL],
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: true, disableSignUp: !config.ALLOW_SIGNUP, minPasswordLength: 10 },
    socialProviders: {
      ...(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: config.GITHUB_CLIENT_ID,
              clientSecret: config.GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
      ...(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: config.GOOGLE_CLIENT_ID,
              clientSecret: config.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    rateLimit: { enabled: config.NODE_ENV !== "test", window: 60, max: 30 },
    advanced: { useSecureCookies: config.PUBLIC_URL.startsWith("https://") },
  });
}

export type Auth = ReturnType<typeof createAuth>;
