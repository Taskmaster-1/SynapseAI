"use client";

import type { Effect, RunStatus, ToolCallStatus } from "@synapse/core";
import { Check, CircleQuestionMark, CircleSlash, LoaderCircle, ShieldAlert, X } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cx } from "@/lib/format";

// ---------- Brand ----------

/**
 * A connection that resolves into a check: the agent's work, signed off by you.
 * `animated` draws the stroke and lights the nodes once, on mount.
 */
export function BrandGlyph({
  className,
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={cx("size-5 overflow-visible", animated && "brand-animated", className)}
      aria-hidden="true"
    >
      <path
        className="brand-stroke"
        d="M4.4 11.6 8.3 15.3 15.6 6.7"
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="brand-start" cx="4.4" cy="11.6" r="2.3" fill="currentColor" />
      <circle className="brand-spark" cx="15.6" cy="6.7" r="2.6" fill="var(--accent)" />
    </svg>
  );
}

export function Brand({ animated = false }: { animated?: boolean }) {
  return (
    <span className="brand inline-flex items-center gap-2 text-[15px] font-medium tracking-[-0.01em] text-fg">
      <BrandGlyph animated={animated} />
      Synapse
    </span>
  );
}

// ---------- Pills ----------

export function Pill({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "attention" | "danger" | "ok" | "outline";
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-12 font-medium whitespace-nowrap",
        tone === "neutral" && "bg-sunken text-fg-muted",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "attention" && "bg-attention-soft text-attention",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "ok" && "bg-ok-soft text-ok",
        tone === "outline" && "border border-line text-fg-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

const EFFECT_TONE: Record<Effect, "neutral" | "accent" | "attention" | "danger"> = {
  read: "neutral",
  write: "accent",
  send: "attention",
  destructive: "danger",
};
const EFFECT_LABEL: Record<Effect, string> = {
  read: "Read",
  write: "Write",
  send: "Send",
  destructive: "Destructive",
};
export const EFFECT_EXPLAINER: Record<Effect, string> = {
  read: "Looks things up. Never changes anything.",
  write: "Creates or changes things inside your tools.",
  send: "Reaches other people: email, messages, comments.",
  destructive: "Deletes or overwrites. Hard to undo.",
};

export function EffectPill({ effect, className }: { effect: Effect; className?: string }) {
  return (
    <Pill
      tone={EFFECT_TONE[effect] ?? "neutral"}
      className={className}
      title={EFFECT_EXPLAINER[effect]}
    >
      {EFFECT_LABEL[effect] ?? effect}
    </Pill>
  );
}

export type TaskStatus = "running" | "needs" | "done" | "failed" | "stopped" | "idle";

export function taskStatus(status: RunStatus | null | undefined): TaskStatus {
  switch (status) {
    case "queued":
    case "running":
      return "running";
    case "waiting":
      return "needs";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
      return "stopped";
    default:
      return "idle";
  }
}

const STATUS_META: Record<
  TaskStatus,
  { label: string; dot: string; tone: Parameters<typeof Pill>[0]["tone"] }
> = {
  running: { label: "Running", dot: "bg-accent anim-pulse", tone: "accent" },
  needs: { label: "Needs you", dot: "bg-attention", tone: "attention" },
  done: { label: "Done", dot: "bg-ok", tone: "ok" },
  failed: { label: "Failed", dot: "bg-danger", tone: "danger" },
  stopped: { label: "Stopped", dot: "bg-fg-faint", tone: "neutral" },
  idle: { label: "New", dot: "bg-line-strong", tone: "neutral" },
};

export function statusLabel(s: TaskStatus) {
  return STATUS_META[s].label;
}

export function StatusDot({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span
      role="img"
      aria-label={STATUS_META[status].label}
      title={STATUS_META[status].label}
      className={cx(
        "inline-block size-2 shrink-0 rounded-full",
        STATUS_META[status].dot,
        className,
      )}
    />
  );
}

export function StatusPill({ status }: { status: TaskStatus }) {
  const m = STATUS_META[status];
  return (
    <Pill tone={m.tone}>
      <span
        className={cx("size-1.5 rounded-full", m.dot.replace("bg-line-strong", "bg-fg-faint"))}
      />
      {m.label}
    </Pill>
  );
}

/** Per-step status glyph: spinner / check / amber / x / question mark. */
export function StepStatusIcon({
  status,
  className,
}: {
  status: ToolCallStatus;
  className?: string;
}) {
  const base = cx("size-4 shrink-0", className);
  switch (status) {
    case "proposed":
    case "approved":
    case "executing":
      return <LoaderCircle className={cx(base, "anim-spin text-accent")} aria-label="Running" />;
    case "succeeded":
      return <Check className={cx(base, "text-ok")} aria-label="Done" />;
    case "awaiting_approval":
      return (
        <span
          className={cx(base, "grid place-items-center")}
          role="img"
          aria-label="Needs approval"
        >
          <span className="size-2 rounded-full bg-attention" />
        </span>
      );
    case "denied":
      return <CircleSlash className={cx(base, "text-danger")} aria-label="Denied" />;
    case "failed":
      return <X className={cx(base, "text-danger")} aria-label="Failed" />;
    case "unknown":
      return (
        <CircleQuestionMark
          className={cx(base, "text-attention")}
          aria-label="Outcome unknown: it may or may not have happened"
        />
      );
    default:
      return null;
  }
}

// ---------- Monogram ----------

const MONO_HUES = [24, 64, 150, 200, 230, 280, 330];

function hueOf(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return MONO_HUES[h % MONO_HUES.length]!;
}

/** Connection tile: first letter on a tinted square. No third-party logos. */
export function Monogram({
  name,
  size = 20,
  round = false,
  className,
}: {
  name: string;
  size?: number;
  round?: boolean;
  className?: string;
}) {
  const hue = hueOf(name.toLowerCase());
  return (
    <span
      aria-hidden="true"
      className={cx("inline-grid shrink-0 place-items-center font-semibold uppercase", className)}
      style={{
        width: size,
        height: size,
        borderRadius: round ? 999 : Math.max(4, Math.round(size / 4)),
        fontSize: Math.round(size * 0.5),
        background: `color-mix(in oklch, oklch(0.7 0.12 ${hue}) var(--mono-mix), var(--surface))`,
        color: `color-mix(in oklch, oklch(0.55 0.13 ${hue}) 85%, var(--fg))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, oklch(0.6 0.1 ${hue}) 22%, transparent)`,
      }}
    >
      {name.trim()[0] ?? "?"}
    </span>
  );
}

// ---------- Tooltip ----------

export function Tooltip({
  label,
  children,
  side = "bottom",
  align = "center",
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  align?: "center" | "start" | "end";
}) {
  const id = useId();
  return (
    <span className="group/tt relative inline-flex" aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={cx(
          "pointer-events-none absolute z-50 w-max max-w-64 rounded-md bg-fg px-2 py-1 text-12 font-normal text-canvas opacity-0 shadow-pop transition-opacity duration-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "start" && "left-0",
          align === "end" && "right-0",
        )}
      >
        {label}
      </span>
    </span>
  );
}

export const TAINT_SENTENCE = "Read outside content — actions need approval";

/** `interactive` makes it focusable for the tooltip; turn it off inside links. */
export function TaintShield({
  withLabel = false,
  align = "center",
  interactive = true,
}: {
  withLabel?: boolean;
  align?: "center" | "start" | "end";
  interactive?: boolean;
}) {
  return (
    <Tooltip label={TAINT_SENTENCE} align={align}>
      {interactive ? (
        <button
          type="button"
          className="inline-flex cursor-default items-center gap-1 rounded-full text-attention"
          aria-label={TAINT_SENTENCE}
        >
          <ShieldAlert className="size-4" />
          {withLabel ? <span className="text-12 font-medium">Outside content</span> : null}
        </button>
      ) : (
        <span role="img" className="inline-flex text-attention" aria-label={TAINT_SENTENCE}>
          <ShieldAlert className="size-4" />
        </span>
      )}
    </Tooltip>
  );
}

// ---------- Controls ----------

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-50",
        checked ? "bg-accent" : "bg-line-strong",
      )}
    >
      <span
        className={cx(
          "inline-block size-4 rounded-full bg-surface shadow-sm transition-transform duration-150",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; tone?: "accent" | "attention" | "danger" | "ok" }[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <fieldset
      aria-label={label}
      className={cx(
        "inline-flex min-w-0 rounded-[9px] border border-line bg-sunken p-0.5",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex items-center justify-center gap-1.5 rounded-[7px] font-medium whitespace-nowrap transition-colors duration-150",
              size === "sm" ? "h-6 px-2 text-12" : "h-7 px-2.5 text-13",
              on
                ? cx(
                    "bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--line)]",
                    o.tone === "danger"
                      ? "text-danger"
                      : o.tone === "attention"
                        ? "text-attention"
                        : o.tone === "ok"
                          ? "text-ok"
                          : o.tone === "accent"
                            ? "text-accent"
                            : "text-fg",
                  )
                : "text-fg-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </fieldset>
  );
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  label,
  className,
  tall = false,
}: {
  value: T;
  tabs: { value: T; label: ReactNode; count?: number }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  /** Matches the 56px page headers. */
  tall?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx("flex gap-5 border-b border-line", className)}
    >
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const i = tabs.findIndex((x) => x.value === value);
              const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
              onChange(n.value);
            }}
            className={cx(
              "-mb-px inline-flex items-center",
              tall ? "h-14" : "h-10",
              "gap-1.5 border-b-2 text-13 font-medium transition-colors duration-150",
              on ? "border-fg text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
            {t.count !== undefined ? (
              <span className="tabular text-12 text-fg-faint">{t.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Layout bits ----------

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small mono line above the title, like a dateline. */
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-10 border-b border-line pb-7">
      {eyebrow ? <p className="eyebrow mb-3">{eyebrow}</p> : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="font-serif text-[42px] leading-[0.98] tracking-[-0.02em] text-fg md:text-[56px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 max-w-[34rem] text-14 text-fg-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Scrollable page body with the standard content column. */
export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div
        className={cx(
          "mx-auto w-full px-4 pt-8 pb-20 md:px-8 md:pt-14",
          wide ? "max-w-[1040px]" : "max-w-[760px]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3 border-b border-line pb-2.5">
      <h2 className="font-serif text-[24px] leading-none tracking-[-0.01em] text-fg">{children}</h2>
      {action}
    </div>
  );
}

/**
 * What a page says before there's anything on it. Pass an `illustration` (a faded,
 * decorative preview of what the page will hold) to set it beside the words; it's hidden
 * from assistive tech and can't be focused or clicked.
 */
export function EmptyState({
  title,
  children,
  action,
  icon,
  illustration,
  compact = false,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  illustration?: ReactNode;
  compact?: boolean;
}) {
  if (illustration) {
    return (
      <div
        className={cx(
          "grid overflow-hidden rounded-[18px] border border-line bg-surface",
          compact
            ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
            : "md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]",
        )}
      >
        <div
          className={cx(
            "order-2 flex flex-col justify-center",
            compact ? "p-6 sm:order-1" : "p-7 md:order-1 md:p-10",
          )}
        >
          <p
            className={cx(
              "font-serif leading-[1.05] tracking-[-0.01em] text-fg",
              compact ? "text-[26px]" : "text-[34px]",
            )}
          >
            {title}
          </p>
          {children ? (
            <p className={cx("max-w-sm text-14 text-fg-muted", compact ? "mt-2" : "mt-3")}>
              {children}
            </p>
          ) : null}
          {action ? <div className={compact ? "mt-5" : "mt-7"}>{action}</div> : null}
        </div>
        <div
          aria-hidden="true"
          inert
          className={cx(
            "relative order-1 overflow-hidden bg-sunken select-none",
            compact ? "min-h-[180px] sm:order-2" : "min-h-[230px] md:order-2 md:min-h-[300px]",
          )}
          style={{
            backgroundImage:
              "radial-gradient(color-mix(in srgb, var(--fg) 13%, transparent) 1px, transparent 1.2px)",
            backgroundSize: "14px 14px",
          }}
        >
          <div className="absolute inset-0 grid place-items-center p-6 opacity-[0.88]">
            {illustration}
          </div>
          <span className="eyebrow absolute top-3 left-4 text-[10px]">Example</span>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cx(
        "flex flex-col items-center rounded-[18px] bg-sunken/70 text-center",
        compact ? "px-5 py-8" : "px-6 py-14",
      )}
    >
      {icon ? <div className="mb-3 text-fg-faint">{icon}</div> : null}
      <p className={cx("font-serif text-fg", compact ? "text-[26px]" : "text-[34px]")}>{title}</p>
      {children ? <p className="mt-1.5 max-w-sm text-14 text-fg-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cx(
        "rounded-[12px] border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-13 text-danger",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("skeleton block", className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {hint ? <p className="hint mt-1.5">{hint}</p> : null}
    </div>
  );
}
