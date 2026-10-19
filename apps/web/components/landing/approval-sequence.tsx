"use client";

import { Check, PenLine } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { EffectPill, Monogram } from "@/components/ui";
import { cx } from "@/lib/format";
import { prefersReducedMotion, useInView, useScrollProgress } from "./motion";

const STAGES = [
  { title: "It proposes.", body: "The agent drafts the exact email it wants to send." },
  { title: "You edit.", body: "Change a word, a recipient, anything. It sends your version." },
  { title: "You sign.", body: "One click, or ⌘↵. Nothing leaves before this moment." },
  { title: "It acts.", body: "Sent, logged, and receipted. Every time." },
] as const;

const BASE = "Hi Bob, 3pm tomorrow works";
const DRAFT_TAIL = ". Talk then.";
const EDIT_TAIL = " for me. I'll bring the Q4 numbers.";

/** 0..3 from scroll on wide screens; from a timer on small ones or when not pinned. */
function useStage(section: React.RefObject<HTMLElement | null>): { stage: number; t: number } {
  const progress = useScrollProgress(section);
  const seen = useInView(section, "-30%");
  const [wide, setWide] = useState(true);
  const [timed, setTimed] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const set = () => setWide(mq.matches && !prefersReducedMotion());
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  useEffect(() => {
    if (wide || !seen) return;
    if (prefersReducedMotion()) return setTimed(3.99);
    let s = 0;
    const id = setInterval(() => {
      s = (s + 1) % 5;
      setTimed(Math.min(s, 3) + 0.99);
    }, 1800);
    return () => clearInterval(id);
  }, [wide, seen]);

  const value = wide ? Math.min(3.99, progress * 4.4) : timed;
  return { stage: Math.floor(value), t: value - Math.floor(value) };
}

function Typed({ text, upto }: { text: string; upto: number }) {
  const n = Math.round(text.length * Math.min(1, Math.max(0, upto)));
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && (
        <span className="landing-caret ml-0.5 inline-block h-[0.95em] w-[2px] translate-y-[3px] bg-ink" />
      )}
    </>
  );
}

export function ApprovalSequence() {
  const section = useRef<HTMLElement>(null);
  const { stage, t } = useStage(section);
  const body =
    stage === 0 ? (
      <Typed text={BASE + DRAFT_TAIL} upto={t * 1.6} />
    ) : stage === 1 ? (
      <>
        {BASE}
        <span className="line-through decoration-danger decoration-2 opacity-45">{DRAFT_TAIL}</span>
        <span className="rounded-sm bg-accent-soft text-accent">
          <Typed text={EDIT_TAIL} upto={0.15 + t * 1.5} />
        </span>
      </>
    ) : (
      BASE + EDIT_TAIL
    );

  return (
    <section
      ref={section}
      aria-labelledby="moment-title"
      className="landing-sheet z-10 bg-field-amber text-ink lg:h-[340vh]"
    >
      <div className="top-0 flex min-h-dvh items-center lg:sticky lg:h-dvh">
        <div className="mx-auto grid w-full max-w-[1280px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:py-0">
          <div>
            <p className="font-mono text-[12px] tracking-[0.14em] uppercase opacity-70">
              The moment that matters
            </p>
            <h2
              id="moment-title"
              className="mt-4 font-serif text-[clamp(44px,6vw,88px)] leading-[0.95] tracking-[-0.02em]"
            >
              Nothing leaves
              <br />
              <span className="italic">without you.</span>
            </h2>
            <ol className="mt-10 space-y-1">
              {STAGES.map((s, i) => (
                <li
                  key={s.title}
                  className={cx(
                    "grid grid-cols-[28px_1fr] gap-x-3 border-t border-ink/20 py-3 transition-opacity duration-500",
                    i === stage ? "opacity-100" : "opacity-45",
                  )}
                >
                  <span className="pt-1 font-mono text-[12px]">0{i + 1}</span>
                  <div>
                    <p className="font-serif text-[26px] leading-tight">{s.title}</p>
                    <p
                      className={cx(
                        "grid text-[15px] leading-relaxed transition-[grid-template-rows,opacity] duration-500",
                        i === stage ? "grid-rows-[1fr] opacity-80" : "grid-rows-[0fr] opacity-0",
                      )}
                    >
                      <span className="min-h-0 overflow-hidden">{s.body}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="relative grid place-items-center">
            {/* The card flies off as a receipt once it acts. */}
            <div
              className="relative w-full max-w-[600px] transition-[translate,rotate,opacity] duration-700 ease-[cubic-bezier(.65,0,.35,1)]"
              style={
                {
                  translate:
                    stage === 3
                      ? `${Math.min(1, t * 1.5) * 18}% ${-Math.min(1, t * 1.5) * 10}%`
                      : "0 0",
                  rotate: stage === 3 ? `${3 + Math.min(1, t * 1.5) * 4}deg` : "-1.5deg",
                } as CSSProperties
              }
            >
              <div className="landing-slip overflow-hidden text-fg">
                <div className="flex items-center gap-2 border-b border-dashed border-line-strong px-6 py-3.5 text-[13px]">
                  <Monogram name="gmail" size={20} />
                  <span className="font-medium">gmail · Send email</span>
                  <EffectPill effect="send" className="ml-1" />
                  <span className="ml-auto font-mono text-[11px] text-fg-faint">
                    {stage >= 3 ? "sent 09:15" : stage >= 1 ? "edited" : "draft"}
                  </span>
                </div>
                <div className="space-y-2 px-6 pt-5 text-[14px]">
                  <div className="flex gap-4">
                    <span className="w-16 text-fg-faint">To</span>
                    <span className="font-medium">bob@acme.com</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="w-16 text-fg-faint">Subject</span>
                    <span>Re: Sync tomorrow?</span>
                  </div>
                </div>
                <p className="min-h-[150px] px-6 pt-5 font-serif text-[clamp(22px,2.4vw,30px)] leading-[1.25]">
                  {body}
                </p>
                <div className="relative flex items-center gap-2 border-t border-line px-6 py-4">
                  <span
                    className={cx(
                      "inline-flex h-10 items-center gap-2 rounded-full px-5 text-[14px] font-medium transition-[background-color,color,scale] duration-300",
                      stage >= 2 ? "scale-95 bg-ok text-white" : "bg-ink text-paper",
                    )}
                  >
                    <Check className="size-4" />
                    {stage >= 2 ? "Signed off" : "Approve"}
                  </span>
                  <span
                    className={cx(
                      "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[14px] transition-colors duration-300",
                      stage === 1
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line-strong",
                    )}
                  >
                    <PenLine className="size-4" />
                    Edit
                  </span>
                  <span className="ml-auto hidden font-mono text-[11px] text-fg-faint sm:inline">
                    ⌘↵ to approve
                  </span>
                  {stage >= 2 && (
                    <span className="landing-stamp landing-stamp-in absolute -top-10 right-8 text-[clamp(22px,2.6vw,34px)] text-ok">
                      Approved
                    </span>
                  )}
                </div>
              </div>
            </div>
            {stage === 3 && (
              <p className="anim-fade-in absolute bottom-[6%] left-[4%] flex items-center gap-2 rounded-full bg-ink px-4 py-2 font-mono text-[12px] text-paper">
                <Check className="size-3.5 text-[#7ee2a8]" /> Sent to bob@acme.com · logged · $0.004
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
