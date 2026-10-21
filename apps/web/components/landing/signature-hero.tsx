import { ArrowRight, Star } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { EffectPill, Monogram } from "@/components/ui";
import { Magnetic } from "./motion";

const GITHUB = "https://github.com/Taskmaster-1/SynapseAI";

/*
 * The hero is laid out on a 1440 × 900 canvas (percentages on large screens) so the
 * signature line, the tool chips it threads through and the slip it lands on stay aligned
 * at any width. The line ends by drawing the check on the slip.
 */
const SIGNATURE =
  "M -40 792 C 110 792 180 748 300 748 S 450 822 560 822 S 700 742 800 742 S 900 590 930 506 L 958 532 L 1030 452";

const CHIPS: { name: string; x: number; y: number; r: number; d: number; label: string }[] = [
  { name: "GitHub", x: 300, y: 748, r: -4, d: 900, label: "read 3 PRs" },
  { name: "Linear", x: 560, y: 822, r: 3, d: 1300, label: "found ENG-212" },
  { name: "Gmail", x: 800, y: 742, r: -2, d: 1700, label: "drafted a reply" },
];

const pct = (x: number, y: number): CSSProperties => ({
  left: `${(x / 1440) * 100}%`,
  top: `${(y / 900) * 100}%`,
});

/** The approval slip from the hero; the sign-in page reuses it. */
export function Slip({
  className,
  style,
  stampDelay = 3100,
}: {
  className?: string;
  style?: CSSProperties;
  stampDelay?: number;
}) {
  return (
    <div className={className} style={style}>
      <div className="landing-slip relative overflow-hidden rotate-[2.5deg]">
        <div className="flex items-center gap-2 border-b border-dashed border-line-strong px-5 py-3 text-12 text-fg-muted">
          <span className="relative grid size-2 place-items-center">
            <span className="m-ring absolute size-2 rounded-full bg-attention" />
            <span className="size-2 rounded-full bg-attention" />
          </span>
          <span className="font-medium text-attention">Needs your sign-off</span>
          <span className="ml-auto font-mono text-[11px] text-fg-faint">09:14</span>
        </div>
        <div className="space-y-1.5 px-5 pt-4 text-[13px]">
          <div className="flex gap-3">
            <span className="w-14 text-fg-faint">To</span>
            <span className="font-medium">bob@acme.com</span>
          </div>
          <div className="flex gap-3">
            <span className="w-14 text-fg-faint">Subject</span>
            <span>Re: Sync tomorrow?</span>
          </div>
          <p className="pt-3 font-serif text-[22px] leading-[1.25] text-fg">
            Hi Bob, 3pm tomorrow works for me. Talk then.
            <br />
            <span className="italic">Ada</span>
          </p>
        </div>
        <div className="mt-4 flex items-end justify-between gap-4 px-5 pb-5">
          <div className="min-w-0 flex-1">
            <div className="h-10" />
            <div className="border-t border-fg/70 pt-1 font-mono text-[10px] tracking-wider text-fg-faint uppercase">
              Signed off by you
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Monogram name="gmail" size={18} />
            <EffectPill effect="send" />
          </div>
        </div>
        <span
          className="landing-stamp landing-stamp-in absolute right-5 bottom-14 text-[15px] text-ok"
          style={{ "--d": `${stampDelay}ms` } as CSSProperties}
        >
          Approved
        </span>
      </div>
    </div>
  );
}

function Headline() {
  const lines: [string, boolean][] = [
    ["Your agent", false],
    ["does the work.", false],
    ["You sign it off.", true],
  ];
  return (
    <h1 className="font-serif text-[clamp(52px,8.6vw,128px)] leading-[0.92] tracking-[-0.025em] text-fg">
      <span className="sr-only">Your agent does the work. You sign it off.</span>
      <span aria-hidden="true">
        {lines.map(([text, italic], i) => (
          <span key={text} className="landing-line">
            <span
              className={italic ? "text-accent italic" : undefined}
              style={{ "--d": `${120 + i * 110}ms` } as CSSProperties}
            >
              {text}
            </span>
          </span>
        ))}
      </span>
    </h1>
  );
}

function Lede() {
  return (
    <>
      <p
        className="landing-rise max-w-[440px] text-[18px] leading-[1.5] text-fg-muted"
        style={{ "--d": "550ms" } as CSSProperties}
      >
        Synapse is an open-source agent for GitHub, Linear, Notion and any MCP server. It reads on
        its own. Anything that sends, changes or deletes waits for your signature.
      </p>
      <div
        className="landing-rise mt-7 flex flex-wrap items-center gap-3"
        style={{ "--d": "700ms" } as CSSProperties}
      >
        <Magnetic>
          <Link
            href="/sign-up"
            className="group inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 text-[15px] font-medium text-paper transition-colors hover:bg-accent"
          >
            Start delegating
            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </Magnetic>
        <Magnetic>
          <a
            href={GITHUB}
            className="group inline-flex h-12 items-center gap-2 rounded-full border border-fg/15 px-5 text-[15px] font-medium text-fg transition-colors hover:border-fg/40"
          >
            <Star className="size-4 transition-[rotate,color] duration-500 group-hover:rotate-[144deg] group-hover:text-attention" />
            Star on GitHub
          </a>
        </Magnetic>
      </div>
    </>
  );
}

export function SignatureHero() {
  return (
    <section className="relative overflow-hidden">
      {/* Large screens: the composed canvas. */}
      <div className="relative mx-auto hidden aspect-[1440/900] max-h-[920px] w-full max-w-[1600px] lg:block">
        <div className="absolute" style={{ left: "5.5%", top: "11%", width: "62%" }}>
          <Headline />
        </div>
        <div className="absolute" style={{ left: "5.5%", top: "58%", width: "38%" }}>
          <Lede />
        </div>
        <Slip
          className="landing-rise absolute"
          style={{ ...pct(900, 250), width: "30%", "--d": "400ms" } as CSSProperties}
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 1440 900"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
        >
          <path
            className="sig-path"
            d={SIGNATURE}
            pathLength={1}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {CHIPS.map((c) => (
          <div
            key={c.name}
            className="sig-chip z-20 flex items-center gap-2 rounded-full bg-surface py-1.5 pr-3.5 pl-1.5 text-[13px] shadow-[var(--slip-shadow)]"
            style={{ ...pct(c.x, c.y), "--r": `${c.r}deg`, "--d": `${c.d}ms` } as CSSProperties}
          >
            <Monogram name={c.name} size={24} round />
            <span className="font-medium">{c.name}</span>
            <span className="font-mono text-[11px] text-fg-faint">{c.label}</span>
          </div>
        ))}
      </div>

      {/* Small screens: stacked, no line. */}
      <div className="px-5 pt-12 pb-16 lg:hidden">
        <Headline />
        <div className="mt-6">
          <Lede />
        </div>
        <Slip
          className="landing-rise mx-auto mt-12 max-w-[420px]"
          style={{ "--d": "500ms" } as CSSProperties}
        />
      </div>
    </section>
  );
}
