"use client";

import { Check, Undo2, X } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { BrandGlyph } from "@/components/ui";
import { cx } from "@/lib/format";
import { prefersReducedMotion } from "./motion";

/*
 * An approval arriving as a push notification, approved from the lock screen, waiting out
 * the undo window, then sent. The words match what Synapse's push notifications say.
 * Everything happens inside a fixed-size phone, so nothing around it moves.
 */

const PHASES = [
  { id: "lock", ms: 900 },
  { id: "arrive", ms: 1300 },
  { id: "expand", ms: 1700 },
  { id: "press", ms: 550 },
  { id: "undo", ms: 10_000 },
  { id: "sent", ms: 2800 },
] as const;
type Phase = (typeof PHASES)[number]["id"];

const TOTAL = PHASES.reduce((n, p) => n + p.ms, 0);
const START_OF = Object.fromEntries(
  PHASES.map((p, i) => [p.id, PHASES.slice(0, i).reduce((n, q) => n + q.ms, 0)]),
) as Record<Phase, number>;

function phaseAt(t: number): { phase: Phase; into: number } {
  let left = t % TOTAL;
  for (const p of PHASES) {
    if (left < p.ms) return { phase: p.id, into: left };
    left -= p.ms;
  }
  return { phase: "lock", into: 0 };
}

const STEPS: { label: string; phases: Phase[] }[] = [
  { label: "Push arrives", phases: ["arrive", "expand"] },
  { label: "Approve", phases: ["press"] },
  { label: "10 s to undo", phases: ["undo"] },
  { label: "Sent", phases: ["sent"] },
];

export function PhoneSequence() {
  const ref = useRef<HTMLDivElement>(null);
  // Server render and reduced motion both show the notification open, ready to approve.
  const [t, setT] = useState(START_OF.expand + 300);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setStill(true);
      setT(START_OF.undo + 200);
      return;
    }
    const el = ref.current;
    let visible = true;
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
    });
    if (el) io.observe(el);
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(500, now - last);
      last = now;
      if (visible && document.visibilityState === "visible") setT((v) => v + dt);
    }, 100);
    return () => {
      clearInterval(id);
      io.disconnect();
    };
  }, []);

  const { phase, into } = phaseAt(t);
  const seconds = still ? 10 : Math.max(1, Math.ceil((10_000 - into) / 1000));
  const shown = phase !== "lock";
  const open = phase === "expand" || phase === "press";
  const approved = phase === "undo" || phase === "sent";

  return (
    <div ref={ref} className="relative mx-auto w-[260px] sm:w-[290px]">
      {/* The phone */}
      <div
        aria-hidden="true"
        className="relative aspect-[9/19] rounded-[46px] bg-ink p-[9px] shadow-[0_40px_80px_-30px_rgb(21_20_15/0.55),0_0_0_1px_rgb(21_20_15/0.9)]"
      >
        <div className="relative h-full overflow-hidden rounded-[38px] bg-field-blue text-paper">
          <div className="absolute top-2.5 left-1/2 h-[22px] w-[84px] -translate-x-1/2 rounded-full bg-ink" />
          <div className="absolute inset-x-0 top-[11%] text-center">
            <p className="text-[12px] font-medium opacity-80">Tuesday 14 October</p>
            <p className="font-serif text-[76px] leading-[0.95] tracking-[-0.02em]">9:41</p>
          </div>

          {/* The notification */}
          <div
            className={cx(
              "absolute inset-x-2.5 top-[37%] transition-[translate,opacity] duration-500 ease-[cubic-bezier(.2,.7,.2,1)]",
              shown && phase !== "sent" ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0",
            )}
          >
            <div className="rounded-[20px] bg-paper/95 p-3 text-ink shadow-[0_10px_30px_-12px_rgb(0_0_0/0.5)]">
              <div className="flex items-center gap-2 text-[11px] text-ink/60">
                <span className="grid size-5 place-items-center rounded-[6px] bg-ink">
                  <BrandGlyph className="size-3.5 text-paper" />
                </span>
                <span className="font-medium tracking-wide uppercase">Synapse</span>
                <span className="ml-auto">now</span>
              </div>
              <p className="mt-1.5 text-[13.5px] leading-snug font-semibold">
                {approved ? `Approved · sending in ${seconds}s` : "Synapse needs your OK"}
              </p>
              <p className="text-[13px] leading-snug text-ink/75">
                Email bob@acme.com: Re: Sync tomorrow?
              </p>
              {approved && !still && phase === "undo" && (
                <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-ink/10">
                  <div
                    key={Math.floor(t / TOTAL)}
                    className="undo-fuse h-full bg-attention"
                    style={
                      {
                        "--fuse": "10s",
                        animationDelay: `-${into}ms`,
                      } as CSSProperties
                    }
                  />
                </div>
              )}
              {approved && still && <div className="mt-2 h-[3px] rounded-full bg-attention" />}
            </div>

            {/* Notification actions, as the lock screen shows them on a long press. */}
            <div
              className={cx(
                "mt-1.5 grid overflow-hidden transition-[grid-template-rows,opacity] duration-300",
                open || approved ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="min-h-0">
                <div className="overflow-hidden rounded-[16px] bg-paper/95 text-[14px] text-ink">
                  {approved ? (
                    <span className="flex h-11 items-center gap-2 px-3.5 font-medium">
                      <Undo2 className="size-4" /> Undo
                    </span>
                  ) : (
                    <>
                      <span
                        className={cx(
                          "relative flex h-11 items-center gap-2 border-b border-ink/10 px-3.5 font-medium transition-colors duration-200",
                          phase === "press" && "bg-ink/10",
                        )}
                      >
                        <Check className="size-4 text-ok" /> Approve
                        {phase === "press" && (
                          <span className="absolute top-1/2 left-[46%] size-9 -translate-1/2 animate-[m-pop_380ms_var(--ease-spring)_both] rounded-full bg-ink/20" />
                        )}
                      </span>
                      <span className="flex h-11 items-center gap-2 px-3.5">
                        <X className="size-4 text-danger" /> Deny
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-2 flex justify-center">
            <span className="h-1 w-[34%] rounded-full bg-paper/70" />
          </div>
        </div>
      </div>

      {/* Outside the phone: the site's own stamp, not phone UI. */}
      {phase === "sent" && (
        <span className="landing-stamp landing-stamp-in absolute top-[46%] -right-6 bg-paper/80 text-[26px] text-ok sm:-right-10">
          Sent
        </span>
      )}

      <ol className="mt-6 grid grid-cols-4 gap-1.5 text-center font-mono text-[10.5px] leading-tight tracking-wide uppercase">
        {STEPS.map((s, i) => {
          const active = !still && s.phases.includes(phase);
          return (
            <li
              key={s.label}
              className={cx(
                "border-t-2 pt-2 transition-[border-color,opacity] duration-300",
                active ? "border-ink opacity-100" : "border-ink/15",
                still || active ? "opacity-100" : "opacity-55",
              )}
            >
              <span className="block opacity-60">0{i + 1}</span>
              {s.label}
            </li>
          );
        })}
      </ol>
      <p className="sr-only">
        An approval arrives as a push notification: “Synapse needs your OK. Email bob@acme.com: Re:
        Sync tomorrow?” You tap Approve on the lock screen. The notification changes to “Approved,
        sending in 10 seconds” with an Undo button. When the 10 seconds are up, the email is sent.
      </p>
    </div>
  );
}
