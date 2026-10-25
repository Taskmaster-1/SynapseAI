import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ScriptedStep, scriptedModel } from "@synapse/core/testing";
import { schema } from "@synapse/db";
import { and, eq } from "drizzle-orm";
import { createApp } from "./app";
import { loadConfig } from "./config";
import type { PendingApproval, ResolvedApproval } from "./notify/types";
import { auditRange, toCsv } from "./routes/workspace";
import { createServices, type Services } from "./services";
import { Worker } from "./worker";

const ORIGIN = "http://localhost:3000";
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
    }),
  );
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
    headers: Headers;
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
      return { status: r.status, json, text, headers: r.headers };
    },
  };
}

/** Creates an invite as `admin` and joins it as `who`. */
async function invite(admin: Person, who: Person, role: "admin" | "member" = "member") {
  const created = await admin.call("/api/workspace/invites", { method: "POST", json: { role } });
  expect(created.status).toBe(201);
  const token = (created.json.link as string).split("/join/")[1]!;
  const joined = await who.call("/api/workspace/join", { method: "POST", json: { token } });
  expect(joined.status).toBe(200);
  return token;
}

describe("workspaces", () => {
  test("create, invite by link, join; bad tokens are refused", async () => {
    const owner = await signUp("owner@acme.com");
    const ann = await signUp("ann@acme.com");
    const bo = await signUp("bo@acme.com");
    const cy = await signUp("cy@acme.com");

    expect((await owner.call("/api/workspace")).json).toEqual({
      workspace: null,
      role: null,
      members: [],
    });
    expect(
      (await owner.call("/api/workspace", { method: "POST", json: { name: " " } })).status,
    ).toBe(422);
    const created = await owner.call("/api/workspace", {
      method: "POST",
      json: { name: "Acme" },
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      workspace: { name: "Acme" },
      role: "owner",
      members: [{ userId: owner.id, email: "owner@acme.com", role: "owner" }],
    });
    // One workspace per person.
    expect(
      (await owner.call("/api/workspace", { method: "POST", json: { name: "Again" } })).status,
    ).toBe(409);

    // The link carries the token once; only its hash is stored.
    const res = await owner.call("/api/workspace/invites", { method: "POST", json: {} });
    expect(res.status).toBe(201);
    expect(res.json.link).toMatch(new RegExp(`^${ORIGIN}/join/[A-Za-z0-9_-]{40,}$`));
    const token = res.json.link.split("/join/")[1];
    const [stored] = await services.database.db
      .select()
      .from(schema.workspaceInvites)
      .where(eq(schema.workspaceInvites.id, res.json.invite.id));
    expect(stored!.tokenHash).not.toContain(token);
    expect(JSON.stringify((await owner.call("/api/workspace/invites")).json)).not.toContain(token);

    expect(
      (await ann.call("/api/workspace/join", { method: "POST", json: { token: "x".repeat(43) } }))
        .status,
    ).toBe(404);
    const join = await ann.call("/api/workspace/join", { method: "POST", json: { token } });
    expect(join.status).toBe(200);
    expect(join.json.role).toBe("member");
    // Used: single use.
    const reused = await bo.call("/api/workspace/join", { method: "POST", json: { token } });
    expect(reused).toMatchObject({ status: 409, json: { error: { code: "invite_used" } } });

    // Revoked.
    const r2 = await owner.call("/api/workspace/invites", { method: "POST", json: {} });
    expect(
      (await owner.call(`/api/workspace/invites/${r2.json.invite.id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
    const revoked = await bo.call("/api/workspace/join", {
      method: "POST",
      json: { token: r2.json.link.split("/join/")[1] },
    });
    expect(revoked).toMatchObject({ status: 409, json: { error: { code: "invite_revoked" } } });

    // Expired.
    const r3 = await owner.call("/api/workspace/invites", { method: "POST", json: {} });
    await services.database.db
      .update(schema.workspaceInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.workspaceInvites.id, r3.json.invite.id));
    const expired = await bo.call("/api/workspace/join", {
      method: "POST",
      json: { token: r3.json.link.split("/join/")[1] },
    });
    expect(expired).toMatchObject({ status: 409, json: { error: { code: "invite_expired" } } });

    const list = (await owner.call("/api/workspace/invites")).json.invites;
    expect(list.map((i: { status: string }) => i.status).sort()).toEqual([
      "expired",
      "revoked",
      "used",
    ]);

    // Members can't invite; strangers can't see anything.
    expect((await ann.call("/api/workspace/invites", { method: "POST", json: {} })).status).toBe(
      403,
    );
    expect((await ann.call("/api/workspace/invites")).status).toBe(403);
    expect((await cy.call("/api/workspace/rules")).status).toBe(404);
    expect((await ann.call("/api/workspace")).json.members).toHaveLength(2);
  });

  test("roles: last owner stays, admins can't make owners, members can't write rules", async () => {
    const owner = await signUp("o@roles.com");
    const admin = await signUp("a@roles.com");
    const member = await signUp("m@roles.com");
    await owner.call("/api/workspace", { method: "POST", json: { name: "Roles" } });
    await invite(owner, admin, "admin");
    await invite(admin, member);

    // The last owner can't leave or step down.
    const leave = await owner.call(`/api/workspace/members/${owner.id}`, { method: "DELETE" });
    expect(leave).toMatchObject({ status: 409, json: { error: { code: "last_owner" } } });
    const demote = await owner.call(`/api/workspace/members/${owner.id}`, {
      method: "PATCH",
      json: { role: "admin" },
    });
    expect(demote).toMatchObject({ status: 409, json: { error: { code: "last_owner" } } });

    // Admins manage members and admins, never owners.
    expect(
      (
        await admin.call(`/api/workspace/members/${member.id}`, {
          method: "PATCH",
          json: { role: "owner" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await admin.call(`/api/workspace/members/${owner.id}`, {
          method: "PATCH",
          json: { role: "member" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await admin.call(`/api/workspace/members/${owner.id}`, { method: "DELETE" })).status,
    ).toBe(403);
    // Members can't change or remove anyone, or rename the team.
    expect(
      (
        await member.call(`/api/workspace/members/${admin.id}`, {
          method: "PATCH",
          json: { role: "member" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await member.call("/api/workspace", { method: "PATCH", json: { name: "X" } })).status,
    ).toBe(403);
    expect(
      (await admin.call("/api/workspace", { method: "PATCH", json: { name: "Roles Inc" } })).json
        .workspace.name,
    ).toBe("Roles Inc");

    // Members can read team rules but not write them.
    const put = await member.call("/api/workspace/rules", {
      method: "PUT",
      json: { rules: [{ tool: "*", decision: "allow" }] },
    });
    expect(put.status).toBe(403);
    expect((await member.call("/api/workspace/rules")).json).toEqual({ rules: [], canEdit: false });
    // Rules are validated like personal ones, incl. regex safety.
    const unsafe = await admin.call("/api/workspace/rules", {
      method: "PUT",
      json: {
        rules: [
          { tool: "*", decision: "block", when: [{ path: "q", op: "matches", value: "(a+)+$" }] },
        ],
      },
    });
    expect(unsafe).toMatchObject({ status: 422, json: { error: { code: "invalid_pattern" } } });
    const ok = await admin.call("/api/workspace/rules", {
      method: "PUT",
      json: {
        rules: [
          { tool: "gmail_*", decision: "ask", approver: "admin", note: "Outside email" },
          { tool: "web_*", decision: "allow", approver: "admin" },
        ],
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.rules).toEqual([
      expect.objectContaining({ tool: "gmail_*", decision: "ask", approver: "admin" }),
      expect.not.objectContaining({ approver: "admin" }),
    ]);

    // An owner can hand over ownership, then step down.
    expect(
      (
        await owner.call(`/api/workspace/members/${admin.id}`, {
          method: "PATCH",
          json: { role: "owner" },
        })
      ).status,
    ).toBe(200);
    const stepped = await owner.call(`/api/workspace/members/${owner.id}`, {
      method: "PATCH",
      json: { role: "member" },
    });
    expect(stepped.json.role).toBe("member");

    // Anyone may leave; an admin may remove a member.
    expect(
      (await admin.call(`/api/workspace/members/${member.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await member.call("/api/workspace")).json.workspace).toBeNull();
    expect(
      (await owner.call(`/api/workspace/members/${owner.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    // The last person out takes the workspace with them.
    expect(
      (await admin.call(`/api/workspace/members/${admin.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect(
      await services.database.db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.name, "Roles Inc")),
    ).toEqual([]);
  });

  test("an admin-required call: the member waits, admins are told, an admin decides", async () => {
    const owner = await signUp("boss@team.com");
    const admin = await signUp("lead@team.com");
    const member = await signUp("dev@team.com");
    const outsider = await signUp("x@other.com");
    await owner.call("/api/workspace", { method: "POST", json: { name: "Team" } });
    await invite(owner, admin, "admin");
    await invite(owner, member);
    await owner.call("/api/workspace/rules", {
      method: "PUT",
      json: { rules: [{ tool: "memory_save", decision: "ask", approver: "admin" }] },
    });
    // The member's own rules allow everything: the team's admin rule still wins.
    await member.call("/api/policy", {
      method: "PUT",
      json: {
        defaults: { read: "allow", write: "allow", send: "allow", destructive: "allow" },
        rules: [{ tool: "*", decision: "allow" }],
      },
    });

    seen.length = 0;
    resolved.length = 0;
    script([
      { toolCalls: [{ name: "memory_save", input: { note: "=HYPERLINK(1)" }, id: "t1" }] },
      { text: "Saved." },
    ]);
    const { json } = await member.call("/api/chats", {
      method: "POST",
      json: { content: '+remember, "quoted"' },
    });
    const runId = json.runId as string;
    await worker.processNow(runId);

    const [row] = await services.database.db
      .select()
      .from(schema.toolCalls)
      .where(and(eq(schema.toolCalls.runId, runId), eq(schema.toolCalls.id, "t1")));
    expect(row).toMatchObject({
      status: "awaiting_approval",
      approver: "admin",
      decisionReason: "Your team requires an admin to approve this.",
    });

    // Notification channels hear about it for the owner and admin, not the member.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.userId).toBe(member.id);
    expect(seen[0]!.recipients.sort()).toEqual([owner.id, admin.id].sort());
    expect(seen[0]!.url).toBe(`${ORIGIN}/inbox`);

    // The member sees it waiting; they can't decide it.
    const mine = (await member.call("/api/approvals")).json.approvals;
    expect(mine).toEqual([expect.objectContaining({ toolCallId: "t1", approver: "admin" })]);
    const path = `/api/runs/${runId}/tool-calls/t1/decision`;
    const self = await member.call(path, { method: "POST", json: { approved: true } });
    expect(self.status).toBe(403);
    expect(
      (
        await member.call(`/api/runs/${runId}/tool-calls/decisions`, {
          method: "POST",
          json: { decisions: [{ toolCallId: "t1", approved: true }] },
        })
      ).status,
    ).toBe(403);
    // Someone outside the team can't either, and learns nothing.
    expect((await outsider.call(path, { method: "POST", json: { approved: true } })).status).toBe(
      404,
    );

    // Admins see it in the team inbox, with who asked; members can't open that inbox.
    expect((await member.call("/api/workspace/approvals")).status).toBe(403);
    const inbox = (await admin.call("/api/workspace/approvals")).json.approvals;
    expect(inbox).toEqual([
      expect.objectContaining({
        runId,
        toolCallId: "t1",
        requester: expect.objectContaining({ id: member.id, email: "dev@team.com" }),
      }),
    ]);

    // An admin can't edit it into something the member's rules or the team block.
    await owner.call("/api/workspace/rules", {
      method: "PUT",
      json: {
        rules: [
          { tool: "memory_save", decision: "ask", approver: "admin" },
          {
            tool: "memory_save",
            decision: "block",
            when: [{ path: "note", op: "equals", value: "secret" }],
          },
        ],
      },
    });
    const edited = await admin.call(path, {
      method: "POST",
      json: { approved: true, input: { note: "secret" } },
    });
    expect(edited.status).toBe(422);

    // The admin decides; the run resumes.
    const ok = await admin.call(path, { method: "POST", json: { approved: true } });
    expect(ok.status).toBe(200);
    expect((await admin.call(path, { method: "POST", json: { approved: true } })).status).toBe(409);
    expect(resolved).toEqual([
      expect.objectContaining({ toolCallId: "t1", userId: member.id, decidedBy: admin.id }),
    ]);
    await worker.processNow(runId);
    const detail = await member.call(`/api/runs/${runId}`);
    expect(detail.json.run.status).toBe("completed");
    expect(detail.json.toolCalls[0]).toMatchObject({
      status: "succeeded",
      decidedBy: admin.id,
      approver: "admin",
    });
    expect((await admin.call("/api/workspace/approvals")).json.approvals).toEqual([]);

    // Admins still can't decide a member's ordinary calls.
    await owner.call("/api/workspace/rules", { method: "PUT", json: { rules: [] } });
    await member.call("/api/policy", {
      method: "PUT",
      json: {
        defaults: { read: "allow", write: "ask", send: "ask", destructive: "ask" },
        rules: [{ tool: "memory_save", decision: "ask" }],
      },
    });
    script([
      { toolCalls: [{ name: "memory_save", input: { note: "x" }, id: "t2" }] },
      { text: "ok" },
    ]);
    const second = await member.call("/api/chats", { method: "POST", json: { content: "again" } });
    await worker.processNow(second.json.runId);
    const p2 = `/api/runs/${second.json.runId}/tool-calls/t2/decision`;
    expect((await admin.call(p2, { method: "POST", json: { approved: true } })).status).toBe(404);
    expect((await member.call(p2, { method: "POST", json: { approved: false } })).status).toBe(200);

    // Audit export: admins only, every member's calls, CSV-safe.
    expect((await member.call("/api/workspace/audit.csv")).status).toBe(403);
    const csv = await admin.call("/api/workspace/audit.csv");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toContain("attachment");
    const lines = csv.text.split("\r\n");
    expect(lines[0]).toBe(
      "time,member,task,tool,effect,decision,status,decided_by,decided_via,reason",
    );
    const t1 = lines.find((l) => l.includes("memory_save") && l.includes("lead@team.com"))!;
    expect(t1).toContain("dev@team.com");
    // A task title starting with + is neutralised and quoted (it has a comma and quotes).
    expect(t1).toContain(`"'+remember, ""quoted"""`);
    expect(t1).toContain(",web,Your team requires an admin to approve this.");
    expect(lines.filter((l) => l.includes("dev@team.com"))).toHaveLength(2);
    expect(csv.text).not.toContain("x@other.com");
    expect((await admin.call("/api/workspace/audit.csv?from=2020-01-01&to=2020-01-02")).text).toBe(
      "time,member,task,tool,effect,decision,status,decided_by,decided_via,reason\r\n",
    );
    expect((await admin.call("/api/workspace/audit.csv?from=nope")).status).toBe(422);
  });

  test("an admin decides their own admin-required calls", async () => {
    const owner = await signUp("solo@own.com");
    await owner.call("/api/workspace", { method: "POST", json: { name: "Solo" } });
    await owner.call("/api/workspace/rules", {
      method: "PUT",
      json: { rules: [{ tool: "memory_save", decision: "ask", approver: "admin" }] },
    });
    script([
      { toolCalls: [{ name: "memory_save", input: { note: "n" }, id: "s1" }] },
      { text: "done" },
    ]);
    const { json } = await owner.call("/api/chats", { method: "POST", json: { content: "go" } });
    await worker.processNow(json.runId);
    const approval = seen.find((a) => a.toolCallId === "s1")!;
    expect(approval.recipients).toEqual([owner.id]);
    expect(
      (
        await owner.call(`/api/runs/${json.runId}/tool-calls/s1/decision`, {
          method: "POST",
          json: { approved: true },
        })
      ).status,
    ).toBe(200);
  });

  test("after leaving the team, a member decides their own waiting call", async () => {
    const owner = await signUp("o@left.com");
    const member = await signUp("m@left.com");
    await owner.call("/api/workspace", { method: "POST", json: { name: "Left" } });
    await invite(owner, member);
    await owner.call("/api/workspace/rules", {
      method: "PUT",
      json: { rules: [{ tool: "memory_save", decision: "ask", approver: "admin" }] },
    });
    script([
      { toolCalls: [{ name: "memory_save", input: { note: "n" }, id: "l1" }] },
      { text: "done" },
    ]);
    const { json } = await member.call("/api/chats", { method: "POST", json: { content: "go" } });
    await worker.processNow(json.runId);
    const path = `/api/runs/${json.runId}/tool-calls/l1/decision`;
    expect((await member.call(path, { method: "POST", json: { approved: true } })).status).toBe(
      403,
    );
    expect(
      (await member.call(`/api/workspace/members/${member.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    // The team's admins can no longer decide it; the member can.
    expect((await owner.call(path, { method: "POST", json: { approved: true } })).status).toBe(404);
    expect((await member.call(path, { method: "POST", json: { approved: true } })).status).toBe(
      200,
    );
  });
});

test("CSV cells are RFC 4180 quoted and formula-safe", () => {
  expect(
    toCsv(
      ["a", "b"],
      [
        ["=1+1", "x,y"],
        ['say "hi"', null],
        ["-2", "@me"],
        ["ok", "a\nb"],
      ],
    ),
  ).toBe('a,b\r\n\'=1+1,"x,y"\r\n"say ""hi""",\r\n\'-2,\'@me\r\nok,"a\nb"\r\n');
});

test("audit ranges: dates are inclusive, defaults to 30 days", () => {
  const r = auditRange("2026-01-01", "2026-01-31");
  expect(r.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  expect(r.to.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  const d = auditRange();
  expect(d.to.getTime() - d.from.getTime()).toBe(30 * 24 * 3600_000);
});
