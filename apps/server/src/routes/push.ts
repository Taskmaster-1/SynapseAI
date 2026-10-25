import { schema } from "@synapse/db";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, apiError, body } from "../http";
import { deviceLabel, isPushEndpoint } from "../notify/push";

function enabledPush(c: { var: AppEnv["Variables"] }) {
  const { push } = c.var.services;
  if (!push)
    apiError(
      503,
      "push_not_configured",
      "Push notifications aren't set up on this server (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).",
    );
  return push;
}

const listColumns = {
  id: schema.pushSubscriptions.id,
  endpoint: schema.pushSubscriptions.endpoint,
  label: schema.pushSubscriptions.userAgent,
  createdAt: schema.pushSubscriptions.createdAt,
  lastUsedAt: schema.pushSubscriptions.lastUsedAt,
};

export const push = new Hono<AppEnv>()
  .get("/config", (c) => {
    const { push } = c.var.services;
    return c.json({ enabled: Boolean(push), publicKey: push?.config.publicKey ?? null });
  })

  .get("/subscriptions", async (c) => {
    const rows = await c.var.services.database.db
      .select(listColumns)
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, c.var.user.id))
      .orderBy(desc(schema.pushSubscriptions.createdAt));
    return c.json({ subscriptions: rows });
  })

  // The browser's PushSubscription.toJSON(). Re-subscribing the same device is an upsert,
  // and a device that signs in to another account moves to it.
  .post("/subscriptions", async (c) => {
    enabledPush(c);
    const input = await body(
      c,
      z.object({
        endpoint: z.string().url().max(2048),
        keys: z.object({
          p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}=*$/),
          auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}=*$/),
        }),
        label: z.string().trim().min(1).max(80).optional(),
      }),
    );
    if (!isPushEndpoint(input.endpoint))
      apiError(422, "invalid_endpoint", "That isn't a known browser push service.");
    const { database, box } = c.var.services;
    const values = {
      userId: c.var.user.id,
      endpoint: input.endpoint,
      p256dh: await box.seal(input.keys.p256dh),
      auth: await box.seal(input.keys.auth),
      userAgent: input.label ?? deviceLabel(c.req.header("user-agent")),
    };
    const [row] = await database.db
      .insert(schema.pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: schema.pushSubscriptions.endpoint,
        set: {
          userId: values.userId,
          p256dh: values.p256dh,
          auth: values.auth,
          userAgent: values.userAgent,
        },
      })
      .returning(listColumns);
    return c.json({ subscription: row }, 201);
  })

  .delete("/subscriptions/:id", async (c) => {
    await c.var.services.database.db
      .delete(schema.pushSubscriptions)
      .where(
        and(
          eq(schema.pushSubscriptions.id, c.req.param("id")),
          eq(schema.pushSubscriptions.userId, c.var.user.id),
        ),
      );
    return c.body(null, 204);
  })

  .post("/test", async (c) => {
    const channel = enabledPush(c);
    const { config } = c.var.services;
    const result = await channel.sendToUser(c.var.user.id, {
      title: "Synapse",
      body: "Notifications work. This is where approvals will show up.",
      tag: "synapse-test",
      data: { url: `${config.PUBLIC_URL}/settings#notifications` },
    });
    return c.json(result);
  });
