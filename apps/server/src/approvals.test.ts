import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { UNDO_DENIAL } from "@synapse/core";
import { type ScriptedStep, scriptedModel } from "@synapse/core/testing";
import { approvalsNeeded, EXPIRY_DENIAL, readEvents, schema } from "@synapse/db";
import { fakeGoogle } from "@synapse/tools/testing";
import { and, eq, sql } from "drizzle-orm";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { fakeSlack } from "./notify/slack-testing";
import type { PendingApproval, ResolvedApproval } from "./notify/types";
import { createServices, type Services } from "./services";
import { sweepApprovals } from "./sweeper";
import { Worker } from "./worker";

const ORIGIN = "http://localhost:3000";
const SIGNING = "signing-secret-123";
const google = fakeGoogle({ email: "ops@acme.io" });
const slack = fakeSlack({ teamId: "T1", teamName: "Acme" });
let services: Services;
let app: ReturnType<typeof createApp>;
let worker: Worker;
let model = scriptedModel([]);
const script = (steps: ScriptedStep[]) => {
  model = scriptedModel(steps);
};
const seen: PendingApproval[] = [];
const resolved: ResolvedApproval[] = [];

beforeAll(async () => {
  services = await createServices(
    loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "pglite://memory",
      SYNAPSE_SECRET: "t".repeat(40),
      PUBLIC_URL: ORIGIN,
      GOOGLE_CLIENT_ID: "cid",
      GOOGLE_CLIENT_SECRET: "secret",
      SLACK_CLIENT_ID: "cid",
      SLACK_CLIENT_SECRET: "csecret",
      SLACK_SIGNING_SECRET: SIGNING,
    }),
  );
  services.config.google!.fetch = google.fetch;
  services.config.slack!.fetch = slack.fetch;
  app = createApp(services);
  worker = new Worker(services, () => [model]);
  services.notifier.add({
    name: "test",
    notify: async (a) => {
      seen.push(...a);
    },
    resolved: async (r) => {
      resolved.push(...r);
    },
  });
});
afterAll(() => services.close());

const MIN = 60_000;
const HOUR = 60 * MIN;
const later = (ms: number) => new Date(Date.now() + ms);
const sweep = (at: Date) => sweepApprovals(services, at);

interface Person {
  id: string;
  email: string;
  call: (
    path: string,
    init?: { method?: string; json?: unknown },
  ) => Promise<{
    status: number;
    // biome-ignore lint/suspicious/noExplicitAny: test responses are loosely typed JSON
    json: any;
    text: string;
  }>;
}

async function signUp(email: string): Promise<Person> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password: "correct horse battery", name: email.split("@")[0] }),
  });
  expect(res.status).toBe(200);
  const { user } = (await res.json()) as { user: { id: string } };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return {
    id: user.id,
    email,
    call: async (path, init = {}) => {
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
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}
      return { status: r.status, json, text };
    },
  };
}

async function invite(admin: Person, who: Person, role: "admin" | "member" = "member") {
  const created = await admin.call("/api/workspace/invites", { method: "POST", json: { role } });
  const token = (created.json.link as string).split("/join/")[1]!;
  const joined = await who.call("/api/workspace/join", { method: "POST", json: { token } });
  expect(joined.status).toBe(200);
}

/** A team: owner, admin and member at `domain`. */
async function team(domain: string, settings: Record<string, unknown> = {}) {
  const owner = await signUp(`owner@${domain}`);
  const admin = await signUp(`admin@${domain}`);
  const member = await signUp(`dev@${domain}`);
  await owner.call("/api/workspace", { method: "POST", json: { name: domain } });
  await invite(owner, admin, "admin");
  await invite(owner, member);
  if (Object.keys(settings).length) {
    const res = await owner.call("/api/workspace", { method: "PATCH", json: settings });
    expect(res.status).toBe(200);
  }
  return { owner, admin, member };
}

async function connectGoogle(me: Person) {
  const start = await me.call("/api/integrations/google/connect", { method: "POST", json: {} });
  const state = new URL(start.json.url).searchParams.get("state")!;
  await me.call(`/api/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`);
}

async function connectSlack(me: Person, slackUser: string) {
  slack.state.nextUser = slackUser;
  const start = await me.call("/api/integrations/slack/connect", { method: "POST", json: {} });
  const state = new URL(start.json.url).searchParams.get("state")!;
  await me.call(`/api/integrations/slack/callback?code=abc&state=${encodeURIComponent(state)}`);
}

const askAll = {
  defaults: { read: "allow", write: "ask", send: "ask", destructive: "ask" },
  rules: [{ tool: "memory_save", decision: "ask" }],
};

/** Starts a task whose first step proposes `first`, and drives it to the approval. */
async function proposed(me: Person, first: ScriptedStep, then = "Done.") {
  await me.call("/api/policy", { method: "PUT", json: askAll });
  script([first, { text: then }]);
  const { json } = await me.call("/api/chats", { method: "POST", json: { content: "Go" } });
  await worker.processNow(json.runId);
  expect((await runOf(json.runId)).status).toBe("waiting");
  return json.runId as string;
}

const save = (id: string): ScriptedStep => ({
  toolCalls: [{ name: "memory_save", input: { note: "likes tea" }, id }],
});
const send = (id: string, to = "priya@northwind.co"): ScriptedStep => ({
  toolCalls: [{ name: "gmail_send", id, input: { to: [to], subject: "Hi", body: "Hello" } }],
});

async function runOf(runId: string) {
  const [run] = await services.database.db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, runId));
  return run!;
}

async function callOf(runId: string, id: string) {
  const [call] = await services.database.db
    .select()
    .from(schema.toolCalls)
    .where(and(eq(schema.toolCalls.runId, runId), eq(schema.toolCalls.id, id)));
  return call!;
}

const notices = (toolCallId: string, kind?: PendingApproval["kind"]) =>
  seen.filter((a) => a.toolCallId === toolCallId && (!kind || a.kind === kind));

const decide = (p: Person, runId: string, id: string, json: Record<string, unknown>) =>
  p.call(`/api/runs/${runId}/tool-calls/${id}/decision`, { method: "POST", json });

describe("reminders, escalation, expiry", () => {
  // Earlier tests leave approvals waiting: expire them so counts below are this test's own.
  beforeEach(() => sweep(later(400 * 24 * HOUR)).then(() => {}));

  test("remind once, escalate to the team's admins, then expire as a deny the agent sees", async () => {
    const { owner, admin, member } = await team("remind.io");
    const runId = await proposed(member, save("r1"), "It wasn't approved in time.");

    // Announced with an expiry from the defaults (24 h).
    const call = await callOf(runId, "r1");
    expect(call.notifiedAt).not.toBeNull();
    expect(call.expiresAt!.getTime() - call.notifiedAt!.getTime()).toBe(24 * HOUR);
    expect(notices("r1", "new")).toHaveLength(1);
    const mine = (await member.call("/api/approvals")).json.approvals[0];
    expect(mine).toMatchObject({ toolCallId: "r1", escalatedAt: null });
    expect(Date.parse(mine.expiresAt)).toBe(call.expiresAt!.getTime());

    // Nothing is due yet.
    expect(await sweep(later(10 * MIN))).toMatchObject({ reminded: 0, escalated: 0, expired: 0 });

    // 30 minutes: one reminder, to the member only.
    expect(await sweep(later(31 * MIN))).toMatchObject({ reminded: 1, escalated: 0 });
    expect(notices("r1", "reminder")).toEqual([
      expect.objectContaining({ recipients: [member.id], expiresAt: call.expiresAt }),
    ]);
    expect(await sweep(later(40 * MIN))).toMatchObject({ reminded: 0 });
    expect((await callOf(runId, "r1")).remindedAt).not.toBeNull();

    // Before escalation, admins can't see or decide a member's own call.
    expect((await admin.call("/api/workspace/approvals")).json.approvals).toEqual([]);
    expect((await decide(admin, runId, "r1", { approved: false })).status).toBe(404);

    // An hour: escalated to the owner and admin (not the member, who already knows).
    expect(await sweep(later(61 * MIN))).toMatchObject({ escalated: 1, reminded: 0 });
    const esc = notices("r1", "escalated");
    expect(esc).toHaveLength(1);
    expect(esc[0]!.recipients.sort()).toEqual([owner.id, admin.id].sort());
    expect(esc[0]!.escalated).toBe(true);
    expect(esc[0]!.url).toBe(`${ORIGIN}/inbox?id=r1`);
    expect(await sweep(later(90 * MIN))).toMatchObject({ escalated: 0 });
    const inbox = (await admin.call("/api/workspace/approvals")).json.approvals;
    expect(inbox).toEqual([
      expect.objectContaining({
        toolCallId: "r1",
        requester: expect.objectContaining({ id: member.id }),
      }),
    ]);
    expect(inbox[0].escalatedAt).toBeTruthy();

    // A day: expired. A deny like any other, that the agent sees, and the run goes on.
    expect(await sweep(later(24 * HOUR + MIN))).toMatchObject({ expired: 1 });
    expect(await callOf(runId, "r1")).toMatchObject({
      status: "denied",
      decidedBy: null,
      decidedVia: "expiry",
      output: { type: "denied", reason: EXPIRY_DENIAL },
    });
    expect(EXPIRY_DENIAL).toStartWith("Expired: nobody decided in time");
    expect(resolved).toContainEqual(
      expect.objectContaining({ toolCallId: "r1", approved: false, via: "expiry" }),
    );
    expect((await runOf(runId)).status).toBe("queued");
    const log = await readEvents(services.database, runId, 0);
    expect(
      log.filter((e) => e.type === "tool.status" && e.toolCallId === "r1").at(-1),
    ).toMatchObject({ status: "denied" });
    await worker.processNow(runId);
    expect((await runOf(runId)).status).toBe("completed");
    // The agent's next step got the expiry as the tool result.
    const [msg] = await services.database.db
      .select()
      .from(schema.messages)
      .where(
        and(eq(schema.messages.runId, runId), sql`${schema.messages.message}->>'role' = 'tool'`),
      );
    expect(JSON.stringify(msg?.message)).toContain("Expired: nobody decided in time");
    // Deciding now is too late.
    expect((await decide(member, runId, "r1", { approved: true })).status).toBe(409);

    // Activity and the audit log show the reminder, escalation and expiry.
    const detail = (await member.call(`/api/runs/${runId}`)).json.toolCalls[0];
    expect(detail).toMatchObject({ status: "denied", decidedVia: "expiry" });
    expect(detail.remindedAt).toBeTruthy();
    expect(detail.escalatedAt).toBeTruthy();
    const csv = (await owner.call("/api/workspace/audit.csv")).text.split("\r\n");
    const row = csv.find((l) => l.includes("dev@remind.io"))!;
    expect(row).toContain(",denied,,expiry,");
    expect(row).toMatch(/,\d{4}-\d\d-\d\dT[^,]+,\d{4}-\d\d-\d\dT[^,]+$/);
  });

  test("sweeps are idempotent: many workers at once remind, escalate and expire once", async () => {
    const { member } = await team("race.io");
    const runId = await proposed(member, save("x1"));
    const before = { events: (await readEvents(services.database, runId, 0)).length };

    const at = later(2 * HOUR);
    const results = await Promise.all([sweep(at), sweep(at), sweep(at), sweep(at)]);
    expect(results.reduce((n, r) => n + r.reminded, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.escalated, 0)).toBe(1);
    expect(notices("x1", "reminder")).toHaveLength(1);
    expect(notices("x1", "escalated")).toHaveLength(1);

    const end = later(25 * HOUR);
    const ends = await Promise.all([sweep(end), sweep(end), sweep(end)]);
    expect(ends.reduce((n, r) => n + r.expired, 0)).toBe(1);
    expect(resolved.filter((r) => r.toolCallId === "x1" && r.via === "expiry")).toHaveLength(1);
    const events = (await readEvents(services.database, runId, 0)).slice(before.events);
    expect(events.filter((e) => e.type === "tool.result")).toHaveLength(1);
  });

  test("a call a worker never announced is announced by the sweeper", async () => {
    const me = await signUp("quiet@solo.io");
    const runId = await proposed(me, save("q1"));
    await services.database.db
      .update(schema.toolCalls)
      .set({ notifiedAt: null, expiresAt: null })
      .where(eq(schema.toolCalls.runId, runId));
    expect(await sweep(later(30_000))).toMatchObject({ announced: 0 });
    expect(await sweep(later(3 * MIN))).toMatchObject({ announced: 1 });
    expect((await callOf(runId, "q1")).expiresAt).not.toBeNull();
  });

  test("personal settings: no escalation without a team; 0 turns reminders and expiry off", async () => {
    const me = await signUp("solo@solo.io");
    const s = (await me.call("/api/settings")).json;
    expect(s).toMatchObject({ remindMinutes: 30, expireHours: 24 });
    expect(
      (await me.call("/api/settings", { method: "PUT", json: { expireHours: 24 * 15 } })).status,
    ).toBe(422);
    const runId = await proposed(me, save("p1"));
    expect(await sweep(later(5 * HOUR))).toMatchObject({ reminded: 1, escalated: 0 });
    expect(notices("p1", "escalated")).toHaveLength(0);

    await me.call("/api/settings", { method: "PUT", json: { remindMinutes: 0, expireHours: 0 } });
    await decide(me, runId, "p1", { approved: false });
    await worker.processNow(runId);
    const second = await proposed(me, save("p2"));
    expect((await callOf(second, "p2")).expiresAt).toBeNull();
    expect(await sweep(later(30 * 24 * HOUR))).toMatchObject({ reminded: 0, expired: 0 });
    expect((await callOf(second, "p2")).status).toBe("awaiting_approval");

    // A shorter reminder applies to new approvals.
    await me.call("/api/settings", { method: "PUT", json: { remindMinutes: 5, expireHours: 1 } });
    await decide(me, second, "p2", { approved: false });
    await worker.processNow(second);
    const third = await proposed(me, save("p3"));
    expect(await sweep(later(6 * MIN))).toMatchObject({ reminded: 1 });
    expect(await sweep(later(61 * MIN))).toMatchObject({ expired: 1 });
    expect((await callOf(third, "p3")).status).toBe("denied");
  });

  test("team settings: escalation off, and a team-wide expiry", async () => {
    const { owner, member } = await team("quiet.io", { escalateMinutes: 0, expireHours: 2 });
    const ws = (await owner.call("/api/workspace")).json.workspace;
    expect(ws).toMatchObject({ escalateMinutes: 0, expireHours: 2, twoPerson: null });
    expect(
      (await member.call("/api/workspace", { method: "PATCH", json: { escalateMinutes: 5 } }))
        .status,
    ).toBe(403);
    const runId = await proposed(member, save("t1"));
    const call = await callOf(runId, "t1");
    expect(call.expiresAt!.getTime() - call.notifiedAt!.getTime()).toBe(2 * HOUR);
    expect(await sweep(later(90 * MIN))).toMatchObject({ escalated: 0, reminded: 1 });
    expect(await sweep(later(2 * HOUR + MIN))).toMatchObject({ expired: 1 });
  });

  test("an admin decides an escalated call; the member still can, the first one wins", async () => {
    const { admin, member } = await team("esc.io");
    const runId = await proposed(member, save("e1"));
    await sweep(later(61 * MIN));
    expect((await decide(admin, runId, "e1", { approved: true })).status).toBe(200);
    expect(await callOf(runId, "e1")).toMatchObject({ status: "approved", decidedBy: admin.id });
    expect((await decide(member, runId, "e1", { approved: false })).status).toBe(409);
    await worker.processNow(runId);
    expect((await runOf(runId)).status).toBe("completed");
  });
});

describe("two-person sign-off", () => {
  test("approvalsNeeded follows the team rule", () => {
    expect(approvalsNeeded("destructive", null)).toBe(1);
    expect(approvalsNeeded("destructive", "destructive")).toBe(2);
    expect(approvalsNeeded("send", "destructive")).toBe(1);
    expect(approvalsNeeded("send", "destructive_send")).toBe(2);
    expect(approvalsNeeded("write", "destructive_send")).toBe(1);
  });

  test("web: the member approves first, an admin second; no one signs twice; undo after the final approval", async () => {
    const { owner, admin, member } = await team("two.io", { twoPerson: "destructive_send" });
    await connectGoogle(member);
    const runId = await proposed(member, send("s1"));

    // Facts and two-person state come with the approval.
    const [mine] = (await member.call("/api/approvals")).json.approvals;
    expect(mine.facts).toEqual([
      "Sends to 1 person outside two.io",
      "Can't be unsent once it goes",
    ]);
    expect(mine.signoffs).toEqual({ needed: 2, first: null });
    expect(notices("s1", "new")[0]!.facts[0]).toBe("Sends to 1 person outside two.io");

    // First approval: recorded, still waiting, nothing runs.
    const first = await decide(member, runId, "s1", { approved: true });
    expect(first.json).toEqual({ executeAfter: null, partial: true });
    expect(await callOf(runId, "s1")).toMatchObject({
      status: "awaiting_approval",
      firstApprovedBy: member.id,
      firstApprovedVia: "web",
      executeAfter: null,
    });
    expect((await runOf(runId)).status).toBe("waiting");
    expect(resolved).toContainEqual(
      expect.objectContaining({ toolCallId: "s1", partial: true, decidedBy: member.id }),
    );
    // The others who may give the second approval are asked; not the first approver.
    const second = notices("s1", "second");
    expect(second).toHaveLength(1);
    expect(second[0]!.recipients.sort()).toEqual([owner.id, admin.id].sort());
    expect(second[0]!.signoffs.first).toEqual({ id: member.id, name: "dev" });

    // The requester can't be both approvers.
    const again = await decide(member, runId, "s1", { approved: true });
    expect(again.status).toBe(409);
    expect(again.json.error.message).toContain("second person");

    // Admins see it in the team inbox with the first approval.
    const inbox = (await admin.call("/api/workspace/approvals")).json.approvals;
    expect(inbox[0]).toMatchObject({
      toolCallId: "s1",
      signoffs: { needed: 2, first: { id: member.id, name: "dev" } },
    });

    // The second, distinct approval completes it and only now starts the undo window.
    const done = await decide(admin, runId, "s1", { approved: true });
    expect(done.status).toBe(200);
    expect(done.json.partial).toBe(false);
    expect(Date.parse(done.json.executeAfter) - Date.now()).toBeGreaterThan(8_000);
    expect(await callOf(runId, "s1")).toMatchObject({
      status: "approved",
      decidedBy: admin.id,
      firstApprovedBy: member.id,
    });
    expect((await runOf(runId)).status).toBe("queued");

    // The member (whose task it is) can still undo inside the window.
    const undone = await member.call(`/api/runs/${runId}/tool-calls/s1/undo`, {
      method: "POST",
      json: {},
    });
    expect(undone.status).toBe(204);
    expect(await callOf(runId, "s1")).toMatchObject({
      status: "denied",
      output: { reason: UNDO_DENIAL },
    });

    // Both approvers appear in activity and the audit log.
    const detail = (await member.call(`/api/runs/${runId}`)).json.toolCalls[0];
    expect(detail).toMatchObject({ firstApprovedByName: "dev", decidedByName: "admin" });
    const row = (await owner.call("/api/workspace/audit.csv")).text
      .split("\r\n")
      .find((l) => l.includes("gmail_send"))!;
    expect(row).toContain("admin@two.io,web,");
    expect(row).toContain(",dev@two.io,web,");
  });

  test("a deny after the first approval ends it", async () => {
    const { admin, member } = await team("deny.io", { twoPerson: "destructive_send" });
    await connectGoogle(member);
    const runId = await proposed(member, send("d1"), "Not sent.");
    expect((await decide(admin, runId, "d1", { approved: true })).json.partial).toBe(true);
    const denied = await decide(member, runId, "d1", { approved: false, reason: "wrong person" });
    expect(denied.status).toBe(200);
    expect(await callOf(runId, "d1")).toMatchObject({
      status: "denied",
      decidedBy: member.id,
      firstApprovedBy: admin.id,
    });
    expect((await runOf(runId)).status).toBe("queued");
    await worker.processNow(runId);
    expect((await runOf(runId)).status).toBe("completed");
  });

  test("ordinary actions and teams without the rule still take one approval", async () => {
    const { member } = await team("one.io", { twoPerson: "destructive" });
    await connectGoogle(member);
    const runId = await proposed(member, send("o1"));
    const res = await decide(member, runId, "o1", { approved: true });
    expect(res.json.partial).toBe(false);
    expect((await callOf(runId, "o1")).status).toBe("approved");
  });

  test("edits: the second approver sees the first approver's edit; an edit restarts the count", async () => {
    const { owner, admin, member } = await team("edit.io", { twoPerson: "destructive_send" });
    await connectGoogle(member);
    const runId = await proposed(member, send("m1", "bob@edit.io"));

    const edited = { to: ["carol@edit.io"], subject: "Hi", body: "Hello, edited" };
    expect(
      (await decide(member, runId, "m1", { approved: true, input: edited })).json.partial,
    ).toBe(true);
    const [seenByAdmin] = (await admin.call("/api/workspace/approvals")).json.approvals;
    expect(seenByAdmin.input).toEqual(edited);
    expect(seenByAdmin.inputEdited).toBe(true);

    // The admin changes it again: that is their approval of the new input only.
    const twice = { ...edited, body: "Hello, edited twice" };
    expect((await decide(admin, runId, "m1", { approved: true, input: twice })).json.partial).toBe(
      true,
    );
    expect(await callOf(runId, "m1")).toMatchObject({
      status: "awaiting_approval",
      firstApprovedBy: admin.id,
      input: twice,
    });
    // So the member can approve again, now as the second person, of exactly that input.
    const final = await decide(member, runId, "m1", { approved: true });
    expect(final.json.partial).toBe(false);
    expect(await callOf(runId, "m1")).toMatchObject({ status: "approved", input: twice });
    void owner;
  });

  test("Slack: an admin-only call needs two admins; the second approves from Slack", async () => {
    const { owner, admin, member } = await team("slack2.io", { twoPerson: "destructive_send" });
    await connectGoogle(member);
    await connectSlack(owner, "U-own");
    await connectSlack(admin, "U-adm");
    await owner.call("/api/workspace/rules", {
      method: "PUT",
      json: { rules: [{ tool: "gmail_send", decision: "ask", approver: "admin" }] },
    });
    const runId = await proposed(member, send("k1"));
    await services.slack!.settled();

    const ownMsg = slack.dms("U-own").at(-1)!;
    const admMsg = slack.dms("U-adm").at(-1)!;
    const text = (m: typeof ownMsg) =>
      m.blocks
        .map(
          (b: { text?: { text: string }; elements?: { text: string }[] }) =>
            b.text?.text ?? b.elements?.map((e) => e.text).join(" ") ?? "",
        )
        .join("\n");
    expect(text(ownMsg)).toContain("Sends to 1 person outside slack2.io");
    expect(text(ownMsg)).toContain("Needs 2 approvals from different people");
    expect(text(ownMsg)).toContain("Expires <!date^");

    // The owner approves in Slack: their message stops asking; the admin's is refreshed.
    const click = async (m: typeof ownMsg, user: string) => {
      await app.request(
        "/api/slack/interactions",
        slack.click(m, "approve", { signingSecret: SIGNING, user }),
      );
      await services.slack!.settled();
    };
    await click(ownMsg, "U-own");
    expect(await callOf(runId, "k1")).toMatchObject({
      status: "awaiting_approval",
      firstApprovedBy: owner.id,
      firstApprovedVia: "slack",
    });
    expect(text(ownMsg)).toContain("You approved here · waiting for a second approval");
    expect(ownMsg.blocks.some((b: { type: string }) => b.type === "actions")).toBe(false);
    expect(text(admMsg)).toContain("1 of 2 approvals · owner approved");
    expect(admMsg.blocks.some((b: { type: string }) => b.type === "actions")).toBe(true);
    const nudge = slack.state.messages.find(
      (m) => m.channel === admMsg.channel && m.text.includes("needs a second approval"),
    );
    expect(nudge).toBeTruthy();

    // A second click from the owner (the old buttons) is refused with a reason.
    await click(admMsg, "U-own");
    expect((await callOf(runId, "k1")).status).toBe("awaiting_approval");

    // The admin completes it from Slack.
    await click(admMsg, "U-adm");
    expect(await callOf(runId, "k1")).toMatchObject({
      status: "approved",
      decidedBy: admin.id,
      decidedVia: "slack",
      firstApprovedBy: owner.id,
    });
    expect(admMsg.blocks.some((b: { type: string }) => b.type === "actions")).toBe(false);
  });

  test("Slack: a reminder refreshes the original message and nudges in its thread", async () => {
    const me = await signUp("nudge@solo.io");
    await connectSlack(me, "U-nudge");
    const runId = await proposed(me, save("n1"));
    await services.slack!.settled();
    const msg = slack.dms("U-nudge").at(-1)!;
    const before = slack.dms("U-nudge").length;
    await sweep(later(31 * MIN));
    expect(msg.updates).toBe(1);
    expect(msg.blocks[0].text.text).toBe("Reminder: Synapse still needs your OK");
    expect(msg.blocks.some((b: { type: string }) => b.type === "actions")).toBe(true);
    const after = slack.dms("U-nudge");
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.text).toContain("Reminder: this is still waiting for you");

    // Expiry rewrites it to the outcome.
    await sweep(later(25 * HOUR));
    expect(JSON.stringify(msg.blocks)).toContain("Expired: nobody decided in time");
    expect(msg.blocks.some((b: { type: string }) => b.type === "actions")).toBe(false);
    void runId;
  });
});
