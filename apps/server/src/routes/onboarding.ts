import { schema } from "@synapse/db";
import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../http";

/**
 * The getting-started checklist on Home, from real state: Google connected, a writing style
 * learned, an automation turned on, and an action the user approved.
 */
export const onboarding = new Hono<AppEnv>().get("/", async (c) => {
  const { config, database } = c.var.services;
  const { db } = database;
  const userId = c.var.user.id;
  const exists = async (q: Promise<unknown[]>) => (await q).length > 0;
  const [google, writingStyle, automation, approved] = await Promise.all([
    exists(
      db
        .select({ id: schema.integrations.id })
        .from(schema.integrations)
        .where(
          and(
            eq(schema.integrations.userId, userId),
            eq(schema.integrations.provider, "google"),
            eq(schema.integrations.status, "active"),
          ),
        )
        .limit(1),
    ),
    exists(
      db
        .select({ id: schema.memories.id })
        .from(schema.memories)
        .where(and(eq(schema.memories.userId, userId), eq(schema.memories.source, "style")))
        .limit(1),
    ),
    exists(
      db
        .select({ id: schema.automations.id })
        .from(schema.automations)
        .where(and(eq(schema.automations.userId, userId), eq(schema.automations.enabled, true)))
        .limit(1),
    ),
    exists(
      db
        .select({ id: schema.toolCalls.id })
        .from(schema.toolCalls)
        .where(
          and(
            eq(schema.toolCalls.userId, userId),
            eq(schema.toolCalls.decidedBy, userId),
            ne(schema.toolCalls.status, "denied"),
          ),
        )
        .limit(1),
    ),
  ]);
  return c.json({
    googleAvailable: Boolean(config.google),
    steps: { google, writingStyle, automation, approved },
  });
});
