"use client";

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx } from "@/lib/format";

type RevealState = "static" | "pending" | "shown";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Plays its children's `m-*` animations the first time it scrolls into view, and lifts
 * itself in. Server-rendered content stays visible ("static") until hydration, so the
 * page reads fine without JavaScript.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li";
}) {
  const ref = useRef<HTMLDivElement & HTMLLIElement>(null);
  const [state, setState] = useState<RevealState>("static");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return setState("shown");
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return setState("shown");
    setState("pending");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      data-reveal={state}
      style={{ transitionDelay: `${delay}ms`, "--d": `${delay}ms` } as CSSProperties}
      className={cx(
        "transition-[opacity,translate] duration-700 ease-[cubic-bezier(.2,.7,.2,1)]",
        state === "pending" && "translate-y-5 opacity-0",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Counts up to `value` once visible. Plain props so server components can render it. */
export function CountUp({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1400,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    let raf = 0;
    setN(0);
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - start) / duration);
        setN(value * (1 - (1 - p) ** 3));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {n.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** A card whose soft highlight follows the pointer. */
export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx("landing-spot", className)}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--x", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--y", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}
