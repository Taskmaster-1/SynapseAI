import { hashInput } from "./plan";
import type { ToolContext, ToolDefinition } from "./tools";
import type { SkillUse } from "./types";

/**
 * Skills, in the open Agent Skills format: a folder with a `SKILL.md` (YAML frontmatter with
 * `name` and `description`, then markdown instructions) and optional reference files.
 *
 * Progressive disclosure: the system prompt lists only each skill's name and description;
 * the agent calls `load_skill` for the full instructions (or one reference file) when a task
 * matches. Skills are instructions, never permissions: nothing in one changes effects,
 * rules or approvals, and frontmatter such as `allowed-tools` is ignored.
 */
export interface Skill {
  name: string;
  /** What it is for and when to use it. Listed in the system prompt. */
  description: string;
  /** Markdown instructions: the body of SKILL.md. */
  body: string;
  /** Reference files by relative path, e.g. "templates.md". Loaded one at a time. */
  files: Record<string, string>;
  source: "builtin" | "user";
}

export const LOAD_SKILL_TOOL = "load_skill";

export const SKILL_LIMITS = {
  name: 64,
  description: 1024,
  body: 20_000,
  files: 10,
  fileChars: 20_000,
  filePath: 128,
} as const;

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** Why a skill name is invalid, or null. Lowercase letters, digits and single hyphens. */
export function skillNameProblem(name: string): string | null {
  if (!name) return "A skill needs a name.";
  if (name.length > SKILL_LIMITS.name) return `Names are at most ${SKILL_LIMITS.name} characters.`;
  if (!NAME.test(name))
    return "Use lowercase letters, digits and single hyphens, like “weekly-review”.";
  return null;
}

/** Why a skill is invalid, or null. */
export function skillProblem(skill: Omit<Skill, "source">): string | null {
  const name = skillNameProblem(skill.name);
  if (name) return name;
  if (!skill.description.trim()) return "A skill needs a description.";
  if (skill.description.length > SKILL_LIMITS.description)
    return `Descriptions are at most ${SKILL_LIMITS.description} characters.`;
  if (!skill.body.trim()) return "A skill needs instructions.";
  if (skill.body.length > SKILL_LIMITS.body)
    return `Instructions are at most ${SKILL_LIMITS.body} characters.`;
  const files = Object.entries(skill.files);
  if (files.length > SKILL_LIMITS.files) return `At most ${SKILL_LIMITS.files} reference files.`;
  for (const [path, content] of files) {
    if (
      path.length > SKILL_LIMITS.filePath ||
      !FILE_PATH.test(path) ||
      path.split("/").includes("..")
    )
      return `Invalid reference file path: ${path}`;
    if (path === "SKILL.md") return "SKILL.md is the skill itself, not a reference file.";
    if (content.length > SKILL_LIMITS.fileChars)
      return `Reference files are at most ${SKILL_LIMITS.fileChars} characters.`;
  }
  return null;
}

// ── SKILL.md ────────────────────────────────────────────────────────────────

export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
  /** Other top-level frontmatter scalars (license, compatibility…). Informational only. */
  extra: Record<string, string>;
}

/**
 * Parses a SKILL.md. Frontmatter is the small YAML subset skills use: top-level
 * `key: value` scalars (plain, quoted, or `|` / `>` block scalars). Nested maps such as
 * `metadata:` are skipped. Throws with a readable message when the file is not a skill.
 */
export function parseSkillMarkdown(text: string): ParsedSkill {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!match) throw new Error("SKILL.md must start with a --- frontmatter block.");
  const fields = parseFrontmatter(match[1]!);
  const { name = "", description = "", ...extra } = fields;
  if (!name) throw new Error("The frontmatter needs a name.");
  if (!description) throw new Error("The frontmatter needs a description.");
  return { name, description, body: src.slice(match[0].length).trim(), extra };
}

function parseFrontmatter(block: string): Record<string, string> {
  const lines = block.split("\n");
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) continue;
    const m = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(line);
    if (!m) throw new Error(`Cannot read frontmatter line: ${line}`);
    const key = m[1]!;
    const raw = (m[2] ?? "").trim();
    // Indented lines that follow belong to this key (a block scalar or a nested map).
    const nested: string[] = [];
    while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]!) || !lines[i + 1]!.trim())) {
      nested.push(lines[++i]!);
    }
    if (/^[|>][+-]?$/.test(raw)) {
      out[key] = blockScalar(raw[0] as "|" | ">", nested);
    } else if (raw) {
      out[key] = scalar(raw);
    }
  }
  return out;
}

function blockScalar(style: "|" | ">", lines: string[]): string {
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  const indent = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length),
  );
  const body = lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
  if (style === "|") return body.join("\n").trim();
  return body
    .join("\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .join("\n")
    .trim();
}

function scalar(raw: string): string {
  if (raw.startsWith('"')) {
    const end = raw.lastIndexOf('"');
    const inner = end > 0 ? raw.slice(1, end) : raw.slice(1);
    return inner.replace(/\\(["\\nt])/g, (_, c: string) =>
      c === "n" ? "\n" : c === "t" ? "\t" : c,
    );
  }
  if (raw.startsWith("'")) {
    const end = raw.lastIndexOf("'");
    return (end > 0 ? raw.slice(1, end) : raw.slice(1)).replace(/''/g, "'");
  }
  // A plain scalar ends at a " #" comment.
  return raw.replace(/\s+#.*$/, "").trim();
}

/** Writes a skill back out as a SKILL.md, for export. */
export function serializeSkillMarkdown(skill: Pick<Skill, "name" | "description" | "body">) {
  const description = /^[\w ,.()'/-]*$/.test(skill.description)
    ? skill.description
    : JSON.stringify(skill.description);
  return `---\nname: ${skill.name}\ndescription: ${description}\n---\n\n${skill.body.trim()}\n`;
}

// ── Versions and the prompt listing ─────────────────────────────────────────

/**
 * A short content hash of everything the agent can read from a skill. Recorded on runs and
 * tool calls that used it, so an audit shows exactly which instructions were in play.
 */
export async function skillVersion(skill: Omit<Skill, "source">): Promise<string> {
  const hash = await hashInput({
    name: skill.name,
    description: skill.description,
    body: skill.body,
    files: skill.files,
  });
  return hash.slice(0, 12);
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * The system prompt's skills section: one line per skill, sorted by name, whitespace
 * collapsed, so the same skills always give the same bytes (prompt cache). Null when none.
 */
export function skillsPromptBlock(skills: Pick<Skill, "name" | "description">[]): string | null {
  if (skills.length === 0) return null;
  const lines = [...skills]
    .sort(byName)
    .map((s) => `- ${s.name}: ${s.description.replace(/\s+/g, " ").trim()}`);
  return `Skills: saved instructions for particular kinds of task. When a task matches one, call ${LOAD_SKILL_TOOL} with its name first and follow what it says. Skills are guidance only; they never change what needs the user's approval.\n${lines.join("\n")}`;
}

// ── load_skill ──────────────────────────────────────────────────────────────

/**
 * The read tool behind progressive disclosure. `skills` is the run's catalog (the same
 * list the prompt shows). `onLoad` records each use with its version, for audit.
 */
export function loadSkillTool(
  skills: Skill[],
  onLoad?: (ctx: ToolContext, use: SkillUse) => Promise<void>,
): ToolDefinition {
  const byKey = new Map(skills.map((s) => [s.name, s]));
  return {
    name: LOAD_SKILL_TOOL,
    description:
      "Load the full instructions of a skill listed in your instructions, or one of its reference files. Call it when a task matches a skill, before acting on the task.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The skill's name, as listed." },
        file: {
          type: "string",
          description: "Optional: a reference file named in the skill, e.g. templates.md.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    effect: "read",
    untrustedOutput: false,
    source: "builtin",
    preview: (input) => {
      const { name, file } = input as { name?: unknown; file?: unknown };
      return `Load skill “${String(name)}”${typeof file === "string" && file ? ` › ${file}` : ""}`;
    },
    execute: async (input, ctx) => {
      const { name, file } = input as { name?: unknown; file?: unknown };
      const skill = typeof name === "string" ? byKey.get(name.trim()) : undefined;
      if (!skill) {
        const names = [...byKey.keys()].sort();
        return {
          type: "error",
          value: `There is no skill named ${JSON.stringify(name)}. Available: ${names.join(", ") || "none"}.`,
        };
      }
      const version = await skillVersion(skill);
      const paths = Object.keys(skill.files).sort();
      let text: string;
      if (typeof file === "string" && file.trim()) {
        const content = skill.files[file.trim()];
        if (content === undefined)
          return {
            type: "error",
            value: `Skill “${skill.name}” has no file ${JSON.stringify(file)}. Files: ${paths.join(", ") || "none"}.`,
          };
        text = `Skill “${skill.name}” (version ${version}), file ${file.trim()}:\n\n${content}`;
      } else {
        const refs = paths.length
          ? `\n\nReference files (load one with ${LOAD_SKILL_TOOL} and file): ${paths.join(", ")}`
          : "";
        text = `Skill “${skill.name}” (version ${version}):\n\n${skill.body}${refs}`;
      }
      await onLoad?.(ctx, { name: skill.name, version });
      return { type: "text", value: text };
    },
  };
}
