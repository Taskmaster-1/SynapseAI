"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
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
      <PageHeader eyebrow="Your workspace" title="Settings" />
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
                    "flex h-9 w-full items-center gap-2.5 rounded-full px-3.5 text-13 whitespace-nowrap transition-colors duration-150",
                    section === x.id
                      ? "bg-fg font-medium text-canvas"
                      : "text-fg-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  <span className={section === x.id ? "text-canvas" : "text-fg-faint"}>
                    {x.icon}
                  </span>
                  {x.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 md:max-w-[680px]">
          <header className="mb-8">
            <p className="eyebrow">
              {String(SECTIONS.findIndex((x) => x.id === section) + 1).padStart(2, "0")} /{" "}
              {String(SECTIONS.length).padStart(2, "0")}
            </p>
            <h2 className="mt-2 font-serif text-[36px] leading-none tracking-[-0.01em] text-fg">
              {meta.label}
            </h2>
            <p className="mt-2 text-14 text-fg-muted">{meta.blurb}</p>
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
        <h3 className="font-serif text-[24px] leading-tight text-fg">Model order</h3>
        <p className="mt-1 mb-4 text-13 text-fg-muted">
          Tried top to bottom. If one is down or out of credit, the next takes over.
        </p>
        {chain.length === 0 ? (
          <div className="rounded-[16px] border border-line bg-surface px-4 py-3.5 text-13 text-fg-muted">
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
          <ol className="divide-y divide-line rounded-[16px] border border-line bg-surface">
            {chain.map((ref, i) => {
              const m = byRef.get(ref);
              const price = m ? priceLabel(m) : null;
              return (
                <li key={ref} className="flex items-center gap-2 py-2.5 pr-3 pl-2">
                  <span
                    className={cx(
                      "tabular w-7 shrink-0 text-center font-serif text-[22px] leading-none",
                      i === 0 ? "text-fg" : "text-fg-faint",
                    )}
                  >
                    {i + 1}
                  </span>
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
        <h3 className="font-serif text-[24px] leading-tight text-fg">Provider keys</h3>
        <p className="mt-1 mb-4 text-13 text-fg-muted">
          Stored encrypted and never shown again. Leave unset to use the server's keys, if it has
          any.
        </p>
        <ul className="divide-y divide-line rounded-[16px] border border-line bg-surface">
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
      <label htmlFor={id} className="w-24 text-14 text-fg sm:w-36">
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
        <div className="rounded-[16px] border border-line bg-surface px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="eyebrow">Spent today</span>
            <span className="tabular text-13 text-fg-muted">
              <span className="font-serif text-[26px] leading-none text-fg">
                {formatCost(todaySpend)}
              </span>{" "}
              of {formatCost(dayLimit)}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken">
            <div
              className={cx(
                "h-full rounded-full",
                todaySpend / dayLimit >= 0.8 ? "bg-attention" : "bg-fg",
              )}
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
  const options: { value: ThemePref; label: string; icon: ReactNode; note: string }[] = [
    { value: "light", label: "Light", icon: <Sun />, note: "Paper and ink. The default." },
    { value: "dark", label: "Dark", icon: <Moon />, note: "Warm, for late nights." },
    { value: "system", label: "System", icon: <Monitor />, note: "Follows your device." },
  ];
  return (
    <fieldset aria-label="Theme" className="grid min-w-0 gap-3 sm:grid-cols-3">
      {options.map((o) => {
        const on = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => setTheme(o.value)}
            className={cx(
              "relative flex flex-col items-start gap-3 rounded-[16px] border bg-surface p-3 text-left transition-[border-color,box-shadow] duration-150",
              on
                ? "border-fg shadow-[0_0_0_1px_var(--fg)]"
                : "border-line hover:border-line-strong",
            )}
          >
            <ThemeSwatch kind={o.value} />
            <span className="flex w-full items-center gap-2 px-0.5 text-14 font-medium text-fg">
              <span className="text-fg-muted">{o.icon}</span>
              {o.label}
              {on ? (
                <span className="ml-auto grid size-5 place-items-center rounded-full bg-fg text-canvas">
                  <Check className="size-3" strokeWidth={2.75} />
                </span>
              ) : null}
            </span>
            <span className="-mt-2 px-0.5 text-12 text-fg-muted">{o.note}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

function ThemeSwatch({ kind }: { kind: ThemePref }) {
  const light = {
    canvas: "#f4f1ea",
    surface: "#fffdf8",
    line: "#e2dccf",
    fg: "#15140f",
    accent: "#3b48cc",
  };
  const dark = {
    canvas: "#13120f",
    surface: "#1c1b17",
    line: "#2b2924",
    fg: "#efeae0",
    accent: "#8b95ff",
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
        <div
          className="font-serif text-[15px] leading-none italic"
          style={{ color: c.fg, fontFamily: "var(--font-serif)" }}
        >
          Aa
        </div>
        <div className="mt-1 h-1 w-2/3 rounded-full" style={{ background: c.line }} />
        <div className="mt-1.5 h-1.5 w-6 rounded-full" style={{ background: c.fg }} />
      </div>
    </div>
  );
  return (
    <div className="flex aspect-[16/9] w-full overflow-hidden rounded-[10px] border border-line">
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
