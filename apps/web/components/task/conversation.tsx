"use client";

import type { UiMessage, UiPart } from "@synapse/core/ui";
import { ChevronRight, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";
import { approvalTitle } from "@/components/approval/approval-card";
import { Markdown } from "@/components/markdown";
import { BrandGlyph, EffectPill, Monogram, StepStatusIcon } from "@/components/ui";
import type { TaskRun } from "@/lib/api";
import {
  cx,
  formatCost,
  formatDateTime,
  formatDuration,
  formatTokens,
  humanToolName,
  splitToolName,
} from "@/lib/format";
import { stepsOf, type ToolPart, wasAsked } from "@/lib/steps";

type Block =
  | { kind: "text"; text: string; key: string }
  | { kind: "reasoning"; text: string; key: string }
  | { kind: "steps"; parts: ToolPart[]; key: string }
  | { kind: "asked"; part: ToolPart; key: string };

function blocksOf(parts: UiPart[]): Block[] {
  const out: Block[] = [];
  parts.forEach((p, i) => {
    if (p.type === "text") {
      if (p.text) out.push({ kind: "text", text: p.text, key: `t${i}` });
    } else if (p.type === "reasoning") {
      if (p.text) out.push({ kind: "reasoning", text: p.text, key: `r${i}` });
    } else if (wasAsked(p)) {
      out.push({ kind: "asked", part: p, key: p.toolCallId });
    } else {
      const last = out.at(-1);
      if (last?.kind === "steps") last.parts.push(p);
      else out.push({ kind: "steps", parts: [p], key: p.toolCallId });
    }
  });
  return out;
}

const LIVE = ["proposed", "approved", "executing"];

/**
 * One entry of the document: a margin label ("You", "Synapse") beside the text on wide
 * screens, stacked above it on narrow ones.
 */
function Entry({
  label,
  children,
  display = false,
}: {
  label: ReactNode;
  children: ReactNode;
  /** The label sits on the first line of large serif text. */
  display?: boolean;
}) {
  return (
    <div className="grid gap-y-2 md:grid-cols-[76px_minmax(0,1fr)] md:gap-x-6">
      <div
        className={cx(
          "eyebrow flex items-center gap-1.5 self-start md:justify-end",
          display ? "md:pt-[13px]" : "md:pt-[7px]",
        )}
      >
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const AGENT_LABEL = (
  <>
    <BrandGlyph className="size-3.5 text-fg" />
    Synapse
  </>
);

export function Conversation({
  messages,
  active,
  queuedId,
  renderAsked,
  onOpenStep,
}: {
  messages: UiMessage[];
  active: boolean;
  queuedId: string | null;
  renderAsked: (part: ToolPart, message: UiMessage) => ReactNode;
  onOpenStep: (toolCallId: string) => void;
}) {
  const last = messages.at(-1);
  const working =
    active &&
    (!last ||
      last.role === "user" ||
      last.parts.length === 0 ||
      (last.parts.at(-1)?.type === "tool" &&
        (last.parts.at(-1) as ToolPart).status !== "awaiting_approval"));
  return (
    <ol className="space-y-9" aria-label="Conversation">
      {messages.map((m, i) => (
        <li key={m.id} className="anim-row-in">
          {m.role === "user" ? (
            <UserMessage message={m} queued={m.id === queuedId} />
          ) : m.role === "handover" ? (
            <Handover message={m} />
          ) : (
            <AgentMessage
              message={m}
              continued={messages[i - 1]?.role === "assistant"}
              streaming={active && i === messages.length - 1}
              renderAsked={renderAsked}
              onOpenStep={onOpenStep}
            />
          )}
        </li>
      ))}
      {working ? (
        <li aria-live="polite" className="anim-row-in">
          <Entry label={last?.role === "assistant" ? null : AGENT_LABEL}>
            <p className="flex items-center gap-2.5 pt-1 text-14 text-fg-muted">
              <span className="flex gap-1" aria-hidden="true">
                <span className="anim-pulse size-1.5 rounded-full bg-fg" />
                <span className="anim-pulse size-1.5 rounded-full bg-fg [animation-delay:200ms]" />
                <span className="anim-pulse size-1.5 rounded-full bg-fg [animation-delay:400ms]" />
              </span>
              <span className="font-serif text-[17px] italic">Working…</span>
            </p>
          </Entry>
        </li>
      ) : null}
    </ol>
  );
}

function textOf(m: UiMessage) {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** What you asked, set like the brief at the top of a page. Long pastes fall back to body type. */
function UserMessage({ message, queued }: { message: UiMessage; queued: boolean }) {
  const text = textOf(message);
  const short = text.length <= 280 && !text.includes("\n\n");
  return (
    <Entry label="You" display={short}>
      <p
        className={cx(
          "max-w-[64ch] break-words whitespace-pre-wrap text-fg",
          short
            ? "font-serif text-[23px] leading-[1.3] tracking-[-0.005em] md:text-[26px]"
            : "border-l-2 border-fg pl-4 text-14 leading-[1.65]",
        )}
      >
        {text}
      </p>
      {queued ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-12 text-fg-faint">
          <span className="anim-pulse size-1.5 rounded-full bg-attention" />
          Queued · the agent will read this at its next step
        </p>
      ) : null}
    </Entry>
  );
}

function Handover({ message }: { message: UiMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center gap-3 text-fg-faint"
      >
        <span className="h-px flex-1 border-t border-dashed border-line-strong" />
        <span className="eyebrow inline-flex items-center gap-1 group-hover:text-fg-muted">
          Earlier conversation summarised
          <ChevronRight
            className={cx("size-3 transition-transform duration-150", open && "rotate-90")}
          />
        </span>
        <span className="h-px flex-1 border-t border-dashed border-line-strong" />
      </button>
      {open ? (
        <div className="anim-row-in slip mx-auto mt-4 max-w-[64ch] px-5 py-4 text-fg-muted">
          <Markdown text={textOf(message)} />
        </div>
      ) : null}
    </div>
  );
}

function AgentMessage({
  message,
  continued,
  streaming,
  renderAsked,
  onOpenStep,
}: {
  message: UiMessage;
  /** Follows another agent message: the margin label is already there. */
  continued: boolean;
  streaming: boolean;
  renderAsked: (part: ToolPart, message: UiMessage) => ReactNode;
  onOpenStep: (toolCallId: string) => void;
}) {
  const blocks = blocksOf(message.parts);
  if (blocks.length === 0) return null;
  return (
    <Entry label={continued ? null : AGENT_LABEL}>
      <div className="space-y-4">
        {blocks.map((b, i) => {
          const isLast = i === blocks.length - 1;
          switch (b.kind) {
            case "text":
              return (
                <Markdown
                  key={b.key}
                  text={b.text}
                  streaming={streaming && isLast}
                  className="max-w-[68ch] text-16 leading-[1.7]"
                />
              );
            case "reasoning":
              return <Reasoning key={b.key} text={b.text} live={streaming && isLast} />;
            case "steps":
              return <StepGroup key={b.key} parts={b.parts} onOpenStep={onOpenStep} />;
            case "asked": {
              // Null when another block already shows this call (a grouped checklist).
              const node = renderAsked(b.part, message);
              return node == null ? null : <div key={b.key}>{node}</div>;
            }
          }
          return null;
        })}
      </div>
    </Entry>
  );
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 font-serif text-[17px] text-fg-muted italic hover:text-fg"
      >
        <Sparkles className={cx("size-3.5", live && "anim-pulse")} />
        {live ? "Thinking…" : "Thought it through"}
        <ChevronRight
          className={cx("size-3 transition-transform duration-150", open && "rotate-90")}
        />
      </button>
      {open ? (
        <div className="anim-row-in mt-2 max-w-[68ch] border-l border-dashed border-line-strong pl-4 text-13 leading-[1.65] whitespace-pre-wrap text-fg-muted">
          {text}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The agent's steps as a small timeline: tool monogram, what it did, status. Short or live
 * groups are open; long finished ones fold to "Used 5 tools · github, linear ▸".
 */
export function StepGroup({
  parts,
  onOpenStep,
}: {
  parts: ToolPart[];
  onOpenStep: (id: string) => void;
}) {
  const running = parts.some((p) => LIVE.includes(p.status));
  const problems = parts.filter((p) => ["failed", "denied", "unknown"].includes(p.status)).length;
  const foldable = parts.length > 3;
  const [open, setOpen] = useState(!foldable || running);
  const sources = Array.from(new Set(parts.map((p) => splitToolName(p.name).source ?? "built-in")));
  return (
    <div>
      {foldable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="group mb-1 flex items-center gap-2 py-1 text-left text-13 text-fg-muted hover:text-fg"
        >
          <span className="flex -space-x-1">
            {sources.slice(0, 3).map((s) => (
              <Monogram
                key={s}
                name={s === "built-in" ? "Synapse" : s}
                size={18}
                className="ring-2 ring-canvas"
              />
            ))}
          </span>
          <span className="min-w-0 truncate">
            {running ? "Using" : "Used"} {parts.length} tools
            <span className="text-fg-faint"> · {sources.join(", ")}</span>
            {problems ? <span className="text-danger"> · {problems} didn't go through</span> : null}
          </span>
          <ChevronRight
            className={cx(
              "size-3.5 shrink-0 text-fg-faint transition-transform duration-150",
              open && "rotate-90",
            )}
          />
        </button>
      ) : null}
      {open ? (
        <ol className={cx("relative", foldable && "anim-row-in")}>
          {parts.length > 1 ? (
            <span
              aria-hidden="true"
              className="absolute top-[18px] bottom-[18px] left-[10.5px] w-px bg-line-strong"
            />
          ) : null}
          {parts.map((p) => (
            <li key={p.toolCallId} className="anim-row-in relative">
              <StepRow part={p} onOpen={() => onOpenStep(p.toolCallId)} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function StepRow({ part: p, onOpen }: { part: ToolPart; onOpen: () => void }) {
  const live = LIVE.includes(p.status);
  const { source } = splitToolName(p.name);
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Show in Activity"
      className="group -mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-[8px] px-2 py-[7px] text-left hover:bg-hover"
    >
      <span className="relative grid shrink-0 place-items-center">
        {live ? (
          <span
            aria-hidden="true"
            className="m-ring absolute inset-0 rounded-[6px] bg-accent/40 [animation-duration:1.8s]"
          />
        ) : null}
        <Monogram
          name={source ?? "Synapse"}
          size={22}
          className="relative ring-[3px] ring-canvas"
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-14">
        <span className={cx("text-fg", live && "font-medium")}>
          {approvalTitle(p.preview, p.name)}
        </span>
        {p.preview ? (
          <span className="hidden text-13 text-fg-faint sm:inline"> · {humanToolName(p.name)}</span>
        ) : null}
      </span>
      <span className="hidden sm:contents">
        <EffectPill effect={p.effect} />
      </span>
      <StepStatusIcon status={p.status} />
    </button>
  );
}

/**
 * The end of a finished run, printed like a till receipt: what was used, what it cost.
 */
export function RunReceipt({
  run,
  messages,
  tainted,
}: {
  run: TaskRun;
  messages: UiMessage[];
  tainted: boolean;
}) {
  const all = stepsOf(messages);
  const own = all.filter((s) => s.runId === run.id);
  const steps = own.length ? own : all;
  const sources = Array.from(
    new Set(steps.map((s) => splitToolName(s.part.name).source ?? "built-in")),
  );
  const asked = steps.filter((s) => s.part.decision === "ask").length;
  const shown = steps.slice(0, 6);
  const duration =
    run.createdAt && run.finishedAt
      ? formatDuration(new Date(run.finishedAt).getTime() - new Date(run.createdAt).getTime())
      : null;
  const rows: [string, string][] = [];
  if (run.model) rows.push(["Model", run.model.replace(/^[a-z-]+:/, "")]);
  rows.push(["Steps", String(run.steps ?? steps.length)]);
  if (sources.length) rows.push(["Tools", sources.join(", ")]);
  if (run.inputTokens || run.outputTokens)
    rows.push([
      "Tokens",
      `${formatTokens(run.inputTokens)} in · ${formatTokens(run.outputTokens)} out`,
    ]);
  if (duration) rows.push(["Time", duration]);

  return (
    <section
      aria-label="Run receipt"
      className="anim-row-in md:grid md:grid-cols-[76px_minmax(0,1fr)] md:gap-x-6"
    >
      <div aria-hidden="true" />
      <div className="max-w-[340px] drop-shadow-[0_14px_18px_rgb(0_0_0/0.14)]">
        <div className="landing-receipt bg-surface px-6 pt-8 pb-9 font-mono text-[12px] leading-[1.55] text-fg">
          <div className="text-center">
            <BrandGlyph className="mx-auto size-5 text-fg" />
            <p className="mt-2 tracking-[0.2em] uppercase">Task receipt</p>
            {run.finishedAt ? (
              <p className="text-[11px] text-fg-faint">{formatDateTime(run.finishedAt)}</p>
            ) : null}
          </div>
          {shown.length ? (
            <>
              <div className="my-4 border-t border-dashed border-line-strong" />
              <ul className="space-y-1.5">
                {shown.map(({ part: p }) => (
                  <li key={p.toolCallId} className="flex items-center gap-2">
                    <Monogram name={splitToolName(p.name).source ?? "Synapse"} size={14} />
                    <span className="min-w-0 flex-1 truncate">
                      {approvalTitle(p.preview, p.name)}
                    </span>
                    <span className="shrink-0 text-fg-faint">
                      {p.status === "succeeded"
                        ? p.decision === "ask"
                          ? "signed"
                          : "ok"
                        : p.status}
                    </span>
                  </li>
                ))}
                {steps.length > shown.length ? (
                  <li className="text-fg-faint">+ {steps.length - shown.length} more</li>
                ) : null}
              </ul>
            </>
          ) : null}
          <div className="my-4 border-t border-dashed border-line-strong" />
          <dl className="space-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-fg-muted">{k}</dt>
                <dd className="tabular min-w-0 truncate text-right">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 pt-1.5 text-[15px] font-semibold">
              <dt>Total</dt>
              <dd className="tabular">{formatCost(run.costUsd)}</dd>
            </div>
          </dl>
          <div className="my-4 border-t border-dashed border-line-strong" />
          <p className="text-center text-[11px] text-fg-faint">
            {tainted
              ? "Read outside content · actions asked first"
              : asked
                ? `${asked} ${asked === 1 ? "action" : "actions"} signed off by you`
                : "Nothing needed your signature"}
          </p>
        </div>
      </div>
    </section>
  );
}
