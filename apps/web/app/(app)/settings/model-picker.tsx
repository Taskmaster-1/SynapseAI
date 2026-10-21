"use client";

import { Check, CornerDownLeft, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/overlay";
import { Kbd, Monogram, Segmented } from "@/components/ui";
import type { ModelInfo } from "@/lib/api";
import { cx, formatTokens } from "@/lib/format";

/** The fallback chain allows at most this many models (the server enforces it too). */
export const MAX_CHAIN = 5;
const REF = /^[a-z-]+:.+$/;

const CREATORS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  deepseek: "DeepSeek",
  moonshotai: "Moonshot",
  zai: "Z.ai",
  mistral: "Mistral",
  meta: "Meta",
  alibaba: "Alibaba",
  amazon: "Amazon",
  cohere: "Cohere",
  perplexity: "Perplexity",
};
const CREATOR_ORDER = ["anthropic", "openai", "google", "xai", "deepseek"];

const PROVIDER_LABEL: Record<ModelInfo["provider"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  gateway: "Vercel AI Gateway",
  "openai-compatible": "OpenAI-compatible",
};

export function creatorLabel(creator: string): string {
  return CREATORS[creator] ?? creator.charAt(0).toUpperCase() + creator.slice(1);
}

/** "$2", "$0.15", "$0.075" — per million tokens. */
function perMillion(usd: number): string {
  if (usd === 0) return "$0";
  if (usd >= 1) return `$${Number(usd.toFixed(2))}`;
  return `$${Number(usd.toPrecision(2))}`;
}

export function priceLabel(m: Pick<ModelInfo, "price">): string | null {
  return m.price ? `${perMillion(m.price.input)} / ${perMillion(m.price.output)}` : null;
}

/** Minimal entries for refs the catalog doesn't know (fallback list, custom refs). */
export function modelFromRef(ref: string): ModelInfo {
  const [provider = "", id = ref] = ref.split(/:(.*)/s);
  const creator = provider === "gateway" ? (id.split("/")[0] ?? provider) : provider;
  return {
    ref,
    name: id,
    provider: provider as ModelInfo["provider"],
    creator,
    contextWindow: null,
    price: null,
    available: true,
    tags: [],
    released: null,
  };
}

export function ModelPicker({
  open,
  onClose,
  models,
  chain,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  models: ModelInfo[];
  chain: string[];
  onPick: (ref: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} label="Add a model" className="max-w-[620px]">
      <PickerBody models={models} chain={chain} onPick={onPick} />
    </Modal>
  );
}

type Row = { kind: "model"; model: ModelInfo } | { kind: "custom"; ref: string };

function PickerBody({
  models,
  chain,
  onPick,
}: {
  models: ModelInfo[];
  chain: string[];
  onPick: (ref: string) => void;
}) {
  const anyAvailable = models.some((m) => m.available);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"available" | "all">(anyAvailable ? "available" : "all");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { groups, rows } = useMemo(() => {
    const query = q.trim().toLowerCase();
    const matches = models.filter(
      (m) =>
        (scope === "all" || m.available) &&
        (!query ||
          m.name.toLowerCase().includes(query) ||
          m.ref.toLowerCase().includes(query) ||
          creatorLabel(m.creator).toLowerCase().includes(query)),
    );
    const byCreator = new Map<string, ModelInfo[]>();
    for (const m of matches) byCreator.set(m.creator, [...(byCreator.get(m.creator) ?? []), m]);
    const rank = (c: string) => {
      const i = CREATOR_ORDER.indexOf(c);
      return i === -1 ? CREATOR_ORDER.length : i;
    };
    const groups = [...byCreator.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || creatorLabel(a).localeCompare(creatorLabel(b)))
      .map(([creator, list]) => ({
        creator,
        list: list.sort(
          (a, b) =>
            Number(b.available) - Number(a.available) ||
            (b.released ?? "").localeCompare(a.released ?? "") ||
            a.name.localeCompare(b.name),
        ),
      }));
    const rows: Row[] = groups.flatMap((g) => g.list.map((model) => ({ kind: "model", model })));
    const custom = q.trim();
    if (REF.test(custom) && !models.some((m) => m.ref === custom) && !chain.includes(custom))
      rows.push({ kind: "custom", ref: custom });
    return { groups, rows };
  }, [models, q, scope, chain]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter change
  useEffect(() => setActive(0), [q, scope]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const selectable = (r: Row | undefined) =>
    !!r && (r.kind === "custom" || (r.model.available && !chain.includes(r.model.ref)));
  const pick = (r: Row | undefined) => {
    if (!r || !selectable(r)) return;
    onPick(r.kind === "custom" ? r.ref : r.model.ref);
  };
  const rowId = (r: Row) =>
    `mp-${(r.kind === "custom" ? `custom-${r.ref}` : r.model.ref).replace(/[^a-zA-Z0-9-]/g, "_")}`;

  let index = -1;
  const custom = rows.at(-1)?.kind === "custom" ? rows.at(-1) : undefined;

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="shrink-0 text-fg-faint" />
        <input
          data-autofocus
          aria-label="Search models"
          role="combobox"
          aria-expanded="true"
          aria-controls="model-picker-list"
          aria-activedescendant={rows[active] ? rowId(rows[active]) : undefined}
          placeholder="Search models, or type provider:model"
          className="h-14 min-w-0 flex-1 bg-transparent font-serif text-[22px] text-fg outline-none placeholder:text-fg-faint"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(rows.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(rows[active]);
            }
          }}
        />
        <span className="hidden sm:inline">
          <Kbd>esc</Kbd>
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 border-b border-line bg-sunken/50 px-4 py-2">
        <Segmented
          label="Which models to show"
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: "available", label: "With a key" },
            { value: "all", label: "All" },
          ]}
        />
        <span className="hidden font-mono text-[10.5px] tracking-[0.08em] text-fg-faint uppercase sm:inline">
          $ per 1M tokens · in / out
        </span>
      </div>
      <div
        ref={listRef}
        id="model-picker-list"
        role="listbox"
        aria-label="Models"
        className="scroll-thin max-h-[min(440px,58dvh)] overflow-y-auto p-1.5"
      >
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-13 text-fg-muted">
            {q.trim()
              ? `Nothing matches “${q.trim()}”. Type a full provider:model ref to add it anyway.`
              : scope === "available"
                ? "No models have a key yet. Add a provider key below, or show all."
                : "No models listed."}
          </p>
        ) : null}
        {groups.map((g) => (
          <div key={g.creator} className="pb-1">
            <div className="eyebrow flex items-center gap-2 px-2.5 pt-3 pb-1.5">
              <Monogram name={creatorLabel(g.creator)} size={14} />
              {creatorLabel(g.creator)}
            </div>
            {g.list.map((m) => {
              index++;
              const i = index;
              const on = i === active;
              const added = chain.includes(m.ref);
              const row: Row = { kind: "model", model: m };
              const price = priceLabel(m);
              return (
                <div
                  key={m.ref}
                  id={rowId(row)}
                  role="option"
                  aria-selected={on}
                  aria-disabled={!selectable(row)}
                  data-index={i}
                  tabIndex={-1}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(row)}
                  onKeyDown={() => {}}
                  className={cx(
                    "flex min-h-12 items-center gap-3 rounded-[10px] px-2.5 py-1.5",
                    selectable(row) ? "cursor-pointer" : "cursor-default",
                    on && "bg-accent-soft",
                    !m.available && "opacity-55",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-14 text-fg">{m.name}</span>
                      {m.tags.includes("reasoning") ? (
                        <span className="hidden text-12 text-fg-faint sm:inline">reasoning</span>
                      ) : null}
                    </div>
                    <div className="truncate font-mono text-12 text-fg-faint">{m.ref}</div>
                  </div>
                  <div className="shrink-0 text-right text-12">
                    {added ? (
                      <span className="inline-flex items-center gap-1 text-fg-muted">
                        <Check className="size-3.5" /> Added
                      </span>
                    ) : !m.available ? (
                      <span className="text-fg-muted">needs {PROVIDER_LABEL[m.provider]} key</span>
                    ) : (
                      <>
                        {price ? <div className="tabular text-fg-muted">{price}</div> : null}
                        {m.contextWindow ? (
                          <div className="tabular text-fg-faint">
                            {formatTokens(m.contextWindow)} ctx
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                  {on && selectable(row) ? (
                    <CornerDownLeft className="hidden size-3.5 shrink-0 text-fg-faint sm:block" />
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
        {custom?.kind === "custom"
          ? (() => {
              const i = rows.length - 1;
              const on = i === active;
              return (
                <div className="pb-1">
                  <div className="eyebrow px-2.5 pt-2 pb-1">Custom</div>
                  <div
                    id={rowId(custom)}
                    role="option"
                    aria-selected={on}
                    data-index={i}
                    tabIndex={-1}
                    onMouseMove={() => setActive(i)}
                    onClick={() => pick(custom)}
                    onKeyDown={() => {}}
                    className={cx(
                      "flex min-h-12 cursor-pointer items-center gap-3 rounded-[10px] px-2.5",
                      on && "bg-accent-soft",
                    )}
                  >
                    <Plus className={on ? "text-accent" : "text-fg-faint"} />
                    <span className="min-w-0 flex-1 truncate text-14 text-fg">
                      Use <span className="font-mono text-13">{custom.ref}</span>
                    </span>
                    <span className="hidden text-12 text-fg-faint sm:inline">price unknown</span>
                  </div>
                </div>
              );
            })()
          : null}
      </div>
    </div>
  );
}
