"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { cx } from "@/lib/format";
import { prefersReducedMotion, useInView } from "./motion";

/** Real captures of the app running on the seeded demo data (`bun run seed`). */
const FRAMES = [
  {
    src: "/product/home.webp",
    path: "/",
    label: "Brief",
    caption: "Home is a briefing: what needs you, what ran, what it cost.",
  },
  {
    src: "/product/task.webp",
    path: "/t/…",
    label: "Draft",
    caption: "The agent drafts the email and stops at the line for your signature.",
  },
  {
    src: "/product/approved.webp",
    path: "/inbox",
    label: "Sign",
    caption: "Approve with one click or ⌘↵. Edit first if you want your words.",
  },
  {
    src: "/product/receipt.webp",
    path: "/t/…",
    label: "Receipt",
    caption: "Every run ends with a receipt: steps, tools, tokens and cost.",
  },
] as const;

const DWELL_MS = 4800;

export function ProductTour() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, "-25%");
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => setStill(prefersReducedMotion()), []);

  // `i` restarts the dwell timer after a manual pick, not just after an automatic advance.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!seen || paused || still) return;
    const id = setTimeout(() => setI((n) => (n + 1) % FRAMES.length), DWELL_MS);
    return () => clearTimeout(id);
  }, [seen, paused, still, i]);

  const frame = FRAMES[i] ?? FRAMES[0];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only pause the autoplay
    <div
      ref={ref}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="overflow-hidden rounded-[14px] bg-paper shadow-[0_40px_80px_-30px_rgb(21_20_15/0.45),0_0_0_1px_rgb(21_20_15/0.08)]">
        <div className="flex items-center gap-3 border-b border-ink/10 bg-[#ebe6db] px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-ink/15" />
            <span className="size-2.5 rounded-full bg-ink/15" />
            <span className="size-2.5 rounded-full bg-ink/15" />
          </span>
          <span className="mx-auto min-w-0 truncate rounded-full bg-paper px-4 py-1 font-mono text-[11px] text-ink/60">
            localhost:3000{frame.path}
          </span>
          <span className="w-[42px]" aria-hidden="true" />
        </div>
        <div className="relative aspect-[1280/800] bg-paper">
          {FRAMES.map((f, n) => (
            // biome-ignore lint/performance/noImgElement: static captures; exact pixels matter more than resizing
            <img
              key={f.src}
              src={f.src}
              alt={n === i ? `Synapse app: ${f.caption}` : ""}
              aria-hidden={n === i ? undefined : true}
              width={2560}
              height={1600}
              loading={n === 0 ? "eager" : "lazy"}
              decoding="async"
              className={cx(
                "absolute inset-0 h-full w-full object-cover object-top transition-[opacity,scale] duration-700 ease-out",
                n === i ? "scale-100 opacity-100" : "scale-[1.015] opacity-0",
              )}
            />
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-4 gap-3 sm:gap-5" role="tablist" aria-label="Tour steps">
        {FRAMES.map((f, n) => (
          <button
            key={f.src}
            type="button"
            role="tab"
            aria-selected={n === i}
            onClick={() => setI(n)}
            className="group text-left"
          >
            <span className="block h-[3px] overflow-hidden rounded-full bg-ink/15">
              <span
                className={cx(
                  "block h-full origin-left bg-ink",
                  n < i || (n === i && (still || !seen)) ? "scale-x-100" : "scale-x-0",
                  n === i && seen && !still && "tour-progress",
                )}
                style={
                  {
                    "--dwell": `${DWELL_MS}ms`,
                    animationPlayState: paused ? "paused" : "running",
                  } as CSSProperties
                }
              />
            </span>
            <span
              className={cx(
                "mt-2.5 block font-mono text-[11px] tracking-[0.14em] uppercase transition-opacity",
                n === i ? "opacity-100" : "opacity-50 group-hover:opacity-80",
              )}
            >
              <span className="hidden sm:inline">0{n + 1} </span>
              {f.label}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-4 min-h-[3em] max-w-[560px] text-[17px] leading-relaxed" aria-live="polite">
        {frame.caption}
      </p>
    </div>
  );
}
