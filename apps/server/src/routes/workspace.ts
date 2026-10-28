import { type Db, isAdminRole, loadTeamRules, membershipOf, schema } from "@synapse/db";
import { and, asc, count, desc, eq, gt, gte, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, apiError, body } from "../http";
import { assertSafePatterns, Rule } from "./account";

/**
 * Team workspaces: one shared set of rules on top of everyone's own, admin sign-off for
 * risky actions, and an audit export. Tasks, connections and memory stay personal.
 *
 * Roles: owner (everything, incl. owners), admin (manage members, invites and rules; decide
 * admin-required calls), member (read the team, its rules; leave).
 */

type Role = schema.WorkspaceRole;
type Ctx = { var: AppEnv["Variables"] };

const Name = z.string().trim().min(1).max(80);
const TeamRule = Rule.extend({ approver: z.enum(["admin"]).nullable().optional() });
const INVITE_DAYS = 7;
const AUDIT_MAX_ROWS = 50_000;

async function membership(c: Ctx) {
  const m = await membershipOf(c.var.services.database.db, c.var.user.id);
  if (!m) apiError(404, "no_workspace", "You're not in a team workspace.");
  return m;
}

async function adminMembership(c: Ctx) {
  const m = await membership(c);
  if (!isAdminRole(m.role)) apiError(403, "forbidden", "Only team owners and admins can do that.");
  return m;
}

async function loadWorkspace(c: Ctx, workspaceId: string, role: Role) {
  const { db } = c.var.services.database;
  const [workspace] = await db
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      createdAt: schema.workspaces.createdAt,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  const members = await db
    .select({
      userId: schema.workspaceMembers.userId,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.workspaceMembers.role,
      joinedAt: schema.workspaceMembers.joinedAt,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.user, eq(schema.user.id, schema.workspaceMembers.userId))
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(schema.workspaceMembers.joinedAt));
  return { workspace, role, members };
}

/** Invite tokens: 32 random bytes, base64url. Only the SHA-256 is stored. */
function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(digest).toString("hex");
}

function inviteStatus(i: {
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): "used" | "revoked" | "expired" | "active" {
  if (i.usedAt) return "used";
  if (i.revokedAt) return "revoked";
  if (i.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
}

export const workspace = new Hono<AppEnv>()
  // ── Workspace ────────────────────────────────────────────────────────────
  .get("/", async (c) => {
    const m = await membershipOf(c.var.services.database.db, c.var.user.id);
    if (!m) return c.json({ workspace: null, role: null, members: [] });
    return c.json(await loadWorkspace(c, m.workspaceId, m.role));
  })

  .post("/", async (c) => {
    const { name } = await body(c, z.object({ name: Name }));
    const { db } = c.var.services.database;
    const userId = c.var.user.id;
    if (await membershipOf(db, userId))
      apiError(409, "already_member", "You're already in a team workspace. Leave it first.");
    const workspaceId = await db.transaction(async (tx) => {
      const [ws] = await tx
        .insert(schema.workspaces)
        .values({ name, createdBy: userId })
        .returning({ id: schema.workspaces.id });
      // The unique user_id makes a concurrent second create fail here, not succeed twice.
      await tx
        .insert(schema.workspaceMembers)
        .values({ workspaceId: ws!.id, userId, role: "owner" });
      return ws!.id;
    });
    return c.json(await loadWorkspace(c, workspaceId, "owner"), 201);
  })

  .patch("/", async (c) => {
    const { name } = await body(c, z.object({ name: Name }));
    const m = await adminMembership(c);
    await c.var.services.database.db
      .update(schema.workspaces)
      .set({ name })
      .where(eq(schema.workspaces.id, m.workspaceId));
    return c.json(await loadWorkspace(c, m.workspaceId, m.role));
  })

  // ── Invites ──────────────────────────────────────────────────────────────
  .post("/invites", async (c) => {
    const input = await body(
      c,
      z.object({
        role: z.enum(["admin", "member"]).default("member"),
        expiresInDays: z.number().int().min(1).max(30).default(INVITE_DAYS),
      }),
    );
    const m = await adminMembership(c);
    const token = newToken();
    const [invite] = await c.var.services.database.db
      .insert(schema.workspaceInvites)
      .values({
        workspaceId: m.workspaceId,
        tokenHash: await hashToken(token),
        role: input.role,
        expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 3600_000),
        createdBy: c.var.user.id,
      })
      .returning({
        id: schema.workspaceInvites.id,
        role: schema.workspaceInvites.role,
        expiresAt: schema.workspaceInvites.expiresAt,
        createdAt: schema.workspaceInvites.createdAt,
      });
    // The token is only ever shown here.
    const link = `${c.var.services.config.PUBLIC_URL}/join/${token}`;
    return c.json({ invite: { ...invite, status: "active" }, link }, 201);
  })

  .get("/invites", async (c) => {
    const m = await adminMembership(c);
    const usedBy = alias(schema.user, "used_by_user");
    const rows = await c.var.services.database.db
      .select({
        id: schema.workspaceInvites.id,
        role: schema.workspaceInvites.role,
        expiresAt: schema.workspaceInvites.expiresAt,
        createdAt: schema.workspaceInvites.createdAt,
        usedAt: schema.workspaceInvites.usedAt,
        revokedAt: schema.workspaceInvites.revokedAt,
        usedByEmail: usedBy.email,
      })
      .from(schema.workspaceInvites)
      .leftJoin(usedBy, eq(usedBy.id, schema.workspaceInvites.usedBy))
      .where(eq(schema.workspaceInvites.workspaceId, m.workspaceId))
      .orderBy(desc(schema.workspaceInvites.createdAt))
      .limit(100);
    return c.json({ invites: rows.map((r) => ({ ...r, status: inviteStatus(r) })) });
  })

  .delete("/invites/:id", async (c) => {
    const m = await adminMembership(c);
    await c.var.services.database.db
      .update(schema.workspaceInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.workspaceInvites.id, c.req.param("id")),
          eq(schema.workspaceInvites.workspaceId, m.workspaceId),
          isNull(schema.workspaceInvites.usedAt),
          isNull(schema.workspaceInvites.revokedAt),
        ),
      );
    return c.body(null, 204);
  })

  .post("/join", async (c) => {
    const { token } = await body(c, z.object({ token: z.string().min(16).max(200) }));
    const { db } = c.var.services.database;
    const userId = c.var.user.id;
    const tokenHash = await hashToken(token);
    const [invite] = await db
      .select()
      .from(schema.workspaceInvites)
      .where(eq(schema.workspaceInvites.tokenHash, tokenHash));
    if (!invite) apiError(404, "invite_not_found", "This invite link isn't valid.");
    const status = inviteStatus(invite);
    if (status !== "active")
      apiError(
        409,
        `invite_${status}`,
        status === "used"
          ? "This invite link has already been used."
          : status === "revoked"
            ? "This invite link was revoked."
            : "This invite link has expired.",
      );
    const current = await membershipOf(db, userId);
    if (current)
      apiError(
        409,
        current.workspaceId === invite.workspaceId ? "already_joined" : "already_member",
        current.workspaceId === invite.workspaceId
          ? "You're already in this team."
          : "You're already in a team workspace. Leave it first.",
      );

    await db.transaction(async (tx) => {
      // Single use: claim the invite with a compare-and-set, so two people can't share one.
      const claimed = await tx
        .update(schema.workspaceInvites)
        .set({ usedBy: userId, usedAt: new Date() })
        .where(
          and(
            eq(schema.workspaceInvites.id, invite.id),
            isNull(schema.workspaceInvites.usedAt),
            isNull(schema.workspaceInvites.revokedAt),
            gt(schema.workspaceInvites.expiresAt, new Date()),
          ),
        )
        .returning({ id: schema.workspaceInvites.id });
      if (claimed.length === 0)
        apiError(409, "invite_used", "This invite link is no longer valid.");
      await tx
        .insert(schema.workspaceMembers)
        .values({ workspaceId: invite.workspaceId, userId, role: invite.role });
    });
    return c.json(await loadWorkspace(c, invite.workspaceId, invite.role));
  })

  // ── Members ──────────────────────────────────────────────────────────────
  .patch("/members/:userId", async (c) => {
    const { role } = await body(c, z.object({ role: z.enum(["owner", "admin", "member"]) }));
    const m = await adminMembership(c);
    const targetId = c.req.param("userId");
    const { db } = c.var.services.database;
    await db.transaction(async (tx) => {
      // Lock the team's memberships so two demotions can't both pass the last-owner check.
      const members = await tx
        .select({ userId: schema.workspaceMembers.userId, role: schema.workspaceMembers.role })
        .from(schema.workspaceMembers)
        .where(eq(schema.workspaceMembers.workspaceId, m.workspaceId))
        .for("update");
      const target = members.find((x) => x.userId === targetId);
      if (!target) apiError(404, "not_found", "That person isn't in your team.");
      if (m.role !== "owner" && (role === "owner" || target.role === "owner"))
        apiError(403, "forbidden", "Only an owner can make or change owners.");
      const owners = members.filter((x) => x.role === "owner").length;
      if (target.role === "owner" && role !== "owner" && owners <= 1)
        apiError(
          409,
          "last_owner",
          "A team needs at least one owner. Make someone else owner first.",
        );
      await tx
        .update(schema.workspaceMembers)
        .set({ role })
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, m.workspaceId),
            eq(schema.workspaceMembers.userId, targetId),
          ),
        );
    });
    const after = await membership(c);
    return c.json(await loadWorkspace(c, after.workspaceId, after.role));
  })

  .delete("/members/:userId", async (c) => {
    const m = await membership(c);
    const targetId = c.req.param("userId");
    const self = targetId === c.var.user.id;
    if (!self && !isAdminRole(m.role))
      apiError(403, "forbidden", "Only team owners and admins can remove people.");
    const { db } = c.var.services.database;
    let withdrawn: string[] = [];
    await db.transaction(async (tx) => {
      const members = await tx
        .select({ userId: schema.workspaceMembers.userId, role: schema.workspaceMembers.role })
        .from(schema.workspaceMembers)
        .where(eq(schema.workspaceMembers.workspaceId, m.workspaceId))
        .for("update");
      const target = members.find((x) => x.userId === targetId);
      if (!target) apiError(404, "not_found", "That person isn't in your team.");
      if (!self && target.role === "owner" && m.role !== "owner")
        apiError(403, "forbidden", "Only an owner can remove an owner.");
      // The last person out takes the workspace with them; otherwise someone must own it.
      if (members.length === 1) {
        await tx.delete(schema.workspaces).where(eq(schema.workspaces.id, m.workspaceId));
        return;
      }
      if (target.role === "owner" && members.filter((x) => x.role === "owner").length <= 1)
        apiError(
          409,
          "last_owner",
          "A team needs at least one owner. Make someone else owner first.",
        );
      await tx
        .delete(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, m.workspaceId),
            eq(schema.workspaceMembers.userId, targetId),
          ),
        );
      withdrawn = await withdrawAdminRequests(tx as unknown as Db, targetId);
    });
    for (const runId of withdrawn) await c.var.services.wake(runId);
    return c.body(null, 204);
  })

  // ── Team rules ───────────────────────────────────────────────────────────
  .get("/rules", async (c) => {
    const m = await membership(c);
    const rules = await loadTeamRules(c.var.services.database.db, m.workspaceId);
    return c.json({ rules, canEdit: isAdminRole(m.role) });
  })

  .put("/rules", async (c) => {
    const input = await body(c, z.object({ rules: z.array(TeamRule).max(200) }));
    const m = await adminMembership(c);
    assertSafePatterns(input.rules);
    const { db } = c.var.services.database;
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.workspaceRules)
        .where(eq(schema.workspaceRules.workspaceId, m.workspaceId));
      if (input.rules.length > 0) {
        await tx.insert(schema.workspaceRules).values(
          input.rules.map((r, position) => ({
            workspaceId: m.workspaceId,
            position,
            tool: r.tool,
            decision: r.decision,
            when: r.when ?? null,
            note: r.note ?? null,
            // An approver only means something on an ask.
            approver: r.decision === "ask" && r.approver === "admin" ? ("admin" as const) : null,
          })),
        );
      }
    });
    return c.json({ rules: await loadTeamRules(db, m.workspaceId), canEdit: true });
  })

  // ── Admin inbox ──────────────────────────────────────────────────────────
  .get("/approvals", async (c) => {
    const m = await adminMembership(c);
    const rows = await c.var.services.database.db
      .select({
        runId: schema.toolCalls.runId,
        chatId: schema.runs.chatId,
        chatTitle: schema.chats.title,
        toolCallId: schema.toolCalls.id,
        name: schema.toolCalls.name,
        effect: schema.toolCalls.effect,
        input: schema.toolCalls.input,
        reason: schema.toolCalls.decisionReason,
        preview: schema.toolCalls.preview,
        approver: schema.toolCalls.approver,
        createdAt: schema.toolCalls.createdAt,
        requester: {
          id: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
        },
      })
      .from(schema.toolCalls)
      .innerJoin(
        schema.workspaceMembers,
        and(
          eq(schema.workspaceMembers.userId, schema.toolCalls.userId),
          eq(schema.workspaceMembers.workspaceId, m.workspaceId),
        ),
      )
      .innerJoin(schema.user, eq(schema.user.id, schema.toolCalls.userId))
      .innerJoin(schema.runs, eq(schema.runs.id, schema.toolCalls.runId))
      .innerJoin(schema.chats, eq(schema.chats.id, schema.runs.chatId))
      .where(
        and(
          eq(schema.toolCalls.status, "awaiting_approval"),
          eq(schema.toolCalls.approver, "admin"),
        ),
      )
      .orderBy(desc(schema.toolCalls.createdAt));
    return c.json({ approvals: rows });
  })

  // ── Audit export ─────────────────────────────────────────────────────────
  .get("/audit.csv", async (c) => {
    const m = await adminMembership(c);
    const { from, to } = auditRange(c.req.query("from"), c.req.query("to"));
    const decider = alias(schema.user, "decider");
    const { db } = c.var.services.database;
    const where = and(
      gte(schema.toolCalls.createdAt, from),
      lt(schema.toolCalls.createdAt, to),
      // Only what a member did while in the team, not their history from before.
      gte(schema.toolCalls.createdAt, schema.workspaceMembers.joinedAt),
    );
    const membersJoin = and(
      eq(schema.workspaceMembers.userId, schema.toolCalls.userId),
      eq(schema.workspaceMembers.workspaceId, m.workspaceId),
    );
    const [{ total } = { total: 0 }] = await db
      .select({ total: count() })
      .from(schema.toolCalls)
      .innerJoin(schema.workspaceMembers, membersJoin)
      .where(where);
    if (total > AUDIT_MAX_ROWS)
      apiError(
        422,
        "too_many_rows",
        `That range has ${total} actions; export at most ${AUDIT_MAX_ROWS} at a time.`,
      );
    const rows = await db
      .select({
        time: schema.toolCalls.createdAt,
        member: schema.user.email,
        task: schema.chats.title,
        tool: schema.toolCalls.name,
        effect: schema.toolCalls.effect,
        decision: schema.toolCalls.decision,
        status: schema.toolCalls.status,
        decidedBy: decider.email,
        decidedVia: schema.toolCalls.decidedVia,
        reason: schema.toolCalls.decisionReason,
      })
      .from(schema.toolCalls)
      .innerJoin(schema.workspaceMembers, membersJoin)
      .innerJoin(schema.user, eq(schema.user.id, schema.toolCalls.userId))
      .innerJoin(schema.runs, eq(schema.runs.id, schema.toolCalls.runId))
      .innerJoin(schema.chats, eq(schema.chats.id, schema.runs.chatId))
      .leftJoin(decider, eq(decider.id, schema.toolCalls.decidedBy))
      .where(where)
      .orderBy(asc(schema.toolCalls.createdAt), sql`${schema.toolCalls.id}`);
    const csv = toCsv(
      [
        "time",
        "member",
        "task",
        "tool",
        "effect",
        "decision",
        "status",
        "decided_by",
        "decided_via",
        "reason",
      ],
      rows.map((r) => [
        r.time.toISOString(),
        r.member,
        r.task,
        r.tool,
        r.effect,
        r.decision,
        r.status,
        r.decidedBy,
        r.decidedVia,
        r.reason,
      ]),
    );
    const day = (d: Date) => d.toISOString().slice(0, 10);
    return c.body(csv, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="synapse-audit-${day(from)}-to-${day(new Date(to.getTime() - 1))}.csv"`,
      "cache-control": "no-store",
    });
  });

/**
 * `from` and `to` are dates (YYYY-MM-DD, `to` inclusive) or ISO times. Default: the last
 * 30 days. At most a year at a time.
 */
export function auditRange(fromQ?: string, toQ?: string): { from: Date; to: Date } {
  const parse = (q: string, endOfDay: boolean) => {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(q);
    const d = new Date(dateOnly ? `${q}T00:00:00.000Z` : q);
    if (Number.isNaN(d.getTime())) apiError(422, "invalid_date", `Not a date: ${q}`);
    return dateOnly && endOfDay ? new Date(d.getTime() + 24 * 3600_000) : d;
  };
  const to = toQ ? parse(toQ, true) : new Date();
  const from = fromQ ? parse(fromQ, false) : new Date(to.getTime() - 30 * 24 * 3600_000);
  if (from >= to) apiError(422, "invalid_range", "`from` must be before `to`.");
  if (to.getTime() - from.getTime() > 366 * 24 * 3600_000)
    apiError(422, "invalid_range", "Export at most a year at a time.");
  return { from, to };
}

/**
 * RFC 4180 CSV (CRLF line ends, fields with quotes, commas or line breaks quoted, quotes
 * doubled). Cells that a spreadsheet would run as a formula (= + - @, tab, CR) get a
 * leading `'`: tool inputs and task titles come from the model and from outside content.
 */
export function toCsv(header: string[], rows: (string | null | undefined)[][]): string {
  const cell = (value: string | null | undefined) => {
    let s = value ?? "";
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return `${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

/**
 * Someone leaving (or being removed from) a team must not be able to approve, on their own,
 * an action the team said needs an admin. Their pending admin-required calls are denied, and
 * runs left with nothing to wait for are re-queued so the agent can respond. Returns them.
 */
async function withdrawAdminRequests(tx: Db, userId: string): Promise<string[]> {
  const denied = await tx
    .update(schema.toolCalls)
    .set({
      status: "denied",
      decidedAt: new Date(),
      decisionReason: "Left the team before an admin decided.",
      output: {
        type: "denied",
        reason:
          "This needed a team admin's approval, and the user left the team before an admin decided. Don't retry it; ask the user what they want to do instead.",
      },
    })
    .where(
      and(
        eq(schema.toolCalls.userId, userId),
        eq(schema.toolCalls.approver, "admin"),
        eq(schema.toolCalls.status, "awaiting_approval"),
      ),
    )
    .returning({ runId: schema.toolCalls.runId });
  const runIds = [...new Set(denied.map((d) => d.runId))];
  const requeued: string[] = [];
  for (const runId of runIds) {
    const [left] = await tx
      .select({ id: schema.toolCalls.id })
      .from(schema.toolCalls)
      .where(
        and(eq(schema.toolCalls.runId, runId), eq(schema.toolCalls.status, "awaiting_approval")),
      )
      .limit(1);
    if (left) continue;
    const updated = await tx
      .update(schema.runs)
      .set({ status: "queued", leaseExpiresAt: null })
      .where(and(eq(schema.runs.id, runId), eq(schema.runs.status, "waiting")))
      .returning({ id: schema.runs.id });
    if (updated.length) requeued.push(runId);
  }
  return requeued;
}
