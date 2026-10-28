"use client";

import { Download, FileText, LoaderCircle, Pencil, Plus, Upload } from "lucide-react";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Sheet } from "@/components/overlay";
import { useToast } from "@/components/toast";
import {
  EmptyState,
  ErrorNote,
  Field,
  Page,
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
  Switch,
} from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { cx, formatRelative } from "@/lib/format";
import { type SkillDetail, type SkillSummary, skillsApi } from "@/lib/skills";
import { useApi } from "@/lib/use-api";

type Editing = { mode: "new" } | { mode: "open"; name: string } | null;

export default function SkillsPage() {
  const skills = useApi(() => skillsApi.list());
  const [editing, setEditing] = useState<Editing>(null);
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const list = skills.data?.skills;
  const own = list?.filter((s) => s.source === "user") ?? [];
  const builtin = list?.filter((s) => s.source === "builtin") ?? [];

  const upsert = (s: SkillSummary, previousName = s.name) =>
    skills.setData((d) => {
      const all = d?.skills ?? [];
      return {
        skills: all.some((x) => x.name === previousName)
          ? all.map((x) => (x.name === previousName ? s : x))
          : [...all, s].sort((a, b) =>
              a.source === b.source
                ? a.name.localeCompare(b.name)
                : a.source === "builtin"
                  ? -1
                  : 1,
            ),
      };
    });

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { skill } = await skillsApi.importMarkdown(await file.text());
      upsert(skill);
      toast(`Imported “${skill.name}”`, "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Know-how"
        title="Skills"
        description="Instructions the agent loads when a task calls for them: how you triage mail, prepare for a meeting, write an update. Skills shape how it works, never what it may do. Every action still goes through your approval rules."
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".md,text/markdown"
              className="hidden"
              onChange={(e) => void importFile(e)}
            />
            <button
              type="button"
              className="btn"
              onClick={() => fileInput.current?.click()}
              title="Import a SKILL.md file"
            >
              <Upload />
              Import
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setEditing({ mode: "new" })}
            >
              <Plus />
              New skill
            </button>
          </>
        }
      />
      {skills.error ? <ErrorNote>{errorMessage(skills.error)}</ErrorNote> : null}
      {!list ? (
        skills.loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 rounded-card" />
            <Skeleton className="h-24 rounded-card" />
          </div>
        ) : null
      ) : (
        <div className="space-y-12">
          <section aria-labelledby="own-skills">
            <SectionTitle>
              <span id="own-skills">Yours</span>
            </SectionTitle>
            {own.length === 0 ? (
              <EmptyState
                compact
                title="Teach it how you work"
                action={
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setEditing({ mode: "new" })}
                  >
                    Write a skill
                  </button>
                }
              >
                Write down a procedure once (how you check invoices, what goes in your weekly
                report) and the agent follows it whenever a task matches. You can also ask it in a
                chat to save something as a skill.
              </EmptyState>
            ) : (
              <SkillList
                skills={own}
                onChange={upsert}
                onOpen={(name) => setEditing({ mode: "open", name })}
              />
            )}
          </section>
          <section aria-labelledby="builtin-skills">
            <SectionTitle>
              <span id="builtin-skills">Built in</span>
            </SectionTitle>
            <SkillList
              skills={builtin}
              onChange={upsert}
              onOpen={(name) => setEditing({ mode: "open", name })}
            />
          </section>
        </div>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.mode === "new" ? "New skill" : (editing?.name ?? "")}
        description={
          editing?.mode === "new"
            ? "In the open Agent Skills format: a name, a description, and instructions in markdown."
            : undefined
        }
        width={600}
      >
        {editing?.mode === "new" ? (
          <SkillForm
            initial={null}
            onCancel={() => setEditing(null)}
            onSaved={(s) => {
              upsert(s);
              setEditing(null);
            }}
          />
        ) : editing?.mode === "open" ? (
          <SkillPanel
            key={editing.name}
            name={editing.name}
            onClose={() => setEditing(null)}
            onSaved={(s, previous) => {
              upsert(s, previous);
              setEditing({ mode: "open", name: s.name });
            }}
            onDeleted={(name) => {
              skills.setData((d) => (d ? { skills: d.skills.filter((x) => x.name !== name) } : d));
              setEditing(null);
            }}
          />
        ) : null}
      </Sheet>
    </Page>
  );
}

function SkillList({
  skills,
  onChange,
  onOpen,
}: {
  skills: SkillSummary[];
  onChange: (s: SkillSummary) => void;
  onOpen: (name: string) => void;
}) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">
      {skills.map((s) => (
        <li key={s.name}>
          <SkillRow skill={s} onChange={onChange} onOpen={() => onOpen(s.name)} />
        </li>
      ))}
    </ul>
  );
}

function SkillRow({
  skill: s,
  onChange,
  onOpen,
}: {
  skill: SkillSummary;
  onChange: (s: SkillSummary) => void;
  onOpen: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      const { skill } = await skillsApi.update(s.name, { enabled });
      onChange(skill);
      toast(enabled ? `“${s.name}” is on` : `“${s.name}” is off`, "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cx("flex items-start gap-4 px-4 py-4 md:px-5", !s.enabled && "bg-sunken/40")}>
      <button
        type="button"
        onClick={onOpen}
        className="group min-w-0 flex-1 text-left"
        aria-label={`Open ${s.name}`}
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cx(
              "font-mono text-13 font-medium group-hover:underline",
              s.enabled ? "text-fg" : "text-fg-muted",
            )}
          >
            {s.name}
          </span>
          {s.files.length > 0 ? (
            <Pill tone="outline" title={s.files.join(", ")}>
              <FileText className="size-3" />
              {s.files.length} {s.files.length === 1 ? "file" : "files"}
            </Pill>
          ) : null}
          <span
            className="tabular font-mono text-12 text-fg-faint"
            title="Version: changes whenever the skill's content does. Recorded on every action taken while it was loaded."
          >
            v{s.version.slice(0, 7)}
          </span>
        </span>
        <span className="mt-1 line-clamp-2 block text-14 text-fg-muted">{s.description}</span>
        {s.updatedAt ? (
          <span className="mt-1 block text-12 text-fg-faint">
            Edited {formatRelative(s.updatedAt)}
          </span>
        ) : null}
      </button>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {busy ? <LoaderCircle className="anim-spin size-3.5 text-fg-faint" /> : null}
        <Switch
          checked={s.enabled}
          label={s.enabled ? `Turn off ${s.name}` : `Turn on ${s.name}`}
          disabled={busy}
          onChange={(v) => void toggle(v)}
        />
      </div>
    </div>
  );
}

function SkillPanel({
  name,
  onClose,
  onSaved,
  onDeleted,
}: {
  name: string;
  onClose: () => void;
  onSaved: (s: SkillDetail, previousName: string) => void;
  onDeleted: (name: string) => void;
}) {
  const detail = useApi(() => skillsApi.get(name), name);
  const [editing, setEditing] = useState(false);
  const skill = detail.data?.skill;

  if (detail.error) return <ErrorNote>{errorMessage(detail.error)}</ErrorNote>;
  if (!skill)
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-40" />
      </div>
    );

  if (editing)
    return (
      <SkillForm
        initial={skill}
        onCancel={() => setEditing(false)}
        onSaved={(s) => {
          detail.setData({ skill: s });
          setEditing(false);
          onSaved(s, skill.name);
        }}
        onDeleted={() => onDeleted(skill.name)}
      />
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={skill.source === "builtin" ? "neutral" : "accent"}>
          {skill.source === "builtin" ? "Built in" : "Yours"}
        </Pill>
        <Pill tone={skill.enabled ? "ok" : "outline"}>{skill.enabled ? "On" : "Off"}</Pill>
        <span className="font-mono text-12 text-fg-faint">version {skill.version}</span>
      </div>
      <p className="text-14 text-fg-muted">{skill.description}</p>
      <div className="rounded-[12px] border border-line bg-canvas px-4 py-3">
        <Markdown text={skill.body} className="text-14" />
      </div>
      {skill.files.length > 0 ? (
        <div>
          <p className="label">Reference files</p>
          <p className="hint mb-2">Loaded only when the instructions call for them.</p>
          <div className="space-y-2">
            {skill.files.map((f) => (
              <details key={f} className="rounded-[12px] border border-line bg-canvas">
                <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 font-mono text-13">
                  <FileText className="size-3.5 text-fg-faint" />
                  {f}
                </summary>
                <div className="border-t border-line px-4 py-3">
                  <Markdown text={skill.fileContents[f] ?? ""} className="text-14" />
                </div>
              </details>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <a className="btn btn-ghost" href={skillsApi.markdownUrl(skill.name)} download>
          <Download />
          SKILL.md
        </a>
        <span className="flex-1" />
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
        {skill.source === "user" ? (
          <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
            <Pencil />
            Edit
          </button>
        ) : null}
      </div>
    </div>
  );
}

const NAME_HINT = "Lowercase letters, digits and hyphens, like weekly-report.";

function SkillForm({
  initial,
  onCancel,
  onSaved,
  onDeleted,
}: {
  initial: SkillDetail | null;
  onCancel: () => void;
  onSaved: (s: SkillDetail) => void;
  onDeleted?: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input = { name: name.trim(), description: description.trim(), body: body.trim() };
    try {
      const { skill } = initial
        ? await skillsApi.update(initial.name, input)
        : await skillsApi.create(input);
      toast(initial ? "Skill saved" : "Skill created", "success");
      onSaved(skill);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial || !window.confirm(`Delete the skill “${initial.name}”?`)) return;
    setBusy(true);
    try {
      await skillsApi.remove(initial.name);
      toast("Skill deleted", "success");
      onDeleted?.();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Name" htmlFor="skill-name" hint={NAME_HINT}>
        <input
          id="skill-name"
          data-autofocus
          className="input font-mono text-13"
          required
          maxLength={64}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          title={NAME_HINT}
          placeholder="invoice-check"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
        />
      </Field>
      <Field
        label="When to use it"
        htmlFor="skill-description"
        hint="The agent sees only this line until it decides to load the skill, so say what it does and when it applies."
      >
        <textarea
          id="skill-description"
          className="input min-h-20 resize-y"
          required
          maxLength={1024}
          placeholder="Check new invoices against the budget sheet. Use when the user asks about invoices or bills."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field
        label="Instructions"
        htmlFor="skill-body"
        hint="Markdown. Steps, rules, examples. Skills can't grant permissions: actions still ask under your rules."
      >
        <textarea
          id="skill-body"
          className="input min-h-64 resize-y font-mono text-13 leading-relaxed"
          required
          maxLength={20000}
          placeholder={"1. Search email for invoices from the last week.\n2. …"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex items-center gap-2 border-t border-line pt-4">
        {initial && onDeleted ? (
          <button
            type="button"
            className="btn btn-ghost text-danger"
            onClick={() => void remove()}
            disabled={busy}
          >
            Delete
          </button>
        ) : null}
        <span className="flex-1" />
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <LoaderCircle className="anim-spin" /> : null}
          {initial ? "Save" : "Create skill"}
        </button>
      </div>
    </form>
  );
}
