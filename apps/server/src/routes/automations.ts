import { nextRun, schema, sendMessage, validateSchedule } from "@synapse/db";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, apiError, body } from "../http";

const Input = z.object({
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(4000),
  schedule: z.string().trim().min(9).max(100),
  timezone: z.string().trim().min(1).max(64).default("UTC"),
  enabled: z.boolean().default(true),
});

function checked(schedule: string, timezone: string) {
  const problem = validateSchedule(schedule, timezone);
  if (problem) apiError(422, "invalid_schedule", problem);
}

export const automations = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await c.var.services.database.db
      .select()
      .from(schema.automations)
      .where(eq(schema.automations.userId, c.var.user.id))
      .orderBy(desc(schema.automations.createdAt));
    return c.json({ automations: rows });
  })

  .post("/", async (c) => {
    const input = await body(c, Input);
    checked(input.schedule, input.timezone);
    const { db } = c.var.services.database;
    const automation = await db.transaction(async (tx) => {
      const [chat] = await tx
        .insert(schema.chats)
        .values({ userId: c.var.user.id, title: `⏱ ${input.name}` })
        .returning({ id: schema.chats.id });
      const [row] = await tx
        .insert(schema.automations)
        .values({
          ...input,
          userId: c.var.user.id,
          chatId: chat!.id,
          nextRunAt: input.enabled ? nextRun(input.schedule, input.timezone) : null,
        })
        .returning();
      return row!;
    });
    return c.json({ automation }, 201);
  })

  .patch("/:id", async (c) => {
    const input = await body(c, Input.partial());
    const current = await own(c, c.req.param("id"));
    const merged = { ...current, ...input };
    checked(merged.schedule, merged.timezone);
    const [automation] = await c.var.services.database.db
      .update(schema.automations)
      .set({
        ...input,
        nextRunAt: merged.enabled ? nextRun(merged.schedule, merged.timezone) : null,
      })
      .where(eq(schema.automations.id, current.id))
      .returning();
    return c.json({ automation });
  })

  .delete("/:id", async (c) => {
    const current = await own(c, c.req.param("id"));
    await c.var.services.database.db
      .delete(schema.automations)
      .where(eq(schema.automations.id, current.id));
    return c.body(null, 204);
  })

  .post("/:id/run", async (c) => {
    const current = await own(c, c.req.param("id"));
    const sent = await sendMessage(c.var.services.database.db, {
      userId: c.var.user.id,
      chatId: current.chatId,
      content: `[Run now: ${current.name}]\n\n${current.prompt}`,
      trigger: "manual",
    });
    await c.var.services.wake(sent.runId);
    return c.json({ ...sent, chatId: current.chatId }, 202);
  });

async function own(c: { var: AppEnv["Variables"] }, id: string) {
  const [row] = await c.var.services.database.db
    .select()
    .from(schema.automations)
    .where(and(eq(schema.automations.id, id), eq(schema.automations.userId, c.var.user.id)));
  if (!row) apiError(404, "not_found", "Automation not found.");
  return row;
}
