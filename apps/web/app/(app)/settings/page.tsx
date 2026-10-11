"use client";

import { useEffect, useState } from "react";
import { ErrorNote, Page, Section, Spinner } from "@/components/page";
import { useToast } from "@/components/toast";
import {
  api,
  errorMessage,
  type ProviderName,
  type Settings,
  type SettingsUpdate,
} from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { PolicyEditor } from "./policy-editor";

const SUGGESTED_MODELS = [
  "anthropic:claude-opus-5-5",
  "anthropic:claude-sonnet-5-5",
  "anthropic:claude-haiku-5-5",
];
const PROVIDERS: { id: ProviderName; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google" },
];

export default function SettingsPage() {
  const settings = useApi(() => api.settings());
  const config = useApi(() => api.config());
  const toast = useToast();

  async function save(update: SettingsUpdate, message = "Saved") {
    const next = await api.saveSettings(update);
    settings.setData(next);
    toast(message, "success");
  }

  const s = settings.data;
  return (
    <Page title="Settings">
      {settings.error ? <ErrorNote error={errorMessage(settings.error)} /> : null}
      {!s ? (
        settings.loading ? (
          <Spinner />
        ) : null
      ) : (
        <>
          <InstructionsSection settings={s} save={save} />
          <ModelsSection settings={s} save={save} known={config.data?.models ?? []} />
          <KeysSection settings={s} save={save} />
          <BudgetsSection settings={s} save={save} />
        </>
      )}
      <PolicyEditor />
    </Page>
  );
}

type SaveFn = (update: SettingsUpdate, message?: string) => Promise<void>;

function useSaver(save: SaveFn) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (update: SettingsUpdate, message?: string) => {
    setBusy(true);
    try {
      await save(update, message);
      return true;
    } catch (err) {
      toast(errorMessage(err), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function InstructionsSection({ settings, save }: { settings: Settings; save: SaveFn }) {
  const [text, setText] = useState(settings.instructions ?? "");
  const { busy, run } = useSaver(save);
  useEffect(() => setText(settings.instructions ?? ""), [settings.instructions]);
  const dirty = text !== (settings.instructions ?? "");
  return (
    <Section
      title="Instructions"
      description="Added to every run's system prompt: how you like to work, tone, defaults."
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !dirty}
          onClick={() => void run({ instructions: text.trim() ? text : null })}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      }
    >
      <label htmlFor="instructions" className="sr-only">
        Instructions
      </label>
      <textarea
        id="instructions"
        className="input min-h-32"
        placeholder="e.g. Be concise. Draft emails in my voice: friendly, no exclamation marks."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </Section>
  );
}

function ModelsSection({
  settings,
  save,
  known,
}: {
  settings: Settings;
  save: SaveFn;
  known: string[];
}) {
  const [chain, setChain] = useState(settings.models.chain);
  const [adding, setAdding] = useState("");
  const { busy, run } = useSaver(save);
  useEffect(() => setChain(settings.models.chain), [settings.models.chain]);
  const options = Array.from(
    new Set([...(settings.models.defaultChain ?? []), ...SUGGESTED_MODELS, ...known]),
  ).filter((m) => !chain.includes(m));
  const dirty = JSON.stringify(chain) !== JSON.stringify(settings.models.chain);

  function add() {
    const m = adding.trim();
    if (!m || chain.includes(m)) return;
    setChain([...chain, m]);
    setAdding("");
  }
  function move(i: number, j: number) {
    if (j < 0 || j >= chain.length) return;
    const next = [...chain];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setChain(next);
  }

  return (
    <Section
      title="Models"
      description='Tried in order; if one fails or is unavailable the next is used. Format "provider:model".'
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !dirty}
          onClick={() => void run({ models: { chain } })}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      }
    >
      {chain.length === 0 ? (
        <p className="mb-3 text-fg-muted">
          {settings.models.defaultChain?.length ? (
            <>
              Using the server default:{" "}
              <span className="font-mono text-[13px]">
                {settings.models.defaultChain.join(" → ")}
              </span>
              . Add models to override it.
            </>
          ) : (
            "No models configured — add at least one."
          )}
        </p>
      ) : (
        <ol className="mb-3 space-y-1.5">
          {chain.map((m, i) => (
            <li
              key={m}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
            >
              <span className="w-5 text-xs text-fg-faint tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{m}</span>
              {i === 0 ? <span className="text-xs text-fg-faint">primary</span> : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Move ${m} up`}
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Move ${m} down`}
                disabled={i === chain.length - 1}
                onClick={() => move(i, i + 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-danger-fg"
                aria-label={`Remove ${m}`}
                onClick={() => setChain(chain.filter((x) => x !== m))}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label htmlFor="model-add" className="sr-only">
          Add model
        </label>
        <input
          id="model-add"
          className="input font-mono text-[13px]"
          list="model-options"
          placeholder="anthropic:claude-sonnet-5-5"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        />
        <datalist id="model-options">
          {options.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <button type="submit" className="btn" disabled={!adding.trim()}>
          Add
        </button>
      </form>
      {options.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {options.slice(0, 6).map((m) => (
            <button
              key={m}
              type="button"
              className="btn btn-sm font-mono text-xs"
              onClick={() => setChain([...chain, m])}
            >
              + {m}
            </button>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

function KeysSection({ settings, save }: { settings: Settings; save: SaveFn }) {
  return (
    <Section
      title="Provider keys"
      description="Stored encrypted and never shown again. Leave unset to use the server's keys, if any."
    >
      <ul className="space-y-3">
        {PROVIDERS.map((p) => (
          <li key={p.id}>
            <KeyRow
              provider={p.id}
              label={p.label}
              isSet={settings.providerKeys[p.id]}
              save={save}
            />
          </li>
        ))}
      </ul>
    </Section>
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
  const { busy, run } = useSaver(save);
  const id = `key-${provider}`;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return;
        if (await run({ providerKeys: { [provider]: value.trim() } }, `${label} key saved`))
          setValue("");
      }}
    >
      <label htmlFor={id} className="w-24 font-medium">
        {label}
      </label>
      <span className={isSet ? "w-14 text-xs text-ok-fg" : "w-14 text-xs text-fg-faint"}>
        {isSet ? "set" : "not set"}
      </span>
      <input
        id={id}
        type="password"
        autoComplete="off"
        className="input min-w-40 flex-1"
        placeholder={isSet ? "Replace key…" : "Paste key…"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn" disabled={busy || !value.trim()}>
        Save
      </button>
      <button
        type="button"
        className="btn btn-danger"
        disabled={busy || !isSet}
        onClick={() => void run({ providerKeys: { [provider]: null } }, `${label} key cleared`)}
      >
        Clear
      </button>
    </form>
  );
}

const str = (n: number | null) => (n == null ? "" : String(n));

function BudgetsSection({ settings, save }: { settings: Settings; save: SaveFn }) {
  const [perRun, setPerRun] = useState(str(settings.budgets.perRunUsd));
  const [perDay, setPerDay] = useState(str(settings.budgets.perDayUsd));
  const { busy, run } = useSaver(save);
  useEffect(() => {
    setPerRun(str(settings.budgets.perRunUsd));
    setPerDay(str(settings.budgets.perDayUsd));
  }, [settings.budgets.perRunUsd, settings.budgets.perDayUsd]);
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const invalid = [perRun, perDay].some((v) => v.trim() !== "" && !(Number(v) >= 0));

  return (
    <Section
      title="Budgets"
      description="Runs stop when they hit a limit. Leave empty for no limit."
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || invalid}
          onClick={() => void run({ budgets: { perRunUsd: num(perRun), perDayUsd: num(perDay) } })}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["budget-run", "Per run (USD)", perRun, setPerRun],
            ["budget-day", "Per day (USD)", perDay, setPerDay],
          ] as const
        ).map(([id, label, value, set]) => (
          <div key={id}>
            <label htmlFor={id} className="label">
              {label}
            </label>
            <input
              id={id}
              className="input"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder="No limit"
              value={value}
              onChange={(e) => set(e.target.value)}
            />
          </div>
        ))}
      </div>
      {invalid ? <p className="mt-2 text-danger-fg">Budgets must be positive numbers.</p> : null}
    </Section>
  );
}
