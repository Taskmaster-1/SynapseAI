"use client";

import type { ToolOutput } from "@synapse/core";
import { splitAttachments, type UiMessage } from "@synapse/core/ui";
import { ChevronRight, ShieldAlert, User, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { approvalTitle } from "@/components/approval/approval-card";
import { PayloadView } from "@/components/approval/payload";
import { useTimeLeft } from "@/components/approval/undo-window";
import { FileChip, fileUrl } from "@/components/task/files";
import { EffectPill, Monogram, StepStatusIcon, Tabs } from "@/components/ui";
import type { TaskRun } from "@/lib/api";
import {
  cx,
  formatCost,
  formatDateTime,
  formatDuration,
  formatTokens,
  humanToolName,
  prettyJson,
  splitToolName,
} from "@/lib/format";
import {
  denialReason,
  isUndone,
  policySummary,
  type Step,
  stepsOf,
  taintStepId,
} from "@/lib/steps";

export type PanelTab = "activity" | "details";

const STATUS_TEXT: Record<string, string> = {
  proposed: "Starting",
  awaiting_approval: "Waiting for you",
  approved: "Approved",
  executing: "Running",
  succeeded: "Done",
  failed: "Failed",
  denied: "Denied",
  unknown: "Outcome unknown",
};

export function RunPanel({
  messages,
  run,
  taintedRuns,
  tab,
  onTab,
  focusStep,
  onClose,
}: {
  messages: UiMessage[];
  run: TaskRun | null;
  taintedRuns: Set<string>;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  focusStep: string | null;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative shrink-0">
        {onClose ? (
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm absolute top-3.5 right-3 z-10"
            aria-label="Close panel"
            onClick={onClose}
          >
            <X />
          </button>
        ) : null}
        <Tabs<PanelTab>
          label="Run panel"
          tall
          className="px-5"
          value={tab}
          onChange={onTab}
          tabs={[
            { value: "activity", label: "Activity", count: stepsOf(messages).length || undefined },
            { value: "details", label: "Details" },
          ]}
        />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-8">
        {tab === "activity" ? (
          <ActivityTimeline messages={messages} taintedRuns={taintedRuns} focusStep={focusStep} />
        ) : (
          <Details messages={messages} run={run} />
        )}
      </div>
    </div>
  );
}

function ActivityTimeline({
  messages,
  taintedRuns,
  focusStep,
}: {
  messages: UiMessage[];
  taintedRuns: Set<string>;
  focusStep: string | null;
}) {
  const steps = useMemo(() => stepsOf(messages), [messages]);
  const taintAt = useMemo(() => taintStepId(steps, taintedRuns), [steps, taintedRuns]);

  // Interleave the user's asks so the timeline reads as a story.
  const rows: ({ kind: "ask"; id: string; text: string } | { kind: "step"; step: Step })[] = [];
  const byMessage = new Map<string, Step[]>();
  for (const s of steps) byMessage.set(s.messageId, [...(byMessage.get(s.messageId) ?? []), s]);
  for (const m of messages) {
    if (m.role === "user") {
      const { text, files } = splitAttachments(
        m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""),
      );
      const n = files.length;
      const note = n ? `${n === 1 ? "1 file" : `${n} files`} attached` : "";
      rows.push({ kind: "ask", id: m.id, text: [text, note].filter(Boolean).join(" · ") });
    } else for (const s of byMessage.get(m.id) ?? []) rows.push({ kind: "step", step: s });
  }

  if (steps.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="font-serif text-[26px] leading-tight text-fg">
          No steps <span className="italic">yet</span>
        </p>
        <p className="mx-auto mt-2 max-w-[24ch] text-13 text-fg-muted">
          Every tool the agent uses shows up here, in order.
        </p>
      </div>
    );
  }

  return (
    <ol className="relative">
      <span
        aria-hidden="true"
        className="absolute top-4 bottom-4 left-[11.5px] border-l border-dashed border-line-strong"
      />
      {rows.map((r) =>
        r.kind === "ask" ? (
          <li key={r.id} className="relative flex gap-3 pb-5">
            <span className="relative z-10 grid size-6 shrink-0 place-items-center rounded-full bg-fg text-canvas">
              <User className="size-3.5" />
            </span>
            <div className="min-w-0">
              <div className="eyebrow">You asked</div>
              <p className="mt-0.5 line-clamp-3 font-serif text-[17px] leading-[1.3] text-fg">
                {r.text}
              </p>
            </div>
          </li>
        ) : (
          <TimelineStep
            key={r.step.part.toolCallId}
            step={r.step}
            taint={taintAt.has(r.step.part.toolCallId)}
            focused={focusStep === r.step.part.toolCallId}
          />
        ),
      )}
    </ol>
  );
}

/** The step's status, with a live countdown while an approved send waits out its undo window. */
function StepStatusText({ part: p }: { part: Step["part"] }) {
  const left = useTimeLeft(p.status === "approved" ? p.executeAfter : null);
  if (left > 0)
    return (
      <span className="tabular-nums">
        {p.effect === "send" ? "Sending" : "Running"} in {Math.ceil(left / 1000)}s
      </span>
    );
  if (isUndone(p.output)) return <>Undone</>;
  return <>{STATUS_TEXT[p.status] ?? p.status}</>;
}

function TimelineStep({ step, taint, focused }: { step: Step; taint: boolean; focused: boolean }) {
  const p = step.part;
  const [open, setOpen] = useState(focused);
  const ref = useRef<HTMLLIElement>(null);
  const { source } = splitToolName(p.name);
  useEffect(() => {
    if (focused) {
      setOpen(true);
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focused]);
  return (
    <li ref={ref} className="anim-row-in relative pb-3.5">
      <div className="flex gap-3">
        <span className="relative z-10 shrink-0 self-start">
          <Monogram name={source ?? "Synapse"} size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={cx(
              "-mx-2 -mt-1 flex w-[calc(100%+16px)] items-start gap-2 rounded-[8px] px-2 py-1 text-left hover:bg-hover",
              focused && "bg-accent-soft",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-13 leading-snug break-words text-fg">
                {approvalTitle(p.preview, p.name)}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] tracking-[0.02em] text-fg-muted">
                <EffectPill effect={p.effect} />
                <span
                  className={cx(
                    p.status === "awaiting_approval" && "text-attention",
                    ["failed", "denied"].includes(p.status) && "text-danger",
                  )}
                >
                  <StepStatusText part={p} />
                </span>
                {p.decision === "ask" &&
                p.status !== "awaiting_approval" &&
                p.status !== "denied" ? (
                  <span className="text-fg-faint">· approved by you</span>
                ) : null}
              </span>
            </span>
            <StepStatusIcon status={p.status} className="mt-0.5" />
            <ChevronRight
              className={cx(
                "mt-1 size-3.5 shrink-0 text-fg-faint transition-transform duration-150",
                open && "rotate-90",
              )}
            />
          </button>
          {taint ? (
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-attention-soft px-2 py-0.5 text-12 font-medium text-attention">
              <ShieldAlert className="size-3.5" />
              Read outside content here
            </p>
          ) : null}
          {open ? (
            <div className="anim-row-in mt-2.5 space-y-3">
              {p.preview ? <p className="text-12 text-fg-faint">{humanToolName(p.name)}</p> : null}
              {p.reason ? (
                <p className="text-12 text-fg-muted">
                  <span className="text-fg-faint">Policy · </span>
                  {p.reason}
                </p>
              ) : null}
              <div>
                <div className="eyebrow mb-1.5">Input</div>
                <div className="rounded-[8px] border border-line bg-surface p-2.5 text-13">
                  <PayloadView input={p.input} tool={p.name} />
                </div>
              </div>
              <div>
                <div className="eyebrow mb-1.5">Output</div>
                <OutputView output={p.output} reason={p.reason} tool={p.name} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

const LIMIT = 600;

export function OutputView({
  output,
  reason,
  tool,
}: {
  output: ToolOutput | null;
  reason?: string | null;
  /** The tool's name, for outputs with their own layout (run_code). */
  tool?: string;
}) {
  if (!output) return <p className="text-12 text-fg-faint">No output yet.</p>;
  if (output.type === "denied")
    return (
      <p className="text-13 text-danger">
        Denied{denialReason(output, reason) ? `: ${denialReason(output, reason)}` : ""}
      </p>
    );
  if (output.type === "image")
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-12 text-fg-muted">Looked at this photo:</p>
        <FileChip file={output} href={fileUrl(output.fileId)} previewUrl={fileUrl(output.fileId)} />
      </div>
    );
  if (tool === "run_code" && output.type === "json" && isCodeRun(output.value))
    return <CodeRunView run={output.value} />;
  const text = output.type === "json" ? prettyJson(output.value) : output.value;
  return <LongText text={text} danger={output.type === "error"} />;
}

function LongText({ text, danger }: { text: string; danger?: boolean }) {
  const [all, setAll] = useState(false);
  const long = text.length > LIMIT;
  return (
    <div>
      <pre className={cx("code max-h-96", danger && "text-danger")}>
        {long && !all ? `${text.slice(0, LIMIT)}…` : text}
      </pre>
      {long ? (
        <button
          type="button"
          className="mt-1 text-12 font-medium text-accent hover:underline"
          onClick={() => setAll((a) => !a)}
        >
          {all ? "Show less" : `Show all (${Math.round(text.length / 100) / 10}k chars)`}
        </button>
      ) : null}
    </div>
  );
}

/** run_code's output: `{ result?, output?, outputTruncated?, files?, note? }`. */
interface CodeRun {
  result?: unknown;
  output?: string;
  outputTruncated?: boolean;
  files?: { fileId: string; name: string; mimeType: string; bytes: number }[];
  note?: string;
}

const CODE_RUN_KEYS = ["result", "output", "outputTruncated", "files", "note"];

function isCodeRun(value: unknown): value is CodeRun {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => CODE_RUN_KEYS.includes(k))
  );
}

function CodeRunView({ run }: { run: CodeRun }) {
  return (
    <div className="space-y-2.5">
      {"result" in run ? (
        <div>
          <p className="mb-1 text-12 text-fg-muted">Result</p>
          <LongText text={typeof run.result === "string" ? run.result : prettyJson(run.result)} />
        </div>
      ) : null}
      {run.output ? (
        <div>
          <p className="mb-1 text-12 text-fg-muted">
            Printed{run.outputTruncated ? " (cut off at the output limit)" : ""}
          </p>
          <LongText text={run.output.replace(/\n$/, "")} />
        </div>
      ) : null}
      {run.files?.length ? (
        <div>
          <p className="mb-1 text-12 text-fg-muted">Saved</p>
          <div className="flex flex-wrap gap-2">
            {run.files.map((f) => (
              <FileChip key={f.fileId} file={f} href={fileUrl(f.fileId)} />
            ))}
          </div>
        </div>
      ) : null}
      {run.note ? <p className="text-12 text-fg-faint">{run.note}</p> : null}
    </div>
  );
}

function Details({ messages, run }: { messages: UiMessage[]; run: TaskRun | null }) {
  const steps = stepsOf(messages);
  const s = policySummary(steps);
  if (!run) {
    return (
      <p className="py-10 text-center text-13 text-fg-muted">
        Details appear once the task starts.
      </p>
    );
  }
  const duration =
    run.createdAt && run.finishedAt
      ? formatDuration(new Date(run.finishedAt).getTime() - new Date(run.createdAt).getTime())
      : null;
  const rows: [string, React.ReactNode][] = [
    [
      "Model",
      run.model ? (
        <span key="model" className="font-mono text-12">
          {run.model}
        </span>
      ) : (
        "—"
      ),
    ],
    ["Steps", run.steps ?? "—"],
    ["Tokens", `${formatTokens(run.inputTokens)} in · ${formatTokens(run.outputTokens)} out`],
    ["Cost", formatCost(run.costUsd)],
    ["Started", formatDateTime(run.createdAt)],
    [
      "Finished",
      run.finishedAt ? `${formatDateTime(run.finishedAt)}${duration ? ` · ${duration}` : ""}` : "—",
    ],
    [
      "Trigger",
      run.trigger === "schedule"
        ? "Schedule"
        : run.trigger === "manual"
          ? "Run now"
          : run.trigger === "chat"
            ? "You"
            : "—",
    ],
  ];
  return (
    <div className="space-y-8">
      <section>
        <h3 className="eyebrow mb-3">Latest run</h3>
        <dl className="space-y-2.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2 text-13">
              <dt className="shrink-0 text-fg-muted">{k}</dt>
              <span
                aria-hidden="true"
                className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-line-strong"
              />
              <dd className="tabular min-w-0 truncate text-right text-fg">{v}</dd>
            </div>
          ))}
        </dl>
        {run.error ? (
          <p className="mt-3 border-l-2 border-danger pl-3 text-13 text-danger">{run.error}</p>
        ) : null}
      </section>
      <section>
        <h3 className="eyebrow mb-3">Policy decisions</h3>
        <ul className="grid grid-cols-2 border-t border-l border-line">
          {[
            ["Allowed automatically", s.auto, "text-fg"],
            ["Approved by you", s.approved, "text-ok"],
            ["Denied", s.denied, "text-danger"],
            ["Blocked by rules", s.blocked, "text-danger"],
          ].map(([label, n, tone]) => (
            <li key={label as string} className="border-r border-b border-line px-3 pt-2 pb-3">
              <div
                className={cx(
                  "tabular font-serif text-[34px] leading-none",
                  (n as number) > 0 ? (tone as string) : "text-fg-faint",
                )}
              >
                {n}
              </div>
              <div className="mt-1.5 text-12 text-fg-muted">{label}</div>
            </li>
          ))}
        </ul>
        {s.waiting > 0 ? (
          <p className="mt-3 inline-flex items-center gap-1.5 text-12 text-attention">
            <span className="size-1.5 rounded-full bg-attention" />
            {s.waiting} waiting on you now.
          </p>
        ) : null}
        <p className="mt-3 text-12 text-fg-faint">Across every run in this task.</p>
      </section>
    </div>
  );
}
