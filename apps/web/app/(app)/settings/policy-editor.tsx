"use client";

import type { ArgMatcher, Decision, Effect, PolicyDefaults, PolicyRule } from "@synapse/core";
import { useCallback, useEffect, useState } from "react";
import { EffectBadge } from "@/components/badges";
import { ErrorNote, Section, Spinner } from "@/components/page";
import { useToast } from "@/components/toast";
import { api, errorMessage, type Policy } from "@/lib/api";
import { useApi } from "@/lib/use-api";

const EFFECTS: Effect[] = ["read", "write", "send", "destructive"];
const DECISIONS: Decision[] = ["allow", "ask", "block"];
const OPS: ArgMatcher["op"][] = ["equals", "in", "allEndWith", "matches"];
const OP_HINT: Record<ArgMatcher["op"], string> = {
  equals: 'JSON value, e.g. "main" or 42',
  in: 'JSON array, e.g. ["a","b"] (or comma-separated)',
  allEndWith: "Comma-separated suffixes, e.g. @acme.com",
  matches: "Regular expression",
};

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
          : m.op === "allEndWith"
            ? m.value.join(", ")
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
  if (!m.path.trim()) throw new Error(`${where}: argument path is required`);
  const path = m.path.trim();
  switch (m.op) {
    case "equals": {
      try {
        return { path, op: "equals", value: JSON.parse(m.raw) };
      } catch {
        return { path, op: "equals", value: m.raw };
      }
    }
    case "in": {
      try {
        const v = JSON.parse(m.raw);
        if (Array.isArray(v)) return { path, op: "in", value: v };
      } catch {
        // fall through to comma-separated
      }
      return { path, op: "in", value: splitList(m.raw) };
    }
    case "allEndWith": {
      const value = splitList(m.raw);
      if (value.length === 0) throw new Error(`${where}: give at least one suffix`);
      return { path, op: "allEndWith", value };
    }
    case "matches":
      try {
        new RegExp(m.raw);
      } catch {
        throw new Error(`${where}: invalid regular expression`);
      }
      return { path, op: "matches", value: m.raw };
  }
}

function fromDraft(rules: DraftRule[]): PolicyRule[] {
  return rules.map((r, i) => {
    const where = `Rule ${i + 1}`;
    if (!r.tool.trim()) throw new Error(`${where}: tool pattern is required`);
    const rule: PolicyRule = { id: r.id, tool: r.tool.trim(), decision: r.decision };
    if (r.when.length) rule.when = r.when.map((m) => toMatcher(m, where));
    if (r.note.trim()) rule.note = r.note.trim();
    return rule;
  });
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function PolicyEditor() {
  const toast = useToast();
  const policy = useApi(() => api.policy());
  const [defaults, setDefaults] = useState<PolicyDefaults | null>(null);
  const [rules, setRules] = useState<DraftRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((p: Policy) => {
    setDefaults(p.defaults);
    setRules(p.rules.map(toDraft));
  }, []);

  useEffect(() => {
    if (policy.data) load(policy.data);
  }, [policy.data, load]);

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
      const saved = await api.savePolicy({ defaults, rules: parsed });
      load(saved);
      toast("Policy saved", "success");
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

  return (
    <Section
      title="Approval policy"
      description={
        <>
          Enforced in code on every tool call. Once a run reads untrusted content (an email, a web
          page, a document), anything that writes, sends or deletes always asks — whatever these
          rules say.
        </>
      }
      footer={
        <>
          {error ? (
            <span role="alert" className="mr-auto text-danger-fg">
              {error}
            </span>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={saving || !policy.data}
            onClick={() => policy.data && load(policy.data)}
          >
            Reset
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || !defaults}
            onClick={save}
          >
            {saving ? "Saving…" : "Save policy"}
          </button>
        </>
      }
    >
      {policy.error ? <ErrorNote error={errorMessage(policy.error)} /> : null}
      {!defaults ? (
        policy.loading ? (
          <Spinner />
        ) : null
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 font-medium">Defaults by effect</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {EFFECTS.map((effect) => (
                <div key={effect}>
                  <label htmlFor={`def-${effect}`} className="mb-1 block">
                    <EffectBadge effect={effect} />
                  </label>
                  <select
                    id={`def-${effect}`}
                    className="input"
                    value={defaults[effect]}
                    onChange={(e) =>
                      setDefaults({ ...defaults, [effect]: e.target.value as Decision })
                    }
                  >
                    {DECISIONS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h3 className="font-medium">Rules</h3>
                <p className="text-xs text-fg-muted">
                  First match wins, except any matching <b>block</b> rule always wins. Tool patterns
                  are globs like <code>github__*</code>.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  setRules((rs) => [
                    ...rs,
                    { id: newKey(), tool: "", decision: "ask", when: [], note: "" },
                  ])
                }
              >
                + Add rule
              </button>
            </div>
            {rules.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-fg-muted">
                No rules — defaults apply.
              </p>
            ) : (
              <ol className="space-y-3">
                {rules.map((r, i) => (
                  <li key={r.id} className="rounded-md border border-border bg-subtle p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <span className="w-5 pb-1.5 text-xs text-fg-faint tabular-nums">{i + 1}</span>
                      <div className="min-w-40 flex-1">
                        <label htmlFor={`r-${r.id}-tool`} className="label">
                          Tool
                        </label>
                        <input
                          id={`r-${r.id}-tool`}
                          className="input font-mono text-[13px]"
                          placeholder="gmail__send_*"
                          value={r.tool}
                          onChange={(e) => update(i, { tool: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`r-${r.id}-dec`} className="label">
                          Decision
                        </label>
                        <select
                          id={`r-${r.id}-dec`}
                          className="input w-auto"
                          value={r.decision}
                          onChange={(e) => update(i, { decision: e.target.value as Decision })}
                        >
                          {DECISIONS.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="btn btn-sm"
                          aria-label={`Move rule ${i + 1} up`}
                          disabled={i === 0}
                          onClick={() => setRules((rs) => move(rs, i, i - 1))}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          aria-label={`Move rule ${i + 1} down`}
                          disabled={i === rules.length - 1}
                          onClick={() => setRules((rs) => move(rs, i, i + 1))}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          aria-label={`Remove rule ${i + 1}`}
                          onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {r.when.length > 0 ? (
                      <ul className="mt-3 space-y-2 pl-7">
                        {r.when.map((m, k) => (
                          <li key={m.key} className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-fg-faint">
                              {k === 0 ? "when" : "and"}
                            </span>
                            <input
                              aria-label="Argument path"
                              className="input w-36 font-mono text-[13px]"
                              placeholder="to.0"
                              value={m.path}
                              onChange={(e) => updateMatcher(i, k, { path: e.target.value })}
                            />
                            <select
                              aria-label="Operator"
                              className="input w-auto"
                              value={m.op}
                              onChange={(e) =>
                                updateMatcher(i, k, { op: e.target.value as ArgMatcher["op"] })
                              }
                            >
                              {OPS.map((op) => (
                                <option key={op} value={op}>
                                  {op}
                                </option>
                              ))}
                            </select>
                            <input
                              aria-label="Value"
                              className="input min-w-40 flex-1 font-mono text-[13px]"
                              placeholder={OP_HINT[m.op]}
                              title={OP_HINT[m.op]}
                              value={m.raw}
                              onChange={(e) => updateMatcher(i, k, { raw: e.target.value })}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label="Remove condition"
                              onClick={() => update(i, { when: r.when.filter((_, n) => n !== k) })}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2 pl-7">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          update(i, {
                            when: [...r.when, { key: newKey(), path: "", op: "equals", raw: "" }],
                          })
                        }
                      >
                        + Condition
                      </button>
                      <input
                        aria-label="Note"
                        className="input min-w-40 flex-1"
                        placeholder="Note (shown as the reason)"
                        value={r.note}
                        onChange={(e) => update(i, { note: e.target.value })}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
