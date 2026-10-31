import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { riskFacts, type ToolContext, type ToolDefinition } from "@synapse/core";
import { createDatabase, type Database, SecretBox, schema } from "@synapse/db";
import type { JSONValue } from "ai";
import { eq } from "drizzle-orm";
import { buildToolset } from "..";
import { SlackUserClient } from "./client";
import { fakeSlackApi } from "./testing";
import { slackTools } from "./tools";

let database: Database;
let box: SecretBox;
let slack: ReturnType<typeof fakeSlackApi>;
const USER = "u-slack";
const TOKEN = "xoxp-T1-test";

const ctx: ToolContext = {
  userId: USER,
  chatId: "c",
  runId: "r",
  toolCallId: "t",
  abortSignal: new AbortController().signal,
};

beforeAll(async () => {
  database = await createDatabase("pglite://memory");
  await database.migrate();
  box = await SecretBox.fromSecret("s".repeat(40));
  await database.db.insert(schema.user).values({ id: USER, name: USER, email: "ada@acme.test" });
});
afterAll(() => database.close());

beforeEach(async () => {
  slack = fakeSlackApi();
  slack.state.tokens.add(TOKEN);
  slack.state.userTokens.set(TOKEN, "U0ADA0001");
  slack.person({ id: "U0ADA0001", name: "ada", real_name: "Ada Lovelace", email: "ada@acme.test" });
  slack.person({ id: "U0SAM0002", name: "sam", real_name: "Sam Rivera", email: "sam@acme.test" });
  slack.channel({ id: "C0GENERAL", name: "general", members: ["U0ADA0001", "U0SAM0002"] });
  slack.channel({ id: "C0SECRET1", name: "secret", is_private: true, members: ["U0SAM0002"] });
  await database.db.delete(schema.slackAccounts);
});

async function connect(userToken: string | null = TOKEN) {
  await database.db.insert(schema.slackAccounts).values({
    userId: USER,
    teamId: "T1",
    teamName: "Acme",
    slackUserId: "U0ADA0001",
    botToken: await box.seal("xoxb-bot"),
    userToken: userToken ? await box.seal(userToken) : null,
    status: "active",
  });
}

async function tools(): Promise<Map<string, ToolDefinition>> {
  const client = await SlackUserClient.forUser({ fetch: slack.fetch }, database.db, box, USER);
  if (!client) throw new Error("no user token");
  return new Map(slackTools(async () => client).map((t) => [t.name, t]));
}

const run = async (tool: ToolDefinition | undefined, input: unknown) => {
  const out = await tool!.execute(input as JSONValue, ctx);
  // biome-ignore lint/suspicious/noExplicitAny: tool output is loosely typed JSON
  return (out as { value: any }).value;
};

describe("slack tools", () => {
  test("are offered only with a user token, and only when the server has a Slack app", async () => {
    const cfg = {
      db: database.db,
      box,
      app: { publicUrl: "https://synapse.test", appName: "t" },
      webSearch: null,
      embedder: null,
      google: null,
      slack: { fetch: slack.fetch },
    };
    const none = await buildToolset(cfg, USER);
    expect(none.registry.get("slack_search")).toBeUndefined();
    await none.close();

    await connect(null); // connected before the agent tools existed
    const old = await buildToolset(cfg, USER);
    expect(old.registry.get("slack_search")).toBeUndefined();
    await old.close();

    await database.db.delete(schema.slackAccounts);
    await connect();
    const after = await buildToolset(cfg, USER);
    expect(after.registry.get("slack_search")?.untrustedOutput).toBe(true);
    expect(after.registry.get("slack_read")?.untrustedOutput).toBe(true);
    expect(after.registry.get("slack_list_channels")?.effect).toBe("read");
    expect(after.registry.get("slack_find_user")?.effect).toBe("read");
    expect(after.registry.get("slack_post_message")?.effect).toBe("send");
    await after.close();

    const noApp = await buildToolset({ ...cfg, slack: null }, USER);
    expect(noApp.registry.get("slack_search")).toBeUndefined();
    await noApp.close();
  });

  test("search returns compact hits with mentions and links made readable", async () => {
    await connect();
    slack.say(
      "C0GENERAL",
      "U0SAM0002",
      "Launch is <@U0ADA0001>'s call, see <https://x.test/doc|the doc>",
    );
    slack.say("C0GENERAL", "U0SAM0002", `launch ${"very long ".repeat(100)}`);
    slack.say("C0SECRET1", "U0SAM0002", "launch secrets"); // not a channel Ada is in
    slack.say("C0GENERAL", "U0SAM0002", "lunch?");
    const t = await tools();
    const out = await run(t.get("slack_search"), { query: "launch", limit: 5 });
    expect(out.total).toBe(2);
    expect(out.messages[0]).toMatchObject({
      channel: "#general",
      channelId: "C0GENERAL",
      user: "sam",
      userId: "U0SAM0002",
      text: "Launch is @ada's call, see the doc (https://x.test/doc)",
    });
    expect(out.messages[0].permalink).toStartWith("https://acme.slack.com/archives/C0GENERAL/");
    expect(out.messages[0].time).toMatch(/^20\d\d-/);
    expect(out.messages[1].text.length).toBeLessThan(450);
    expect(out.messages[1].text).toEndWith("[truncated]");
    expect(slack.state.calls.filter((c) => c === "users.info").length).toBeLessThanOrEqual(2);
  });

  test("read shows a channel newest first, pages with a cursor, and reads a thread", async () => {
    await connect();
    const parent = slack.say("C0GENERAL", "U0SAM0002", "Who owns the launch?");
    slack.say("C0GENERAL", "U0ADA0001", "I do", parent.ts);
    slack.say("C0GENERAL", "U0SAM0002", "Thanks!");
    const t = await tools();

    const first = await run(t.get("slack_read"), { channel: "#general", limit: 1 });
    expect(first.channel).toBe("#general");
    expect(first.messages).toEqual([expect.objectContaining({ user: "sam", text: "Thanks!" })]);
    expect(first.nextCursor).toBeTruthy();
    const second = await run(t.get("slack_read"), {
      channel: "C0GENERAL",
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.messages[0]).toMatchObject({
      text: "Who owns the launch?",
      replies: 1,
      thread_ts: parent.ts,
    });
    expect(second.nextCursor).toBeNull();

    const thread = await run(t.get("slack_read"), { channel: "C0GENERAL", thread_ts: parent.ts });
    expect(thread.messages.map((m: { text: string }) => m.text)).toEqual([
      "Who owns the launch?",
      "I do",
    ]);

    await expect(run(t.get("slack_read"), { channel: "#nope" })).rejects.toThrow(
      "not in a Slack channel named #nope",
    );
  });

  test("lists only the user's channels, and finds people by email or name", async () => {
    await connect();
    const t = await tools();
    const { channels } = await run(t.get("slack_list_channels"), {});
    expect(channels).toEqual([{ id: "C0GENERAL", name: "#general", private: false }]);

    const byEmail = await run(t.get("slack_find_user"), { email: "sam@acme.test" });
    expect(byEmail.users).toEqual([
      {
        id: "U0SAM0002",
        name: "sam",
        realName: "Sam Rivera",
        displayName: "sam",
        email: "sam@acme.test",
      },
    ]);
    expect((await run(t.get("slack_find_user"), { email: "nobody@acme.test" })).users).toEqual([]);
    const byName = await run(t.get("slack_find_user"), { name: "rivera" });
    expect(byName.users.map((u: { id: string }) => u.id)).toEqual(["U0SAM0002"]);
  });

  test("posts as the user to a channel by name, a DM by user id, and in a thread", async () => {
    await connect();
    const t = await tools();
    const post = t.get("slack_post_message")!;
    expect(post.preview!({ channel: "#general", text: "Ship it\ntoday" })).toBe(
      "Post in #general: Ship it today",
    );
    expect(post.preview!({ channel: "U0SAM0002", text: "hi" })).toBe(
      "Send a direct message to U0SAM0002: hi",
    );

    const inChannel = await run(post, { channel: "#general", text: "Ship it" });
    expect(inChannel).toMatchObject({ posted: true, channel: "#general", channelId: "C0GENERAL" });
    const dm = await run(post, { channel: "U0SAM0002", text: "Hi Sam" });
    expect(dm).toMatchObject({ channel: "@sam", channelId: "D-U0SAM0002" });
    await run(post, { channel: "C0GENERAL", text: "In thread", thread_ts: inChannel.ts });

    const posted = slack.state.messages.slice(-3);
    expect(posted.map((m) => [m.channel, m.text, m.token, m.thread_ts])).toEqual([
      ["C0GENERAL", "Ship it", TOKEN, undefined],
      ["D-U0SAM0002", "Hi Sam", TOKEN, undefined],
      ["C0GENERAL", "In thread", TOKEN, inChannel.ts],
    ]);
    expect(slack.state.calls).toContain("conversations.open");
  });

  test("a revoked user token turns the tools off until Slack is reconnected", async () => {
    await connect();
    const t = await tools();
    slack.state.tokens.delete(TOKEN);
    await expect(run(t.get("slack_list_channels"), {})).rejects.toThrow("Reconnect Slack");
    const [row] = await database.db
      .select()
      .from(schema.slackAccounts)
      .where(eq(schema.slackAccounts.userId, USER));
    expect(row?.userToken).toBeNull();
    expect(row?.status).toBe("active"); // approval DMs use the bot token and keep working
    expect(
      await SlackUserClient.forUser({ fetch: slack.fetch }, database.db, box, USER),
    ).toBeNull();
  });

  test("risk facts say the post goes out as the user", () => {
    const base = { name: "slack_post_message", effect: "send" as const };
    expect(riskFacts({ ...base, input: { channel: "#general", text: "x" } })[0]).toBe(
      "Posts as you in #general",
    );
    expect(riskFacts({ ...base, input: { channel: "U0SAM0002", text: "x" } })[0]).toBe(
      "Sends a direct message as you",
    );
  });
});
