import { afterAll, beforeAll, expect, test } from "bun:test";
import { type ScriptedStep, scriptedModel } from "@synapse/core/testing";
import { schema } from "@synapse/db";
import { and, eq } from "drizzle-orm";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { outcomeText, renderInput } from "./notify/slack";
import { verifySlackSignature } from "./notify/slack-api";
import { fakeSlack } from "./notify/slack-testing";
import { createServices, type Services } from "./services";
import { Worker } from "./worker";

const ORIGIN = "http://localhost:3000";
const SIGNING = "signing-secret-123";
const slack = fakeSlack({ teamId: "T1", teamName: "Acme" });
let services: Services;
let app: ReturnType<typeof createApp>;
let worker: Worker;
let model = scriptedModel([]);
const script = (steps: ScriptedStep[]) => {
  model = scriptedModel(steps);
};

beforeAll(async () => {
  services = await createServices(
    loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "pglite://memory",
      SYNAPSE_SECRET: "t".repeat(40),
      PUBLIC_URL: ORIGIN,
      SLACK_CLIENT_ID: "cid",
      SLACK_CLIENT_SECRET: "csecret",
      SLACK_SIGNING_SECRET: SIGNING,
    }),
  );
  services.config.slack!.fetch = slack.fetch;
  app = createApp(services);
  worker = new Worker(services, () => [model]);
});
afterAll(() => services.close());

async function signUp(email: string) {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password: "correct horse battery", name: email.split("@")[0] }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return async (path: string, init: { method?: string; json?: unknown } = {}) => {
    const r = await app.request(path, {
      method: init.method ?? "GET",
      headers: {
        cookie,
        origin: ORIGIN,
        ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    const text = await r.text();
    return {
      status: r.status,
      location: r.headers.get("location"),
      json:
        text && r.headers.get("content-type")?.includes("json")
          ? // biome-ignore lint/suspicious/noExplicitAny: test responses are loosely typed JSON
            (JSON.parse(text) as any)
          : null,
    };
  };
}
type Client = Awaited<ReturnType<typeof signUp>>;

async function connectSlack(me: Client, slackUser: string) {
  slack.state.nextUser = slackUser;
  const start = await me("/api/integrations/slack/connect", { method: "POST", json: {} });
  expect(start.status).toBe(200);
  const url = new URL(start.json.url);
  expect(url.host).toBe("slack.com");
  expect(url.searchParams.get("scope")).toBe("chat:write,im:write,users:read");
  expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/integrations/slack/callback`);
  const state = url.searchParams.get("state")!;
  const back = await me(
    `/api/integrations/slack/callback?code=abc&state=${encodeURIComponent(state)}`,
  );
  expect(back.location).toBe(`${ORIGIN}/connections?connected=slack`);
}

/** Starts a task whose one action (saving a memory) waits for approval. */
async function ask(me: Client, note = "likes tea", content = "remember tea") {
  await me("/api/policy", {
    method: "PUT",
    json: {
      defaults: { read: "allow", write: "ask", send: "ask", destructive: "ask" },
      rules: [{ tool: "memory_save", decision: "ask" }],
    },
  });
  script([{ toolCalls: [{ name: "memory_save", input: { note }, id: "n1" }] }, { text: "Saved." }]);
  const { json } = await me("/api/chats", { method: "POST", json: { content } });
  const runId = json.runId as string;
  await worker.processNow(runId);
  return runId;
}

const call = async (runId: string) =>
  (
    await services.database.db
      .select()
      .from(schema.toolCalls)
      .where(and(eq(schema.toolCalls.runId, runId), eq(schema.toolCalls.id, "n1")))
  )[0]!;

async function click(req: ReturnType<typeof slack.click>) {
  const res = await app.request("/api/slack/interactions", req);
  await services.slack!.settled();
  return res;
}

const lastBlockText = (m: { blocks: { text?: { text: string } }[] }) =>
  m.blocks.map((b) => b.text?.text ?? "").join("\n");

test("connecting Slack over HTTP is bound to the user who started it", async () => {
  const me = await signUp("slack-connect@example.com");
  const before = await me("/api/integrations");
  expect(before.json.slack).toEqual({ available: true, connection: null });

  const start = await me("/api/integrations/slack/connect", { method: "POST", json: {} });
  const state = new URL(start.json.url).searchParams.get("state")!;
  const eve = await signUp("slack-eve@example.com");
  const stolen = await eve(
    `/api/integrations/slack/callback?code=x&state=${encodeURIComponent(state)}`,
  );
  expect(decodeURIComponent(stolen.location!)).toContain("belongs to another user");
  expect((await eve("/api/integrations")).json.slack.connection).toBeNull();

  const cancelled = await me("/api/integrations/slack/callback?error=access_denied");
  expect(decodeURIComponent(cancelled.location!)).toContain("You cancelled");

  await connectSlack(me, "U-conn");
  const after = await me("/api/integrations");
  expect(after.json.slack.connection).toMatchObject({ team: "Acme", status: "active" });
  const [row] = await services.database.db.select().from(schema.slackAccounts);
  expect(row?.botToken.startsWith("xoxb-")).toBe(false); // sealed at rest

  // The same Slack person can't answer for a second Synapse user.
  slack.state.nextUser = "U-conn";
  const again = await eve("/api/integrations/slack/connect", { method: "POST", json: {} });
  const s2 = new URL(again.json.url).searchParams.get("state")!;
  const dup = await eve(`/api/integrations/slack/callback?code=y&state=${encodeURIComponent(s2)}`);
  expect(decodeURIComponent(dup.location!)).toContain("already connected");

  const test = await me("/api/integrations/slack/test", { method: "POST", json: {} });
  expect(test.status).toBe(200);
  expect(slack.dms("U-conn").at(-1)?.text).toContain("Synapse is connected");

  expect((await me("/api/integrations/slack", { method: "DELETE" })).status).toBe(204);
  expect(slack.state.revoked).toHaveLength(1);
  expect((await me("/api/integrations")).json.slack.connection).toBeNull();
});

test("an approval is DMed with buttons, and a signed click from the right person approves it", async () => {
  const me = await signUp("slack-ada@example.com");
  await connectSlack(me, "U-ada");
  const runId = await ask(me, "likes green tea");

  const dms = slack.dms("U-ada");
  expect(dms).toHaveLength(1);
  const msg = dms[0]!;
  expect(msg.blocks[0]).toEqual({
    type: "header",
    text: { type: "plain_text", text: "Synapse needs your OK" },
  });
  const text = lastBlockText(msg);
  expect(text).toContain("likes green tea");
  const actions = msg.blocks.find((b) => b.type === "actions");
  expect(actions.elements.map((e: { action_id: string }) => e.action_id)).toEqual([
    "approve",
    "deny",
    "open",
  ]);
  expect(actions.elements[0].style).toBe("primary");
  expect(actions.elements[1].style).toBe("danger");
  expect(actions.elements[2].url).toStartWith(`${ORIGIN}/t/`);
  const [stored] = await services.database.db
    .select()
    .from(schema.slackMessages)
    .where(eq(schema.slackMessages.runId, runId));
  expect(stored).toMatchObject({ toolCallId: "n1", channel: msg.channel, ts: msg.ts });

  // Forged and stale requests are refused before anything is read.
  const forged = await click(slack.click(msg, "approve", { signingSecret: "wrong" }));
  expect(forged.status).toBe(401);
  const stale = await click(
    slack.click(msg, "approve", {
      signingSecret: SIGNING,
      user: "U-ada",
      timestamp: Math.floor(Date.now() / 1000) - 6 * 60,
    }),
  );
  expect(stale.status).toBe(401);
  const tampered = slack.click(msg, "approve", { signingSecret: SIGNING, user: "U-ada" });
  tampered.body = tampered.body.replace("approve", "deny");
  expect((await click(tampered)).status).toBe(401);
  expect((await call(runId)).status).toBe("awaiting_approval");

  // Another Slack user (connected to nobody here) is refused.
  const other = await click(slack.click(msg, "approve", { signingSecret: SIGNING, user: "U-x" }));
  expect(other.status).toBe(200);
  expect((await call(runId)).status).toBe("awaiting_approval");
  expect(slack.state.responses.at(-1)).toMatchObject({ response_type: "ephemeral" });

  // Clicked on the message as it was, before it updated (a double click, or a second device).
  const late = slack.click(msg, "deny", { signingSecret: SIGNING, user: "U-ada" });
  const ok = await click(slack.click(msg, "approve", { signingSecret: SIGNING, user: "U-ada" }));
  expect(ok.status).toBe(200);
  const decided = await call(runId);
  expect(decided).toMatchObject({ decidedVia: "slack" });
  expect(["approved", "succeeded"]).toContain(decided.status);
  expect(msg.updates).toBe(1);
  expect(lastBlockText(msg)).toContain("Approved by you");
  expect(msg.blocks.some((b) => b.type === "actions")).toBe(false);

  // A double click shows the current state instead of failing.
  const twice = await click(late);
  expect(twice.status).toBe(200);
  expect(msg.updates).toBe(2);
  expect(lastBlockText(msg)).toContain("Approved by you");
  expect((await call(runId)).decidedVia).toBe("slack");
});

test("a connected Slack user can't decide someone else's action", async () => {
  const bob = await signUp("slack-bob@example.com");
  const mal = await signUp("slack-mal@example.com");
  await connectSlack(bob, "U-bob");
  await connectSlack(mal, "U-mal");
  const runId = await ask(bob);
  const msg = slack.dms("U-bob").at(-1)!;
  expect(slack.dms("U-mal")).toHaveLength(0);
  const res = await click(slack.click(msg, "approve", { signingSecret: SIGNING, user: "U-mal" }));
  expect(res.status).toBe(200);
  expect((await call(runId)).status).toBe("awaiting_approval");
  expect(String(slack.state.responses.at(-1)?.text)).toContain("Only the person");
  expect(msg.updates).toBe(0);

  // Denying from Slack.
  await click(slack.click(msg, "deny", { signingSecret: SIGNING, user: "U-bob" }));
  expect(await call(runId)).toMatchObject({ status: "denied", decidedVia: "slack" });
  expect(lastBlockText(msg)).toContain("Denied by you");
});

test("deciding in the web app updates the Slack message", async () => {
  const me = await signUp("slack-web@example.com");
  await connectSlack(me, "U-web");
  const runId = await ask(me);
  const msg = slack.dms("U-web").at(-1)!;
  const res = await me(`/api/runs/${runId}/tool-calls/n1/decision`, {
    method: "POST",
    json: { approved: true },
  });
  expect(res.status).toBe(200);
  expect(msg.updates).toBe(1);
  expect(lastBlockText(msg)).toContain("Approved in the web app");
  expect(msg.blocks.some((b) => b.type === "actions")).toBe(false);
});

test("nothing is sent to people without Slack", async () => {
  const me = await signUp("slack-none@example.com");
  const before = slack.state.calls.length;
  const runId = await ask(me);
  expect((await call(runId)).status).toBe("awaiting_approval");
  expect(slack.state.calls.slice(before)).toEqual([]);
});

test("rendering: email inputs, key fields, outcome lines, signatures", () => {
  const email = renderInput({
    to: ["bob@acme.com"],
    subject: "Re: <Sync>",
    body: "Hi Bob,\n\nSee you at 3.\nline 3\nline 4\nline 5\nline 6",
  })!;
  expect(email).toContain("*To:* bob@acme.com");
  expect(email).toContain("*Subject:* Re: &lt;Sync&gt;");
  expect(email).toContain("> Hi Bob,");
  expect(email).toContain("> …");
  expect(renderInput({ note: "x".repeat(500) })!.length).toBeLessThan(200);
  // Untrusted text can't smuggle in a link or a mention.
  expect(renderInput({ note: "<https://evil.test|click> <@U1>" })).not.toContain("<");

  const now = Date.now();
  expect(
    outcomeText({
      approved: true,
      via: "slack",
      byYou: true,
      executeAfter: new Date(now + 10_000),
      now,
    }),
  ).toBe("Approved by you · sending in 10s (undo in Synapse)");
  expect(outcomeText({ approved: false, via: "push", byYou: false, executeAfter: null })).toBe(
    "Denied from your phone",
  );

  const ts = Math.floor(now / 1000);
  expect(verifySlackSignature("s", { timestamp: String(ts), signature: "v0=00", body: "" })).toBe(
    false,
  );
  expect(verifySlackSignature("s", { timestamp: undefined, signature: "x", body: "" })).toBe(false);
});
