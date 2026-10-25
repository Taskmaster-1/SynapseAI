import type { StoredMessage, ToolCallRecord } from "@synapse/core";
import { toUiMessages } from "@synapse/core/ui";
import { PgRunStore, schema, sendMessage } from "@synapse/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, apiError, body } from "../http";

const Content = z.string().trim().min(1).max(20_000);

export const chats = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db } = c.var.services.database;
    const rows = await db
      .select({
        id: schema.chats.id,
        title: schema.chats.title,
        updatedAt: schema.chats.updatedAt,
        status: sql<
          string | null
        >`(select status from runs r where r.chat_id = "chats"."id" order by r.created_at desc limit 1)`,
        pendingApprovals: sql<number>`(select count(*)::int from tool_calls t join runs r on r.id = t.run_id where r.chat_id = "chats"."id" and t.status = 'awaiting_approval')`,
        costUsd: sql<number>`(select coalesce(sum(cost_usd), 0)::float from runs r where r.chat_id = "chats"."id")`,
        tainted: sql<boolean>`exists (select 1 from runs r where r.chat_id = "chats"."id" and r.tainted)`,
        trigger: sql<
          string | null
        >`(select trigger from runs r where r.chat_id = "chats"."id" order by r.created_at desc limit 1)`,
        // Latest assistant text, for task previews.
        snippet: sql<
          string | null
        >`(select left(p->>'text', 200) from messages m, jsonb_array_elements(case when jsonb_typeof(m.message->'content') = 'array' then m.message->'content' else '[]'::jsonb end) p where m.chat_id = "chats"."id" and m.message->>'role' = 'assistant' and p->>'type' = 'text' order by m.seq desc limit 1)`,
      })
      .from(schema.chats)
      .where(eq(schema.chats.userId, c.var.user.id))
      .orderBy(desc(schema.chats.updatedAt))
      .limit(200);
    return c.json({ chats: rows });
  })

  .post("/", async (c) => {
    const { content } = await body(c, z.object({ content: Content.optional() }));
    const { db } = c.var.services.database;
    const [chat] = await db
      .insert(schema.chats)
      .values({ userId: c.var.user.id, title: content ? titleFrom(content) : null })
      .returning({ id: schema.chats.id, title: schema.chats.title });
    if (!content) return c.json({ chat }, 201);
    const sent = await sendMessage(db, { userId: c.var.user.id, chatId: chat!.id, content });
    await c.var.services.wake(sent.runId);
    return c.json({ chat, runId: sent.runId }, 201);
  })

  .get("/:id", async (c) => {
    const { db } = c.var.services.database;
    const chat = await ownChat(c.var.services.database.db, c.var.user.id, c.req.param("id"));
    const store = new PgRunStore(db);
    const rows: StoredMessage[] = await store.listMessages(chat.id);
    const runIds = [...new Set(rows.map((r) => r.runId).filter((x): x is string => !!x))];
    const calls: ToolCallRecord[] = runIds.length
      ? (
          await db.select().from(schema.toolCalls).where(inArray(schema.toolCalls.runId, runIds))
        ).map((r) => ({
          id: r.id,
          runId: r.runId,
          messageId: r.messageId,
          name: r.name,
          input: r.input,
          inputEdited: r.inputEdited,
          effect: r.effect,
          status: r.status,
          decision: r.decision,
          decisionReason: r.decisionReason,
          output: r.output,
          decidedBy: r.decidedBy,
          preview: r.preview,
          executeAfter: r.executeAfter?.toISOString() ?? null,
        }))
      : [];
    const [run] = await db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.chatId, chat.id))
      .orderBy(desc(schema.runs.createdAt))
      .limit(1);
    const lastSeq = run ? await resumePoint(db, run.id, new Set(rows.map((r) => r.id))) : 0;
    return c.json({
      chat: { id: chat.id, title: chat.title },
      messages: toUiMessages(rows, calls),
      run: run
        ? {
            id: run.id,
            status: run.status,
            error: run.error,
            model: run.model,
            tainted: run.tainted,
            steps: run.steps,
            trigger: run.trigger,
            createdAt: run.createdAt,
            finishedAt: run.finishedAt,
            inputTokens: run.inputTokens,
            outputTokens: run.outputTokens,
            costUsd: run.costUsd,
            lastSeq,
          }
        : null,
    });
  })

  .patch("/:id", async (c) => {
    const { title } = await body(c, z.object({ title: z.string().trim().min(1).max(200) }));
    const chat = await ownChat(c.var.services.database.db, c.var.user.id, c.req.param("id"));
    await c.var.services.database.db
      .update(schema.chats)
      .set({ title })
      .where(eq(schema.chats.id, chat.id));
    return c.json({ chat: { id: chat.id, title } });
  })

  .delete("/:id", async (c) => {
    const chat = await ownChat(c.var.services.database.db, c.var.user.id, c.req.param("id"));
    await c.var.services.database.db.delete(schema.chats).where(eq(schema.chats.id, chat.id));
    return c.body(null, 204);
  })

  .post("/:id/messages", async (c) => {
    const { content } = await body(c, z.object({ content: Content }));
    const { db } = c.var.services.database;
    const sent = await sendMessage(db, {
      userId: c.var.user.id,
      chatId: c.req.param("id"),
      content,
    });
    await c.var.services.wake(sent.runId);
    return c.json(sent, 202);
  });

/**
 * Where the client should resume the event stream. If a message is still streaming (its
 * events exist but its row was not stored when we read `rows`), resume just before its
 * `message.start` so the client receives the whole message; otherwise from the end.
 */
async function resumePoint(
  db: AppEnv["Variables"]["services"]["database"]["db"],
  runId: string,
  stored: Set<string>,
) {
  const [last] = await db
    .select({ seq: schema.runEvents.seq, event: schema.runEvents.event })
    .from(schema.runEvents)
    .where(
      and(
        eq(schema.runEvents.runId, runId),
        sql`${schema.runEvents.event}->>'type' = 'message.start'`,
      ),
    )
    .orderBy(desc(schema.runEvents.seq))
    .limit(1);
  const [max] = await db
    .select({ max: sql<number>`coalesce(max(seq), 0)::int` })
    .from(schema.runEvents)
    .where(eq(schema.runEvents.runId, runId));
  const messageId = (last?.event as { messageId?: string } | undefined)?.messageId;
  if (last && messageId && !stored.has(messageId)) return last.seq - 1;
  return max?.max ?? 0;
}

async function ownChat(
  db: AppEnv["Variables"]["services"]["database"]["db"],
  userId: string,
  id: string,
) {
  const [chat] = await db
    .select()
    .from(schema.chats)
    .where(and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)));
  if (!chat) apiError(404, "not_found", "Chat not found.");
  return chat;
}

function titleFrom(content: string): string {
  const line = content.split("\n")[0]!.trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}
