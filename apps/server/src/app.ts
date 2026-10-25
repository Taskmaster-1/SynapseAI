import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { type AppEnv, onError, requireUser } from "./http";
import { documents, memories, policy, settings, usage } from "./routes/account";
import { automations, hooks } from "./routes/automations";
import { chats } from "./routes/chats";
import { clientMetadataDocument, connections, oauthCallback } from "./routes/connections";
import { googleCallback, integrations } from "./routes/integrations";
import { models } from "./routes/models";
import { push } from "./routes/push";
import { approvals, runs } from "./routes/runs";
import { slackIntegration, slackInteractions } from "./routes/slack";
import { suggestions } from "./routes/suggestions";
import type { Services } from "./services";

export function createApp(services: Services) {
  const { config } = services;
  const app = new Hono<AppEnv>();
  app.use(secureHeaders());
  app.use(async (c, next) => {
    c.set("services", services);
    await next();
  });
  app.onError(onError);

  // Cross-site writes are rejected: browsers send Origin on POST/PUT/PATCH/DELETE.
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (
      origin &&
      c.req.method !== "GET" &&
      c.req.method !== "HEAD" &&
      origin !== new URL(config.PUBLIC_URL).origin
    ) {
      return c.json(
        { error: { code: "forbidden", message: "Cross-origin request rejected." } },
        403,
      );
    }
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/config", (c) =>
    c.json({
      auth: {
        emailPassword: true,
        signup: config.ALLOW_SIGNUP,
        github: Boolean(config.GITHUB_CLIENT_ID),
        google: Boolean(config.GOOGLE_CLIENT_ID),
      },
      integrations: { google: Boolean(config.google), slack: Boolean(config.slack) },
      features: {
        webSearch: Boolean(config.webSearch),
        embeddings: Boolean(config.embedding),
        push: Boolean(services.push),
        emailAlerts: Boolean(services.email),
      },
      models: config.SYNAPSE_MODELS,
    }),
  );
  app.get("/oauth/client-metadata.json", (c) => c.json(clientMetadataDocument(c)));
  app.on(["GET", "POST"], "/api/auth/*", (c) => services.auth.handler(c.req.raw));
  // Public: authenticated by the secret token in the URL, not a session.
  app.route("/api/hooks", hooks);
  // Public: authenticated by Slack's request signature.
  app.route("/api/slack/interactions", slackInteractions);

  const api = new Hono<AppEnv>();
  api.use(requireUser);
  api.route("/chats", chats);
  api.route("/runs", runs);
  api.route("/approvals", approvals);
  api.route("/connections/oauth/callback", oauthCallback);
  api.route("/connections", connections);
  api.route("/integrations/google/callback", googleCallback);
  api.route("/integrations/slack", slackIntegration);
  api.route("/integrations", integrations);
  api.route("/policy/suggestions", suggestions);
  api.route("/policy", policy);
  api.route("/memories", memories);
  api.route("/documents", documents);
  api.route("/settings", settings);
  api.route("/usage", usage);
  api.route("/models", models);
  api.route("/automations", automations);
  api.route("/push", push);
  api.get("/me", (c) => c.json({ user: c.var.user }));
  app.route("/api", api);

  return app;
}
