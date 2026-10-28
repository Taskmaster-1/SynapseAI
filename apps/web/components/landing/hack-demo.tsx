"use client";

import { Check, Flag, Play, RotateCcw, ShieldAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { EffectPill, Monogram } from "@/components/ui";
import { cx } from "@/lib/format";
import {
  type CallStep,
  DEMO_RULE_SENTENCES,
  DEMO_RULES,
  type DemoEmail,
  PRESETS,
  type Step,
  simulate,
} from "./hack-sim";
import { prefersReducedMotion } from "./motion";

const STEP_MS = 520;
const MAX_BODY = 2000;

const VERDICT = {
  allow: { label: "Ran", tone: "bg-ok-soft text-ok" },
  ask: { label: "Held for you", tone: "bg-attention-soft text-attention" },
  block: { label: "Blocked", tone: "bg-danger-soft text-danger" },
} as const;

/** The playable prompt-injection demo. Simulated agent, real policy. */
export function HackDemo() {
  const ids = useId();
  const [preset, setPreset] = useState(PRESETS[0]!.id);
  const [email, setEmail] = useState<DemoEmail>(PRESETS[0]!.email);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [shown, setShown] = useState(0);
  const [decided, setDecided] = useState<Record<number, "approved" | "denied">>({});
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const trace = useRef<HTMLDivElement>(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const run = () => {
    clearInterval(timer.current);
    const next = simulate(email);
    setSteps(next);
    setDecided({});
    // Stacked layout: the trace is below the email, so bring it into view.
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      trace.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
    }
    if (prefersReducedMotion()) return setShown(next.length);
    setShown(1);
    let n = 1;
    timer.current = setInterval(() => {
      n += 1;
      setShown(n);
      if (n >= next.length) clearInterval(timer.current);
    }, STEP_MS);
  };

  const pick = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    clearInterval(timer.current);
    setPreset(id);
    setEmail(p.email);
    setSteps(null);
  };

  const edit = (patch: Partial<DemoEmail>) => {
    setEmail((e) => ({ ...e, ...patch }));
    setPreset("custom");
  };

  const running = steps !== null && shown < steps.length;

  return (
    <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:gap-8">
      {/* The email */}
      <div className="min-w-0">
        <fieldset>
          <legend className="font-mono text-[12px] tracking-[0.14em] uppercase opacity-70">
            Start from
          </legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p.id)}
                aria-pressed={preset === p.id}
                className={cx(
                  "inline-flex h-9 items-center rounded-full border px-4 text-[14px] font-medium transition-colors",
                  preset === p.id
                    ? "border-ink bg-ink text-paper"
                    : "border-ink/15 bg-surface hover:border-ink/40",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="landing-slip mt-5 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-dashed border-line-strong px-5 py-3 text-[13px] text-fg-muted">
            <Monogram name="gmail" size={18} />
            <span className="font-medium text-fg">An email in your inbox</span>
            <span className="ml-auto font-mono text-[11px]">editable</span>
          </div>
          <div className="space-y-3 px-5 pt-4 pb-5 text-[14px]">
            <label className="flex items-center gap-3" htmlFor={`${ids}-from`}>
              <span className="w-16 shrink-0 text-fg-faint">From</span>
              <input
                id={`${ids}-from`}
                className="input min-h-9 py-1.5 font-mono text-[13px]"
                value={email.from}
                maxLength={120}
                spellCheck={false}
                onChange={(e) => edit({ from: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-3" htmlFor={`${ids}-subject`}>
              <span className="w-16 shrink-0 text-fg-faint">Subject</span>
              <input
                id={`${ids}-subject`}
                className="input min-h-9 py-1.5"
                value={email.subject}
                maxLength={160}
                onChange={(e) => edit({ subject: e.target.value })}
              />
            </label>
            <label className="block" htmlFor={`${ids}-body`}>
              <span className="sr-only">Body</span>
              <textarea
                id={`${ids}-body`}
                className="input h-[220px] resize-none font-mono text-[13px] leading-[1.6]"
                value={email.body}
                maxLength={MAX_BODY}
                spellCheck={false}
                onChange={(e) => edit({ body: e.target.value })}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={run}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-6 text-[15px] font-medium text-paper transition-colors hover:bg-accent"
              >
                {steps ? <RotateCcw className="size-4" /> : <Play className="size-4" />}
                {steps ? "Run again" : "Run the agent"}
              </button>
              <span className="text-[13px] text-fg-muted">
                Task: <i>“Summarize my unread email.”</i>
              </span>
            </div>
          </div>
        </div>

        <details className="group mt-5 rounded-card border border-ink/10 bg-surface/60 px-5 py-3 text-[14px]">
          <summary className="cursor-pointer list-none font-medium marker:hidden">
            <span className="inline-flex items-center gap-2">
              Rules in this demo
              <span className="text-fg-faint transition-transform group-open:rotate-90">›</span>
            </span>
          </summary>
          <ul className="mt-3 space-y-2">
            {DEMO_RULE_SENTENCES.map((r) => (
              <li key={r.text} className="flex flex-wrap items-baseline gap-x-2">
                <code className="font-mono text-[12px] text-fg-faint">{r.tool}</code>
                <span>{r.text}</span>
                <span className="ml-auto font-medium">→ {r.verdict}</span>
              </li>
            ))}
          </ul>
          <pre className="code mt-3 max-h-56 text-[11.5px]">
            {JSON.stringify(DEMO_RULES, null, 2)}
          </pre>
        </details>
      </div>

      {/* What happens */}
      <div ref={trace} className="min-w-0 scroll-mt-24">
        <div className="rounded-[18px] bg-ink p-4 text-paper sm:p-5">
          <div className="flex flex-wrap items-center gap-2 border-b border-paper/15 pb-3">
            <span className="font-mono text-[12px] tracking-[0.14em] uppercase opacity-70">
              What happens
            </span>
            <span className="ml-auto rounded-full border border-field-amber/60 px-2.5 py-0.5 font-mono text-[11px] text-field-amber">
              Simulated agent · real policy code
            </span>
          </div>
          <div aria-live="polite" className="min-h-[380px] pt-4">
            {!steps ? (
              <div className="grid h-[360px] place-items-center text-center">
                <div className="max-w-[340px]">
                  <ShieldAlert className="mx-auto size-8 opacity-60" strokeWidth={1.5} />
                  <p className="mt-3 text-[15px] text-paper/80">
                    Edit the email any way you like, then run the agent. It plays a model that has
                    been fooled: it obeys whatever the email says.
                  </p>
                </div>
              </div>
            ) : (
              <ol className="space-y-2.5">
                {steps.slice(0, shown).map((s, i) => (
                  <StepRow
                    // biome-ignore lint/suspicious/noArrayIndexKey: steps are a fixed script
                    key={i}
                    step={s}
                    decided={decided[i]}
                    settled={steps.every(
                      (x, j) => x.kind !== "call" || x.verdict.decision !== "ask" || decided[j],
                    )}
                    onDecide={(v) => setDecided((d) => ({ ...d, [i]: v }))}
                  />
                ))}
                {running && (
                  <li className="flex items-center gap-2 pl-1 text-[13px] text-paper/60">
                    <span className="size-1.5 anim-pulse rounded-full bg-paper/70" /> working
                  </li>
                )}
              </ol>
            )}
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">
          The agent here is a script standing in for a model that has been fooled. Every call it
          proposes is judged in your browser by the policy engine from{" "}
          <code className="font-mono">@synapse/core</code> (
          <code className="font-mono">evaluateComposedPolicy</code>, the function the server's
          runtime calls), with taint set the way the runtime sets it. Nothing is sent anywhere.
        </p>
      </div>
    </div>
  );
}

function StepRow({
  step,
  decided,
  settled,
  onDecide,
}: {
  step: Step;
  decided: "approved" | "denied" | undefined;
  /** Every held call has been approved or denied. */
  settled: boolean;
  onDecide: (v: "approved" | "denied") => void;
}) {
  if (step.kind === "task") {
    return (
      <li className="anim-row-in rounded-[12px] bg-paper/[0.06] px-3.5 py-2.5 text-[14px]">
        <span className="text-paper/55">You · </span>
        {step.text}
      </li>
    );
  }
  if (step.kind === "model") {
    return (
      <li className="anim-row-in flex gap-2.5 px-1 py-1 text-[14px]">
        <Flag className="mt-0.5 size-4 shrink-0 text-field-amber" />
        <span>
          <span className="font-mono text-[11px] tracking-wide text-field-amber uppercase">
            Model, fooled ·{" "}
          </span>
          <span className="text-paper/90">{step.text}</span>
        </span>
      </li>
    );
  }
  if (step.kind === "end") {
    return (
      <li
        className={cx(
          "anim-row-in mt-1 rounded-[12px] border px-3.5 py-2.5 text-[14px]",
          step.outcome === "paused" && !settled
            ? "border-field-amber/50 text-field-amber"
            : step.outcome === "blocked"
              ? "border-[#f97066]/50 text-[#f9a39b]"
              : "border-[#4cc38a]/50 text-[#7ee2a8]",
        )}
      >
        {step.outcome === "paused" && settled
          ? "You decided. In the real app, the task now carries on with your answer."
          : step.text}
      </li>
    );
  }
  return <CallRow step={step} decided={decided} onDecide={onDecide} />;
}

function CallRow({
  step,
  decided,
  onDecide,
}: {
  step: CallStep;
  decided: "approved" | "denied" | undefined;
  onDecide: (v: "approved" | "denied") => void;
}) {
  const v = VERDICT[step.verdict.decision];
  const escalated = step.untainted.decision !== step.verdict.decision;
  return (
    <li className="anim-row-in rounded-[12px] bg-paper text-[14px] text-ink">
      <div className="flex flex-wrap items-center gap-2 px-3.5 pt-3">
        <code className="font-mono text-[12.5px] font-medium">{step.tool}</code>
        <EffectPill effect={step.effect} />
        <span
          className={cx("ml-auto rounded-full px-2.5 py-0.5 text-[12px] font-semibold", v.tone)}
        >
          {v.label}
        </span>
      </div>
      <p className="px-3.5 pt-1 text-[13.5px] text-fg-muted">{step.preview}</p>
      {step.verdict.decision !== "allow" || step.tainted ? (
        <p className="mx-3.5 mt-2 border-l-2 border-ink/20 pl-2.5 text-[13px] leading-snug">
          <span className="font-medium">Policy: </span>
          {step.verdict.reason}
          {escalated && (
            <span className="block pt-1 text-fg-muted">
              Before the run read outside content, your rules said{" "}
              <b className="font-medium">{step.untainted.decision}</b> (“{step.untainted.reason}”).
            </span>
          )}
        </p>
      ) : null}
      {step.output && (
        <p className="px-3.5 pt-1.5 font-mono text-[12px] text-fg-faint">→ {step.output}</p>
      )}
      {step.taints && (
        <p className="mx-3.5 mt-2 inline-flex items-center gap-1.5 rounded-full bg-attention-soft px-2.5 py-0.5 text-[12px] font-medium text-attention">
          <ShieldAlert className="size-3.5" /> Run tainted: it has read outside content
        </p>
      )}
      {step.verdict.decision === "ask" && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-dashed border-line-strong px-3.5 py-2.5">
          {decided ? (
            <span
              className={cx(
                "landing-stamp landing-stamp-in text-[15px]",
                decided === "denied" ? "text-danger" : "text-ok",
              )}
            >
              {decided}
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onDecide("denied")}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-medium text-paper hover:bg-accent"
              >
                <X className="size-3.5" /> Deny
              </button>
              <button
                type="button"
                onClick={() => onDecide("approved")}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink/20 px-3.5 text-[13px] font-medium hover:border-ink/50"
              >
                <Check className="size-3.5" /> Approve
              </button>
            </>
          )}
          <span className="ml-auto text-[12px] text-fg-faint">
            {decided === "approved"
              ? "It would now wait 10 s for Undo."
              : decided === "denied"
                ? "The agent is told you said no."
                : "Waiting for you"}
          </span>
        </div>
      )}
      <details className="group px-3.5 pt-1 pb-2.5">
        <summary className="cursor-pointer list-none text-[12px] text-fg-faint marker:hidden hover:text-fg">
          <span className="group-open:hidden">Show the policy call</span>
          <span className="hidden group-open:inline">Hide the policy call</span>
        </summary>
        <pre className="code mt-2 text-[11px]">
          {`evaluateComposedPolicy(${JSON.stringify(
            { tool: step.tool, effect: step.effect, input: step.input, tainted: step.tainted },
            null,
            2,
          )}, rules)\n→ ${JSON.stringify(
            {
              decision: step.verdict.decision,
              reason: step.verdict.reason,
              ruleId: step.verdict.ruleId,
            },
            null,
            2,
          )}`}
        </pre>
      </details>
    </li>
  );
}
