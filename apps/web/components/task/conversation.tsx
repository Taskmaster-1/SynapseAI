"use client";

import type { UiMessage, UiPart } from "@synapse/core/ui";
import { ChevronRight, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";
import { approvalTitle } from "@/components/approval/approval-card";
import { Markdown } from "@/components/markdown";
import { EffectPill, Monogram, StepStatusIcon } from "@/components/ui";
import { cx, humanToolName, splitToolName } from "@/lib/format";
import { type ToolPart, wasAsked } from "@/lib/steps";

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
    <ol className="space-y-6" aria-label="Conversation">
      {messages.map((m, i) => (
        <li key={m.id} className="anim-row-in">
          {m.role === "user" ? (
            <UserMessage message={m} queued={m.id === queuedId} />
          ) : m.role === "handover" ? (
            <Handover message={m} />
          ) : (
            <AgentMessage
              message={m}
              streaming={active && i === messages.length - 1}
              renderAsked={renderAsked}
              onOpenStep={onOpenStep}
            />
          )}
        </li>
      ))}
      {working ? (
        <li aria-live="polite" className="flex items-center gap-2 text-13 text-fg-muted">
          <span className="flex gap-1">
            <span className="anim-pulse size-1.5 rounded-full bg-accent" />
            <span className="anim-pulse size-1.5 rounded-full bg-accent [animation-delay:200ms]" />
            <span className="anim-pulse size-1.5 rounded-full bg-accent [animation-delay:400ms]" />
          </span>
          Working…
        </li>
      ) : null}
    </ol>
  );
}

function textOf(m: UiMessage) {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function UserMessage({ message, queued }: { message: UiMessage; queued: boolean }) {
  return (
    <div className="flex flex-col items-end pl-10 sm:pl-24">
      <div className="max-w-full rounded-[14px] rounded-br-[4px] bg-sunken px-3.5 py-2 text-14 whitespace-pre-wrap break-words text-fg">
        {textOf(message)}
      </div>
      {queued ? (
        <p className="mt-1 text-12 text-fg-faint">
          Queued · the agent will read this at its next step
        </p>
      ) : null}
    </div>
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
        className="group flex w-full items-center gap-3 text-12 text-fg-faint"
      >
        <span className="h-px flex-1 bg-line" />
        <span className="inline-flex items-center gap-1 group-hover:text-fg-muted">
          Earlier conversation summarised
          <ChevronRight
            className={cx("size-3 transition-transform duration-150", open && "rotate-90")}
          />
        </span>
        <span className="h-px flex-1 bg-line" />
      </button>
      {open ? (
        <div className="anim-row-in mt-3 rounded-[10px] bg-sunken px-4 py-3 text-fg-muted">
          <Markdown text={textOf(message)} />
        </div>
      ) : null}
    </div>
  );
}

function AgentMessage({
  message,
  streaming,
  renderAsked,
  onOpenStep,
}: {
  message: UiMessage;
  streaming: boolean;
  renderAsked: (part: ToolPart, message: UiMessage) => ReactNode;
  onOpenStep: (toolCallId: string) => void;
}) {
  const blocks = blocksOf(message.parts);
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        const isLast = i === blocks.length - 1;
        switch (b.kind) {
          case "text":
            return <Markdown key={b.key} text={b.text} streaming={streaming && isLast} />;
          case "reasoning":
            return <Reasoning key={b.key} text={b.text} live={streaming && isLast} />;
          case "steps":
            return <StepGroup key={b.key} parts={b.parts} onOpenStep={onOpenStep} />;
          case "asked":
            return <div key={b.key}>{renderAsked(b.part, message)}</div>;
        }
        return null;
      })}
    </div>
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
        className="inline-flex items-center gap-1.5 text-13 text-fg-faint hover:text-fg-muted"
      >
        <Sparkles className={cx("size-3.5", live && "anim-pulse")} />
        {live ? "Thinking…" : "Thought it through"}
        <ChevronRight
          className={cx("size-3 transition-transform duration-150", open && "rotate-90")}
        />
      </button>
      {open ? (
        <div className="anim-row-in mt-2 border-l-2 border-line pl-3 text-13 whitespace-pre-wrap text-fg-muted">
          {text}
        </div>
      ) : null}
    </div>
  );
}

/** "Used 2 tools · gmail, linear ▸" — expands to one row per step. */
export function StepGroup({
  parts,
  onOpenStep,
}: {
  parts: ToolPart[];
  onOpenStep: (id: string) => void;
}) {
  const running = parts.some((p) => ["proposed", "approved", "executing"].includes(p.status));
  const problems = parts.filter((p) => ["failed", "denied", "unknown"].includes(p.status)).length;
  const [open, setOpen] = useState(false);
  const sources = Array.from(new Set(parts.map((p) => splitToolName(p.name).source ?? "built-in")));
  return (
    <div className="rounded-[10px] border border-line bg-surface/60">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-13 text-fg-muted hover:text-fg"
      >
        <span className="flex -space-x-1">
          {sources.slice(0, 3).map((s) => (
            <Monogram
              key={s}
              name={s === "built-in" ? "Synapse" : s}
              size={18}
              className="ring-2 ring-surface"
            />
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {running ? "Using" : "Used"} {parts.length} {parts.length === 1 ? "tool" : "tools"}
          <span className="text-fg-faint"> · {sources.join(", ")}</span>
          {problems ? <span className="text-danger"> · {problems} didn't go through</span> : null}
        </span>
        {running ? <StepStatusIcon status="executing" /> : null}
        <ChevronRight
          className={cx(
            "size-3.5 shrink-0 text-fg-faint transition-transform duration-150",
            open && "rotate-90",
          )}
        />
      </button>
      {open ? (
        <ul className="anim-row-in border-t border-line py-1">
          {parts.map((p) => (
            <li key={p.toolCallId}>
              <button
                type="button"
                onClick={() => onOpenStep(p.toolCallId)}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-13 hover:bg-hover"
                title="Show in Activity"
              >
                <StepStatusIcon status={p.status} />
                <span className="min-w-0 flex-1 truncate text-fg">
                  {approvalTitle(p.preview, p.name)}
                </span>
                {p.preview ? (
                  <span className="hidden truncate text-12 text-fg-faint sm:inline">
                    {humanToolName(p.name)}
                  </span>
                ) : null}
                <EffectPill effect={p.effect} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
