import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runAgent, ToolRegistry } from "@synapse/core";
import { scriptedModel } from "@synapse/core/testing";
import { eq } from "drizzle-orm";
import { createDatabase, type Database } from "./client";
import { SecretBox } from "./crypto";
import { EventLog, readEvents } from "./events";
import {
  ConflictError,
  claimRun,
  decideToolCall,
  releaseRun,
  requestCancel,
  sendMessage,
} from "./runs";
import { automations, chats, pendingInputs, runs, user } from "./schema";
import { PgRunStore } from "./store";

let database: Database;

beforeAll(async () => {
  database = await createDatabase("pglite://memory");
  await database.migrate();
  await database.db.insert(user).values([
    { id: "u1", name: "Ada", email: "ada@example.com" },
    { id: "u2", name: "Mallory", email: "mallory@example.com" },
  ]);
});
afterAll(() => database.close());

async function newChat(userId = "u1") {
  const [chat] = await database.db.insert(chats).values({ userId }).returning();
  return chat!.id;
}

const sendTool = new ToolRegistry([
  {
    name: "send_email",
    description: "Send",
    inputSchema: { type: "object", properties: { to: { type: "string" } } },
    effect: "send",
    untrustedOutput: false,
    source: "test",
    execute: async (input) => ({ type: "text", value: `sent to ${(input as { to: string }).to}` }),
  },
]);

describe("postgres store", () => {
  test("full approval round trip through the database", async () => {
    const chatId = await newChat();
    const { runId } = await sendMessage(database.db, {
      userId: "u1",
      chatId,
      content: "email bob",
    });
    const store = new PgRunStore(database.db);
    const events = new EventLog(database, 0);
    const m = scriptedModel([
      { text: "On it.", toolCalls: [{ name: "send_email", input: { to: "bob@x.com" }, id: "c1" }] },
      { text: "Sent." },
    ]);
    const opts = { runId, store, events, tools: sendTool, models: [m], system: "test" };

    expect(await runAgent(opts)).toBe("waiting");

    // Another user cannot approve it; the owner can, exactly once.
    await expect(
      decideToolCall(database.db, { userId: "u2", runId, toolCallId: "c1", approved: true }),
    ).rejects.toThrow();
    await decideToolCall(database.db, {
      userId: "u1",
      runId,
      toolCallId: "c1",
      approved: true,
      editedInput: { to: "robert@x.com" },
    });
    await expect(
      decideToolCall(database.db, { userId: "u1", runId, toolCallId: "c1", approved: true }),
    ).rejects.toBeInstanceOf(ConflictError);

    const [queued] = await database.db.select().from(runs).where(eq(runs.id, runId));
    expect(queued!.status).toBe("queued");

    expect(await runAgent(opts)).toBe("completed");
    const calls = await store.listToolCalls(runId);
    expect(calls[0]).toMatchObject({ status: "succeeded", inputEdited: true });
    expect(JSON.stringify(calls[0]!.output)).toContain("robert@x.com");

    await events.flush(runId);
    const log = await readEvents(database, runId, 0);
    expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1));
    expect(log.some((e) => e.type === "approval.requested")).toBe(true);
    expect(log.at(-1)).toMatchObject({ type: "run.status", status: "completed" });
    // Resume from the middle returns only the tail.
    expect((await readEvents(database, runId, 3))[0]!.seq).toBe(4);
  });

  test("a new message while waiting denies pending approvals and queues the input", async () => {
    const chatId = await newChat();
    const { runId } = await sendMessage(database.db, {
      userId: "u1",
      chatId,
      content: "email bob",
    });
    const store = new PgRunStore(database.db);
    const m = scriptedModel([
      { toolCalls: [{ name: "send_email", input: { to: "bob@x.com" }, id: "c1" }] },
      { text: "Okay, not sending. Checking spam instead." },
    ]);
    const opts = {
      runId,
      store,
      events: new EventLog(database, 0),
      tools: sendTool,
      models: [m],
      system: "t",
    };
    expect(await runAgent(opts)).toBe("waiting");

    const again = await sendMessage(database.db, {
      userId: "u1",
      chatId,
      content: "actually, check spam",
    });
    expect(again).toEqual({ runId, queued: "pending_input" });
    expect((await store.listToolCalls(runId))[0]!.status).toBe("denied");

    expect(await runAgent(opts)).toBe("completed");
    expect(JSON.stringify(m.calls[1]!.prompt)).toContain("actually, check spam");
    expect(
      await database.db.select().from(pendingInputs).where(eq(pendingInputs.chatId, chatId)),
    ).toEqual([]);
  });

  test("one active run per chat; other users' chats are invisible", async () => {
    const chatId = await newChat();
    await sendMessage(database.db, { userId: "u1", chatId, content: "a" });
    const second = await sendMessage(database.db, { userId: "u1", chatId, content: "b" });
    expect(second.queued).toBe("pending_input");
    await expect(sendMessage(database.db, { userId: "u2", chatId, content: "x" })).rejects.toThrow(
      "chat not found",
    );
  });

  test("leases: claim, expire, reclaim", async () => {
    // Drain queued runs left by earlier tests so this test controls the queue.
    while (await claimRun(database.db, "drain", 60_000)) {}
    const chatId = await newChat();
    const { runId } = await sendMessage(database.db, { userId: "u1", chatId, content: "hi" });
    expect(await claimRun(database.db, "w1", 1)).toBe(runId);
    await database.db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));
    await Bun.sleep(5);
    // w1's lease expired: w2 takes over.
    expect(await claimRun(database.db, "w2", 60_000)).toBe(runId);
    expect(await claimRun(database.db, "w3", 60_000)).toBeNull();
    await releaseRun(database.db, runId, "w2");
    const [r] = await database.db.select().from(runs).where(eq(runs.id, runId));
    expect(r).toMatchObject({ status: "queued", leaseOwner: null });
  });

  test("cancel on a waiting run re-queues it for the worker", async () => {
    const chatId = await newChat();
    const { runId } = await sendMessage(database.db, { userId: "u1", chatId, content: "x" });
    await database.db.update(runs).set({ status: "waiting" }).where(eq(runs.id, runId));
    await expect(
      requestCancel(database.db, { userId: "u2", runId, mode: "now" }),
    ).rejects.toThrow();
    await requestCancel(database.db, { userId: "u1", runId, mode: "now" });
    const [r] = await database.db.select().from(runs).where(eq(runs.id, runId));
    expect(r).toMatchObject({ status: "queued", cancelRequested: "now" });
  });
});

test("SecretBox round-trips and rejects tampering", async () => {
  const box = await SecretBox.fromSecret("x".repeat(32));
  const sealed = await box.seal("token");
  expect(await box.open(sealed)).toBe("token");
  await expect(box.open(`${sealed.slice(0, -2)}AA`)).rejects.toThrow();
});

describe("automations", () => {
  test("schedules are validated", async () => {
    const { validateSchedule } = await import("./automations");
    expect(validateSchedule("0 9 * * 1-5", "Europe/London")).toBeNull();
    expect(validateSchedule("* * * * *", "UTC")).toContain("15 minutes");
    expect(validateSchedule("not cron", "UTC")).not.toBeNull();
    expect(validateSchedule("0 9 * * *", "Mars/Olympus")).not.toBeNull();
  });

  test("due automations fire once, advance, and queue behind an active run", async () => {
    const { fireDueAutomations, nextRun } = await import("./automations");
    const chatId = await newChat();
    const past = new Date(Date.now() - 60_000);
    const [auto] = await database.db
      .insert(automations)
      .values({
        userId: "u1",
        name: "Morning brief",
        prompt: "Summarise my inbox",
        schedule: "0 9 * * *",
        chatId,
        nextRunAt: past,
      })
      .returning();

    // Drain unrelated due automations from other tests (none expected).
    const fired = await fireDueAutomations(database.db);
    expect(fired).toHaveLength(1);
    const [after] = await database.db
      .select()
      .from(automations)
      .where(eq(automations.id, auto!.id));
    expect(after!.nextRunAt!.getTime()).toBe(
      nextRun("0 9 * * *", "UTC", after!.lastRunAt!)!.getTime(),
    );
    expect(await fireDueAutomations(database.db)).toEqual([]);

    const [run] = await database.db.select().from(runs).where(eq(runs.id, fired[0]!));
    expect(run).toMatchObject({ trigger: "schedule", status: "queued", chatId });
  });
});
