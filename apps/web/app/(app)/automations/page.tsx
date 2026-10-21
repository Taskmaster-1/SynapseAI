"use client";

import { ArrowRight, LoaderCircle, Pencil, Play, Plus, Repeat, Trash } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/overlay";
import { useToast } from "@/components/toast";
import { EmptyState, ErrorNote, Field, Page, PageHeader, Skeleton, Switch } from "@/components/ui";
import { ApiError, type Automation, type AutomationInput, api, errorMessage } from "@/lib/api";
import { describeCron, nextRuns, SCHEDULE_PRESETS } from "@/lib/cron";
import { cx, formatDateTime, formatRelative } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useWorkspace } from "@/lib/workspace";

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function humanSchedule(cron: string, tz: string) {
  const d = describeCron(cron);
  return d ? `${d} (${tz})` : `Custom schedule (${tz})`;
}

export default function AutomationsPage() {
  const autos = useApi(() => api.automations());
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  const list = autos.data?.automations;

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("new")) setEditing("new");
  }, []);

  const upsert = (a: Automation) =>
    autos.setData((d) => {
      const all = d?.automations ?? [];
      return {
        automations: all.some((x) => x.id === a.id)
          ? all.map((x) => (x.id === a.id ? a : x))
          : [a, ...all],
      };
    });

  return (
    <Page>
      <PageHeader
        eyebrow="On a schedule"
        title="Automations"
        description="Prompts that run on a schedule, each in its own task. Anything that needs your OK waits in the Inbox."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus />
            New automation
          </button>
        }
      />
      {autos.error ? <ErrorNote>{errorMessage(autos.error)}</ErrorNote> : null}
      {!list ? (
        autos.loading ? (
          <div className="space-y-3">
            <Skeleton className="h-40 rounded-card" />
          </div>
        ) : null
      ) : list.length === 0 ? (
        <EmptyState
          illustration={<SampleSchedule />}
          title="Nothing scheduled yet"
          action={
            <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
              Create an automation
            </button>
          }
        >
          A morning brief every weekday, a Friday summary of what shipped — set it once and it runs
          on its own.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.map((a) => (
            <li key={a.id}>
              <AutomationCard automation={a} onChange={upsert} onEdit={() => setEditing(a)} />
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New automation" : "Edit automation"}
        description="Runs as you, with your approval rules."
        width={520}
      >
        {editing !== null ? (
          <AutomationForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={(a) => {
              upsert(a);
              setEditing(null);
            }}
            onDeleted={(id) => {
              autos.setData((d) =>
                d ? { automations: d.automations.filter((x) => x.id !== id) } : d,
              );
              setEditing(null);
            }}
          />
        ) : null}
      </Sheet>
    </Page>
  );
}

function AutomationCard({
  automation: a,
  onChange,
  onEdit,
}: {
  automation: Automation;
  onChange: (a: Automation) => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { reload } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      className={cx(
        "flex overflow-hidden rounded-[16px] border border-line bg-surface",
        !a.enabled && "bg-surface/60",
      )}
    >
      <ScheduleStub cron={a.schedule} enabled={a.enabled} />
      <div className="min-w-0 flex-1 p-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2
              className={cx(
                "font-serif text-[24px] leading-[1.1]",
                a.enabled ? "text-fg" : "text-fg-muted",
              )}
            >
              {a.name}
            </h2>
            <p className="mt-1 line-clamp-2 text-14 text-fg-muted">{a.prompt}</p>
          </div>
          <Switch
            checked={a.enabled}
            label={a.enabled ? `Pause ${a.name}` : `Enable ${a.name}`}
            disabled={busy !== null}
            onChange={(enabled) =>
              void act("toggle", async () => {
                const res = await api.updateAutomation(a.id, { enabled });
                onChange(res.automation);
                toast(enabled ? "Automation on" : "Automation paused", "success");
              })
            }
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-13">
          <span className="inline-flex items-center gap-1.5 text-fg">
            <Repeat className={a.enabled ? "text-accent" : "text-fg-faint"} />
            {humanSchedule(a.schedule, a.timezone)}
          </span>
          <code className="rounded-[5px] bg-sunken px-1.5 py-px font-mono text-12 text-fg-muted">
            {a.schedule}
          </code>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3.5 text-13">
          <span className="text-fg-muted" title={formatDateTime(a.nextRunAt)}>
            Next{" "}
            <span className="text-fg">
              {a.enabled && a.nextRunAt ? formatRelative(a.nextRunAt) : "—"}
            </span>
          </span>
          <span className="text-fg-muted" title={formatDateTime(a.lastRunAt)}>
            Last{" "}
            {a.lastRunAt && a.chatId ? (
              <Link href={`/t/${a.chatId}`} className="text-fg hover:underline">
                {formatRelative(a.lastRunAt)}
              </Link>
            ) : (
              <span className="text-fg">never</span>
            )}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy !== null}
              onClick={onEdit}
            >
              <Pencil className="size-3.5" />
              Edit
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() =>
                void act("run", async () => {
                  const res = await api.runAutomation(a.id);
                  void reload();
                  router.push(`/t/${res.chatId}`);
                })
              }
            >
              {busy === "run" ? (
                <LoaderCircle className="anim-spin size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
              Run now
            </button>
          </span>
        </div>
      </div>
    </article>
  );
}

function AutomationForm({
  initial,
  onCancel,
  onSaved,
  onDeleted,
}: {
  initial: Automation | null;
  onCancel: () => void;
  onSaved: (a: Automation) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [schedule, setSchedule] = useState(initial?.schedule ?? SCHEDULE_PRESETS[0]!.cron);
  const [timezone, setTimezone] = useState(initial?.timezone ?? localTimezone());
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () => nextRuns(schedule, timezone.trim() || "UTC", 3),
    [schedule, timezone],
  );
  const described = describeCron(schedule);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setScheduleError(null);
    const body: AutomationInput = {
      name: name.trim(),
      prompt: prompt.trim(),
      schedule: schedule.trim(),
      timezone: timezone.trim() || "UTC",
      enabled,
    };
    try {
      const res = initial
        ? await api.updateAutomation(initial.id, body)
        : await api.createAutomation(body);
      toast(initial ? "Automation saved" : "Automation created", "success");
      onSaved(res.automation);
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_schedule") setScheduleError(err.message);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial || !window.confirm(`Delete “${initial.name}”? Its past task stays.`)) return;
    setBusy(true);
    try {
      await api.deleteAutomation(initial.id);
      toast("Automation deleted", "success");
      onDeleted(initial.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const tz = timezone.trim() || "UTC";
  const fmt = (d: Date) =>
    d.toLocaleString(undefined, {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Name" htmlFor="auto-name">
        <input
          id="auto-name"
          data-autofocus
          className="input"
          required
          placeholder="Morning brief"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="What should it do?" htmlFor="auto-prompt">
        <textarea
          id="auto-prompt"
          className="input min-h-28 resize-y"
          required
          placeholder="Summarise unread email and today's Linear issues. Flag anything urgent."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>

      <fieldset>
        <legend className="label">When</legend>
        <div className="flex flex-wrap gap-1.5">
          {SCHEDULE_PRESETS.map((p) => {
            const on = schedule.trim() === p.cron;
            return (
              <button
                key={p.cron}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setSchedule(p.cron);
                  setScheduleError(null);
                }}
                className={cx(
                  "h-8 rounded-full border px-3 text-13 transition-colors duration-150",
                  on
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
          <div>
            <label htmlFor="auto-schedule" className="hint mb-1 block">
              Cron (5 fields, ≥ 15 min apart)
            </label>
            <input
              id="auto-schedule"
              className="input font-mono text-13"
              required
              value={schedule}
              aria-invalid={scheduleError ? true : undefined}
              aria-describedby="auto-schedule-desc"
              onChange={(e) => {
                setSchedule(e.target.value);
                setScheduleError(null);
              }}
            />
          </div>
          <div>
            <label htmlFor="auto-tz" className="hint mb-1 block">
              Timezone
            </label>
            <input
              id="auto-tz"
              className="input"
              placeholder="Europe/Berlin"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </div>
        </div>
        <div id="auto-schedule-desc" className="mt-3 rounded-[10px] bg-sunken px-3.5 py-3">
          {scheduleError ? (
            <p role="alert" className="text-13 text-danger">
              {scheduleError}
            </p>
          ) : preview === null ? (
            <p className="text-13 text-fg-muted">That doesn't look like a valid schedule yet.</p>
          ) : (
            <>
              <p className="text-13 font-medium text-fg">
                {described ? `${described} (${tz})` : `Custom schedule (${tz})`}
              </p>
              <p className="eyebrow mt-2.5 mb-1">Next 3 runs</p>
              <ol className="space-y-0.5 text-13 text-fg-muted">
                {preview.length === 0 ? <li>Not within the next month.</li> : null}
                {preview.map((d) => (
                  <li key={d.getTime()} className="tabular flex items-center gap-2">
                    <ArrowRight className="size-3 text-fg-faint" />
                    {fmt(d)}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </fieldset>

      <div className="flex items-center justify-between rounded-[10px] border border-line px-3.5 py-3">
        <div>
          <p className="text-14 text-fg">Enabled</p>
          <p className="text-12 text-fg-muted">Paused automations keep their settings.</p>
        </div>
        <Switch checked={enabled} onChange={setEnabled} label="Enabled" />
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="flex items-center gap-2 pt-1">
        {initial ? (
          <button
            type="button"
            className="btn btn-ghost text-danger"
            onClick={() => void remove()}
            disabled={busy}
          >
            <Trash className="size-3.5" />
            Delete
          </button>
        ) : null}
        <span className="flex-1" />
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <LoaderCircle className="anim-spin size-3.5" /> : null}
          {initial ? "Save" : "Create"}
        </button>
      </div>
    </form>
  );
}

function splitSchedule(cron: string): [string, string | null] {
  const d = describeCron(cron);
  if (!d) return ["Custom", null];
  const [when, at] = d.split(" at ");
  return at ? [when!, at] : [d, null];
}

/** The tear-off stub on the left of a schedule ticket. */
function ScheduleStub({ cron, enabled }: { cron: string; enabled: boolean }) {
  const [when, at] = splitSchedule(cron);
  return (
    <div
      aria-hidden="true"
      className={cx(
        "hidden w-[112px] shrink-0 flex-col items-center justify-center border-r border-dashed border-line-strong bg-sunken/60 px-3 text-center sm:flex",
        !enabled && "opacity-60",
      )}
    >
      {at ? (
        <span className="tabular font-serif text-[34px] leading-none text-fg">{at}</span>
      ) : (
        <Repeat className="size-6 text-fg-faint" />
      )}
      <span className="mt-1.5 font-mono text-[10px] leading-tight tracking-[0.1em] text-fg-faint uppercase">
        {when}
      </span>
    </div>
  );
}

/** Empty-state art: two schedule tickets. */
function SampleSchedule() {
  const ticket = (at: string, when: string, name: string, line: string) => (
    <div className="slip flex w-[270px] overflow-hidden">
      <div className="flex w-[78px] shrink-0 flex-col items-center justify-center border-r border-dashed border-line-strong bg-sunken/60 py-3">
        <span className="font-serif text-[24px] leading-none text-fg">{at}</span>
        <span className="mt-1 font-mono text-[9px] tracking-[0.1em] text-fg-faint uppercase">
          {when}
        </span>
      </div>
      <div className="min-w-0 flex-1 px-3.5 py-3">
        <p className="truncate font-serif text-[18px] leading-tight text-fg">{name}</p>
        <p className="mt-0.5 truncate text-[11px] text-fg-muted">{line}</p>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="relative h-3 w-5 rounded-full bg-accent">
            <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-surface" />
          </span>
          <span className="font-mono text-[9px] tracking-[0.08em] text-fg-faint uppercase">
            Next in 14h
          </span>
        </div>
      </div>
    </div>
  );
  return (
    <div className="relative h-[200px] w-[300px]">
      <div className="absolute top-2 left-6 rotate-[4deg] opacity-70">
        {ticket("17:00", "Fridays", "What shipped", "Summarise merged PRs and closed issues")}
      </div>
      <div className="absolute top-[78px] left-0 rotate-[-2deg]">
        {ticket(
          "8:00",
          "Weekdays",
          "Morning brief",
          "Unread email, today's Linear, anything urgent",
        )}
      </div>
    </div>
  );
}
