"use client";

import type { Effect } from "@synapse/core";
import { Check, ChevronDown, CircleSlash, LoaderCircle, ShieldAlert } from "lucide-react";
import {
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useToast } from "@/components/toast";
import { EffectPill, TAINT_SENTENCE } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";
import { cx, humanToolName } from "@/lib/format";
import { type ApprovalHandle, approvalTitle, ToolSource } from "./approval-card";
import { isPlainObject, PayloadView } from "./payload";

/** The built-in tool whose approval is a checklist of steps. */
export const PLAN_TOOL = "propose_plan";

export interface PlanStep {
  tool: string;
  input: Record<string, unknown>;
  why: string;
}

/** A `propose_plan` input, or null when it isn't shaped like one (then show it raw). */
export function asPlan(
  name: string,
  input: unknown,
): { summary: string; steps: PlanStep[] } | null {
  if (name !== PLAN_TOOL || !isPlainObject(input) || !Array.isArray(input.steps)) return null;
  const steps = input.steps.filter(
    (s): s is PlanStep => isPlainObject(s) && typeof s.tool === "string" && isPlainObject(s.input),
  );
  if (steps.length !== input.steps.length) return null;
  return { summary: typeof input.summary === "string" ? input.summary : "", steps };
}

/** An inked tick box. */
function Tick({
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
    <span className="relative grid size-[18px] shrink-0 place-items-center">
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer size-[18px] cursor-pointer appearance-none rounded-[4px] border-[1.5px] border-line-strong bg-surface transition-colors outline-none checked:border-fg checked:bg-fg hover:border-fg focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:opacity-50"
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute size-3 text-canvas opacity-0 peer-checked:opacity-100"
      />
    </span>
  );
}

/** One line of a checklist: tick, what it is, and the full payload on demand. */
function ChecklistRow({
  checked,
  onCheck,
  title,
  why,
  meta,
  input,
  locked,
}: {
  checked: boolean;
  onCheck: (v: boolean) => void;
  title: string;
  why?: string;
  meta?: ReactNode;
  input: unknown;
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className="pt-[3px]">
          <Tick checked={checked} onChange={onCheck} label={title} disabled={locked} />
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="group flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span
              className={cx(
                "block text-14 leading-snug break-words text-fg",
                !checked && "text-fg-faint line-through decoration-fg-faint",
              )}
            >
              {title}
            </span>
            {why ? <span className="mt-0.5 block text-13 text-fg-muted">{why}</span> : null}
          </span>
          {meta ? <span className="shrink-0 pt-px">{meta}</span> : null}
          <ChevronDown
            className={cx(
              "mt-[3px] size-4 shrink-0 text-fg-faint transition-transform group-hover:text-fg",
              open && "rotate-180",
            )}
          />
        </button>
      </div>
      {open ? (
        <div id={id} className="anim-row-in mt-3 ml-[30px]">
          <PayloadView input={input} />
        </div>
      ) : null}
    </li>
  );
}

/** The steps of a plan, each tickable. Used inside the approval card for `propose_plan`. */
export function PlanSteps({
  steps,
  kept,
  onKept,
  locked,
}: {
  steps: PlanStep[];
  kept: boolean[];
  onKept: (kept: boolean[]) => void;
  locked: boolean;
}) {
  return (
    <ol className="divide-y divide-line border-y border-line">
      {steps.map((s, i) => (
        <ChecklistRow
          // biome-ignore lint/suspicious/noArrayIndexKey: steps are a fixed list
          key={i}
          checked={kept[i] ?? true}
          onCheck={(v) => onKept(kept.map((k, j) => (j === i ? v : k)))}
          title={`${i + 1}. ${humanToolName(s.tool)}`}
          why={s.why}
          input={s.input}
          locked={locked}
        />
      ))}
    </ol>
  );
}

export interface BatchItem {
  toolCallId: string;
  name: string;
  effect: Effect;
  input: unknown;
  reason: string | null;
  preview: string | null;
}

/** How long the stamp sits on the slip before the card resolves into receipts. */
const STAMP_MS = 950;

/**
 * Several actions from one step of a task, signed off together. Ticked rows are approved,
 * unticked ones denied, in one request; nothing reads as decided until the server says so.
 */
export function ApprovalBatch({
  runId,
  items,
  tainted,
  glow,
  onDecided,
  onConflict,
  handle,
  className,
}: {
  runId: string;
  items: BatchItem[];
  tainted?: boolean;
  glow?: boolean;
  /** Called after the server accepted the decisions, with each call's outcome. */
  onDecided: (approved: Record<string, boolean>) => void;
  onConflict: () => void;
  handle?: Ref<ApprovalHandle>;
  className?: string;
}) {
  const toast = useToast();
  const id = useId();
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [stamped, setStamped] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settle = useRef<(() => void) | null>(null);
  const isTicked = (tid: string) => ticked[tid] ?? true;
  const count = items.filter((a) => isTicked(a.toolCallId)).length;
  // One reason for every row (the usual case) is said once, not repeated on each line.
  const reasons = new Set(items.map((a) => a.reason ?? ""));
  const sharedReason = reasons.size === 1 ? [...reasons][0] || null : null;
  const locked = busy !== null || stamped !== null;

  useEffect(
    () => () => {
      const pending = settle.current;
      settle.current = null;
      pending?.();
    },
    [],
  );

  async function decide(all: "selected" | "deny") {
    if (locked) return;
    if (all === "selected" && count === 0) return setError("Tick at least one, or deny all.");
    setError(null);
    const outcome = Object.fromEntries(
      items.map((a) => [a.toolCallId, all === "selected" && isTicked(a.toolCallId)]),
    );
    setBusy(all === "selected" ? "approve" : "deny");
    try {
      await api.decideMany(
        runId,
        items.map((a) => ({ toolCallId: a.toolCallId, approved: outcome[a.toolCallId]! })),
      );
      settle.current = () => onDecided(outcome);
      setStamped(all === "selected" ? "approved" : "denied");
      setTimeout(() => {
        const pending = settle.current;
        settle.current = null;
        pending?.();
      }, STAMP_MS);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast("Already decided, or the task moved on. Refreshing.", "info");
        onConflict();
      } else setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  useImperativeHandle(handle, () => ({
    approve: () => void decide("selected"),
    deny: () => void decide("deny"),
    edit: () => {},
  }));

  return (
    <section
      aria-labelledby={`${id}-title`}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void decide("selected");
        }
      }}
      className={cx("slip relative", className)}
    >
      {glow ? (
        <span
          aria-hidden="true"
          className="anim-glow pointer-events-none absolute inset-0 rounded-[8px]"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-dashed border-line-strong px-4 py-3 sm:px-6">
        <span className="flex items-center gap-2 text-13 font-medium text-attention">
          <span aria-hidden="true" className="relative grid size-2 place-items-center">
            {stamped ? null : <span className="m-ring absolute size-2 rounded-full bg-attention" />}
            <span className="size-2 rounded-full bg-attention" />
          </span>
          Needs your sign-off
        </span>
        <span className="eyebrow ml-auto">
          {count} of {items.length} ticked
        </span>
      </div>

      <div className="px-4 pt-5 sm:px-6">
        <h3
          id={`${id}-title`}
          className="font-serif text-[25px] leading-[1.15] tracking-[-0.01em] text-fg sm:text-[30px]"
        >
          This task wants to do {items.length} things
        </h3>
        {tainted ? (
          <p className="mt-2.5 flex items-start gap-1.5 text-13 font-medium text-attention">
            <ShieldAlert className="mt-[3px] size-3.5 shrink-0" />
            {TAINT_SENTENCE}
          </p>
        ) : null}
        <p className="mt-2 text-13 text-fg-muted">
          {sharedReason ? `${sharedReason} ` : ""}Untick anything you don't want. Open a row to see
          exactly what it sends.
        </p>

        <ul className="mt-4 divide-y divide-line border-y border-line">
          {items.map((a) => (
            <ChecklistRow
              key={a.toolCallId}
              checked={isTicked(a.toolCallId)}
              onCheck={(v) => setTicked((t) => ({ ...t, [a.toolCallId]: v }))}
              title={approvalTitle(a.preview, a.name)}
              why={sharedReason ? undefined : (a.reason ?? undefined)}
              meta={
                <span className="hidden items-center gap-2 sm:flex">
                  <ToolSource name={a.name} size={16} />
                  <EffectPill effect={a.effect} />
                </span>
              }
              input={a.input}
              locked={locked}
            />
          ))}
        </ul>

        {error ? (
          <p role="alert" className="mt-3 text-13 text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <div className="relative px-4 pt-6 pb-4 sm:px-6 sm:pb-5">
        <div className={cx("flex flex-wrap items-center gap-2", stamped && "opacity-40")}>
          <button
            type="button"
            className="btn btn-primary h-10 px-5"
            disabled={locked || count === 0}
            onClick={() => void decide("selected")}
            aria-keyshortcuts="Meta+Enter Control+Enter"
          >
            {busy === "approve" ? <LoaderCircle className="anim-spin" /> : <Check />}
            {busy === "approve"
              ? "Approving…"
              : count === items.length
                ? "Approve all"
                : `Approve ${count} selected`}
          </button>
          <button
            type="button"
            className="btn btn-ghost h-10 text-danger"
            disabled={locked}
            onClick={() => void decide("deny")}
          >
            {busy === "deny" ? <LoaderCircle className="anim-spin" /> : <CircleSlash />}
            {busy === "deny" ? "Denying…" : "Deny all"}
          </button>
        </div>
        <div className="mt-3 flex items-baseline gap-3 border-t border-fg/55 pt-1.5">
          <span className="font-mono text-[10.5px] tracking-[0.14em] text-fg-faint uppercase">
            {stamped === "approved"
              ? "Signed off by you"
              : stamped === "denied"
                ? "Declined by you"
                : "Your signature"}
          </span>
        </div>
        {stamped ? (
          <span
            role="status"
            className={cx(
              "stamp stamp-in pointer-events-none absolute right-5 bottom-12 z-10 text-[24px] sm:right-10 sm:bottom-[46px] sm:text-[30px]",
              stamped === "approved" ? "text-ok" : "text-danger",
            )}
          >
            {stamped === "approved" ? "Approved" : "Denied"}
          </span>
        ) : null}
      </div>
    </section>
  );
}
