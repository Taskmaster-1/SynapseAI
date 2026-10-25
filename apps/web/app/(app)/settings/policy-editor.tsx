"use client";

import type { ArgMatcher, Decision, Effect, PolicyDefaults, PolicyRule } from "@synapse/core";
import { GripVertical, Plus, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { EffectPill, ErrorNote, Pill, Segmented, Skeleton } from "@/components/ui";
import { api, errorMessage, type Policy } from "@/lib/api";
import { cx, humanToolName } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const EFFECTS: Effect[] = ["read", "write", "send", "destructive"];
const OPS: { op: ArgMatcher["op"]; label: string; hint: string }[] = [
  { op: "allEndWith", label: "ends with", hint: "@acme.com, @acme.io" },
  { op: "emailsEndWith", label: "every email address ends with", hint: "@acme.com" },
  { op: "equals", label: "is", hint: "main" },
  { op: "in", label: "is one of", hint: "a, b, c" },
  { op: "matches", label: "matches", hint: "^release/" },
];

const DECISION_OPTIONS: { value: Decision; label: string; tone: "ok" | "attention" | "danger" }[] =
  [
    { value: "allow", label: "Allow", tone: "ok" },
    { value: "ask", label: "Ask", tone: "attention" },
    { value: "block", label: "Block", tone: "danger" },
  ];

interface DraftMatcher {
  key: string;
  path: string;
  op: ArgMatcher["op"];
  raw: string;
}
interface DraftRule {
  id: string;
  tool: string;
  decision: Decision;
  when: DraftMatcher[];
  note: string;
  fresh?: boolean;
}

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function toDraft(rule: PolicyRule): DraftRule {
  return {
    id: rule.id,
    tool: rule.tool,
    decision: rule.decision,
    note: rule.note ?? "",
    when: (rule.when ?? []).map((m) => ({
      key: newKey(),
      path: m.path,
      op: m.op,
      raw:
        m.op === "matches"
          ? m.value
          : m.op === "allEndWith" || m.op === "emailsEndWith"
            ? m.value.join(", ")
            : m.op === "in"
              ? m.value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ")
              : typeof m.value === "string"
                ? m.value
                : JSON.stringify(m.value),
    })),
  };
}

const splitList = (raw: string) =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function toMatcher(m: DraftMatcher, where: string): ArgMatcher {
  if (m.op === "emailsEndWith") {
    const value = splitList(m.raw);
    if (value.length === 0) throw new Error(`${where}: give at least one ending`);
    return { path: "*", op: "emailsEndWith", value };
  }
  const path = m.path.trim();
  if (!path) throw new Error(`${where}: say which field the condition checks`);
  switch (m.op) {
    case "equals": {
      try {
        const v = JSON.parse(m.raw);
        return {
          path,
          op: "equals",
          value:
            typeof v === "object" || typeof v === "number" || typeof v === "boolean" ? v : m.raw,
        };
      } catch {
        return { path, op: "equals", value: m.raw };
      }
    }
    case "in": {
      try {
        const v = JSON.parse(m.raw);
        if (Array.isArray(v)) return { path, op: "in", value: v };
      } catch {
        // comma-separated
      }
      return { path, op: "in", value: splitList(m.raw) };
    }
    case "allEndWith": {
      const value = splitList(m.raw);
      if (value.length === 0) throw new Error(`${where}: give at least one ending`);
      return { path, op: "allEndWith", value };
    }
    case "matches":
      try {
        new RegExp(m.raw);
      } catch {
        throw new Error(`${where}: that pattern isn't a valid regular expression`);
      }
      return { path, op: "matches", value: m.raw };
  }
}

function fromDraft(rules: DraftRule[]): PolicyRule[] {
  return rules.map((r, i) => {
    const where = `Rule ${i + 1}`;
    if (!r.tool.trim()) throw new Error(`${where}: which tool does it apply to?`);
    const rule: PolicyRule = { id: r.id, tool: r.tool.trim(), decision: r.decision };
    if (r.when.length) rule.when = r.when.map((m) => toMatcher(m, where));
    if (r.note.trim()) rule.note = r.note.trim();
    return rule;
  });
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Inline token input that grows with its content. */
function Token({
  value,
  onChange,
  placeholder,
  label,
  mono = false,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  mono?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <input
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      size={Math.max(4, Math.min(36, (value || placeholder).length + 1))}
      // biome-ignore lint/a11y/noAutofocus: new rule from "Always allow…"
      autoFocus={autoFocus}
      className={cx(
        "h-7 max-w-full rounded-[6px] border border-line-strong bg-surface px-2 text-13 font-medium text-fg outline-none transition-[border-color,box-shadow] duration-150 placeholder:font-normal placeholder:text-fg-faint focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)]",
        mono && "font-mono text-12",
      )}
    />
  );
}

export function PolicyEditor({ prefillTool }: { prefillTool?: string | null }) {
  const toast = useToast();
  const policy = useApi(() => api.policy());
  const [defaults, setDefaults] = useState<PolicyDefaults | null>(null);
  const [rules, setRules] = useState<DraftRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const prefilled = useRef(false);

  const load = useCallback((p: Policy) => {
    setDefaults(p.defaults);
    setRules(p.rules.map(toDraft));
  }, []);

  useEffect(() => {
    if (!policy.data) return;
    load(policy.data);
    if (prefillTool && !prefilled.current) {
      prefilled.current = true;
      setRules((rs) => [
        { id: newKey(), tool: prefillTool, decision: "allow", when: [], note: "", fresh: true },
        ...rs,
      ]);
    }
  }, [policy.data, load, prefillTool]);

  const saved = policy.data
    ? JSON.stringify({
        d: policy.data.defaults,
        r: policy.data.rules
          .map(toDraft)
          .map(({ when, ...r }) => ({ ...r, when: when.map(({ key: _k, ...m }) => m) })),
      })
    : "";
  const current = JSON.stringify({
    d: defaults,
    r: rules.map(({ when, fresh: _f, ...r }) => ({
      ...r,
      when: when.map(({ key: _k, ...m }) => m),
    })),
  });
  const dirty = policy.data !== undefined && saved !== current;

  async function save() {
    if (!defaults) return;
    setError(null);
    let parsed: PolicyRule[];
    try {
      parsed = fromDraft(rules);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setSaving(true);
    try {
      const next = await api.savePolicy({ defaults, rules: parsed });
      policy.setData(next);
      load(next);
      toast("Approval rules saved", "success");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const update = (i: number, patch: Partial<DraftRule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updateMatcher = (i: number, k: number, patch: Partial<DraftMatcher>) =>
    setRules((rs) =>
      rs.map((r, j) =>
        j === i ? { ...r, when: r.when.map((m, n) => (n === k ? { ...m, ...patch } : m)) } : r,
      ),
    );

  if (policy.error) return <ErrorNote>{errorMessage(policy.error)}</ErrorNote>;
  if (!defaults)
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
      </div>
    );

  return (
    <div className="space-y-10">
      <section>
        <h3 className="font-serif text-[24px] leading-tight text-fg">By default</h3>
        <p className="mt-1 mb-4 text-13 text-fg-muted">What happens when no rule below matches.</p>
        <ul className="divide-y divide-line rounded-[16px] border border-line bg-surface">
          {EFFECTS.map((effect) => (
            <li
              key={effect}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <span className="flex items-center gap-2.5 text-14 text-fg">
                <EffectPill effect={effect} />
                tools
              </span>
              <Segmented<Decision>
                label={`Default for ${effect} tools`}
                value={defaults[effect]}
                onChange={(d) => setDefaults({ ...defaults, [effect]: d })}
                options={DECISION_OPTIONS}
              />
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-start gap-2 text-12 text-fg-muted">
          <ShieldAlert className="mt-px size-3.5 shrink-0 text-attention" />
          Once a task reads outside content — an email, a web page, a document — anything that
          writes, sends or deletes asks you first, whatever these settings say.
        </p>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-serif text-[24px] leading-tight text-fg">Rules</h3>
            <p className="mt-1 text-13 text-fg-muted">
              Checked top to bottom; the first match wins. A matching Block always wins. Drag to
              reorder.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              setRules((rs) => [
                ...rs,
                { id: newKey(), tool: "", decision: "ask", when: [], note: "", fresh: true },
              ])
            }
          >
            <Plus className="size-3.5" />
            Add rule
          </button>
        </div>
        {rules.length === 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] bg-sunken/70 px-5 py-4">
            <p className="min-w-0 flex-1 text-13 text-fg-muted">
              No rules yet, so the defaults above apply to everything. A rule reads like a sentence:
            </p>
            <p
              aria-hidden="true"
              className="inline-flex flex-wrap items-center gap-1.5 text-13 text-fg-muted"
            >
              When
              <span className="rounded-[6px] border border-line-strong bg-surface px-1.5 font-mono text-12 text-fg">
                gmail__send_email
              </span>
              <span>→</span>
              <span className="rounded-[6px] bg-ok-soft px-1.5 font-medium text-ok">Allow</span>
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {rules.map((r, i) => (
              <li
                key={r.id}
                onDragOver={(e) => {
                  if (dragging === null) return;
                  e.preventDefault();
                  setOver(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging !== null) setRules((rs) => move(rs, dragging, i));
                  setDragging(null);
                  setOver(null);
                }}
                className={cx(
                  "rounded-[16px] border bg-surface transition-[border-color,opacity] duration-150",
                  over === i && dragging !== null && dragging !== i
                    ? "border-accent"
                    : "border-line",
                  dragging === i && "opacity-50",
                  r.fresh && "border-accent/50",
                )}
              >
                <div className="flex items-start gap-2 py-3 pr-3 pl-1.5">
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      setDragging(i);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        e.preventDefault();
                        setRules((rs) => move(rs, i, i + (e.key === "ArrowUp" ? -1 : 1)));
                      }
                    }}
                    aria-label={`Rule ${i + 1}. Drag, or use arrow keys, to reorder`}
                    className="mt-0.5 grid h-7 w-6 shrink-0 cursor-grab place-items-center rounded-[6px] text-fg-faint hover:bg-hover hover:text-fg-muted active:cursor-grabbing"
                  >
                    <GripVertical className="size-3.5" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-14 text-fg-muted">
                      <span>When</span>
                      <Token
                        label="Tool"
                        mono
                        value={r.tool}
                        placeholder="gmail__send_email"
                        onChange={(v) => update(i, { tool: v })}
                        autoFocus={r.fresh && r.tool === ""}
                      />
                      {r.when.map((m, k) => (
                        <span
                          key={m.key}
                          className="inline-flex flex-wrap items-center gap-x-2 gap-y-2"
                        >
                          <span>and</span>
                          {m.op === "emailsEndWith" ? null : (
                            <Token
                              label="Field"
                              mono
                              value={m.path}
                              placeholder="to"
                              onChange={(v) => updateMatcher(i, k, { path: v })}
                            />
                          )}
                          <select
                            aria-label="Condition"
                            value={m.op}
                            onChange={(e) =>
                              updateMatcher(i, k, { op: e.target.value as ArgMatcher["op"] })
                            }
                            className="h-7 rounded-[6px] border border-transparent bg-transparent px-1 text-14 text-fg-muted outline-none hover:border-line focus:border-accent"
                          >
                            {OPS.map((o) => (
                              <option key={o.op} value={o.op}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <Token
                            label="Value"
                            value={m.raw}
                            placeholder={OPS.find((o) => o.op === m.op)?.hint ?? ""}
                            onChange={(v) => updateMatcher(i, k, { raw: v })}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm size-6"
                            aria-label="Remove condition"
                            onClick={() => update(i, { when: r.when.filter((_, n) => n !== k) })}
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                      <span aria-hidden="true">→</span>
                      <Segmented<Decision>
                        label={`Decision for rule ${i + 1}`}
                        size="sm"
                        value={r.decision}
                        onChange={(d) => update(i, { decision: d })}
                        options={DECISION_OPTIONS}
                      />
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {r.note.startsWith("Learned:") ? (
                        <Pill tone="ok" title="Added from your approvals. Remove it any time.">
                          Learned
                        </Pill>
                      ) : null}
                      {r.tool && !/[*?]/.test(r.tool) ? (
                        <span className="text-12 text-fg-faint">{humanToolName(r.tool)}</span>
                      ) : r.tool ? (
                        <span className="text-12 text-fg-faint">Pattern · * matches anything</span>
                      ) : null}
                      <button
                        type="button"
                        className="text-12 font-medium text-accent hover:underline"
                        onClick={() =>
                          update(i, {
                            when: [
                              ...r.when,
                              { key: newKey(), path: "", op: "allEndWith", raw: "" },
                            ],
                          })
                        }
                      >
                        + Condition
                      </button>
                      <input
                        aria-label="Note shown as the reason"
                        className="h-7 min-w-40 flex-1 rounded-[6px] border border-transparent bg-transparent px-1.5 text-12 text-fg-muted outline-none placeholder:text-fg-faint hover:border-line focus:border-accent"
                        placeholder="Add a note (shown as the reason)"
                        value={r.note}
                        onChange={(e) => update(i, { note: e.target.value })}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm shrink-0"
                    aria-label={`Remove rule ${i + 1}`}
                    onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div
        className={cx(
          "slip sticky bottom-4 z-10 flex items-center gap-3 rounded-full py-2 pr-2 pl-5 transition-opacity duration-150",
          dirty || error ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!(dirty || error)}
      >
        {error ? (
          <span role="alert" className="min-w-0 flex-1 text-13 text-danger">
            {error}
          </span>
        ) : (
          <span className="flex-1 text-13 text-fg-muted">Unsaved changes</span>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={saving}
          onClick={() => policy.data && load(policy.data)}
          tabIndex={dirty ? 0 : -1}
        >
          Discard
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void save()}
          tabIndex={dirty ? 0 : -1}
        >
          {saving ? "Saving…" : "Save rules"}
        </button>
      </div>
    </div>
  );
}
