import type { CSSProperties } from "react";
import { EffectPill, Monogram } from "@/components/ui";

/** The stamped approval slip shown on the sign-in and sign-up pages. */
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
