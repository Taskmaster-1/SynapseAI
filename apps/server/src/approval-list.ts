import { orgDomain, riskFacts } from "@synapse/core";
import { approvalsNeeded, type Db, schema } from "@synapse/db";
import { and, desc, eq, inArray, isNotNull, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

/**
 * Waiting approvals as the inbox shows them: the call, plus when it expires, whether it
 * was escalated, its two-person sign-off state and plain-language risk facts.
 */
export async function listApprovals(
  db: Db,
  where: SQL | undefined,
  opts: { withRequester?: boolean } = {},
) {
  const first = alias(schema.user, "first_approver");
  const rows = await db
    .select({
      runId: schema.toolCalls.runId,
      chatId: schema.runs.chatId,
      chatTitle: schema.chats.title,
      toolCallId: schema.toolCalls.id,
      name: schema.toolCalls.name,
      effect: schema.toolCalls.effect,
      input: schema.toolCalls.input,
      inputEdited: schema.toolCalls.inputEdited,
      reason: schema.toolCalls.decisionReason,
      preview: schema.toolCalls.preview,
      /** "admin": the person's team requires an admin to decide; they only wait. */
      approver: schema.toolCalls.approver,
      tainted: schema.runs.tainted,
      expiresAt: schema.toolCalls.expiresAt,
      escalatedAt: schema.toolCalls.escalatedAt,
      firstId: schema.toolCalls.firstApprovedBy,
      firstName: first.name,
      firstAt: schema.toolCalls.firstApprovedAt,
      twoPerson: schema.workspaces.twoPerson,
      createdAt: schema.toolCalls.createdAt,
      requester: {
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
      },
    })
    .from(schema.toolCalls)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.toolCalls.runId))
    .innerJoin(schema.chats, eq(schema.chats.id, schema.runs.chatId))
    .innerJoin(schema.user, eq(schema.user.id, schema.toolCalls.userId))
    .leftJoin(schema.workspaceMembers, eq(schema.workspaceMembers.userId, schema.toolCalls.userId))
    .leftJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .leftJoin(first, eq(first.id, schema.toolCalls.firstApprovedBy))
    .where(and(eq(schema.toolCalls.status, "awaiting_approval"), where))
    .orderBy(desc(schema.toolCalls.createdAt));
  return rows.map(({ firstId, firstName, firstAt, twoPerson, requester, ...r }) => ({
    ...r,
    facts: riskFacts({
      name: r.name,
      effect: r.effect,
      input: r.input,
      tainted: r.tainted,
      domain: orgDomain(requester.email),
    }),
    signoffs: {
      needed: approvalsNeeded(r.effect, twoPerson),
      first: firstId ? { id: firstId, name: firstName ?? "Someone", at: firstAt } : null,
    },
    ...(opts.withRequester ? { requester } : {}),
  }));
}

/**
 * What a team's owners and admins may decide for members: calls a team rule reserves for
 * an admin, calls escalated to them, and calls the two-person rule needs a second person for.
 */
export function teamDecidable(workspaceId: string, twoPerson: schema.TwoPersonRule | null) {
  const effects =
    twoPerson === "destructive"
      ? (["destructive"] as const)
      : twoPerson === "destructive_send"
        ? (["destructive", "send"] as const)
        : [];
  return and(
    eq(schema.workspaceMembers.workspaceId, workspaceId),
    or(
      eq(schema.toolCalls.approver, "admin"),
      isNotNull(schema.toolCalls.escalatedAt),
      ...(effects.length ? [inArray(schema.toolCalls.effect, [...effects])] : []),
    ),
  );
}
