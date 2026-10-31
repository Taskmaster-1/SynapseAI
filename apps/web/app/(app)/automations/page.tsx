"use client";

import {
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
  Copy,
  LoaderCircle,
  Mail,
  Pencil,
  Play,
  Plus,
  Repeat,
  RotateCw,
  Trash,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/overlay";
import { useToast } from "@/components/toast";
import {
  ErrorNote,
  Field,
  Page,
  PageHeader,
  SectionTitle,
  Skeleton,
  Switch,
} from "@/components/ui";
import {
  ApiError,
  type Automation,
  type AutomationInput,
  type AutomationTemplate,
  type AutomationTrigger,
  api,
  errorMessage,
  type TemplateRequirement,
} from "@/lib/api";
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

/** "Fri 7 Nov, 09:00" in the automation's own zone. */
function onceLabel(iso: string, tz: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return formatDateTime(iso);
  }
}

type Editing = Automation | "new" | "new-email" | { template: AutomationTemplate };

const editingKey = (e: Editing) =>
  typeof e === "string" ? e : "template" in e ? `t-${e.template.id}` : e.id;

export default function AutomationsPage() {
  const autos = useApi(() => api.automations());
  const [editing, setEditing] = useState<Editing | null>(null);
  const list = autos.data?.automations;

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has("new")) setEditing(q.get("new") === "email" ? "new-email" : "new");
  }, []);

  const remove = (id: string) =>
    autos.setData((d) => (d ? { automations: d.automations.filter((x) => x.id !== id) } : d));

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
        eyebrow="Runs on its own"
        title="Automations"
        description="Prompts that run on a schedule, when an email arrives, or when another app calls a webhook, plus the reminders and follow-ups you asked for in chat. Anything that needs your OK waits in the Inbox."
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
      ) : list.length === 0 ? null : (
        <ul className="space-y-3">
          {list.map((a) => (
            <li key={a.id}>
              <AutomationCard
                automation={a}
                onChange={upsert}
                onEdit={() => setEditing(a)}
                onDeleted={remove}
              />
            </li>
          ))}
        </ul>
      )}

      {list ? (
        <Gallery first={list.length === 0} onUse={(template) => setEditing({ template })} />
      ) : null}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing !== null && typeof editing !== "string" && "template" in editing
            ? editing.template.name
            : typeof editing === "string"
              ? "New automation"
              : "Edit automation"
        }
        description="Runs as you, with your approval rules."
        width={520}
      >
        {editing !== null ? (
          <AutomationForm
            key={editingKey(editing)}
            initial={typeof editing === "string" || "template" in editing ? null : editing}
            template={
              typeof editing !== "string" && "template" in editing ? editing.template : null
            }
            startWith={editing === "new-email" ? "gmail" : "schedule"}
            onCancel={() => setEditing(null)}
            onSaved={(a) => {
              upsert(a);
              setEditing(null);
            }}
            onDeleted={(id) => {
              remove(id);
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
  onDeleted,
}: {
  automation: Automation;
  onChange: (a: Automation) => void;
  onEdit: () => void;
  onDeleted: (id: string) => void;
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
      {a.trigger.type === "schedule" && a.runAt ? (
        <OnceStub automation={a} />
      ) : a.trigger.type === "schedule" ? (
        <ScheduleStub cron={a.schedule} enabled={a.enabled} />
      ) : (
        <EventStub trigger={a.trigger} enabled={a.enabled} />
      )}
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
            {a.kind === "reminder" || a.runAt ? (
              <p className="mt-1.5 flex flex-wrap gap-1.5">
                {a.runAt ? <Tag>Once</Tag> : null}
                {a.kind === "reminder" ? <Tag>Reminder</Tag> : null}
              </p>
            ) : null}
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
        <TriggerLine automation={a} />
        {a.lastError ? (
          <p className="mt-2 text-13 text-danger" role="status">
            {a.lastError}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3.5 text-13">
          {a.trigger.type === "schedule" ? (
            <span className="text-fg-muted" title={formatDateTime(a.nextRunAt)}>
              Next{" "}
              <span className="text-fg">
                {a.enabled && a.nextRunAt ? formatRelative(a.nextRunAt) : "—"}
              </span>
            </span>
          ) : null}
          <span className="text-fg-muted" title={formatDateTime(a.lastRunAt)}>
            Last{" "}
            {a.lastRunAt && a.chatId && a.trigger.type === "schedule" ? (
              <Link href={`/t/${a.chatId}`} className="text-fg hover:underline">
                {formatRelative(a.lastRunAt)}
              </Link>
            ) : (
              <span className="text-fg">{a.lastRunAt ? formatRelative(a.lastRunAt) : "never"}</span>
            )}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            {a.runAt ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm text-danger"
                disabled={busy !== null}
                onClick={() => {
                  if (!window.confirm(`Cancel “${a.name}”? It is removed for good.`)) return;
                  void act("cancel", async () => {
                    await api.deleteAutomation(a.id);
                    onDeleted(a.id);
                    toast(a.enabled ? "Cancelled" : "Removed", "success");
                  });
                }}
              >
                <Trash className="size-3.5" />
                {a.enabled ? "Cancel" : "Remove"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy !== null}
                onClick={onEdit}
              >
                <Pencil className="size-3.5" />
                Edit
              </button>
            )}
            {a.kind === "reminder" ? null : (
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
            )}
          </span>
        </div>
      </div>
    </article>
  );
}

function AutomationForm({
  initial,
  template,
  startWith,
  onCancel,
  onSaved,
  onDeleted,
}: {
  initial: Automation | null;
  /** Prefills a new automation from the gallery. */
  template?: AutomationTemplate | null;
  startWith: AutomationTrigger["type"];
  onCancel: () => void;
  onSaved: (a: Automation) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const from = initial ?? template ?? null;
  const [name, setName] = useState(from?.name ?? "");
  const [prompt, setPrompt] = useState(from?.prompt ?? "");
  const [kind, setKind] = useState<AutomationTrigger["type"]>(from?.trigger.type ?? startWith);
  const [query, setQuery] = useState(from?.trigger.type === "gmail" ? from.trigger.query : "");
  const [schedule, setSchedule] = useState(from?.schedule || SCHEDULE_PRESETS[0]!.cron);
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
    const trigger: AutomationTrigger =
      kind === "gmail" ? { type: "gmail", query: query.trim() } : { type: kind };
    const body: AutomationInput = {
      name: name.trim(),
      prompt: prompt.trim(),
      trigger,
      ...(kind === "schedule" ? { schedule: schedule.trim() } : {}),
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
      {template ? (
        <p className="rounded-[10px] bg-sunken px-3.5 py-3 text-13 text-fg-muted">
          {template.outcome} Change anything below before you create it.
        </p>
      ) : null}
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
          placeholder={
            kind === "gmail"
              ? "If it's a customer question, draft a reply in my tone. If it's a receipt, label it Receipts and archive it."
              : kind === "webhook"
                ? "Review this pull request: summarise the change and flag anything risky."
                : "Summarise unread email and today's Linear issues. Flag anything urgent."
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>

      <TriggerPicker value={kind} onChange={setKind} />

      {kind === "gmail" ? <EmailTriggerFields query={query} onChange={setQuery} /> : null}
      {kind === "webhook" ? <WebhookFields automation={initial} onRotated={onSaved} /> : null}

      {kind === "schedule" ? (
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
      ) : null}

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

function Tag({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-sunken px-2 py-px font-mono text-[10px] tracking-[0.1em] text-fg-muted uppercase">
      {children}
    </span>
  );
}

/** The stub of a one-off: its date and time, in its own zone. */
function OnceStub({ automation: a }: { automation: Automation }) {
  const at = new Date(a.runAt ?? "");
  const part = (o: Intl.DateTimeFormatOptions) => {
    try {
      return at.toLocaleString(undefined, { timeZone: a.timezone, ...o });
    } catch {
      return at.toLocaleString(undefined, o);
    }
  };
  return (
    <div
      aria-hidden="true"
      className={cx(
        "hidden w-[112px] shrink-0 flex-col items-center justify-center border-r border-dashed border-line-strong bg-sunken/60 px-3 text-center sm:flex",
        !a.enabled && "opacity-60",
      )}
    >
      <span className="tabular font-serif text-[34px] leading-none text-fg">
        {part({ hour: "2-digit", minute: "2-digit" })}
      </span>
      <span className="mt-1.5 font-mono text-[10px] leading-tight tracking-[0.1em] text-fg-faint uppercase">
        {part({ weekday: "short", day: "numeric", month: "short" })}
      </span>
    </div>
  );
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

const TRIGGERS: {
  type: AutomationTrigger["type"];
  label: string;
  hint: string;
  icon: typeof Repeat;
}[] = [
  {
    type: "schedule",
    label: "On a schedule",
    hint: "Every weekday at 8, every Friday…",
    icon: Repeat,
  },
  {
    type: "gmail",
    label: "When email arrives",
    hint: "New mail in Gmail that matches",
    icon: Mail,
  },
  {
    type: "webhook",
    label: "On a webhook",
    hint: "GitHub, Linear, Stripe, Zapier…",
    icon: Webhook,
  },
];

function TriggerPicker({
  value,
  onChange,
}: {
  value: AutomationTrigger["type"];
  onChange: (t: AutomationTrigger["type"]) => void;
}) {
  return (
    <fieldset>
      <legend className="label">Starts</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {TRIGGERS.map((t) => {
          const on = value === t.type;
          const Icon = t.icon;
          return (
            <button
              key={t.type}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(t.type)}
              className={cx(
                "rounded-[12px] border px-3 py-2.5 text-left transition-colors duration-150",
                on ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong",
              )}
            >
              <Icon className={cx("size-4", on ? "text-accent" : "text-fg-faint")} />
              <span
                className={cx("mt-1.5 block text-13 font-medium", on ? "text-accent" : "text-fg")}
              >
                {t.label}
              </span>
              <span className="mt-0.5 block text-12 leading-snug text-fg-muted">{t.hint}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const EMAIL_FILTERS = [
  { label: "Everything new", q: "" },
  { label: "Important", q: "is:important" },
  { label: "From a domain", q: "from:@acme.com" },
  { label: "Invoices", q: "subject:(invoice OR receipt)" },
];

function EmailTriggerFields({ query, onChange }: { query: string; onChange: (q: string) => void }) {
  const integ = useApi(() => api.integrations());
  const google = integ.data?.google;
  const connected = google?.connection?.status === "active";
  return (
    <div className="space-y-3">
      {google && !connected ? (
        <div className="rounded-[10px] border border-attention/40 bg-attention/10 px-3.5 py-3 text-13 text-fg">
          {google.available ? (
            <>
              Email triggers watch your Gmail.{" "}
              <Link href="/connections" className="font-medium text-accent hover:underline">
                Connect Google
              </Link>{" "}
              first.
            </>
          ) : (
            <>Email triggers need Google set up on this server. See docs/google.md.</>
          )}
        </div>
      ) : null}
      <div>
        <label htmlFor="auto-query" className="label">
          Which emails? <span className="font-normal text-fg-muted">(Gmail search)</span>
        </label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {EMAIL_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              aria-pressed={query.trim() === f.q}
              onClick={() => onChange(f.q)}
              className={cx(
                "h-8 rounded-full border px-3 text-13 transition-colors duration-150",
                query.trim() === f.q
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          id="auto-query"
          className="input font-mono text-13"
          placeholder="Empty = every new email in your inbox"
          value={query}
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="hint mt-1.5">
          Checked every couple of minutes. Each new email becomes its own task. Mail already in your
          inbox doesn't count, and emails you send never trigger it.
        </p>
      </div>
      <SafetyNote>
        The email is written by someone else, so these tasks can read freely but can't send, change
        or delete anything without your sign-off, even where you've set "always allow".
      </SafetyNote>
    </div>
  );
}

function WebhookFields({
  automation,
  onRotated,
}: {
  automation: Automation | null;
  onRotated: (a: Automation) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const url = automation?.trigger.type === "webhook" ? automation.webhookUrl : null;
  return (
    <div className="space-y-3">
      {url ? (
        <div>
          <p className="label">Webhook URL</p>
          <CopyField value={url} />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="hint">Anyone with this URL can start a task. Keep it secret.</p>
            <button
              type="button"
              className="btn btn-ghost btn-sm shrink-0"
              disabled={busy}
              onClick={async () => {
                if (!automation || !window.confirm("Make a new URL? The old one stops working."))
                  return;
                setBusy(true);
                try {
                  const res = await api.updateAutomation(automation.id, { rotateWebhook: true });
                  onRotated(res.automation);
                  toast("New webhook URL made", "success");
                } catch (err) {
                  toast(errorMessage(err), "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RotateCw className="size-3.5" />
              New URL
            </button>
          </div>
        </div>
      ) : (
        <p className="rounded-[10px] bg-sunken px-3.5 py-3 text-13 text-fg-muted">
          You'll get a secret URL once it's saved. Point GitHub, Linear, Stripe, Zapier or any app
          that sends webhooks at it. Each delivery starts its own task, with the payload attached.
        </p>
      )}
      <SafetyNote>
        Payloads come from outside, so these tasks can read freely but can't send, change or delete
        anything without your sign-off.
      </SafetyNote>
    </div>
  );
}

function SafetyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2.5 border-l-2 border-accent pl-3 text-13 leading-relaxed text-fg-muted">
      {children}
    </p>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1.5 rounded-[10px] border border-line bg-sunken py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-12 text-fg">{value}</code>
      <button
        type="button"
        className="btn btn-ghost btn-sm shrink-0"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function TriggerLine({ automation: a }: { automation: Automation }) {
  const iconClass = a.enabled ? "text-accent" : "text-fg-faint";
  if (a.trigger.type === "schedule" && a.runAt)
    return (
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-13">
        <span className="inline-flex items-center gap-1.5 text-fg">
          {a.kind === "reminder" ? (
            <Bell className={iconClass} />
          ) : (
            <CalendarClock className={iconClass} />
          )}
          {a.kind === "reminder" ? "Reminds you" : "Runs once"} {onceLabel(a.runAt, a.timezone)} (
          {a.timezone})
        </span>
        {a.chatId ? (
          <Link href={`/t/${a.chatId}`} className="text-fg-muted hover:text-fg hover:underline">
            From this conversation
          </Link>
        ) : null}
      </div>
    );
  if (a.trigger.type === "schedule")
    return (
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-13">
        <span className="inline-flex items-center gap-1.5 text-fg">
          <Repeat className={iconClass} />
          {humanSchedule(a.schedule, a.timezone)}
        </span>
        <code className="rounded-[5px] bg-sunken px-1.5 py-px font-mono text-12 text-fg-muted">
          {a.schedule}
        </code>
      </div>
    );
  if (a.trigger.type === "gmail")
    return (
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-13">
        <span className="inline-flex items-center gap-1.5 text-fg">
          <Mail className={iconClass} />
          When a new email arrives
        </span>
        {a.trigger.query ? (
          <code className="rounded-[5px] bg-sunken px-1.5 py-px font-mono text-12 text-fg-muted">
            {a.trigger.query}
          </code>
        ) : (
          <span className="text-fg-muted">in your inbox</span>
        )}
      </div>
    );
  return (
    <div className="mt-4 space-y-2 text-13">
      <span className="inline-flex items-center gap-1.5 text-fg">
        <Webhook className={iconClass} />
        When the webhook is called
      </span>
      {a.webhookUrl ? <CopyField value={a.webhookUrl} /> : null}
    </div>
  );
}

/** The stub for event triggers: what it listens for instead of a time. */
function EventStub({ trigger, enabled }: { trigger: AutomationTrigger; enabled: boolean }) {
  const Icon = trigger.type === "gmail" ? Mail : Webhook;
  return (
    <div
      aria-hidden="true"
      className={cx(
        "hidden w-[112px] shrink-0 flex-col items-center justify-center border-r border-dashed border-line-strong bg-sunken/60 px-3 text-center sm:flex",
        !enabled && "opacity-60",
      )}
    >
      <Icon className="size-7 text-fg" strokeWidth={1.5} />
      <span className="mt-2 font-mono text-[10px] leading-tight tracking-[0.1em] text-fg-faint uppercase">
        {trigger.type === "gmail" ? "On email" : "On webhook"}
      </span>
    </div>
  );
}

// ---------- Gallery ----------

const REQUIREMENT_NAMES: Record<TemplateRequirement, string> = {
  google: "Google",
  github: "GitHub",
  linear: "Linear",
};

function triggerLabel(t: AutomationTemplate) {
  if (t.trigger.type === "gmail") return "When email arrives";
  if (t.trigger.type === "webhook") return "On a webhook";
  return describeCron(t.schedule ?? "") ?? "On a schedule";
}

/**
 * Ready-made automations, grouped by what they're for. "Use" opens the normal form,
 * prefilled; ones that need something you haven't connected say what and link to it.
 */
function Gallery({ first, onUse }: { first: boolean; onUse: (t: AutomationTemplate) => void }) {
  const data = useApi(() => api.automationTemplates());
  const [category, setCategory] = useState<string | null>(null);
  const templates = data.data?.templates;
  const categories = data.data?.categories ?? [];
  const shown = categories.filter((c) => category === null || c === category);

  return (
    <section className={first ? "" : "mt-14"} aria-labelledby="gallery-h">
      <SectionTitle>
        <span id="gallery-h">{first ? "Start with a template" : "More ideas"}</span>
      </SectionTitle>
      <p className="mb-5 max-w-[36rem] text-14 text-fg-muted">
        Starting points you can edit before they run. They work as you, under your approval rules:
        drafts are saved for you to review, and with the default rules nothing is sent, changed or
        deleted until you approve it.
      </p>
      {data.error ? <ErrorNote>{errorMessage(data.error)}</ErrorNote> : null}
      {!templates ? (
        data.loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-40 rounded-card" />
            <Skeleton className="h-40 rounded-card" />
          </div>
        ) : null
      ) : (
        <>
          <fieldset aria-label="Category" className="mb-6 flex flex-wrap gap-1.5">
            {[null, ...categories].map((c) => {
              const on = category === c;
              return (
                <button
                  key={c ?? "all"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCategory(c)}
                  className={cx(
                    "h-8 rounded-full border px-3 text-13 transition-colors duration-150",
                    on
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {c ?? "All"}
                </button>
              );
            })}
          </fieldset>
          <div className="space-y-9">
            {shown.map((c) => (
              <div key={c}>
                <h3 className="eyebrow mb-3">{c}</h3>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {templates
                    .filter((t) => t.category === c)
                    .map((t) => (
                      <li key={t.id} className="flex">
                        <TemplateCard
                          template={t}
                          googleAvailable={data.data?.googleAvailable ?? false}
                          onUse={() => onUse(t)}
                        />
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TemplateCard({
  template: t,
  googleAvailable,
  onUse,
}: {
  template: AutomationTemplate;
  googleAvailable: boolean;
  onUse: () => void;
}) {
  const Icon = t.trigger.type === "gmail" ? Mail : t.trigger.type === "webhook" ? Webhook : Repeat;
  const missing = t.missing[0];
  const blocked = missing === "google" && !googleAvailable;
  return (
    <article className="flex w-full flex-col rounded-[16px] border border-line bg-surface p-4">
      <p className="flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.1em] text-fg-faint uppercase">
        <Icon className="size-3.5" />
        {triggerLabel(t)}
      </p>
      <h4 className="mt-2.5 font-serif text-[21px] leading-[1.1] text-fg">{t.name}</h4>
      <p className="mt-1 flex-1 text-13 text-fg-muted">{t.outcome}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {t.requires.map((r) => {
            const have = !t.missing.includes(r);
            return (
              <span
                key={r}
                className={cx(
                  "inline-flex h-5 items-center gap-1 rounded-full px-2 text-12",
                  have ? "bg-ok-soft text-ok" : "border border-line text-fg-muted",
                )}
                title={have ? "Connected" : "Not connected"}
              >
                {have ? <Check className="size-3" strokeWidth={2.5} /> : null}
                {REQUIREMENT_NAMES[r]}
              </span>
            );
          })}
        </span>
        {missing ? (
          blocked ? (
            <span className="text-12 text-fg-muted">Needs Google on this server</span>
          ) : (
            <Link href="/connections" className="btn btn-sm">
              Connect {REQUIREMENT_NAMES[missing]}
            </Link>
          )
        ) : null}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={Boolean(missing)}
          title={missing ? `Connect ${REQUIREMENT_NAMES[missing]} first` : undefined}
          onClick={onUse}
        >
          Use
        </button>
      </div>
    </article>
  );
}
