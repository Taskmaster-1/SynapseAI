import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ToolContext, ToolDefinition } from "@synapse/core";
import { createDatabase, type Database, SecretBox, schema } from "@synapse/db";
import type { JSONValue } from "ai";
import { and, eq } from "drizzle-orm";
import { buildToolset } from "..";
import {
  completeLinearAuth,
  disconnectLinear,
  type LinearAppConfig,
  LinearAuthError,
  LinearClient,
  type LinearTokens,
  linearAuthorizationUrl,
} from "./client";
import { fakeLinearApi } from "./testing";
import { linearIssueRef, linearTools, linearUpdatePreview } from "./tools";

let database: Database;
let box: SecretBox;
let linear: ReturnType<typeof fakeLinearApi>;
let app: LinearAppConfig;
const USER = "u-linear";

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
  linear = fakeLinearApi();
  app = {
    clientId: "lcid",
    clientSecret: "lsecret",
    publicUrl: "https://synapse.test",
    fetch: linear.fetch,
  };
  linear.person({ id: "lu-ada", name: "Ada Lovelace", email: "ada@acme.test" });
  linear.person({ id: "lu-sam", name: "Sam Rivera", email: "sam@acme.test" });
  linear.team({ id: "t-eng", key: "ENG", name: "Engineering", labels: ["Bug", "Frontend"] });
  linear.team({ id: "t-ops", key: "OPS", name: "Operations" });
  linear.state.workspaceLabels.push({ id: "wl-cust", name: "Customer" });
  await database.db.delete(schema.integrations);
});

/** Runs the OAuth round trip the way the routes do. */
async function connect() {
  const url = new URL(await linearAuthorizationUrl(app, box, USER));
  return completeLinearAuth(app, database.db, box, {
    userId: USER,
    code: "code-1",
    state: url.searchParams.get("state")!,
  });
}

async function row() {
  const [r] = await database.db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, USER), eq(schema.integrations.provider, "linear")));
  return r;
}

async function tools(): Promise<Map<string, ToolDefinition>> {
  const client = await LinearClient.forUser(app, database.db, box, USER);
  if (!client) throw new Error("not connected");
  return new Map(linearTools(async () => client).map((t) => [t.name, t]));
}

const run = async (tool: ToolDefinition | undefined, input: unknown) => {
  const out = await tool!.execute(input as JSONValue, ctx);
  // biome-ignore lint/suspicious/noExplicitAny: tool output is loosely typed JSON
  return (out as { value: any }).value;
};

/** Makes the stored access token look expired, so the next call refreshes. */
async function expire() {
  const r = await row();
  const tokens = JSON.parse(await box.open(r!.secret)) as LinearTokens;
  await database.db
    .update(schema.integrations)
    .set({ secret: await box.seal(JSON.stringify({ ...tokens, expiresAt: Date.now() - 1 })) })
    .where(eq(schema.integrations.id, r!.id));
}

describe("linear connect", () => {
  test("asks for read and write with PKCE, and stores tokens sealed with the workspace", async () => {
    const url = new URL(await linearAuthorizationUrl(app, box, USER));
    expect(url.origin + url.pathname).toBe("https://linear.app/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("read,write");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://synapse.test/api/integrations/linear/callback",
    );

    expect(await connect()).toEqual({ account: "ada@acme.test", workspace: "Acme" });
    const r = await row();
    expect(r).toMatchObject({ account: "ada@acme.test", status: "active", scopes: "read write" });
    expect(r!.secret).not.toContain("lin_oauth_");
    const tokens = JSON.parse(await box.open(r!.secret)) as LinearTokens;
    expect(tokens).toMatchObject({
      workspace: "Acme",
      workspaceKey: "acme",
      userName: "Ada Lovelace",
    });
    expect(tokens.refreshToken).toStartWith("lin_refresh_");
  });

  test("refuses a state from another user, or a grant without write", async () => {
    const url = new URL(await linearAuthorizationUrl(app, box, "someone-else"));
    await expect(
      completeLinearAuth(app, database.db, box, {
        userId: USER,
        code: "c",
        state: url.searchParams.get("state")!,
      }),
    ).rejects.toBeInstanceOf(LinearAuthError);
    linear.state.grantedScope = "read";
    await expect(connect()).rejects.toThrow("did not grant write access");
    expect(await row()).toBeUndefined();
  });

  test("an expired access token is refreshed, and the rotated refresh token saved", async () => {
    await connect();
    const before = JSON.parse(await box.open((await row())!.secret)) as LinearTokens;
    await expire();
    const t = await tools();
    await run(t.get("linear_list_teams"), {});
    expect(linear.state.calls).toContain("token:refresh_token");
    const after = JSON.parse(await box.open((await row())!.secret)) as LinearTokens;
    expect(after.accessToken).not.toBe(before.accessToken);
    expect(after.refreshToken).not.toBe(before.refreshToken);
    expect(after.expiresAt).toBeGreaterThan(Date.now());
  });

  test("a revoked grant switches to reconnect and withholds the tools", async () => {
    await connect();
    linear.state.refresh.clear(); // revoked at Linear
    await expire();
    const t = await tools();
    await expect(run(t.get("linear_my_issues"), {})).rejects.toThrow("Reconnect Linear");
    expect((await row())!.status).toBe("needs_auth");
    expect(await LinearClient.forUser(app, database.db, box, USER)).toBeNull();
  });

  test("a rejected access token also switches to reconnect", async () => {
    await connect();
    linear.state.tokens.clear();
    const t = await tools();
    await expect(run(t.get("linear_search"), { query: "x" })).rejects.toThrow("Reconnect Linear");
    expect((await row())!.status).toBe("needs_auth");
  });

  test("disconnect revokes both tokens at Linear and deletes them", async () => {
    await connect();
    const tokens = JSON.parse(await box.open((await row())!.secret)) as LinearTokens;
    await disconnectLinear(app, database.db, box, USER);
    expect(linear.state.revoked).toEqual([tokens.refreshToken!, tokens.accessToken]);
    expect(await row()).toBeUndefined();
  });
});

describe("linear tools", () => {
  test("are offered only when connected, and only when the server has a Linear app", async () => {
    const cfg = {
      db: database.db,
      box,
      app: { publicUrl: "https://synapse.test", appName: "t" },
      webSearch: null,
      embedder: null,
      google: null,
      slack: null,
      linear: app,
    };
    const none = await buildToolset(cfg, USER);
    expect(none.registry.get("linear_search")).toBeUndefined();
    await none.close();

    await connect();
    const after = await buildToolset(cfg, USER);
    const get = (n: string) => after.registry.get(n);
    expect(get("linear_search")?.untrustedOutput).toBe(true);
    expect(get("linear_read")?.untrustedOutput).toBe(true);
    expect(get("linear_my_issues")?.untrustedOutput).toBe(true);
    expect(get("linear_list_teams")).toMatchObject({ effect: "read", untrustedOutput: false });
    expect(get("linear_create_issue")?.effect).toBe("write");
    expect(get("linear_update_issue")?.effect).toBe("write");
    expect(get("linear_comment")?.effect).toBe("send");
    await after.close();

    const noApp = await buildToolset({ ...cfg, linear: null }, USER);
    expect(noApp.registry.get("linear_search")).toBeUndefined();
    await noApp.close();
  });

  test("search maps hits and passes team, state and assignee filters", async () => {
    await connect();
    linear.issue({
      team: "ENG",
      number: 1,
      title: "Login fails on Safari",
      assignee: "lu-ada",
      priority: 2,
    });
    linear.issue({
      team: "ENG",
      number: 2,
      title: "Login page copy",
      state: "Done",
      assignee: "lu-sam",
    });
    linear.issue({ team: "OPS", number: 3, title: "Login alerts" });
    const t = await tools();
    const all = await run(t.get("linear_search"), { query: "login" });
    expect(all.total).toBe(3);
    expect(all.issues[0]).toEqual({
      id: "ENG-1",
      title: "Login fails on Safari",
      state: "Todo",
      priority: "High",
      assignee: "Ada Lovelace",
      updated: expect.any(String),
      url: "https://linear.app/acme/issue/ENG-1/x",
    });
    const narrowed = await run(t.get("linear_search"), {
      query: "login",
      team: "eng",
      state: "done",
      assignee: "sam@acme.test",
    });
    expect(narrowed.issues.map((i: { id: string }) => i.id)).toEqual(["ENG-2"]);
    const mine = await run(t.get("linear_search"), { query: "login", assignee: "me" });
    expect(mine.issues.map((i: { id: string }) => i.id)).toEqual(["ENG-1"]);
  });

  test("read takes an identifier or a link and caps description and comments", async () => {
    await connect();
    linear.issue({
      team: "ENG",
      number: 7,
      title: "Checkout crash",
      description: "x".repeat(5000),
      labels: ["Bug"],
      assignee: "lu-sam",
    });
    for (let i = 1; i <= 12; i++) linear.comment("ENG-7", "lu-sam", `note ${i}`);
    const t = await tools();
    const out = await run(t.get("linear_read"), {
      issue: "https://linear.app/acme/issue/eng-7/checkout-crash",
    });
    expect(out).toMatchObject({
      id: "ENG-7",
      title: "Checkout crash",
      state: "Todo",
      assignee: "Sam Rivera",
      assigneeEmail: "sam@acme.test",
      labels: ["Bug"],
      team: "Engineering (ENG)",
      olderComments: 2,
    });
    expect(out.description).toEndWith("… [truncated]");
    expect(out.description.length).toBeLessThan(4100);
    expect(out.comments).toHaveLength(10);
    expect(out.comments.at(-1)).toMatchObject({ author: "Sam Rivera", body: "note 12" });

    await expect(run(t.get("linear_read"), { issue: "ENG-999" })).rejects.toThrow(
      "Linear: Entity not found: Issue",
    );
    expect(() => linearIssueRef("not an issue")).toThrow("isn't a Linear issue");
  });

  test("my issues are open ones, grouped by state", async () => {
    await connect();
    linear.issue({ team: "ENG", number: 1, title: "A", assignee: "lu-ada" });
    linear.issue({ team: "ENG", number: 2, title: "B", state: "In Progress", assignee: "lu-ada" });
    linear.issue({ team: "ENG", number: 3, title: "C", state: "Done", assignee: "lu-ada" });
    linear.issue({ team: "ENG", number: 4, title: "D", assignee: "lu-sam" });
    const t = await tools();
    const open = await run(t.get("linear_my_issues"), {});
    expect(open.total).toBe(2);
    expect(open.byState.map((g: { state: string }) => g.state).sort()).toEqual([
      "In Progress",
      "Todo",
    ]);
    expect(open.byState[0].issues[0]).not.toHaveProperty("state");
    const all = await run(t.get("linear_my_issues"), { include_closed: true });
    expect(all.total).toBe(3);
  });

  test("list teams gives keys, ordered states and labels", async () => {
    await connect();
    const t = await tools();
    const out = await run(t.get("linear_list_teams"), {});
    expect(out.teams[0]).toEqual({
      id: "t-eng",
      key: "ENG",
      name: "Engineering",
      states: [
        { name: "Backlog", type: "backlog" },
        { name: "Todo", type: "unstarted" },
        { name: "In Progress", type: "started" },
        { name: "Done", type: "completed" },
        { name: "Canceled", type: "canceled" },
      ],
      labels: ["Bug", "Frontend"],
    });
    expect(out.workspaceLabels).toEqual(["Customer"]);
    const one = await run(t.get("linear_list_teams"), { team: "ops" });
    expect(one.teams.map((x: { key: string }) => x.key)).toEqual(["OPS"]);
  });

  test("create resolves team, state, labels and assignee to ids", async () => {
    await connect();
    const t = await tools();
    const create = t.get("linear_create_issue")!;
    const input = {
      team: "eng",
      title: "Safari login loop",
      description: "Steps:\n1. Open",
      priority: "urgent",
      assignee: "sam@acme.test",
      labels: ["bug", "Customer"],
      state: "in progress",
    };
    expect(create.preview?.(input as unknown as JSONValue)).toBe(
      "Create ENG issue: Safari login loop",
    );
    const out = await run(create, input);
    expect(out).toMatchObject({ created: true, id: "ENG-101", state: "In Progress" });
    expect(linear.state.mutations.at(-1)).toEqual({
      op: "LinearCreateIssue",
      variables: {
        input: {
          teamId: "t-eng",
          title: "Safari login loop",
          description: "Steps:\n1. Open",
          stateId: "t-eng-st-2",
          labelIds: ["t-eng-lb-bug", "wl-cust"],
          priority: 1,
          assigneeId: "lu-sam",
        },
      },
    });
    await expect(run(create, { team: "ENG", title: "x", state: "Shipped" })).rejects.toThrow(
      'ENG has no state "Shipped". States: Backlog, Todo, In Progress, Done, Canceled.',
    );
    await expect(run(create, { team: "NOPE", title: "x" })).rejects.toThrow("No Linear team");
    await expect(run(create, { team: "ENG", title: "x", labels: ["Nope"] })).rejects.toThrow(
      'No label "Nope" in ENG',
    );
  });

  test("update moves, reassigns and relabels; comment posts as the user", async () => {
    await connect();
    linear.issue({ team: "ENG", number: 5, title: "Old", labels: ["Bug"], assignee: "lu-sam" });
    const t = await tools();
    expect(linearUpdatePreview({ issue: "eng-5", state: "Done" })).toBe("Move ENG-5 to Done");
    expect(linearUpdatePreview({ issue: "ENG-5", state: "Done", assignee: "me" })).toBe(
      "Update ENG-5: move to Done, assignee me",
    );
    const out = await run(t.get("linear_update_issue"), {
      issue: "ENG-5",
      state: "Done",
      assignee: "me",
      priority: "low",
      add_labels: ["Frontend"],
      remove_labels: ["bug"],
    });
    expect(out).toMatchObject({
      changed: true,
      id: "ENG-5",
      state: "Done",
      assignee: "Ada Lovelace",
      priority: "Low",
      labels: ["Frontend"],
    });
    const unassigned = await run(t.get("linear_update_issue"), {
      issue: "ENG-5",
      assignee: "none",
    });
    expect(unassigned.assignee).toBeNull();
    await expect(run(t.get("linear_update_issue"), { issue: "ENG-5" })).rejects.toThrow(
      "Nothing to change.",
    );

    const comment = t.get("linear_comment")!;
    expect(comment.preview?.({ issue: "ENG-5", body: "Fixed in   #42" })).toBe(
      "Comment on ENG-5: Fixed in #42",
    );
    const posted = await run(comment, { issue: "eng-5", body: "Fixed in #42" });
    expect(posted).toMatchObject({ commented: true, issue: "ENG-5" });
    expect(linear.state.issues.find((i) => i.identifier === "ENG-5")!.comments).toEqual([
      { body: "Fixed in #42", createdAt: expect.any(String), userId: "lu-ada" },
    ]);
  });

  test("a rate limit says when to try again", async () => {
    await connect();
    linear.state.rateLimited = true;
    const t = await tools();
    await expect(run(t.get("linear_search"), { query: "x" })).rejects.toThrow(
      "Linear's rate limit was reached. Try again in 30 seconds.",
    );
    expect((await row())!.status).toBe("active");
  });
});
