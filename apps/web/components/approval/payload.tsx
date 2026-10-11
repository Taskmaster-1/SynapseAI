"use client";

import type { ReactNode } from "react";
import { Switch } from "@/components/ui";
import { cx, humanize } from "@/lib/format";

type Obj = Record<string, unknown>;

/** Deep equality for JSON values, ignoring object key order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameJson(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => k in b && sameJson(a[k], b[k]));
  }
  return false;
}

export function isPlainObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isPrimitive = (v: unknown) =>
  v === null || ["string", "number", "boolean"].includes(typeof v);

const EMAIL_HEAD = ["from", "to", "cc", "bcc", "subject"] as const;
const BODY_KEYS = ["body", "text", "message", "content", "html"];

/** `to` plus a subject or body reads as an email. */
export function isEmailLike(v: unknown): v is Obj {
  if (!isPlainObject(v)) return false;
  const hasTo = ["to", "recipient", "recipients"].some((k) => k in v);
  return hasTo && ("subject" in v || BODY_KEYS.some((k) => k in v));
}

function label(key: string) {
  if (key === "cc" || key === "bcc") return key.toUpperCase();
  return humanize(key);
}

function Chips({ items }: { items: unknown[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((x, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          key={i}
          className="inline-flex max-w-full items-center rounded-full border border-line bg-surface px-2 py-px text-13 break-all text-fg"
        >
          {String(x)}
        </span>
      ))}
    </span>
  );
}

function Scalar({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="text-fg-faint italic">empty</span>;
  if (typeof value === "boolean")
    return <span className="font-mono text-13 text-fg">{value ? "Yes" : "No"}</span>;
  if (typeof value === "number")
    return <span className="tabular font-mono text-13 text-fg">{value}</span>;
  const s = String(value);
  if (s === "") return <span className="text-fg-faint italic">empty</span>;
  if (s.includes("\n") || s.length > 140) {
    return (
      <div className="max-h-72 overflow-auto rounded-control bg-sunken px-3 py-2.5 text-14 leading-relaxed whitespace-pre-wrap break-words text-fg">
        {s}
      </div>
    );
  }
  return <span className="break-words text-fg">{s}</span>;
}

export function Value({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (isPrimitive(value)) return <Scalar value={value} />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-fg-faint italic">none</span>;
    if (value.every(isPrimitive)) return <Chips items={value} />;
    return (
      <ol className="space-y-2">
        {value.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional data
          <li key={i} className="border-l border-line-strong pl-3">
            <div className="eyebrow mb-1">Item {i + 1}</div>
            <Value value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return <span className="text-fg-faint italic">empty</span>;
    return (
      <div className={cx(depth > 0 && "border-l border-line-strong pl-3")}>
        <Fields obj={value} depth={depth} />
      </div>
    );
  }
  return <span className="font-mono text-13">{String(value)}</span>;
}

function Fields({ obj, depth = 0, skip = [] }: { obj: Obj; depth?: number; skip?: string[] }) {
  const keys = Object.keys(obj).filter((k) => !skip.includes(k));
  if (keys.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-[minmax(72px,max-content)_1fr]">
      {keys.map((k) => (
        <div key={k} className="contents">
          <dt className="pt-px text-13 text-fg-muted">{label(k)}</dt>
          <dd className="min-w-0 text-14">
            <Value value={obj[k]} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function asList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];
}

function EmailView({ obj }: { obj: Obj }) {
  const head = EMAIL_HEAD.filter((k) => k in obj);
  const bodyKey = BODY_KEYS.find((k) => k in obj);
  const rest = Object.keys(obj).filter(
    (k) => !(EMAIL_HEAD as readonly string[]).includes(k) && k !== bodyKey,
  );
  return (
    <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
      <dl className="divide-y divide-line">
        {head.map((k) => (
          <div key={k} className="flex items-baseline gap-3 px-3.5 py-2">
            <dt className="w-14 shrink-0 text-13 text-fg-muted">{label(k)}</dt>
            <dd className={cx("min-w-0 flex-1 text-14", k === "subject" && "font-medium")}>
              {k === "subject" ? <Scalar value={obj[k]} /> : <Chips items={asList(obj[k])} />}
            </dd>
          </div>
        ))}
      </dl>
      {bodyKey ? (
        <div className="border-t border-line px-3.5 py-3 text-14 leading-relaxed whitespace-pre-wrap break-words text-fg">
          {typeof obj[bodyKey] === "string" ? (
            (obj[bodyKey] as string)
          ) : (
            <Value value={obj[bodyKey]} />
          )}
        </div>
      ) : null}
      {rest.length > 0 ? (
        <div className="border-t border-line px-3.5 py-3">
          <Fields obj={obj} skip={[...EMAIL_HEAD, ...(bodyKey ? [bodyKey] : [])]} />
        </div>
      ) : null}
    </div>
  );
}

/** Tool input rendered as something a person reads, not JSON. */
export function PayloadView({ input }: { input: unknown }) {
  if (isEmailLike(input)) return <EmailView obj={input} />;
  if (isPlainObject(input)) {
    if (Object.keys(input).length === 0)
      return <p className="text-13 text-fg-muted">No arguments.</p>;
    return <Fields obj={input} />;
  }
  return <Value value={input} />;
}

// ---------- Editing ----------

export type FieldDraft =
  | { kind: "string"; text: string; multiline: boolean }
  | { kind: "number"; text: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "list"; text: string }
  | { kind: "json"; text: string };

export type Drafts = Record<string, FieldDraft>;

export function toDrafts(obj: Obj): Drafts {
  const out: Drafts = {};
  let entries = Object.entries(obj);
  if (isEmailLike(obj)) {
    // Edit an email in the order you'd read it: headers, then the body.
    const rank = (k: string) => {
      const h = (EMAIL_HEAD as readonly string[]).indexOf(k);
      return h >= 0 ? h : BODY_KEYS.includes(k) ? 10 : 20;
    };
    entries = entries.sort(([a], [b]) => rank(a) - rank(b));
  }
  for (const [k, v] of entries) {
    if (typeof v === "string")
      out[k] = {
        kind: "string",
        text: v,
        multiline: v.includes("\n") || v.length > 80 || BODY_KEYS.includes(k),
      };
    else if (typeof v === "number") out[k] = { kind: "number", text: String(v) };
    else if (typeof v === "boolean") out[k] = { kind: "boolean", value: v };
    else if (Array.isArray(v) && v.every((x) => typeof x === "string"))
      out[k] = { kind: "list", text: v.join(", ") };
    else out[k] = { kind: "json", text: JSON.stringify(v, null, 2) };
  }
  return out;
}

export function fromDrafts(d: Drafts): { value: Obj } | { error: string } {
  const value: Obj = {};
  for (const [k, f] of Object.entries(d)) {
    switch (f.kind) {
      case "string":
        value[k] = f.text;
        break;
      case "number": {
        const n = Number(f.text);
        if (f.text.trim() === "" || Number.isNaN(n))
          return { error: `${label(k)} must be a number.` };
        value[k] = n;
        break;
      }
      case "boolean":
        value[k] = f.value;
        break;
      case "list":
        value[k] = f.text
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "json":
        try {
          value[k] = JSON.parse(f.text);
        } catch {
          return { error: `${label(k)} isn't valid JSON.` };
        }
    }
  }
  return { value };
}

export function PayloadEditor({
  drafts,
  onChange,
  idPrefix,
}: {
  drafts: Drafts;
  onChange: (d: Drafts) => void;
  idPrefix: string;
}) {
  const set = (k: string, f: FieldDraft) => onChange({ ...drafts, [k]: f });
  return (
    <div className="space-y-3.5">
      {Object.entries(drafts).map(([k, f], i) => {
        const id = `${idPrefix}-${k}`;
        return (
          <div key={k}>
            <label
              htmlFor={id}
              className="mb-1.5 flex items-baseline justify-between text-13 text-fg-muted"
            >
              <span>{label(k)}</span>
              {f.kind === "list" ? (
                <span className="text-12 text-fg-faint">comma-separated</span>
              ) : null}
              {f.kind === "json" ? <span className="text-12 text-fg-faint">JSON</span> : null}
            </label>
            {f.kind === "string" ? (
              f.multiline ? (
                <textarea
                  id={id}
                  data-autofocus={i === 0 ? true : undefined}
                  className="input min-h-28 resize-y"
                  rows={Math.min(14, Math.max(4, f.text.split("\n").length + 1))}
                  value={f.text}
                  onChange={(e) => set(k, { ...f, text: e.target.value })}
                />
              ) : (
                <input
                  id={id}
                  className="input"
                  value={f.text}
                  onChange={(e) => set(k, { ...f, text: e.target.value })}
                />
              )
            ) : f.kind === "number" ? (
              <input
                id={id}
                className="input tabular w-40"
                inputMode="decimal"
                value={f.text}
                onChange={(e) => set(k, { ...f, text: e.target.value })}
              />
            ) : f.kind === "boolean" ? (
              <div className="flex items-center gap-2">
                <Switch
                  checked={f.value}
                  label={label(k)}
                  onChange={(v) => set(k, { ...f, value: v })}
                />
                <span className="text-13 text-fg">{f.value ? "Yes" : "No"}</span>
              </div>
            ) : f.kind === "list" ? (
              <input
                id={id}
                className="input"
                value={f.text}
                onChange={(e) => set(k, { ...f, text: e.target.value })}
              />
            ) : (
              <textarea
                id={id}
                spellCheck={false}
                className="input min-h-24 resize-y font-mono text-12"
                rows={Math.min(14, f.text.split("\n").length + 1)}
                value={f.text}
                onChange={(e) => set(k, { ...f, text: e.target.value })}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
