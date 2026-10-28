import { ArrowDown, Star } from "lucide-react";
import type { CSSProperties } from "react";
import { CopyCommand } from "./copy-command";
import { formatStars, GITHUB } from "./github";
import { Magnetic } from "./motion";
import { PhoneSequence } from "./phone-sequence";

export const SELF_HOST_LINES = [
  "git clone https://github.com/Taskmaster-1/SynapseAI",
  "cd SynapseAI && cp .env.example .env",
  "# add SYNAPSE_SECRET and a model key to .env",
  "docker compose up -d",
];

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

function Headline() {
  const lines: [string, boolean][] = [
    ["Hand off the work.", false],
    ["Keep the last word.", true],
  ];
  return (
    <h1 className="font-serif text-[clamp(48px,7vw,104px)] leading-[0.94] tracking-[-0.025em] text-fg">
      <span className="sr-only">Hand off the work. Keep the last word.</span>
      <span aria-hidden="true">
        {lines.map(([text, italic], i) => (
          <span key={text} className="landing-line">
            <span className={italic ? "text-accent italic" : undefined} style={d(120 + i * 120)}>
              {text}
            </span>
          </span>
        ))}
      </span>
    </h1>
  );
}

export function GitHubButton({ stars, size = "md" }: { stars: number | null; size?: "md" | "lg" }) {
  return (
    <Magnetic>
      <a
        href={GITHUB}
        className={`group inline-flex items-center gap-2 rounded-full border border-fg/15 font-medium text-fg transition-colors hover:border-fg/40 ${size === "lg" ? "h-14 px-6 text-[16px]" : "h-11 px-5 text-[15px]"}`}
      >
        <Star className="size-4 transition-[rotate,color] duration-500 group-hover:rotate-[144deg] group-hover:text-attention" />
        Star on GitHub
        {stars !== null && (
          <span className="tabular -mr-1 rounded-full bg-ink/[0.07] px-2 py-0.5 font-mono text-[12px]">
            {formatStars(stars)}
          </span>
        )}
      </a>
    </Magnetic>
  );
}

export function Hero({ stars }: { stars: number | null }) {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-[1280px] items-center gap-14 px-5 pt-14 pb-20 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10 lg:pt-24 lg:pb-28">
        <div className="min-w-0">
          <p className="landing-rise font-mono text-[12px] tracking-[0.14em] uppercase opacity-70">
            Open-source AI agent · MIT · self-hosted
          </p>
          <div className="mt-5">
            <Headline />
          </div>
          <p
            className="landing-rise mt-7 max-w-[560px] text-[18px] leading-[1.55] text-fg-muted"
            style={d(450)}
          >
            Synapse works through your email, calendar and tools on its own. Before anything is
            sent, changed or deleted, it asks: on your phone, in Slack or in the app. It asks less
            as it learns your rules, and every approved send waits ten seconds for Undo.
          </p>
          <div className="landing-rise mt-8 max-w-[560px]" style={d(600)}>
            <CopyCommand lines={SELF_HOST_LINES} />
          </div>
          <div className="landing-rise mt-5 flex flex-wrap items-center gap-3" style={d(700)}>
            <GitHubButton stars={stars} />
            <a
              href="#hack"
              className="group inline-flex h-11 items-center gap-2 rounded-full px-3 text-[15px] font-medium text-fg-muted transition-colors hover:text-fg"
            >
              Try to hack it
              <ArrowDown className="size-4 transition-transform duration-300 group-hover:translate-y-0.5" />
            </a>
          </div>
        </div>
        <div className="landing-rise min-w-0" style={d(300)}>
          <PhoneSequence />
        </div>
      </div>
    </section>
  );
}
