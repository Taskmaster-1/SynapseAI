"use client";

import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { cx } from "@/lib/format";

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * How far the page has scrolled through `ref`: 0 when its top reaches the top of the
 * viewport, 1 when its bottom reaches the bottom. Drives the pinned sequences.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      setProgress(span <= 0 ? 1 : Math.min(1, Math.max(0, -r.top / span)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [ref]);
  return progress;
}

/** True once `ref` has scrolled into view (stays true). */
export function useInView(ref: RefObject<HTMLElement | null>, margin = "-15%"): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: `0px 0px ${margin} 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return seen;
}

/** Leans gently toward the pointer, like a magnet. */
export function Magnetic({
  children,
  strength = 6,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={ref}
      className={cx("inline-flex transition-transform duration-300 ease-out", className)}
      onPointerMove={(e) => {
        if (prefersReducedMotion() || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width - 0.5) * 2 * strength;
        const y = ((e.clientY - r.top) / r.height - 0.5) * 2 * strength;
        e.currentTarget.style.transform = `translate(${x}px, ${y}px)`;
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.transform = "";
      }}
    >
      {children}
    </span>
  );
}

/** Tilts a few degrees toward the pointer. */
export function Tilt({
  children,
  className,
  max = 4,
  style,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cx("transition-transform duration-300 ease-out", className)}
      style={style}
      onPointerMove={(e) => {
        if (prefersReducedMotion() || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        e.currentTarget.style.transform = `perspective(900px) rotateX(${-y * max}deg) rotateY(${x * max}deg) translateY(-4px)`;
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.transform = "";
      }}
    >
      {children}
    </div>
  );
}
