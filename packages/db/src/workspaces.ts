import type { TeamPolicyRule } from "@synapse/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "./client";
import { type WorkspaceRole, workspaceMembers, workspaceRules } from "./schema";

/** Roles that may decide calls a team rule reserves for an admin, and manage the team. */
export const ADMIN_ROLES: WorkspaceRole[] = ["owner", "admin"];

export function isAdminRole(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** The person's workspace and role, or null when they are not in one. */
export async function membershipOf(
  db: Db,
  userId: string,
): Promise<{ workspaceId: string; role: WorkspaceRole } | null> {
  const [row] = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  return row ?? null;
}

/** User ids of a workspace's owners and admins. */
export async function workspaceAdminIds(db: Db, workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.role, ADMIN_ROLES),
      ),
    )
    .orderBy(asc(workspaceMembers.joinedAt));
  return rows.map((r) => r.userId);
}

/** A workspace's rules, in order, in the shape the policy engine takes. */
export async function loadTeamRules(db: Db, workspaceId: string): Promise<TeamPolicyRule[]> {
  const rows = await db
    .select()
    .from(workspaceRules)
    .where(eq(workspaceRules.workspaceId, workspaceId))
    .orderBy(asc(workspaceRules.position), asc(workspaceRules.createdAt));
  return rows.map(
    (r): TeamPolicyRule => ({
      id: r.id,
      tool: r.tool,
      decision: r.decision,
      ...(r.when ? { when: r.when } : {}),
      ...(r.note ? { note: r.note } : {}),
      ...(r.approver ? { approver: r.approver } : {}),
    }),
  );
}

/** The team rules that apply to a person (empty when they are not in a workspace). */
export async function teamRulesFor(db: Db, userId: string): Promise<TeamPolicyRule[]> {
  const membership = await membershipOf(db, userId);
  return membership ? loadTeamRules(db, membership.workspaceId) : [];
}
