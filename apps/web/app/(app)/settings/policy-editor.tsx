"use client";

import type { ArgMatcher, Decision, Effect, PolicyDefaults } from "@synapse/core";
import { GripVertical, Plus, ShieldAlert, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { EffectPill, ErrorNote, Pill, Segmented, Skeleton } from "@/components/ui";
import { api, errorMessage, type TeamRule } from "@/lib/api";
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
  /** Team rules only: an Ask that a team admin, not the member, must decide. */
  approver?: boolean;
}

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function toDraft(rule: TeamRule): DraftRule {
  return {
    id: rule.id,
    tool: rule.tool,
    decision: rule.decision,
    approver: rule.approver === "admin",
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

function fromDraft(rules: DraftRule[]): TeamRule[] {
  return rules.map((r, i) => {
    const where = `Rule ${i + 1}`;
    if (!r.tool.trim()) throw new Error(`${where}: which tool does it apply to?`);
    const rule: TeamRule = { id: r.id, tool: r.tool.trim(), decision: r.decision };
    if (r.when.length) rule.when = r.when.map((m) => toMatcher(m, where));
    if (r.note.trim()) rule.note = r.note.trim();
    if (r.decision === "ask" && r.approver) rule.approver = "admin";
    return rule;
  });
}

/** Draft rules as compared for "unsaved changes". */
const comparable = (rules: DraftRule[]) =>
  rules.map(({ when, fresh: _f, approver, ...r }) => ({
    ...r,
    approver: r.decision === "ask" && !!approver,
    when: when.map(({ key: _k, ...m }) => m),
  }));

/** Rules as loaded by either scope: personal (with defaults) or the team's. */
interface Loaded {
  defaults: PolicyDefaults | null;
  rules: TeamRule[];
  canEdit: boolean;
}

function matcherText(m: ArgMatcher): string {
  const label = OPS.find((o) => o.op === m.op)?.label ?? m.op;
  const value = Array.isArray(m.value)
    ? m.value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ")
    : typeof m.value === "string"
      ? m.value
      : JSON.stringify(m.value);
  return m.op === "emailsEndWith" ? `${label} ${value}` : `${m.path} ${label} ${value}`;
}

/**
 * Team rules as sentences, for people who can't change them: members in the Team section,
 * and everyone above their own rules.
 */
export function TeamRulesReadOnly({ rules, intro }: { rules: TeamRule[]; intro?: ReactNode }) {
  return (
    <section aria-label="Team rules">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-[24px] leading-tight text-fg">Team rules</h3>
        <Pill tone="outline">Set by your team</Pill>
      </div>
      {intro ? <p className="mb-4 text-13 text-fg-muted">{intro}</p> : null}
      {rules.length === 0 ? (
        <p className="rounded-[16px] bg-sunken/70 px-5 py-4 text-13 text-fg-muted">
          Your team hasn't set any rules yet.
        </p>
      ) : (
        <ol className="divide-y divide-line rounded-[16px] border border-line bg-surface">
          {rules.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-3 text-14 text-fg-muted"
            >
              <span>When</span>
              <span className="rounded-[6px] border border-line-strong px-1.5 font-mono text-12 text-fg">
                {r.tool}
              </span>
              {(r.when ?? []).map((m) => (
                <span key={`${m.path}-${m.op}`} className="text-13">
                  and {matcherText(m)}
                </span>
              ))}
              <span aria-hidden="true">→</span>
              <Pill
                tone={r.decision === "allow" ? "ok" : r.decision === "ask" ? "attention" : "danger"}
              >
                {DECISION_OPTIONS.find((o) => o.value === r.decision)?.label}
                {r.approver === "admin" ? " · an admin decides" : ""}
              </Pill>
              {r.note ? <span className="w-full text-12 text-fg-faint">{r.note}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
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

/**
 * Approval rules editor. `scope="personal"` (default) edits your defaults and rules and
 * shows your team's rules above them, read-only. `scope="team"` edits the team's rules
 * (admins), with "an admin decides" on Ask rules; members see them read-only.
 */
export function PolicyEditor({
  prefillTool,
  scope = "personal",
}: {
  prefillTool?: string | null;
  scope?: "personal" | "team";
}) {
  const team = scope === "team";
  const toast = useToast();
  const policy = useApi<Loaded>(() =>
    team
      ? api.teamRules().then((r) => ({ defaults: null, rules: r.rules, canEdit: r.canEdit }))
      : api.policy().then((p) => ({ ...p, canEdit: true })),
  );
  // Personal scope: the team's rules, shown above yours (404 when not in a team).
  const teamAbove = useApi(() =>
    team ? Promise.resolve(null) : api.teamRules().catch(() => null),
  );
  const [defaults, setDefaults] = useState<PolicyDefaults | null>(null);
  const [rules, setRules] = useState<DraftRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const prefilled = useRef(false);

  const load = useCallback((p: Loaded) => {
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
    ? JSON.stringify({ d: policy.data.defaults, r: comparable(policy.data.rules.map(toDraft)) })
    : "";
  const current = JSON.stringify({ d: defaults, r: comparable(rules) });
  const dirty = policy.data !== undefined && saved !== current;

  async function save() {
    if (!team && !defaults) return;
    setError(null);
    let parsed: TeamRule[];
    try {
      parsed = fromDraft(rules);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setSaving(true);
    try {
      const next: Loaded = team
        ? await api.saveTeamRules(parsed).then((r) => ({ defaults: null, ...r }))
        : await api
            .savePolicy({ defaults: defaults!, rules: parsed })
            .then((p) => ({ ...p, canEdit: true }));
      policy.setData(next);
      load(next);
      toast(team ? "Team rules saved" : "Approval rules saved", "success");
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
  if (!policy.data || (!team && !defaults))
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
      </div>
    );
  // Members see their team's rules; only owners and admins change them.
  if (team && !policy.data.canEdit)
    return (
      <TeamRulesReadOnly
        rules={policy.data.rules}
        intro="These apply to every task you run, on top of your own rules. The strictest answer wins."
      />
    );

  return (
    <div className="space-y-10">
      {teamAbove.data ? (
        <TeamRulesReadOnly
          rules={teamAbove.data.rules}
          intro="Your team's rules apply first. Your own rules can make things stricter, never looser: the strictest answer wins."
        />
      ) : null}
      {defaults ? (
        <section>
          <h3 className="font-serif text-[24px] leading-tight text-fg">By default</h3>
          <p className="mt-1 mb-4 text-13 text-fg-muted">
            What happens when no rule below matches.
          </p>
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
      ) : null}

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-serif text-[24px] leading-tight text-fg">
              {team ? "Team rules" : teamAbove.data ? "Your rules" : "Rules"}
            </h3>
            <p className="mt-1 text-13 text-fg-muted">
              {team
                ? "Apply to everyone in the team, on top of their own rules; the strictest answer wins and a team Block can't be overridden. An Ask can need an admin to decide."
                : "Checked top to bottom; the first match wins. A matching Block always wins. Drag to reorder."}
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
              {team
                ? "No team rules yet, so everyone's own rules apply. A rule reads like a sentence:"
                : "No rules yet, so the defaults above apply to everything. A rule reads like a sentence:"}
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
                      {team && r.decision === "ask" ? (
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-13 text-fg-muted">
                          <input
                            type="checkbox"
                            className="size-3.5 accent-[var(--attention)]"
                            checked={!!r.approver}
                            onChange={(e) => update(i, { approver: e.target.checked })}
                          />
                          needs an admin
                        </label>
                      ) : null}
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
