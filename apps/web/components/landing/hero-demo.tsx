"use client";

import { Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EffectPill, Monogram } from "@/components/ui";
import { cx } from "@/lib/format";

/**
 * The product's core moment, played on a loop: a task comes in, the agent reads on its
 * own, then stops and asks before it sends; a pointer approves. Decorative only; reduced
 * motion shows the finished state without looping.
 */
const STEPS = [
  900, // 1 user message
  1000, // 2 reading the thread
  1000, // 3 read done, checking calendar
  1300, // 4 calendar done, agent text streams
  1300, // 5 approval card waits; pointer travels
  420, // 6 approve pressed
  700, // 7 receipt
  3400, // 8 final answer, hold
];
const LAST = STEPS.length;

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function usePhase(): number {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reduced()) {
      setPhase(LAST);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    let current = 0;
    const tick = () => {
      current = current >= LAST ? 0 : current + 1;
      setPhase(current);
      timer = setTimeout(tick, current === 0 ? 500 : STEPS[current - 1]);
    };
    timer = setTimeout(tick, 900);
    return () => clearTimeout(timer);
  }, []);
  return phase;
}

/** Streams `text` in once `show` turns true, like a model writing. */
function Typed({ text, show }: { text: string; show: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!show) return setN(0);
    if (reduced()) return setN(text.length);
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(text.length, i + 2);
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, 18);
    return () => clearInterval(id);
  }, [show, text]);
  return (
    <>
      {text.slice(0, n)}
      {show && n < text.length && (
        <span className="landing-caret ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] rounded-[1px] bg-accent" />
      )}
    </>
  );
}

function Appear({
  show,
  children,
  className,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "grid transition-[grid-template-rows,opacity,translate] duration-500 ease-[cubic-bezier(.2,.7,.2,1)]",
        show ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] translate-y-2 opacity-0",
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function Step({ name, label, done }: { name: string; label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 text-13">
      <Monogram name={name} size={18} />
      <span className="min-w-0 flex-1 truncate text-fg">{label}</span>
      <EffectPill effect="read" />
      <span className="relative grid size-4 place-items-center">
        <LoaderCircle
          className={cx(
            "anim-spin absolute size-3.5 text-fg-faint transition-[opacity,scale] duration-200",
            done && "scale-50 opacity-0",
          )}
        />
        <Check
          strokeWidth={2.25}
          className={cx(
            "absolute size-3.5 text-ok transition-[opacity,scale] duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]",
            done ? "scale-100 opacity-100" : "scale-50 opacity-0",
          )}
        />
      </span>
    </div>
  );
}

/** A pointer that glides to the Approve button and clicks it. */
function Pointer({ phase, target }: { phase: number; target: { x: number; y: number } | null }) {
  const visible = (phase === 5 || phase === 6) && target;
  const at = phase >= 5 && target ? target : { x: 560, y: 420 };
  return (
    <div
      className={cx(
        "pointer-events-none absolute top-0 left-0 z-20 transition-[translate,opacity] ease-[cubic-bezier(.65,0,.35,1)]",
        phase === 5 ? "duration-[1100ms]" : "duration-300",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{ translate: `${at.x}px ${at.y}px` }}
    >
      {phase === 6 && (
        <span className="landing-click absolute -top-3 -left-3 size-6 rounded-full bg-accent/40" />
      )}
      <svg
        aria-hidden="true"
        width="18"
        height="22"
        viewBox="0 0 18 22"
        className={cx(
          "drop-shadow-md transition-transform duration-150",
          phase === 6 && "scale-90",
        )}
      >
        <path
          d="M1.5 1.5v16.2l4.3-4.1 2.9 6.6 2.9-1.3-2.9-6.5h6z"
          fill="var(--fg)"
          stroke="var(--surface)"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function HeroDemo() {
  const phase = usePhase();
  const approved = phase >= 7;
  const waiting = phase >= 5 && !approved;
  const frame = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);

  // Aim the pointer at the Approve button once the card has opened.
  useLayoutEffect(() => {
    if (phase !== 5) return;
    const id = setTimeout(() => {
      const f = frame.current?.getBoundingClientRect();
      const b = button.current?.getBoundingClientRect();
      if (f && b)
        setTarget({ x: b.left - f.left + b.width * 0.55, y: b.top - f.top + b.height * 0.5 });
    }, 380);
    return () => clearTimeout(id);
  }, [phase]);

  return (
    <div
      ref={frame}
      aria-hidden="true"
      className="relative mx-auto w-full max-w-[640px] select-none overflow-hidden rounded-[16px] border border-line bg-surface text-left shadow-pop"
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
        </span>
        <span className="ml-2 truncate text-12 text-fg-muted">Reply to Bob about tomorrow</span>
        <span
          className={cx(
            "ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-12 font-medium transition-colors duration-500",
            phase >= 8
              ? "bg-ok-soft text-ok"
              : waiting
                ? "bg-attention-soft text-attention"
                : "bg-accent-soft text-accent",
          )}
        >
          <span
            className={cx(
              "size-1.5 rounded-full",
              phase >= 8 ? "bg-ok" : waiting ? "bg-attention" : "bg-accent anim-pulse",
            )}
          />
          {phase >= 8 ? "Done" : waiting ? "Needs you" : "Running"}
        </span>
      </div>

      <div className="h-[372px] space-y-3 overflow-hidden px-4 py-4 sm:px-5">
        <Appear show={phase >= 1}>
          <div className="ml-auto w-fit max-w-[85%] rounded-[14px] rounded-br-[4px] bg-sunken px-3.5 py-2 text-13 text-fg">
            Bob asked about a sync tomorrow. Tell him 3pm works if I'm free.
          </div>
        </Appear>

        <Appear show={phase >= 2}>
          <div className="rounded-card border border-line px-3 py-1">
            <Step name="gmail" label="Read the thread from Bob" done={phase >= 3} />
            <Appear show={phase >= 3}>
              <Step name="calendar" label="Check tomorrow 3–4pm" done={phase >= 4} />
            </Appear>
          </div>
        </Appear>

        <Appear show={phase >= 4}>
          <p className="text-13 leading-relaxed text-fg">
            <Typed
              show={phase >= 4}
              text="You're free at 3pm. Here's the reply. I'll send it once you approve."
            />
          </p>
        </Appear>

        <Appear show={phase >= 5}>
          {approved ? (
            <div className="anim-pop-in flex items-center gap-2 rounded-card border border-ok/25 bg-ok-soft/60 px-3.5 py-2.5 text-13">
              <Check className="size-4 text-ok" strokeWidth={2.25} />
              <span className="text-fg">Approved by you</span>
              <span className="truncate text-fg-muted">· email sent to bob@acme.com</span>
            </div>
          ) : (
            <div className="anim-glow overflow-hidden rounded-card border border-attention/35">
              <div className="bg-attention-soft px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-12 font-medium text-attention">
                  <span className="relative grid size-1.5 place-items-center">
                    <span className="m-ring absolute size-1.5 rounded-full bg-attention" />
                    <span className="size-1.5 rounded-full bg-attention" />
                  </span>
                  Needs your approval
                </div>
                <p className="mt-0.5 text-13 font-medium text-fg">
                  Email bob@acme.com: “Re: Sync tomorrow?”
                </p>
              </div>
              <div className="border-t border-attention/20 bg-surface px-3.5 py-2.5 text-13 leading-relaxed text-fg">
                Hi Bob, 3pm tomorrow works for me. Talk then. Ada
              </div>
              <div className="flex items-center gap-2 border-t border-line bg-surface px-3.5 py-2">
                <span
                  ref={button}
                  className={cx(
                    "btn btn-primary btn-sm pointer-events-none transition-[scale,box-shadow] duration-150",
                    phase === 6 && "scale-95 ring-4 ring-accent/25",
                  )}
                >
                  <Check className="size-3.5" />
                  Approve
                </span>
                <span className="btn btn-sm pointer-events-none">Edit</span>
                <span className="btn btn-sm btn-ghost pointer-events-none">Deny</span>
                <span className="ml-auto hidden items-center gap-1 text-12 text-fg-faint sm:flex">
                  <ShieldCheck className="size-3.5" />
                  Sends always ask
                </span>
              </div>
            </div>
          )}
        </Appear>

        <Appear show={phase >= 8}>
          <p className="text-13 leading-relaxed text-fg">
            <Typed show={phase >= 8} text="Sent. Bob has his answer: 3pm tomorrow." />
          </p>
        </Appear>
      </div>

      <Pointer phase={phase} target={target} />
    </div>
  );
}
