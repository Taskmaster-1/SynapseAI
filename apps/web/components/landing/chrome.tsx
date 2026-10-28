import { Check, Star } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandGlyph } from "@/components/ui";
import { formatStars, GITHUB } from "./github";

/**
 * Nav, footer and page frame shared by the marketing pages. `home` is the landing page's
 * own path for in-page anchors: "" on the landing itself, "/welcome" elsewhere (a
 * signed-in visitor's "/" is their workspace, not the landing).
 */
export function Nav({ home = "", stars = null }: { home?: string; stars?: number | null }) {
  return (
    <header className="sticky top-3 z-[80] px-3 sm:top-4">
      <div className="mx-auto flex h-14 max-w-[920px] items-center gap-5 rounded-full border border-ink/10 bg-paper/80 pr-2 pl-5 shadow-[0_8px_30px_-12px_rgb(21_20_15/0.25)] backdrop-blur-xl">
        <Link href={home || "/"} aria-label="Synapse home" className="flex items-center gap-2">
          <BrandGlyph animated className="size-[22px] text-ink" />
          <span className="text-[16px] font-semibold tracking-[-0.02em]">Synapse</span>
        </Link>
        <nav className="hidden items-center gap-5 text-[14px] text-fg-muted md:flex">
          <a href={`${home}#hack`} className="hover:text-fg">
            Try to hack it
          </a>
          <a href={`${home}#features`} className="hover:text-fg">
            Features
          </a>
          <Link href="/trust" className="hover:text-fg">
            Trust
          </Link>
          <a href={GITHUB} className="inline-flex items-center gap-1.5 hover:text-fg">
            GitHub
            {stars !== null && (
              <span className="tabular inline-flex items-center gap-0.5 font-mono text-[12px]">
                <Star className="size-3" />
                {formatStars(stars)}
              </span>
            )}
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/sign-in"
            className="hidden h-10 items-center rounded-full px-4 text-[14px] text-fg-muted hover:text-fg sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-[14px] font-medium text-paper transition-colors hover:bg-accent"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="relative z-[70] bg-paper px-5 pb-10 sm:px-8">
      <div className="mx-auto max-w-[1440px] border-t border-ink/15 pt-8">
        <div className="flex flex-col gap-6 text-[14px] text-fg-muted sm:flex-row sm:items-center">
          <span className="flex items-center gap-2 text-fg">
            <BrandGlyph className="size-5" />
            <span className="font-semibold">Synapse</span>
          </span>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <a href={GITHUB} className="hover:text-fg">
              GitHub
            </a>
            <a href={`${GITHUB}#readme`} className="hover:text-fg">
              Docs
            </a>
            <Link href="/trust" className="hover:text-fg">
              Trust
            </Link>
            <Link href="/trust#disclosure" className="hover:text-fg">
              Report a vulnerability
            </Link>
            <a href={`${GITHUB}/blob/main/LICENSE`} className="hover:text-fg">
              MIT License
            </a>
            <Link href="/sign-in" className="hover:text-fg">
              Sign in
            </Link>
          </nav>
          <p className="flex items-center gap-1.5 sm:ml-auto">
            <Check className="size-4 text-accent" /> Asks before it acts. Less over time.
          </p>
        </div>
      </div>
    </footer>
  );
}

export function MarketingFrame({
  children,
  home,
  stars,
}: {
  children: ReactNode;
  home?: string;
  stars?: number | null;
}) {
  return (
    <div className="landing landing-grain min-h-dvh overflow-x-clip">
      <Nav home={home} stars={stars} />
      <main className="-mt-[72px] pt-[72px]">{children}</main>
      <Footer />
    </div>
  );
}
