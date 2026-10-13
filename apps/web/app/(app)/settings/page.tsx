"use client";

import {
  ArrowDown,
  ArrowUp,
  Cpu,
  Monitor,
  Moon,
  Palette,
  Plus,
  ShieldCheck,
  Sun,
  User,
  Wallet,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { ErrorNote, Field, Page, PageHeader, Pill, Skeleton } from "@/components/ui";
import {
  api,
  errorMessage,
  type ProviderName,
  type Settings,
  type SettingsUpdate,
} from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { cx, formatCost } from "@/lib/format";
import { type ThemePref, useTheme } from "@/lib/theme";
import { useApi } from "@/lib/use-api";
import { useWorkspace } from "@/lib/workspace";
import { MAX_CHAIN, ModelPicker, modelFromRef, priceLabel } from "./model-picker";
import { PolicyEditor } from "./policy-editor";

type Section = "general" | "models" | "budgets" | "rules" | "appearance";

const SECTIONS: { id: Section; label: string; icon: ReactNode; blurb: string }[] = [
  {
    id: "general",
    label: "General",
    icon: <User />,
    blurb: "Who you are and how you like to work.",
  },
  {
    id: "models",
    label: "Models & keys",
    icon: <Cpu />,
    blurb: "Which models run your tasks, and whose keys pay for them.",
  },
  {
    id: "budgets",
    label: "Budgets",
    icon: <Wallet />,
    blurb: "Hard limits. Tasks stop when they reach one.",
  },
  {
    id: "rules",
    label: "Approval rules",
    icon: <ShieldCheck />,
    blurb: "What the agent may do on its own, and what waits for you.",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: <Palette />,
    blurb: "How Synapse looks on this device.",
  },
];

const SUGGESTED_MODELS = [
  "anthropic:claude-opus-5-5",
  "anthropic:claude-sonnet-5-5",
  "anthropic:claude-haiku-5-5",
  "gateway:anthropic/claude-sonnet-5.5",
];
const PROVIDERS: { id: ProviderName; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google" },
  { id: "gateway", label: "Vercel AI Gateway" },
];

type SaveFn = (update: SettingsUpdate, message?: string) => Promise<boolean>;

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const settings = useApi(() => api.settings());
  const config = useApi(() => api.config());
  const [section, setSection] = useState<Section>("general");
  const [prefill, setPrefill] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("section") as Section | null;
    if (s && SECTIONS.some((x) => x.id === s)) setSection(s);
    const allow = q.get("allow");
    if (allow) {
      setSection("rules");
      setPrefill(allow);
    }
  }, []);

  // Keep the active section visible in the horizontally scrolling mobile nav.
  useEffect(() => {
    document
      .querySelector<HTMLElement>(`[data-section="${section}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [section]);

  function go(s: Section) {
    setSection(s);
    router.replace(s === "general" ? "/settings" : `/settings?section=${s}`);
  }

  const save: SaveFn = async (update, message = "Saved") => {
    try {
      const next = await api.saveSettings(update);
      settings.setData(next);
      toast(message, "success");
      return true;
    } catch (err) {
      toast(errorMessage(err), "error");
      return false;
    }
  };

  const meta = SECTIONS.find((s) => s.id === section)!;
  const s = settings.data;

  return (
    <Page wide>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-8 md:flex-row md:gap-12">
        <nav aria-label="Settings sections" className="md:w-52 md:shrink-0">
          <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-col md:gap-px md:overflow-visible md:px-0">
            {SECTIONS.map((x) => (
              <li key={x.id} className="shrink-0">
                <button
                  type="button"
                  aria-current={section === x.id ? "page" : undefined}
                  data-section={x.id}
                  onClick={() => go(x.id)}
                  className={cx(
                    "flex h-8 w-full items-center gap-2.5 rounded-[7px] px-2.5 text-13 whitespace-nowrap transition-colors duration-150",
                    section === x.id
                      ? "bg-surface font-medium text-fg shadow-[0_0_0_1px_var(--line)]"
                      : "text-fg-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  <span className={section === x.id ? "text-fg" : "text-fg-faint"}>{x.icon}</span>
                  {x.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 md:max-w-[680px]">
          <header className="mb-6">
            <h2 className="font-serif text-28 text-fg">{meta.label}</h2>
            <p className="mt-1 text-13 text-fg-muted">{meta.blurb}</p>
          </header>
          {settings.error && section !== "rules" && section !== "appearance" ? (
            <ErrorNote>{errorMessage(settings.error)}</ErrorNote>
          ) : null}
          {section === "rules" ? (
            <PolicyEditor prefillTool={prefill} />
          ) : section === "appearance" ? (
            <Appearance />
          ) : !s ? (
            <div className="space-y-3">
              <Skeleton className="h-10 rounded-control" />
              <Skeleton className="h-32 rounded-control" />
            </div>
          ) : section === "general" ? (
            <General settings={s} save={save} />
          ) : section === "models" ? (
            <Models settings={s} save={save} known={config.data?.models ?? []} />
          ) : (
            <Budgets settings={s} save={save} />
          )}
        </div>
      </div>
    </Page>
  );
}

function SaveBar({
  dirty,
  busy,
  onSave,
  onReset,
}: {
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onReset?: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      {dirty && onReset ? (
        <button type="button" className="btn btn-ghost" onClick={onReset} disabled={busy}>
          Discard
        </button>
      ) : null}
      <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={onSave}>
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function General({ settings, save }: { settings: Settings; save: SaveFn }) {
  const { user, setUser } = useWorkspace();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [text, setText] = useState(settings.instructions ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(user?.name ?? ""), [user?.name]);
  useEffect(() => setText(settings.instructions ?? ""), [settings.instructions]);
  const dirtyName = !!user && name.trim() !== user.name && name.trim() !== "";
  const dirtyText = text !== (settings.instructions ?? "");

  async function onSave() {
    setBusy(true);
    try {
      if (dirtyName && user) {
        const res = await authClient.updateUser({ name: name.trim() });
        if (res.error) throw new Error(res.error.message ?? "Couldn't update your name");
        setUser({ ...user, name: name.trim() });
        if (!dirtyText) toast("Saved", "success");
      }
      if (dirtyText) await save({ instructions: text.trim() ? text : null });
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Field
        label="Your name"
        htmlFor="set-name"
        hint="Used in greetings, and how the agent signs things for you."
      >
        <input
          id="set-name"
          className="input max-w-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
      </Field>
      {user?.email ? (
        <Field label="Email">
          <p className="text-14 text-fg-muted">{user.email}</p>
        </Field>
      ) : null}
      <Field
        label="Instructions"
        htmlFor="set-instructions"
        hint="Added to every task: tone, defaults, things to always or never do."
      >
        <textarea
          id="set-instructions"
          className="input min-h-36 resize-y"
          placeholder="Be concise. Draft emails in my voice: friendly, no exclamation marks. Sign off as “Ada”."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <SaveBar
        dirty={dirtyName || dirtyText}
        busy={busy}
        onSave={() => void onSave()}
        onReset={() => {
          setName(user?.name ?? "");
          setText(settings.instructions ?? "");
        }}
      />
    </div>
  );
}

function Models({ settings, save, known }: { settings: Settings; save: SaveFn; known: string[] }) {
  const [chain, setChain] = useState(settings.models.chain);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const catalog = useApi(() => api.models());
  useEffect(() => setChain(settings.models.chain), [settings.models.chain]);
  // If the catalog can't load, fall back to a short list so the chain stays editable.
  const models = useMemo(
    () =>
      catalog.data?.models ??
      Array.from(
        new Set([...(settings.models.defaultChain ?? []), ...SUGGESTED_MODELS, ...known]),
      ).map(modelFromRef),
    [catalog.data, settings.models.defaultChain, known],
  );
  const byRef = useMemo(() => new Map(models.map((m) => [m.ref, m])), [models]);
  const dirty = JSON.stringify(chain) !== JSON.stringify(settings.models.chain);
  const full = chain.length >= MAX_CHAIN;
  const mv = (i: number, j: number) => {
    if (j < 0 || j >= chain.length) return;
    const next = [...chain];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setChain(next);
  };
  // Saving a key changes which models are usable.
  const saveKeys: SaveFn = async (update, message) => {
    const ok = await save(update, message);
    if (ok) void catalog.reload();
    return ok;
  };

  return (
    <div className="space-y-10">
      <section>
        <h3 className="text-16 font-medium text-fg">Model order</h3>
        <p className="mt-1 mb-4 text-13 text-fg-muted">
          Tried top to bottom. If one is down or out of credit, the next takes over.
        </p>
        {chain.length === 0 ? (
          <div className="rounded-card border border-line bg-surface px-4 py-3.5 text-13 text-fg-muted">
            Using the server default
            {settings.models.defaultChain?.length ? (
              <ol className="mt-2 space-y-1">
                {settings.models.defaultChain.map((m, i) => (
                  <li key={m} className="flex min-w-0 items-center gap-2 text-fg">
                    <span className="tabular w-4 text-12 text-fg-faint">{i + 1}</span>
                    <span className="truncate text-13">{byRef.get(m)?.name ?? m}</span>
                    {byRef.get(m) ? (
                      <span className="hidden truncate font-mono text-12 text-fg-faint sm:inline">
                        {m}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              ": none configured. Add at least one model."
            )}
          </div>
        ) : (
          <ol className="divide-y divide-line rounded-card border border-line bg-surface">
            {chain.map((ref, i) => {
              const m = byRef.get(ref);
              const price = m ? priceLabel(m) : null;
              return (
                <li key={ref} className="flex items-center gap-2 px-3 py-2">
                  <span className="tabular w-5 text-center text-12 text-fg-faint">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-14 text-fg">{m?.name ?? ref}</span>
                      {i === 0 ? <Pill tone="accent">Primary</Pill> : null}
                      {m && !m.available ? (
                        <Pill tone="attention" title="Add a key for this provider below">
                          No key
                        </Pill>
                      ) : null}
                    </div>
                    {m ? (
                      <div className="flex min-w-0 gap-2 text-12 text-fg-faint">
                        <span className="truncate font-mono">{ref}</span>
                        {price ? (
                          <span className="tabular hidden shrink-0 sm:inline">{price} per 1M</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    aria-label={`Move ${ref} up`}
                    disabled={i === 0}
                    onClick={() => mv(i, i - 1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    aria-label={`Move ${ref} down`}
                    disabled={i === chain.length - 1}
                    onClick={() => mv(i, i + 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    aria-label={`Remove ${ref}`}
                    onClick={() => setChain(chain.filter((x) => x !== ref))}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            className="btn"
            disabled={full}
            aria-haspopup="dialog"
            onClick={() => setPicking(true)}
          >
            <Plus className="size-4" /> Add model
          </button>
          <span className="text-12 text-fg-faint">
            {full
              ? `Up to ${MAX_CHAIN} models. Remove one to add another.`
              : catalog.error
                ? "Couldn't load the model list; showing a few suggestions."
                : catalog.data
                  ? `${catalog.data.models.length} models from every provider you can use.`
                  : null}
          </span>
        </div>
        <ModelPicker
          open={picking}
          onClose={() => setPicking(false)}
          models={models}
          chain={chain}
          onPick={(ref) => {
            if (!chain.includes(ref) && chain.length < MAX_CHAIN) setChain([...chain, ref]);
            setPicking(false);
          }}
        />
        <SaveBar
          dirty={dirty}
          busy={busy}
          onReset={() => setChain(settings.models.chain)}
          onSave={async () => {
            setBusy(true);
            await save({ models: { chain } }, "Model order saved");
            setBusy(false);
          }}
        />
      </section>

      <section>
        <h3 className="text-16 font-medium text-fg">Provider keys</h3>
        <p className="mt-1 mb-4 text-13 text-fg-muted">
          Stored encrypted and never shown again. Leave unset to use the server's keys, if it has
          any.
        </p>
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {PROVIDERS.map((p) => (
            <li key={p.id}>
              <KeyRow
                provider={p.id}
                label={p.label}
                isSet={settings.providerKeys[p.id]}
                save={saveKeys}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function KeyRow({
  provider,
  label,
  isSet,
  save,
}: {
  provider: ProviderName;
  label: string;
  isSet: boolean;
  save: SaveFn;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const id = `key-${provider}`;
  return (
    <form
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return;
        setBusy(true);
        if (await save({ providerKeys: { [provider]: value.trim() } }, `${label} key saved`))
          setValue("");
        setBusy(false);
      }}
    >
      <label htmlFor={id} className="w-24 text-14 text-fg">
        {label}
      </label>
      {isSet ? <Pill tone="ok">Set</Pill> : <Pill>Not set</Pill>}
      <input
        id={id}
        type="password"
        autoComplete="off"
        className="input h-8 min-h-8 min-w-40 flex-1 py-0"
        placeholder={isSet ? "Replace key…" : "Paste key…"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn btn-sm" disabled={busy || !value.trim()}>
        Save
      </button>
      {isSet ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm text-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await save({ providerKeys: { [provider]: null } }, `${label} key cleared`);
            setBusy(false);
          }}
        >
          Clear
        </button>
      ) : null}
    </form>
  );
}

const str = (n: number | null) => (n == null ? "" : String(n));

function Budgets({ settings, save }: { settings: Settings; save: SaveFn }) {
  const [perRun, setPerRun] = useState(str(settings.budgets.perRunUsd));
  const [perDay, setPerDay] = useState(str(settings.budgets.perDayUsd));
  const [busy, setBusy] = useState(false);
  const { todaySpend } = useWorkspace();
  useEffect(() => {
    setPerRun(str(settings.budgets.perRunUsd));
    setPerDay(str(settings.budgets.perDayUsd));
  }, [settings.budgets.perRunUsd, settings.budgets.perDayUsd]);
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const invalid = [perRun, perDay].some((v) => v.trim() !== "" && !(Number(v) >= 0));
  const dirty =
    perRun !== str(settings.budgets.perRunUsd) || perDay !== str(settings.budgets.perDayUsd);
  const dayLimit = settings.budgets.perDayUsd;

  return (
    <div className="space-y-6">
      {dayLimit && todaySpend != null ? (
        <div className="rounded-card border border-line bg-surface px-4 py-3.5">
          <div className="flex items-baseline justify-between text-13">
            <span className="text-fg-muted">Spent today</span>
            <span className="tabular text-fg">
              {formatCost(todaySpend)}{" "}
              <span className="text-fg-faint">of {formatCost(dayLimit)}</span>
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full bg-accent"
              style={{
                width: `${Math.min(100, Math.max(todaySpend > 0 ? 1.5 : 0, (todaySpend / dayLimit) * 100))}%`,
              }}
            />
          </div>
        </div>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        {(
          [
            [
              "budget-run",
              "Per task run",
              "One run stops when it reaches this.",
              perRun,
              setPerRun,
            ],
            [
              "budget-day",
              "Per day",
              "All runs pause for the rest of the day (UTC).",
              perDay,
              setPerDay,
            ],
          ] as const
        ).map(([id, label, hint, value, set]) => (
          <Field key={id} label={label} htmlFor={id} hint={hint}>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-faint">
                $
              </span>
              <input
                id={id}
                className="input tabular pl-7"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="No limit"
                value={value}
                onChange={(e) => set(e.target.value)}
              />
            </div>
          </Field>
        ))}
      </div>
      {invalid ? <p className="text-13 text-danger">Budgets must be zero or more.</p> : null}
      <SaveBar
        dirty={dirty && !invalid}
        busy={busy}
        onReset={() => {
          setPerRun(str(settings.budgets.perRunUsd));
          setPerDay(str(settings.budgets.perDayUsd));
        }}
        onSave={async () => {
          setBusy(true);
          await save(
            { budgets: { perRunUsd: num(perRun), perDayUsd: num(perDay) } },
            "Budgets saved",
          );
          setBusy(false);
        }}
      />
    </div>
  );
}

function Appearance() {
  const [theme, setTheme] = useTheme();
  const options: { value: ThemePref; label: string; icon: ReactNode }[] = [
    { value: "system", label: "System", icon: <Monitor /> },
    { value: "light", label: "Light", icon: <Sun /> },
    { value: "dark", label: "Dark", icon: <Moon /> },
  ];
  return (
    <fieldset aria-label="Theme" className="grid min-w-0 grid-cols-3 gap-3">
      {options.map((o) => {
        const on = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => setTheme(o.value)}
            className={cx(
              "flex flex-col items-start gap-3 rounded-card border bg-surface p-3 text-left transition-colors duration-150",
              on
                ? "border-accent shadow-[0_0_0_1px_var(--accent)]"
                : "border-line hover:border-line-strong",
            )}
          >
            <ThemeSwatch kind={o.value} />
            <span className="flex items-center gap-2 text-13 font-medium text-fg">
              <span className="text-fg-muted">{o.icon}</span>
              {o.label}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}

function ThemeSwatch({ kind }: { kind: ThemePref }) {
  const light = {
    canvas: "#F6F5F1",
    surface: "#FFFFFF",
    line: "#E5E2DA",
    fg: "#1B1A17",
    accent: "#3B48CC",
  };
  const dark = {
    canvas: "#0F0F0E",
    surface: "#181816",
    line: "#272623",
    fg: "#ECEAE4",
    accent: "#8B95FF",
  };
  const pane = (c: typeof light) => (
    <div className="flex h-full flex-1 gap-1 p-1.5" style={{ background: c.canvas }}>
      <div className="w-1/4 space-y-1">
        <div className="h-1 w-3/4 rounded-full" style={{ background: c.line }} />
        <div className="h-1 w-1/2 rounded-full" style={{ background: c.line }} />
      </div>
      <div
        className="flex-1 rounded-[3px] p-1"
        style={{ background: c.surface, boxShadow: `0 0 0 1px ${c.line}` }}
      >
        <div className="h-1 w-2/3 rounded-full" style={{ background: c.fg, opacity: 0.7 }} />
        <div className="mt-1 h-1.5 w-6 rounded-full" style={{ background: c.accent }} />
      </div>
    </div>
  );
  return (
    <div className="flex aspect-[16/10] w-full overflow-hidden rounded-[8px] border border-line">
      {kind === "dark" ? (
        pane(dark)
      ) : kind === "light" ? (
        pane(light)
      ) : (
        <>
          {pane(light)}
          {pane(dark)}
        </>
      )}
    </div>
  );
}
