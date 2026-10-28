import {
  parseSkillMarkdown,
  SKILL_LIMITS,
  serializeSkillMarkdown,
  skillProblem,
  skillVersion,
} from "@synapse/core";
import { schema } from "@synapse/db";
import { isBuiltinSkill, MAX_USER_SKILLS, type SkillEntry, skillCatalog } from "@synapse/tools";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, apiError, body } from "../http";

type Ctx = { var: AppEnv["Variables"] };

const Files = z.record(z.string(), z.string()).default({});

const Fields = z.object({
  name: z.string().trim().max(SKILL_LIMITS.name),
  description: z.string().trim().max(SKILL_LIMITS.description),
  body: z.string().trim().max(SKILL_LIMITS.body),
  files: Files,
  enabled: z.boolean().default(true),
});

/** Either the fields, or a whole SKILL.md to import. */
const Create = z.union([
  Fields,
  z.object({
    markdown: z.string().max(SKILL_LIMITS.body + SKILL_LIMITS.description + 1_000),
    files: Files,
    enabled: z.boolean().default(true),
  }),
]);

/** A field left out keeps its value. Built-in skills only take `enabled`. */
const Update = z.object({
  name: Fields.shape.name.optional(),
  description: Fields.shape.description.optional(),
  body: Fields.shape.body.optional(),
  files: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

async function summary(s: SkillEntry) {
  return {
    name: s.name,
    description: s.description,
    source: s.source,
    enabled: s.enabled,
    version: await skillVersion(s),
    files: Object.keys(s.files).sort(),
    updatedAt: s.updatedAt?.toISOString() ?? null,
  };
}

async function full(s: SkillEntry) {
  return { ...(await summary(s)), body: s.body, fileContents: s.files };
}

async function find(c: Ctx, name: string): Promise<SkillEntry> {
  const skill = (await skillCatalog(c.var.services.database.db, c.var.user.id)).find(
    (s) => s.name === name,
  );
  if (!skill) apiError(404, "not_found", "Skill not found.");
  return skill;
}

function check(skill: { name: string; description: string; body: string; files: object }) {
  const problem = skillProblem(skill as Parameters<typeof skillProblem>[0]);
  if (problem) apiError(422, "invalid_skill", problem);
  if (isBuiltinSkill(skill.name))
    apiError(409, "conflict", `“${skill.name}” is a built-in skill. Pick another name.`);
}

/**
 * Skills: built-ins (switch on or off) and the user's own (create, edit, delete). Skills are
 * instructions only, so nothing here touches policy; every call a skill leads to is still
 * judged by the user's rules.
 */
export const skills = new Hono<AppEnv>()
  .get("/", async (c) => {
    const all = await skillCatalog(c.var.services.database.db, c.var.user.id);
    return c.json({ skills: await Promise.all(all.map(summary)) });
  })

  .get("/:name", async (c) => c.json({ skill: await full(await find(c, c.req.param("name"))) }))

  /** The skill as a SKILL.md, to share or move to another agent. */
  .get("/:name/markdown", async (c) => {
    const skill = await find(c, c.req.param("name"));
    c.header("content-disposition", `attachment; filename="${skill.name}-SKILL.md"`);
    return c.body(serializeSkillMarkdown(skill), 200, {
      "content-type": "text/markdown; charset=utf-8",
    });
  })

  .post("/", async (c) => {
    const input = await body(c, Create);
    let fields: z.infer<typeof Fields>;
    if ("markdown" in input) {
      try {
        const parsed = parseSkillMarkdown(input.markdown);
        fields = { ...parsed, files: input.files, enabled: input.enabled };
      } catch (error) {
        apiError(422, "invalid_skill", error instanceof Error ? error.message : String(error));
      }
    } else fields = input;
    check(fields);
    const { db } = c.var.services.database;
    const userId = c.var.user.id;
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.skills)
      .where(eq(schema.skills.userId, userId));
    if (n >= MAX_USER_SKILLS)
      apiError(422, "too_many", `You can have up to ${MAX_USER_SKILLS} skills.`);
    const [row] = await db
      .insert(schema.skills)
      .values({ ...fields, userId })
      .onConflictDoNothing()
      .returning({ name: schema.skills.name });
    if (!row) apiError(409, "conflict", `You already have a skill named “${fields.name}”.`);
    return c.json({ skill: await full(await find(c, row.name)) }, 201);
  })

  .patch("/:name", async (c) => {
    const input = await body(c, Update);
    const current = await find(c, c.req.param("name"));
    const { db } = c.var.services.database;
    const userId = c.var.user.id;

    if (current.source === "builtin") {
      const { enabled, ...rest } = input;
      if (Object.values(rest).some((v) => v !== undefined))
        apiError(422, "read_only", "Built-in skills can be switched on or off, not edited.");
      if (enabled !== undefined) {
        const [settings] = await db
          .select({ disabled: schema.userSettings.disabledSkills })
          .from(schema.userSettings)
          .where(eq(schema.userSettings.userId, userId));
        const others = (settings?.disabled ?? []).filter((n) => n !== current.name);
        const disabledSkills = enabled ? others : [...others, current.name];
        await db
          .insert(schema.userSettings)
          .values({ userId, disabledSkills })
          .onConflictDoUpdate({ target: schema.userSettings.userId, set: { disabledSkills } });
      }
      return c.json({ skill: await full(await find(c, current.name)) });
    }

    const next = {
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      body: input.body ?? current.body,
      files: input.files ?? current.files,
      enabled: input.enabled ?? current.enabled,
    };
    check(next);
    if (next.name !== current.name) {
      const [taken] = await db
        .select({ id: schema.skills.id })
        .from(schema.skills)
        .where(and(eq(schema.skills.userId, userId), eq(schema.skills.name, next.name)));
      if (taken) apiError(409, "conflict", `You already have a skill named “${next.name}”.`);
    }
    await db
      .update(schema.skills)
      .set(next)
      .where(and(eq(schema.skills.userId, userId), eq(schema.skills.name, current.name)));
    return c.json({ skill: await full(await find(c, next.name)) });
  })

  .delete("/:name", async (c) => {
    const current = await find(c, c.req.param("name"));
    if (current.source === "builtin")
      apiError(422, "read_only", "Built-in skills can be switched off, not deleted.");
    await c.var.services.database.db
      .delete(schema.skills)
      .where(and(eq(schema.skills.userId, c.var.user.id), eq(schema.skills.name, current.name)));
    return c.body(null, 204);
  });
