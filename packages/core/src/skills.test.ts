import { describe, expect, test } from "bun:test";
import {
  loadSkillTool,
  parseSkillMarkdown,
  type Skill,
  serializeSkillMarkdown,
  skillNameProblem,
  skillProblem,
  skillsPromptBlock,
  skillVersion,
} from "./skills";
import type { ToolContext } from "./tools";

const skill = (over: Partial<Skill> = {}): Skill => ({
  name: "weekly-review",
  description: "Review the week ahead.",
  body: "1. List events.",
  files: {},
  source: "user",
  ...over,
});

const ctx: ToolContext = {
  userId: "u",
  chatId: "c",
  runId: "r",
  toolCallId: "t",
  abortSignal: new AbortController().signal,
};

describe("parseSkillMarkdown", () => {
  test("reads frontmatter and body", () => {
    const parsed = parseSkillMarkdown(
      "---\nname: inbox-triage\ndescription: Sort the inbox. Use when asked.\nlicense: MIT\n---\n\n# Triage\n\nSteps.\n",
    );
    expect(parsed).toEqual({
      name: "inbox-triage",
      description: "Sort the inbox. Use when asked.",
      body: "# Triage\n\nSteps.",
      extra: { license: "MIT" },
    });
  });

  test("quoted, folded and literal scalars; nested maps and comments are skipped", () => {
    const parsed = parseSkillMarkdown(
      [
        "﻿---",
        "# a comment",
        'name: "quoted-name"',
        "description: >",
        "  Folded over",
        "  two lines.",
        "",
        "  Second paragraph.",
        "metadata:",
        "  author: someone",
        "  version: 2",
        "compatibility: 'it''s fine' # trailing comment",
        "notes: |",
        "  line one",
        "    indented",
        "allowed-tools: Bash Read",
        "---",
        "Body",
      ].join("\r\n"),
    );
    expect(parsed.name).toBe("quoted-name");
    expect(parsed.description).toBe("Folded over two lines.\nSecond paragraph.");
    expect(parsed.extra).toEqual({
      compatibility: "it's fine",
      notes: "line one\n  indented",
      "allowed-tools": "Bash Read",
    });
    expect(parsed.body).toBe("Body");
  });

  test("refuses files that are not skills", () => {
    expect(() => parseSkillMarkdown("# Just markdown")).toThrow("frontmatter");
    expect(() => parseSkillMarkdown("---\ndescription: x\n---\nbody")).toThrow("name");
    expect(() => parseSkillMarkdown("---\nname: x\n---\nbody")).toThrow("description");
    expect(() => parseSkillMarkdown("---\nname x\n---\nbody")).toThrow("Cannot read");
  });

  test("serialize then parse round-trips", () => {
    const s = skill({ description: 'Says "no": politely, #always.' });
    const parsed = parseSkillMarkdown(serializeSkillMarkdown(s));
    expect(parsed).toMatchObject({ name: s.name, description: s.description, body: s.body });
  });
});

describe("validation", () => {
  test("names follow the Agent Skills rules", () => {
    expect(skillNameProblem("weekly-review")).toBeNull();
    expect(skillNameProblem("a1")).toBeNull();
    for (const bad of ["", "Weekly", "-x", "x-", "a--b", "a_b", "a".repeat(65)])
      expect(skillNameProblem(bad)).not.toBeNull();
  });

  test("description, body and reference files are checked", () => {
    expect(skillProblem(skill())).toBeNull();
    expect(skillProblem(skill({ description: " " }))).toContain("description");
    expect(skillProblem(skill({ body: "" }))).toContain("instructions");
    expect(skillProblem(skill({ files: { "refs/notes.md": "x" } }))).toBeNull();
    expect(skillProblem(skill({ files: { "../secret": "x" } }))).toContain("path");
    expect(skillProblem(skill({ files: { "a/../b.md": "x" } }))).toContain("path");
    expect(skillProblem(skill({ files: { "SKILL.md": "x" } }))).toContain("SKILL.md");
  });
});

describe("versions and the prompt listing", () => {
  test("the version is a content hash: stable, and changes with any content", async () => {
    const v = await skillVersion(skill());
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(await skillVersion(skill({ source: "builtin" }))).toBe(v);
    expect(await skillVersion(skill({ body: "1. List events!" }))).not.toBe(v);
    expect(await skillVersion(skill({ files: { "a.md": "x" } }))).not.toBe(v);
  });

  test("the listing is sorted, one line each, and byte-stable", () => {
    const a = skill({ name: "b-second", description: "Two\n  lines." });
    const b = skill({ name: "a-first", description: "First." });
    const block = skillsPromptBlock([a, b])!;
    expect(skillsPromptBlock([b, a])).toBe(block);
    expect(block.split("\n").slice(1)).toEqual(["- a-first: First.", "- b-second: Two lines."]);
    expect(block).toContain("load_skill");
    expect(block).not.toContain("1. List events");
    expect(skillsPromptBlock([])).toBeNull();
  });
});

describe("load_skill", () => {
  const s = skill({ files: { "template.md": "# Template" } });

  test("is a trusted read", () => {
    const tool = loadSkillTool([s]);
    expect(tool).toMatchObject({ effect: "read", untrustedOutput: false, source: "builtin" });
    expect(tool.preview!({ name: "weekly-review", file: "template.md" })).toBe(
      "Load skill “weekly-review” › template.md",
    );
  });

  test("returns the body or a reference file and records the version", async () => {
    const uses: unknown[] = [];
    const tool = loadSkillTool([s], async (_ctx, use) => {
      uses.push(use);
    });
    const version = await skillVersion(s);
    const body = await tool.execute({ name: "weekly-review" }, ctx);
    expect(body).toEqual({
      type: "text",
      value: `Skill “weekly-review” (version ${version}):\n\n1. List events.\n\nReference files (load one with load_skill and file): template.md`,
    });
    const file = await tool.execute({ name: "weekly-review", file: "template.md" }, ctx);
    expect(file.type === "text" && file.value.endsWith("# Template")).toBe(true);
    expect(uses).toEqual([
      { name: "weekly-review", version },
      { name: "weekly-review", version },
    ]);
  });

  test("unknown skills and files are errors that list what exists", async () => {
    const uses: unknown[] = [];
    const tool = loadSkillTool([s], async (_c, u) => {
      uses.push(u);
    });
    expect(await tool.execute({ name: "nope" }, ctx)).toEqual({
      type: "error",
      value: 'There is no skill named "nope". Available: weekly-review.',
    });
    const missing = await tool.execute({ name: "weekly-review", file: "../x" }, ctx);
    expect(missing).toMatchObject({ type: "error" });
    expect(missing.type === "error" && missing.value).toContain("template.md");
    expect(uses).toEqual([]);
  });
});
