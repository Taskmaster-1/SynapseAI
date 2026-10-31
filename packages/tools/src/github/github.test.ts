import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ToolContext, ToolDefinition } from "@synapse/core";
import { createDatabase, type Database, SecretBox, schema } from "@synapse/db";
import type { JSONValue } from "ai";
import { eq } from "drizzle-orm";
import { buildToolset } from "..";
import {
  completeGitHubAuth,
  disconnectGitHub,
  type GitHubAppConfig,
  GitHubClient,
  githubAuthorizationUrl,
  githubErrorMessage,
} from "./client";
import { fakeGitHub } from "./testing";
import { githubTools, githubUpdatePreview, parseIssueRef, parseRepo } from "./tools";

let database: Database;
let box: SecretBox;
let gh: ReturnType<typeof fakeGitHub>;
let app: GitHubAppConfig;
const USER = "u-github";

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
  gh = fakeGitHub({ login: "ada" });
  app = {
    clientId: gh.state.clientId,
    clientSecret: gh.state.clientSecret,
    publicUrl: "https://synapse.test",
    fetch: gh.fetch,
  };
  gh.repo({ name: "acme/web" });
  gh.repo({ name: "acme/secret", private: true, members: ["sam"] });
  await database.db.delete(schema.integrations);
});

/** Runs the whole OAuth flow against the fake. */
async function connect() {
  const url = new URL(await githubAuthorizationUrl(app, box, USER));
  return completeGitHubAuth(app, database.db, box, {
    userId: USER,
    code: "c0de",
    state: url.searchParams.get("state")!,
  });
}

async function tools(): Promise<Map<string, ToolDefinition>> {
  const client = await GitHubClient.forUser(app, database.db, box, USER);
  if (!client) throw new Error("not connected");
  return new Map(githubTools(async () => client).map((t) => [t.name, t]));
}

// biome-ignore lint/suspicious/noExplicitAny: tool output JSON, inspected loosely
async function call(name: string, input: Record<string, unknown>): Promise<any> {
  const tool = (await tools()).get(name)!;
  const out = await tool.execute(input as JSONValue, ctx);
  return (out as { value: unknown }).value;
}

describe("refs", () => {
  test("issue refs come as owner/repo#n or URLs", () => {
    expect(parseIssueRef("acme/web#12")).toEqual({ owner: "acme", repo: "web", number: 12 });
    expect(parseIssueRef("https://github.com/acme/web/pull/7/files")).toEqual({
      owner: "acme",
      repo: "web",
      number: 7,
    });
    expect(parseIssueRef("acme/web.js/issues/3").repo).toBe("web.js");
    expect(() => parseIssueRef("acme#3")).toThrow("not an issue or pull request");
    expect(() => parseIssueRef("../x/y#1")).toThrow();
  });

  test("repos come as owner/repo or a URL", () => {
    expect(parseRepo("https://github.com/acme/web.git")).toEqual({ owner: "acme", repo: "web" });
    expect(() => parseRepo("acme")).toThrow("owner/repo");
  });

  test("update previews say what changes", () => {
    expect(githubUpdatePreview({ repo: "acme/web", number: 3, state: "closed" })).toBe(
      "Close acme/web#3",
    );
    expect(githubUpdatePreview({ repo: "acme/web", number: 3, labels: ["bug"], title: "x" })).toBe(
      "Update acme/web#3 (title, labels)",
    );
    expect(
      githubUpdatePreview({ repo: "acme/web", number: 3, state: "open", assignees: ["sam"] }),
    ).toBe("Reopen acme/web#3 and change assignees");
  });
});

describe("connect and disconnect", () => {
  test("the flow uses PKCE and the integration callback, and stores the login", async () => {
    const url = new URL(await githubAuthorizationUrl(app, box, USER));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("repo read:org");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://synapse.test/api/integrations/github/callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(await connect()).toEqual({ account: "ada" });
    expect(gh.state.exchanges.at(-1)!.code_verifier).toBeTruthy();
    const [row] = await database.db.select().from(schema.integrations);
    expect(row).toMatchObject({ provider: "github", account: "ada", status: "active" });
    expect(row!.secret).not.toContain("gho_"); // sealed
  });

  test("a grant without repo access is refused", async () => {
    gh.state.grantedScope = "read:org";
    await expect(connect()).rejects.toThrow("did not grant repository access");
  });

  test("a state from another user or a tampered one is refused", async () => {
    const url = new URL(await githubAuthorizationUrl(app, box, "someone-else"));
    await expect(
      completeGitHubAuth(app, database.db, box, {
        userId: USER,
        code: "x",
        state: url.searchParams.get("state")!,
      }),
    ).rejects.toThrow("another user");
    await expect(
      completeGitHubAuth(app, database.db, box, { userId: USER, code: "x", state: "nope" }),
    ).rejects.toThrow("invalid");
  });

  test("disconnecting revokes the grant, or only the token when sign-in shares the app", async () => {
    await connect();
    await disconnectGitHub(app, database.db, box, USER);
    expect(gh.state.revoked).toHaveLength(1);
    expect(gh.state.revoked[0]!.startsWith("grant:")).toBe(true);
    expect(await database.db.select().from(schema.integrations)).toEqual([]);

    await connect();
    await disconnectGitHub({ ...app, sharedWithSignIn: true }, database.db, box, USER);
    expect(gh.state.revoked[1]!.startsWith("token:")).toBe(true);
  });

  test("tools are only offered when connected", async () => {
    const cfg = {
      db: database.db,
      box,
      app: { publicUrl: "https://synapse.test", appName: "Synapse" },
      webSearch: null,
      embedder: null,
      google: null,
      slack: null,
      github: app,
    };
    const names = async () => {
      const t = await buildToolset(cfg, USER);
      await t.close();
      return t.registry.list().map((x) => x.name);
    };
    expect(await names()).not.toContain("github_search");
    await connect();
    expect(await names()).toContain("github_comment");
    expect(await names()).toContain("github_read_file");
  });
});

describe("tools", () => {
  beforeEach(connect);

  test("search maps hits compactly and runs issues and PRs separately when untyped", async () => {
    gh.issue({ repo: "acme/web", number: 1, title: "Login broken on Safari", labels: ["bug"] });
    gh.issue({
      repo: "acme/web",
      number: 2,
      title: "Fix login on Safari",
      pr: {
        head: "fix",
        base: "main",
        sha: "abc",
        merged: true,
        files: [],
        reviews: [],
        requested: [],
        checks: [],
      },
    });
    gh.issue({ repo: "acme/secret", number: 1, title: "Login secret" });
    const res = await call("github_search", { query: "repo:acme/web login" });
    expect(res.total).toBe(2);
    expect(res.results.map((r: { ref: string; type: string; state: string }) => r)).toEqual([
      expect.objectContaining({ ref: "acme/web#2", type: "pull_request", state: "merged" }),
      expect.objectContaining({
        ref: "acme/web#1",
        type: "issue",
        state: "open",
        labels: ["bug"],
        url: "https://github.com/acme/web/issues/1",
      }),
    ]);
    expect(gh.state.calls.filter((c) => c === "GET /search/issues")).toHaveLength(2);
    // A typed query runs once and passes qualifiers through.
    const typed = await call("github_search", { query: "is:issue is:open label:bug" });
    expect(typed.results.map((r: { ref: string }) => r.ref)).toEqual(["acme/web#1"]);
  });

  test("reading a PR gives branches, files, reviews, checks and the latest comments", async () => {
    const pr = gh.issue({
      repo: "acme/web",
      number: 9,
      title: "Speed up builds",
      author: "sam",
      body: "x".repeat(5000),
      labels: ["perf"],
      pr: {
        head: "fast-builds",
        base: "main",
        sha: "deadbeef",
        mergeable_state: "blocked",
        files: [
          { filename: "build.ts", status: "modified", additions: 10, deletions: 2 },
          { filename: "old.ts", status: "removed", additions: 0, deletions: 40 },
        ],
        reviews: [
          { user: "ada", state: "APPROVED" },
          { user: "ada", state: "COMMENTED" },
          { user: "lin", state: "CHANGES_REQUESTED" },
        ],
        requested: ["kim"],
        checks: [
          { name: "test", status: "completed", conclusion: "success" },
          { name: "lint", status: "completed", conclusion: "failure" },
          { name: "e2e", status: "in_progress", conclusion: null },
        ],
      },
    });
    for (let k = 1; k <= 13; k++) gh.comment(pr, "sam", `comment ${k}`);
    const res = await call("github_read", {
      ref: "https://github.com/acme/web/pull/9",
      comments: 5,
    });
    expect(res).toMatchObject({
      ref: "acme/web#9",
      type: "pull_request",
      state: "open",
      author: "sam",
      head: "acme:fast-builds",
      base: "main",
      mergeable: true,
      mergeableState: "blocked",
      additions: 10,
      deletions: 42,
      changedFiles: 2,
      commentCount: 13,
      reviews: {
        decision: "changes_requested",
        reviewers: [
          { user: "ada", state: "approved" },
          { user: "lin", state: "changes_requested" },
        ],
        requested: ["kim"],
      },
      checks: { state: "failing", passed: 1, failed: 1, pending: 1, failing: ["lint (failure)"] },
    });
    expect(res.files[1]).toEqual({
      path: "old.ts",
      status: "removed",
      additions: 0,
      deletions: 40,
    });
    expect(res.body.length).toBeLessThan(4100);
    expect(res.body).toEndWith("[truncated]");
    expect(res.comments.map((c: { body: string }) => c.body)).toEqual([
      "comment 9",
      "comment 10",
      "comment 11",
      "comment 12",
      "comment 13",
    ]);
  });

  test("my work lists review requests, assignments and my PRs", async () => {
    const pr = {
      head: "x",
      base: "main",
      sha: "s",
      files: [],
      reviews: [],
      checks: [],
    };
    gh.issue({
      repo: "acme/web",
      number: 1,
      title: "Review me",
      pr: { ...pr, requested: ["ada"] },
    });
    gh.issue({ repo: "acme/web", number: 2, title: "Fix it", assignees: ["ada"] });
    gh.issue({
      repo: "acme/web",
      number: 3,
      title: "Mine",
      author: "ada",
      pr: { ...pr, requested: [] },
    });
    gh.issue({ repo: "acme/web", number: 4, title: "Closed", assignees: ["ada"], state: "closed" });
    const res = await call("github_my_work", {});
    expect(res.login).toBe("ada");
    expect(res.reviewRequested.items.map((i: { ref: string }) => i.ref)).toEqual(["acme/web#1"]);
    expect(res.assignedIssues.items.map((i: { ref: string }) => i.ref)).toEqual(["acme/web#2"]);
    expect(res.myPullRequests.items.map((i: { ref: string }) => i.ref)).toEqual(["acme/web#3"]);
  });

  test("files are decoded and capped; binaries and directories are described", async () => {
    gh.state.repos[0]!.files = {
      "README.md": "# Web\n",
      "src/big.ts": "a".repeat(30_000),
      "logo.png": new Uint8Array([137, 80, 78, 71, 0, 1, 2]),
    };
    expect(await call("github_read_file", { repo: "acme/web", path: "README.md" })).toMatchObject({
      content: "# Web\n",
    });
    const big = await call("github_read_file", { repo: "acme/web", path: "src/big.ts" });
    expect(big.content).toEndWith("[truncated]");
    expect(big.size).toBe(30_000);
    const png = await call("github_read_file", { repo: "acme/web", path: "logo.png" });
    expect(png.binary).toBe(true);
    expect(png.content).toBeUndefined();
    const dir = await call("github_read_file", { repo: "acme/web", path: "src" });
    expect(dir.entries).toEqual([{ name: "big.ts", type: "file", size: 0 }]);
  });

  test("writes post with the user's token", async () => {
    gh.issue({ repo: "acme/web", number: 5, title: "Flaky test" });
    const c = await call("github_comment", { repo: "acme/web", number: 5, body: "On it." });
    expect(c).toMatchObject({ commented: true, ref: "acme/web#5" });
    expect(gh.state.issues[0]!.comments[0]).toMatchObject({ author: "ada", body: "On it." });

    const made = await call("github_create_issue", {
      repo: "acme/web",
      title: "New bug",
      body: "Steps",
      labels: ["bug"],
      assignees: ["@sam"],
    });
    expect(made.ref).toBe("acme/web#6");
    expect(gh.state.issues.at(-1)).toMatchObject({ labels: ["bug"], assignees: ["sam"] });

    const closed = await call("github_update_issue", {
      repo: "acme/web",
      number: 6,
      state: "closed",
      state_reason: "not_planned",
      labels: [],
    });
    expect(closed).toMatchObject({ state: "closed", labels: [] });
    await expect(call("github_update_issue", { repo: "acme/web", number: 6 })).rejects.toThrow(
      "Nothing to change",
    );
  });

  test("previews say where it goes", async () => {
    const t = await tools();
    expect(
      t.get("github_comment")!.preview!({ repo: "acme/web", number: 5, body: "Looks good\nto me" }),
    ).toBe("Comment on acme/web#5: Looks good to me");
    expect(t.get("github_create_issue")!.preview!({ repo: "acme/web", title: "Crash" })).toBe(
      "Open issue in acme/web: Crash",
    );
  });
});

describe("errors", () => {
  beforeEach(connect);

  test("404 and private repositories read as not found or no access", async () => {
    gh.issue({ repo: "acme/secret", number: 1, title: "Hidden" });
    await expect(call("github_read", { ref: "acme/secret#1" })).rejects.toThrow(
      "acme/secret#1 was not found on GitHub, or the connected account has no access to it.",
    );
  });

  test("rate limits say when they reset", async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    gh.failNext({
      path: "/search/issues",
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
      body: { message: "API rate limit exceeded" },
    });
    await expect(call("github_search", { query: "is:issue x" })).rejects.toThrow(
      /GitHub rate limit reached; it resets at \d\d:\d\d UTC \(in 10 min\)/,
    );
    gh.failNext({ path: "/search/issues", status: 429, headers: { "retry-after": "30" } });
    await expect(call("github_search", { query: "is:issue x" })).rejects.toThrow(
      "Try again in 30 seconds",
    );
  });

  test("a revoked token marks the integration for reconnect and withdraws the tools", async () => {
    const t = await tools();
    gh.state.tokens.clear();
    await expect(t.get("github_my_work")!.execute({}, ctx)).rejects.toThrow(
      "Reconnect GitHub under Connections",
    );
    const [row] = await database.db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.userId, USER));
    expect(row!.status).toBe("needs_auth");
    expect(await GitHubClient.forUser(app, database.db, box, USER)).toBeNull();
  });

  test("validation errors carry GitHub's details", () => {
    expect(
      githubErrorMessage(
        422,
        new Headers(),
        JSON.stringify({
          message: "Validation Failed",
          errors: [{ field: "assignees", code: "invalid" }],
        }),
        "acme/web",
      ),
    ).toBe("GitHub rejected the request: Validation Failed (assignees invalid)");
  });
});
