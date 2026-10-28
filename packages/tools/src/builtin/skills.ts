import {
  loadSkillTool,
  parseSkillMarkdown,
  type Skill,
  skillProblem,
  type ToolDefinition,
} from "@synapse/core";
import { addRunSkill, type Db, schema } from "@synapse/db";
import { and, asc, eq, sql } from "drizzle-orm";
// Built-in skills live in packages/tools/skills/<name>/ as plain Agent Skills folders. They
// are imported as text so they ship inside any bundle of the server, with no file reads.
import followUpNudges from "../../skills/follow-up-nudges/SKILL.md" with { type: "text" };
import inboxTriage from "../../skills/inbox-triage/SKILL.md" with { type: "text" };
import meetingBrief from "../../skills/meeting-prep/brief-template.md" with { type: "text" };
import meetingPrep from "../../skills/meeting-prep/SKILL.md" with { type: "text" };
import declinePatterns from "../../skills/polite-decline/patterns.md" with { type: "text" };
import politeDecline from "../../skills/polite-decline/SKILL.md" with { type: "text" };
import statusUpdate from "../../skills/status-update/SKILL.md" with { type: "text" };
import statusTemplate from "../../skills/status-update/template.md" with { type: "text" };
import weeklyReview from "../../skills/weekly-calendar-review/SKILL.md" with { type: "text" };

/** Each built-in skill folder: SKILL.md plus its reference files, by relative path. */
export const BUILTIN_SKILL_FILES: Record<string, string>[] = [
  { "SKILL.md": followUpNudges },
  { "SKILL.md": inboxTriage },
  { "SKILL.md": meetingPrep, "brief-template.md": meetingBrief },
  { "SKILL.md": politeDecline, "patterns.md": declinePatterns },
  { "SKILL.md": statusUpdate, "template.md": statusTemplate },
  { "SKILL.md": weeklyReview },
];

/** Reads one Agent Skills folder (as a map of files) into a skill. Throws when invalid. */
export function skillFromFiles(files: Record<string, string>, source: Skill["source"]): Skill {
  const { "SKILL.md": main, ...refs } = files;
  if (main === undefined) throw new Error("A skill folder needs a SKILL.md.");
  const parsed = parseSkillMarkdown(main);
  const skill: Skill = {
    name: parsed.name,
    description: parsed.description,
    body: parsed.body,
    files: refs,
    source,
  };
  const problem = skillProblem(skill);
  if (problem) throw new Error(`Skill ${parsed.name}: ${problem}`);
  return skill;
}

export const BUILTIN_SKILLS: Skill[] = BUILTIN_SKILL_FILES.map((f) => skillFromFiles(f, "builtin"));

const BUILTIN_NAMES = new Set(BUILTIN_SKILLS.map((s) => s.name));

export function isBuiltinSkill(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}

export const MAX_USER_SKILLS = 100;

export interface SkillEntry extends Skill {
  enabled: boolean;
  /** User skills only. */
  updatedAt: Date | null;
}

/** Every skill the user can see: built-ins, then their own, each with its on/off state. */
export async function skillCatalog(db: Db, userId: string): Promise<SkillEntry[]> {
  const [settings] = await db
    .select({ disabled: schema.userSettings.disabledSkills })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId));
  const disabled = new Set(settings?.disabled ?? []);
  const own = await db
    .select()
    .from(schema.skills)
    .where(eq(schema.skills.userId, userId))
    .orderBy(asc(schema.skills.name));
  return [
    ...BUILTIN_SKILLS.map((s) => ({ ...s, enabled: !disabled.has(s.name), updatedAt: null })),
    ...own.map((r) => ({
      name: r.name,
      description: r.description,
      body: r.body,
      files: r.files,
      source: "user" as const,
      enabled: r.enabled,
      updatedAt: r.updatedAt,
    })),
  ];
}

/** The skills a run may use: the enabled ones. */
export async function enabledSkills(db: Db, userId: string): Promise<Skill[]> {
  return (await skillCatalog(db, userId))
    .filter((s) => s.enabled)
    .map(({ enabled: _e, updatedAt: _u, ...s }) => s);
}

/**
 * `load_skill` over the run's enabled skills (when there are any), recording each use on the
 * run; and `skill_save`, so the user can say "save that as a skill".
 */
export function skillTools(db: Db, skills: Skill[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [skillSaveTool(db)];
  if (skills.length > 0)
    tools.push(loadSkillTool(skills, (ctx, use) => addRunSkill(db, ctx.runId, use)));
  return tools;
}

/**
 * Creates or replaces one of the user's own skills. A skill steers every later task, so this
 * asks for approval by default; like any non-read call it always asks once the run has read
 * outside content, so injected text can never plant a skill on its own.
 */
function skillSaveTool(db: Db): ToolDefinition {
  return {
    name: "skill_save",
    description:
      "Save a reusable procedure as one of the user's skills (or replace one of theirs with the same name), for future tasks. Only when the user asks to save or change a skill. Built-in skills cannot be changed.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Lowercase letters, digits and hyphens, e.g. weekly-invoice-check.",
        },
        description: {
          type: "string",
          description: "One or two sentences: what it does and when to use it.",
        },
        instructions: { type: "string", description: "The steps and rules, in markdown." },
      },
      required: ["name", "description", "instructions"],
      additionalProperties: false,
    },
    effect: "write",
    defaultDecision: "ask",
    untrustedOutput: false,
    source: "builtin",
    preview: (input) => {
      const { name, description } = input as { name?: unknown; description?: unknown };
      return `Save skill “${String(name)}”: ${String(description ?? "")}`;
    },
    execute: async (input, ctx) => {
      const i = input as { name?: unknown; description?: unknown; instructions?: unknown };
      const skill = {
        name: String(i.name ?? "").trim(),
        description: String(i.description ?? "").trim(),
        body: String(i.instructions ?? "").trim(),
        files: {},
      };
      const problem = skillProblem(skill);
      if (problem) return { type: "error", value: problem };
      if (isBuiltinSkill(skill.name))
        return { type: "error", value: `“${skill.name}” is a built-in skill. Pick another name.` };
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.skills)
        .where(eq(schema.skills.userId, ctx.userId));
      const [existing] = await db
        .select({ id: schema.skills.id })
        .from(schema.skills)
        .where(and(eq(schema.skills.userId, ctx.userId), eq(schema.skills.name, skill.name)));
      if (!existing && n >= MAX_USER_SKILLS)
        return { type: "error", value: `The user already has ${MAX_USER_SKILLS} skills.` };
      await db
        .insert(schema.skills)
        .values({ ...skill, userId: ctx.userId })
        .onConflictDoUpdate({
          target: [schema.skills.userId, schema.skills.name],
          set: { description: skill.description, body: skill.body },
        });
      return {
        type: "text",
        value: `Saved skill “${skill.name}”${existing ? " (replaced the previous version)" : ""}. It is available from the next task on; the user can edit or switch it off under Skills.`,
      };
    },
  };
}
