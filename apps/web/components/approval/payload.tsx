"use client";

import type { ReactNode } from "react";
import { EmailAttachments } from "@/components/task/files";
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
          className="inline-flex max-w-full items-center rounded-full bg-sunken px-2.5 py-px text-13 [overflow-wrap:anywhere] text-fg"
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
      <div className="scroll-thin max-h-72 overflow-auto border-l-2 border-line-strong py-0.5 pl-3 text-14 leading-relaxed whitespace-pre-wrap break-words text-fg">
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

function Recipients({ items }: { items: unknown[] }) {
  if (items.length === 0) return <span className="text-fg-faint italic">empty</span>;
  return (
    <span className="font-medium [overflow-wrap:anywhere] text-fg">
      {items.map((x) => String(x)).join(", ")}
    </span>
  );
}

/** An email reads like the letter it is: headers, then the body set like a page. */
function EmailView({ obj }: { obj: Obj }) {
  const head = EMAIL_HEAD.filter((k) => k in obj);
  const bodyKey = BODY_KEYS.find((k) => k in obj);
  const body = bodyKey ? obj[bodyKey] : undefined;
  const files = Array.isArray(obj.attachments)
    ? obj.attachments.filter((v): v is string => typeof v === "string")
    : [];
  const rest = Object.keys(obj).filter(
    (k) =>
      !(EMAIL_HEAD as readonly string[]).includes(k) &&
      k !== bodyKey &&
      !(k === "attachments" && files.length > 0),
  );
  const long = typeof body === "string" && body.length > 700;
  return (
    <div>
      <dl className="space-y-1.5">
        {head.map((k) => (
          <div key={k} className="flex items-baseline gap-3 sm:gap-4">
            <dt className="w-14 shrink-0 text-13 text-fg-muted sm:w-16">{label(k)}</dt>
            <dd className="min-w-0 flex-1 text-14">
              {k === "subject" ? <Scalar value={obj[k]} /> : <Recipients items={asList(obj[k])} />}
            </dd>
          </div>
        ))}
      </dl>
      {bodyKey ? (
        typeof body === "string" ? (
          <div
            className={cx(
              "mt-5 font-serif whitespace-pre-wrap break-words text-fg",
              long
                ? "scroll-thin max-h-[420px] overflow-auto text-[18px] leading-[1.45]"
                : "text-[20px] leading-[1.35] sm:text-[22px]",
            )}
          >
            {body.trim() ? (
              body
                .trim()
                .split(/\n\s*\n/)
                .map((para, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of a static body
                  <p key={i} className={cx(i > 0 && "mt-[0.6em]")}>
                    {para}
                  </p>
                ))
            ) : (
              <span className="text-fg-faint italic">empty</span>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <Value value={body} />
          </div>
        )
      ) : null}
      {files.length > 0 ? (
        <div className="mt-5">
          <p className="mb-2 text-13 text-fg-muted">
            {files.length === 1 ? "1 attachment" : `${files.length} attachments`}
          </p>
          <EmailAttachments ids={files} />
        </div>
      ) : null}
      {rest.length > 0 ? (
        <div className="mt-5 border-t border-dashed border-line-strong pt-4">
          <Fields
            obj={obj}
            skip={[
              ...EMAIL_HEAD,
              ...(bodyKey ? [bodyKey] : []),
              ...(files.length > 0 ? ["attachments"] : []),
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Where a Slack post goes, in words: "#general", "Direct message to U0…". */
function slackWhere(channel: unknown): string {
  const v = typeof channel === "string" ? channel.trim() : "";
  if (/^[UW][A-Z0-9]{6,}$/.test(v)) return `Direct message to ${v}`;
  if (/^D[A-Z0-9]{6,}$/.test(v)) return "Direct message";
  if (/^[CG][A-Z0-9]{6,}$/.test(v)) return `Channel ${v}`;
  return `#${v.replace(/^#/, "")}`;
}

/** A Slack post as it will appear: where it lands, as you, then the message. */
function SlackPostView({ obj }: { obj: Obj }) {
  const text = typeof obj.text === "string" ? obj.text : "";
  const thread = typeof obj.thread_ts === "string" && obj.thread_ts ? obj.thread_ts : null;
  const rest = Object.keys(obj).filter((k) => !["channel", "text", "thread_ts"].includes(k));
  return (
    <div>
      <dl className="space-y-1.5">
        <div className="flex items-baseline gap-3 sm:gap-4">
          <dt className="w-14 shrink-0 text-13 text-fg-muted sm:w-16">Where</dt>
          <dd className="min-w-0 flex-1 text-14 font-medium [overflow-wrap:anywhere] text-fg">
            {slackWhere(obj.channel)}
            {thread ? <span className="font-normal text-fg-muted"> · in a thread</span> : null}
          </dd>
        </div>
        <div className="flex items-baseline gap-3 sm:gap-4">
          <dt className="w-14 shrink-0 text-13 text-fg-muted sm:w-16">As</dt>
          <dd className="min-w-0 flex-1 text-14 text-fg">You, in Slack</dd>
        </div>
      </dl>
      <div className="mt-5 font-serif text-[20px] leading-[1.35] whitespace-pre-wrap break-words text-fg sm:text-[22px]">
        {text.trim() ? text.trim() : <span className="text-fg-faint italic">empty</span>}
      </div>
      {rest.length > 0 ? (
        <div className="mt-5 border-t border-dashed border-line-strong pt-4">
          <Fields obj={obj} skip={["channel", "text", "thread_ts"]} />
        </div>
      ) : null}
    </div>
  );
}

/** A new document reads like one: the title, then the body set like a page. */
function DocView({ obj }: { obj: Obj }) {
  const body = typeof obj.body === "string" ? obj.body.trim() : "";
  return (
    <div>
      <p className="eyebrow mb-1.5">New Google Doc</p>
      <h3 className="font-serif text-[24px] leading-[1.15] break-words text-fg">
        {String(obj.title ?? "") || <span className="text-fg-faint italic">Untitled</span>}
      </h3>
      <div className="scroll-thin mt-4 max-h-[420px] overflow-auto border-l-2 border-line-strong pl-3 text-14 leading-relaxed whitespace-pre-wrap break-words text-fg">
        {body || <span className="text-fg-faint italic">empty</span>}
      </div>
    </div>
  );
}

/** "'Q4 costs'!A1:C3" → "Q4 costs › A1:C3". */
function prettyRange(range: string): string {
  const bang = range.lastIndexOf("!");
  const unquote = (s: string) => s.replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
  return bang < 0 ? unquote(range) : `${unquote(range.slice(0, bang))} › ${range.slice(bang + 1)}`;
}

const SHEET_ROWS_SHOWN = 50;

/** Rows as a small grid. Formulas are set in mono so they stand out from plain values. */
function CellTable({ rows, header }: { rows: unknown[][]; header?: unknown[] }) {
  const shown = rows.slice(0, SHEET_ROWS_SHOWN);
  const width = Math.max(header?.length ?? 0, ...shown.map((r) => r.length), 1);
  const cell = (v: unknown, key: number, head = false) => {
    const s =
      v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    const formula = typeof v === "string" && v.trimStart().startsWith("=");
    const Tag = head ? "th" : "td";
    return (
      <Tag
        key={key}
        className={cx(
          "max-w-56 border border-line px-2 py-1 text-left align-top break-words",
          head ? "bg-sunken font-medium text-fg" : "text-fg",
          typeof v === "number" && "tabular text-right",
          formula && "font-mono text-12 text-accent",
        )}
      >
        {s}
      </Tag>
    );
  };
  const pad = (r: unknown[]) => [...r, ...Array(Math.max(0, width - r.length)).fill("")];
  return (
    <div>
      <div className="scroll-thin max-h-80 overflow-auto rounded-[8px] border border-line">
        <table className="w-full border-collapse text-13 [&_td:first-child]:border-l-0 [&_th:first-child]:border-l-0">
          {header?.length ? (
            <thead>
              <tr>{pad(header).map((v, i) => cell(v, i, true))}</tr>
            </thead>
          ) : null}
          <tbody>
            {shown.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
              <tr key={i}>{pad(r).map((v, j) => cell(v, j))}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length ? (
        <p className="mt-1.5 text-12 text-fg-muted">
          and {rows.length - shown.length} more {rows.length - shown.length === 1 ? "row" : "rows"}
        </p>
      ) : null}
    </div>
  );
}

const asRows = (v: unknown): unknown[][] =>
  Array.isArray(v) ? v.map((r) => (Array.isArray(r) ? r : [r])) : [];

/** A spreadsheet write: which sheet and range, then the rows as they'll land. */
function SheetView({ obj, tool }: { obj: Obj; tool: string }) {
  const create = tool === "sheets_create";
  const rows = asRows(tool === "sheets_update" ? obj.values : obj.rows);
  const header = create && Array.isArray(obj.header) ? obj.header : undefined;
  const title = String((create ? obj.title : obj.spreadsheetTitle) ?? "");
  const range = typeof obj.range === "string" && obj.range.trim() ? obj.range.trim() : null;
  const where =
    tool === "sheets_update"
      ? `Overwrites ${range ? prettyRange(range) : "a range"}`
      : tool === "sheets_append"
        ? `Adds ${rows.length === 1 ? "1 row" : `${rows.length} rows`} at the end of ${range ? prettyRange(range) : "the first sheet"}`
        : "A new private spreadsheet in your Drive";
  const known = ["spreadsheet", "spreadsheetTitle", "title", "range", "rows", "values", "header"];
  const rest = Object.keys(obj).filter((k) => !known.includes(k));
  return (
    <div>
      <p className="eyebrow mb-1.5">{create ? "New Google Sheet" : "Google Sheet"}</p>
      <h3 className="font-serif text-[24px] leading-[1.15] break-words text-fg">
        {title || <span className="text-fg-faint italic">Untitled</span>}
      </h3>
      <p className="mt-1 text-13 text-fg-muted">{where}</p>
      {!create && typeof obj.spreadsheet === "string" ? (
        <p className="mt-0.5 truncate font-mono text-12 text-fg-faint" title={obj.spreadsheet}>
          {obj.spreadsheet}
        </p>
      ) : null}
      {rows.length || header?.length ? (
        <div className="mt-4">
          <CellTable rows={rows} {...(header ? { header } : {})} />
        </div>
      ) : null}
      {rest.length > 0 ? (
        <div className="mt-5 border-t border-dashed border-line-strong pt-4">
          <Fields obj={obj} skip={known} />
        </div>
      ) : null}
    </div>
  );
}

const REPEAT_LABELS: Record<string, string> = {
  none: "Once",
  daily: "Every day",
  weekdays: "Every weekday",
  weekly: "Every week",
  monthly: "Every month",
};

/**
 * When it fires, in the zone given, else at the offset the agent wrote, so it matches the
 * card's title (which the server writes in the user's zone).
 */
function scheduledTime(when: unknown, timezone: unknown): string {
  const s = typeof when === "string" ? when : "";
  const d = new Date(s);
  if (!s || Number.isNaN(d.getTime())) return s || "—";
  const parts = {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  } as const;
  if (typeof timezone === "string" && timezone) {
    try {
      return d.toLocaleString(undefined, { ...parts, timeZone: timezone, timeZoneName: "short" });
    } catch {}
  }
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(s);
  const offset = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  const local = new Date(d.getTime() + offset * 60_000).toLocaleString(undefined, {
    ...parts,
    timeZone: "UTC",
  });
  return `${local} ${offset === 0 ? "UTC" : `UTC${m![1]}${m![2]}:${m![3]}`}`;
}

/** Scheduling for later: what kind, when, how often, then the instructions as a page. */
function ScheduleView({ obj }: { obj: Obj }) {
  const reminder = obj.kind === "reminder";
  const repeat = typeof obj.repeat === "string" && obj.repeat ? obj.repeat : "none";
  const rows: [string, string][] = [
    ["When", scheduledTime(obj.when, obj.timezone)],
    ["Repeats", REPEAT_LABELS[repeat] ?? `Custom (${repeat})`],
    ["Then", reminder ? "Notify you" : "The agent carries out the instructions in this chat"],
  ];
  const text = typeof obj.instructions === "string" ? obj.instructions.trim() : "";
  return (
    <div>
      <p className="eyebrow mb-1.5">{reminder ? "Reminder" : "Scheduled task"}</p>
      <h3 className="font-serif text-[24px] leading-[1.15] break-words text-fg">
        {String(obj.title ?? "") || <span className="text-fg-faint italic">Untitled</span>}
      </h3>
      <dl className="mt-4 space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-3 sm:gap-4">
            <dt className="w-16 shrink-0 text-13 text-fg-muted">{k}</dt>
            <dd className="min-w-0 flex-1 text-14 text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="scroll-thin mt-4 max-h-[320px] overflow-auto border-l-2 border-line-strong pl-3 text-14 leading-relaxed whitespace-pre-wrap break-words text-fg">
        {text || <span className="text-fg-faint italic">empty</span>}
      </div>
    </div>
  );
}

const SHEET_WRITES = new Set(["sheets_append", "sheets_update", "sheets_create"]);

/** Tool input rendered as something a person reads, not JSON. `tool` picks a tailored view. */
export function PayloadView({ input, tool }: { input: unknown; tool?: string }) {
  if (tool === "schedule_task" && isPlainObject(input)) return <ScheduleView obj={input} />;
  if (tool === "slack_post_message" && isPlainObject(input)) return <SlackPostView obj={input} />;
  if (tool === "drive_create_doc" && isPlainObject(input)) return <DocView obj={input} />;
  if (tool && SHEET_WRITES.has(tool) && isPlainObject(input))
    return <SheetView obj={input} tool={tool} />;
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
                  className={cx(
                    "input min-h-28 resize-y",
                    BODY_KEYS.includes(k) && "font-serif text-[19px] leading-[1.4]",
                  )}
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
