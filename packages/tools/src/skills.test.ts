import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_SKILL_FILES, BUILTIN_SKILLS, skillFromFiles } from "./builtin/skills";

const DIR = join(import.meta.dir, "../skills");

test("every built-in skill folder is bundled, file for file", () => {
  const folders = readdirSync(DIR).sort();
  expect(BUILTIN_SKILLS.map((s) => s.name)).toEqual(folders);
  for (const [i, name] of folders.entries()) {
    const onDisk = Object.fromEntries(
      readdirSync(join(DIR, name))
        .sort()
        .map((f) => [f, readFileSync(join(DIR, name, f), "utf8")]),
    );
    expect(BUILTIN_SKILL_FILES[i]).toEqual(onDisk);
  }
});

test("built-in skills are valid, and their reference files are mentioned in the body", () => {
  for (const s of BUILTIN_SKILLS) {
    expect(s.source).toBe("builtin");
    for (const file of Object.keys(s.files)) expect(s.body).toContain(file);
  }
});

test("a folder without SKILL.md is refused", () => {
  expect(() => skillFromFiles({ "notes.md": "x" }, "user")).toThrow("SKILL.md");
});
