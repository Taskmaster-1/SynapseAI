"use client";

import type { ToolOutput } from "@synapse/core";
import type { UiMessage } from "@synapse/core/ui";
import { ChevronRight, ShieldAlert, User, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { approvalTitle } from "@/components/approval/approval-card";
import { PayloadView } from "@/components/approval/payload";
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
import { denialReason, policySummary, type Step, stepsOf, taintStepId } from "@/lib/steps";

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
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
      const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
      rows.push({ kind: "ask", id: m.id, text });
    } else for (const s of byMessage.get(m.id) ?? []) rows.push({ kind: "step", step: s });
  }

  if (steps.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="font-serif text-20 text-fg">No steps yet</p>
        <p className="mt-1 text-13 text-fg-muted">
          Every tool the agent uses shows up here, in order.
        </p>
      </div>
    );
  }

  return (
    <ol className="relative">
      <span aria-hidden="true" className="absolute top-3 bottom-3 left-[11px] w-px bg-line" />
      {rows.map((r) =>
        r.kind === "ask" ? (
          <li key={r.id} className="relative flex gap-3 pb-4">
            <span className="relative z-10 grid size-6 shrink-0 place-items-center rounded-full border border-line bg-canvas text-fg-faint">
              <User className="size-3.5" />
            </span>
            <p className="line-clamp-2 min-w-0 pt-0.5 text-13 text-fg-muted">{r.text}</p>
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
    <li ref={ref} className="anim-row-in relative pb-4">
      <div className="flex gap-3">
        <span className="relative z-10 shrink-0 self-start rounded-[6px] bg-surface">
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
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-12 text-fg-muted">
                <EffectPill effect={p.effect} />
                <span
                  className={cx(
                    p.status === "awaiting_approval" && "text-attention",
                    ["failed", "denied"].includes(p.status) && "text-danger",
                  )}
                >
                  {STATUS_TEXT[p.status] ?? p.status}
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
                  <PayloadView input={p.input} />
                </div>
              </div>
              <div>
                <div className="eyebrow mb-1.5">Output</div>
                <OutputView output={p.output} reason={p.reason} />
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
}: {
  output: ToolOutput | null;
  reason?: string | null;
}) {
  const [all, setAll] = useState(false);
  if (!output) return <p className="text-12 text-fg-faint">No output yet.</p>;
  if (output.type === "denied")
    return (
      <p className="text-13 text-danger">
        Denied{denialReason(output, reason) ? `: ${denialReason(output, reason)}` : ""}
      </p>
    );
  const text = output.type === "json" ? prettyJson(output.value) : output.value;
  const long = text.length > LIMIT;
  return (
    <div>
      <pre className={cx("code max-h-96", output.type === "error" && "text-danger")}>
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
    <div className="space-y-6">
      <section>
        <h3 className="eyebrow mb-2">Latest run</h3>
        <dl className="divide-y divide-line rounded-[10px] border border-line bg-surface">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 px-3 py-2 text-13">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="tabular min-w-0 truncate text-right text-fg">{v}</dd>
            </div>
          ))}
        </dl>
        {run.error ? <p className="mt-2 text-13 text-danger">{run.error}</p> : null}
      </section>
      <section>
        <h3 className="eyebrow mb-2">Policy decisions</h3>
        <ul className="grid grid-cols-2 gap-2">
          {[
            ["Allowed automatically", s.auto, "text-fg"],
            ["Approved by you", s.approved, "text-ok"],
            ["Denied", s.denied, "text-danger"],
            ["Blocked by rules", s.blocked, "text-danger"],
          ].map(([label, n, tone]) => (
            <li
              key={label as string}
              className="rounded-[10px] border border-line bg-surface px-3 py-2.5"
            >
              <div
                className={cx(
                  "tabular text-20 font-medium",
                  (n as number) > 0 ? (tone as string) : "text-fg-faint",
                )}
              >
                {n}
              </div>
              <div className="text-12 text-fg-muted">{label}</div>
            </li>
          ))}
        </ul>
        {s.waiting > 0 ? (
          <p className="mt-2 text-12 text-attention">{s.waiting} waiting on you now.</p>
        ) : null}
        <p className="mt-3 text-12 text-fg-faint">Across every run in this task.</p>
      </section>
    </div>
  );
}
