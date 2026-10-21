"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/format";

/** A terminal that types its commands out once visible, with a copy button. */
export function CopyCommand({ lines, dark = false }: { lines: string[]; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const total = lines.reduce((n, l) => n + l.length, 0);
  const [typed, setTyped] = useState(total);
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setTyped(0);
    let id: ReturnType<typeof setInterval>;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        let n = 0;
        id = setInterval(() => {
          n = Math.min(total, n + 2);
          setTyped(n);
          if (n >= total) clearInterval(id);
        }, 16);
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearInterval(id);
    };
  }, [total]);

  let left = typed;
  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-card border",
        dark
          ? "border-white/10 bg-[#201f1a] text-[#f4f1ea] shadow-[0_30px_60px_-24px_rgb(0_0_0/0.7)] [--fg:#f4f1ea] [--fg-faint:#8f897b] [--fg-muted:#b9b2a3]"
          : "border-line bg-sunken",
      )}
    >
      <div
        className={cx(
          "flex items-center justify-between border-b px-4 py-2",
          dark ? "border-white/10" : "border-line",
        )}
      >
        <span className="flex items-center gap-2 text-12 text-fg-muted">
          <span className="flex gap-1.5">
            <span className="size-2 rounded-full bg-line-strong" />
            <span className="size-2 rounded-full bg-line-strong" />
            <span className="size-2 rounded-full bg-line-strong" />
          </span>
          Terminal
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(lines.join("\n")).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        ref={ref}
        className={cx(
          "min-h-[124px] overflow-x-auto px-4 py-3.5 font-mono leading-relaxed text-fg",
          dark ? "text-[15px] sm:px-6 sm:py-5" : "text-13",
        )}
      >
        {lines.map((line) => {
          const shown = line.slice(0, Math.max(0, left));
          const active = left > 0 && left < line.length + 1 && typed < total;
          left -= line.length;
          if (!shown && !active) return <div key={line}>&nbsp;</div>;
          return (
            <div key={line}>
              {line.startsWith("#") ? (
                <span className="text-fg-faint">{shown}</span>
              ) : (
                <>
                  <span className="select-none text-fg-faint">$ </span>
                  {shown}
                </>
              )}
              {(active || (typed >= total && line === lines.at(-1))) && (
                <span className="landing-caret ml-0.5 inline-block h-[1.1em] w-[7px] translate-y-[3px] bg-accent/70" />
              )}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
