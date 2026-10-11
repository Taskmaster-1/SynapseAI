"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Empty, ErrorNote, Page, Section, Spinner } from "@/components/page";
import { useToast } from "@/components/toast";
import { ApiError, type Automation, type AutomationInput, api, errorMessage } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const PRESETS = [
  { label: "Weekdays 9:00", cron: "0 9 * * 1-5" },
  { label: "Every day 8:00", cron: "0 8 * * *" },
  { label: "Every Monday 8:00", cron: "0 8 * * 1" },
  { label: "Hourly", cron: "0 * * * *" },
];

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function describe(cron: string): string | null {
  return PRESETS.find((p) => p.cron === cron.trim())?.label ?? null;
}

export default function AutomationsPage() {
  const autos = useApi(() => api.automations());
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  const list = autos.data?.automations;

  const upsert = (a: Automation) =>
    autos.setData((d) => {
      const rest = (d?.automations ?? []).filter((x) => x.id !== a.id);
      const exists = d?.automations.some((x) => x.id === a.id);
      return {
        automations: exists
          ? (d?.automations ?? []).map((x) => (x.id === a.id ? a : x))
          : [a, ...rest],
      };
    });

  return (
    <Page
      title="Automations"
      description="Prompts that run on a schedule, each in its own chat. Anything that needs approval waits in your Approvals inbox."
      actions={
        editing === null ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEditing("new")}
          >
            + New automation
          </button>
        ) : null
      }
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
        />
      ) : null}
      {autos.error ? <ErrorNote error={errorMessage(autos.error)} /> : null}
      {!list ? (
        autos.loading ? (
          <Spinner />
        ) : null
      ) : list.length === 0 ? (
        editing === null ? (
          <Empty>No automations yet.</Empty>
        ) : null
      ) : (
        <ul className="space-y-3">
          {list.map((a) => (
            <li key={a.id}>
              <AutomationRow
                automation={a}
                onChange={upsert}
                onEdit={() => setEditing(a)}
                onDeleted={() =>
                  autos.setData((d) =>
                    d ? { automations: d.automations.filter((x) => x.id !== a.id) } : d,
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

function AutomationRow({
  automation: a,
  onChange,
  onEdit,
  onDeleted,
}: {
  automation: Automation;
  onChange: (a: Automation) => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
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

  const preset = describe(a.schedule);
  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{a.name}</span>
            {!a.enabled ? (
              <span className="inline-flex h-5 items-center rounded bg-read-bg px-1.5 text-xs text-read-fg">
                Paused
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-fg-muted">
            <span className="font-mono">{a.schedule}</span>
            {preset ? ` (${preset})` : null} · {a.timezone}
          </div>
          <p className="mt-1.5 line-clamp-2 text-fg-muted">{a.prompt}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-fg-faint">
            <span title={formatDateTime(a.nextRunAt)}>
              Next: {a.enabled && a.nextRunAt ? formatRelative(a.nextRunAt) : "—"}
            </span>
            <span title={formatDateTime(a.lastRunAt)}>Last: {formatRelative(a.lastRunAt)}</span>
            {a.chatId ? (
              <Link href={`/c/${a.chatId}`} className="text-accent hover:underline">
                Open chat
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-fg-muted">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={a.enabled}
              disabled={busy !== null}
              onChange={(e) => {
                const enabled = e.target.checked;
                void act("toggle", async () => {
                  const res = await api.updateAutomation(a.id, { enabled });
                  onChange(res.automation);
                });
              }}
            />
            Enabled
          </label>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy !== null}
            onClick={() =>
              void act("run", async () => {
                const res = await api.runAutomation(a.id);
                router.push(`/c/${res.chatId}`);
              })
            }
          >
            {busy === "run" ? "Starting…" : "Run now"}
          </button>
          <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm(`Delete "${a.name}"?`)) return;
              void act("delete", async () => {
                await api.deleteAutomation(a.id);
                onDeleted();
              });
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function AutomationForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: Automation | null;
  onCancel: () => void;
  onSaved: (a: Automation) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [schedule, setSchedule] = useState(initial?.schedule ?? PRESETS[0]!.cron);
  const [timezone, setTimezone] = useState(initial?.timezone ?? localTimezone());
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Section title={initial ? `Edit “${initial.name}”` : "New automation"}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="auto-name" className="label">
            Name
          </label>
          <input
            id="auto-name"
            className="input"
            required
            placeholder="Morning inbox triage"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="auto-prompt" className="label">
            Prompt
          </label>
          <textarea
            id="auto-prompt"
            className="input min-h-28"
            required
            placeholder="Summarize unread email from the last day and draft replies for anything urgent."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="auto-schedule" className="label">
              Schedule (cron, at least 15 minutes apart)
            </label>
            <input
              id="auto-schedule"
              className="input font-mono text-[13px]"
              required
              value={schedule}
              aria-invalid={scheduleError ? true : undefined}
              aria-describedby={scheduleError ? "auto-schedule-error" : undefined}
              onChange={(e) => {
                setSchedule(e.target.value);
                setScheduleError(null);
              }}
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.cron}
                  type="button"
                  aria-pressed={schedule.trim() === p.cron}
                  className={
                    schedule.trim() === p.cron
                      ? "btn btn-sm border-accent text-accent"
                      : "btn btn-sm text-fg-muted"
                  }
                  onClick={() => {
                    setSchedule(p.cron);
                    setScheduleError(null);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {scheduleError ? (
              <p id="auto-schedule-error" role="alert" className="mt-1.5 text-danger-fg">
                {scheduleError}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="auto-tz" className="label">
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
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>
        {error ? (
          <p role="alert" className="text-danger-fg">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save" : "Create"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Section>
  );
}
