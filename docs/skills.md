# Skills

A skill is a short set of instructions for one kind of task: how to triage an inbox, prepare
for a meeting, or write a status update. The agent loads one when a task matches it and
follows it. Skills shape *how* the agent works. They never change *what it may do*.

Skills use the open [Agent Skills](https://agentskills.io) format, so a skill written for
another agent works here and the other way round.

## The format

A skill is a folder with a `SKILL.md` and, optionally, reference files:

```
meeting-prep/
├── SKILL.md
└── brief-template.md
```

`SKILL.md` starts with YAML frontmatter and continues with markdown instructions:

```markdown
---
name: meeting-prep
description: Build a one-page brief for an upcoming meeting from the calendar event, recent
  email with the attendees and the user's documents. Use when the user asks to prepare for a
  meeting.
license: MIT
---

# Meeting prep

1. Find the meeting with `calendar_list_events`…
3. Write the brief using `brief-template.md` (load it with `load_skill`, file `brief-template.md`).
```

| Field | Rules |
|---|---|
| `name` | 1–64 characters: lowercase letters, digits and single hyphens (`weekly-review`). Unique per user; built-in names are reserved. |
| `description` | Up to 1,024 characters. What the skill does **and when to use it**: this is the only part the agent sees until it loads the skill. |
| body | Up to 20,000 characters of markdown. |
| reference files | Up to 10, each up to 20,000 characters, at relative paths (`templates/decline.md`). |

Other frontmatter fields (`license`, `compatibility`, `metadata`…) are accepted and ignored.
So is `allowed-tools`: see [Safety](#safety).

## How the agent uses them (progressive disclosure)

Skills cost almost nothing until they are needed.

1. **Listed.** The system prompt lists every enabled skill as one line, `- name: description`,
   sorted by name with whitespace collapsed. The same skills always produce the same bytes,
   so the listing does not break prompt caching.
2. **Loaded.** When a task matches, the agent calls the built-in `load_skill` tool with the
   skill's `name`. It returns the full instructions and the names of its reference files.
3. **Referenced.** If the instructions point to a reference file, the agent calls
   `load_skill` again with `file`, and gets only that file.

`load_skill` is a `read`: it runs without asking, and its output is trusted (it comes from
you or from this repository, not from a third party), so it never taints a run.

## Built-in skills

They live in [`packages/tools/skills/`](../packages/tools/skills) as plain Agent Skills
folders, and are imported as text so they ship inside any bundle of the server.

| Skill | For |
|---|---|
| `inbox-triage` | What needs a reply, a decision, or nothing |
| `meeting-prep` | A one-page brief before a meeting (with a template) |
| `follow-up-nudges` | Sent emails nobody answered, and drafts to chase them |
| `weekly-calendar-review` | Conflicts, overload, prep and focus time in the week ahead |
| `polite-decline` | A short, kind, clear no (with patterns) |
| `status-update` | Done, next, risks, asks (with a template) |

Every built-in is on by default. Switch any of them off on the **Skills** page. To add one to
the repository, create a folder there and add its files to `BUILTIN_SKILL_FILES` in
`packages/tools/src/builtin/skills.ts`; a test fails if a folder is not bundled.

## Your own skills

On the **Skills** page you can write a skill (name, when to use it, instructions), import a
`SKILL.md`, switch it on or off, edit or delete it, and download it as a `SKILL.md` to use
elsewhere. They are stored in Postgres (`skills` table) and are private to you.

You can also ask in a chat: *"save that as a skill called invoice-check"*. The agent then
calls `skill_save`. Saving a skill is a `write` that always asks for your approval, and
like every non-read call it can never be auto-allowed once a task has read outside content.
So an email or web page can't plant a skill: you would see it on an approval card first.

## Versions and audit

Every skill has a version: the first 12 hex characters of a SHA-256 over its name,
description, body and reference files. Any change to what the agent can read changes it.

When the agent loads a skill, the run records it (`runs.skills`: name and version, in load
order). Every tool call proposed after that carries the list (`tool_calls.skills`, and the
`skills` field of the `tool.call` event). An audit can therefore say exactly which
instructions, in which version, were in play when an email went out.

## Safety

**Skills are instructions, never permissions.** Nothing in a skill changes a tool's effect,
your rules, your team's rules, the undo window or who must approve. Every call a skill leads
to goes through the policy engine like any other. A skill that says "send the summary to the
team" still produces a send that asks. `allowed-tools` in the frontmatter is ignored.

A skill's text is treated as yours: built-ins come from this repository and your own
skills from you. For the [new-recipient check](../README.md#approval-policy), addresses in
the skills listing count as trusted like the rest of the system prompt, and so do those in a
skill the agent loaded before the task read outside content. A skill loaded afterwards is
still followed, but it can't vouch for a recipient: by then, the agent might be asking for it
because of something it read.

## API

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/skills` | | `{ skills: { name, description, source: "builtin" \| "user", enabled, version, files: string[], updatedAt }[] }` |
| GET | `/api/skills/:name` | | `{ skill }`, plus `body` and `fileContents` |
| GET | `/api/skills/:name/markdown` | | the skill as a `SKILL.md` (`text/markdown`, download) |
| POST | `/api/skills` | `{ name, description, body, files?, enabled? }` or `{ markdown, files?, enabled? }` | `201 { skill }` (`422 invalid_skill`, `409 conflict`) |
| PATCH | `/api/skills/:name` | any of `name`, `description`, `body`, `files`, `enabled` | `{ skill }`. Built-ins accept only `enabled` (`422 read_only`) |
| DELETE | `/api/skills/:name` | | `204`. Built-ins can't be deleted (`422 read_only`) |
