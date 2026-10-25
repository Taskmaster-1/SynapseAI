"use client";

import type { Effect } from "@synapse/core";
import { Check, CircleSlash, Code, LoaderCircle, Pencil, ShieldAlert, Undo2 } from "lucide-react";
import Link from "next/link";
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
import { EffectPill, Monogram, Pill, TAINT_SENTENCE } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";
import { cx, humanize, humanToolName, prettyJson, splitToolName } from "@/lib/format";
import { asPlan, PLAN_TOOL, PlanSteps } from "./checklist";
import {
  type Drafts,
  fromDrafts,
  isPlainObject,
  PayloadEditor,
  PayloadView,
  sameJson,
  toDrafts,
} from "./payload";
import { UndoCountdown, UndoFuse, type UndoTarget, useTimeLeft } from "./undo-window";

export interface ApprovalHandle {
  approve: () => void;
  deny: () => void;
  edit: () => void;
}

export interface ApprovalCardProps {
  runId: string;
  toolCallId: string;
  name: string;
  effect: Effect;
  input: unknown;
  reason: string | null;
  preview: string | null;
  tainted?: boolean;
  /** One gentle amber glow when the card first appears. */
  glow?: boolean;
  /** Called after the server accepted the decision (204). */
  onDecided: (
    approved: boolean,
    info: { reason?: string; edited: boolean; executeAfter: string | null },
  ) => void;
  /** Called on 409 (already decided / run moved on) so the caller can refetch. */
  onConflict: () => void;
  handle?: Ref<ApprovalHandle>;
  className?: string;
  /**
   * The person's team requires an admin to decide this, and they aren't one: the slip is
   * shown for information, with no way to sign it.
   */
  waitingForAdmin?: boolean;
  /** A team admin is deciding a member's call: whose task asked. */
  requester?: { name: string; email: string } | null;
}

/** How long the stamp sits on the slip before the card resolves into a receipt. */
const STAMP_MS = 950;

export function approvalTitle(preview: string | null | undefined, name: string) {
  return preview?.trim() || humanToolName(name);
}

export function ToolSource({ name, size = 18 }: { name: string; size?: number }) {
  const { source } = splitToolName(name);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-13 text-fg-muted">
      <Monogram name={source ?? "Synapse"} size={size} />
      <span className="truncate">{source ?? "Built-in"}</span>
    </span>
  );
}

/**
 * The approval moment. Nothing reads as decided until the server returns 204; while the
 * request is in flight the card only shows a pending state. 409 → the caller refetches.
 */
export function ApprovalCard(props: ApprovalCardProps) {
  const { runId, toolCallId, name, effect, input, reason, preview, tainted } = props;
  const toast = useToast();
  const id = useId();
  const objectInput = isPlainObject(input);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [raw, setRaw] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>(() => (objectInput ? toDrafts(input) : {}));
  const [rawDraft, setRawDraft] = useState(() => prettyJson(input));
  const [denying, setDenying] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set once the server accepted the decision: the stamp lands, then the card resolves. */
  const [stamped, setStamped] = useState<"approved" | "denied" | null>(null);
  const settle = useRef<(() => void) | null>(null);
  const root = useRef<HTMLElement>(null);
  const denyInput = useRef<HTMLInputElement>(null);
  /** A `propose_plan` call shows its steps as a checklist; unticked steps are left out. */
  const plan = asPlan(name, input);
  const [kept, setKept] = useState<boolean[]>(() => plan?.steps.map(() => true) ?? []);
  const keptCount = kept.filter(Boolean).length;

  /** The input as currently edited, or an error. */
  function edited(): { value: unknown } | { error: string } {
    if (plan && mode === "view") {
      if (keptCount === plan.steps.length) return { value: input };
      if (keptCount === 0) return { error: "Tick at least one step, or deny the plan." };
      return { value: { ...(input as object), steps: plan.steps.filter((_, i) => kept[i]) } };
    }
    if (mode !== "edit") return { value: input };
    if (raw || !objectInput) {
      try {
        return { value: JSON.parse(rawDraft) };
      } catch {
        return { error: "The raw input isn't valid JSON." };
      }
    }
    return fromDrafts(drafts);
  }
  const current = edited();
  const isEdited = "value" in current && !sameJson(current.value, input);

  function startEdit() {
    setMode("edit");
    setRaw(!objectInput);
    setError(null);
    setTimeout(
      () => root.current?.querySelector<HTMLElement>("[data-autofocus], textarea, input")?.focus(),
      0,
    );
  }
  function resetEdit() {
    setMode("view");
    setRaw(false);
    setDrafts(objectInput ? toDrafts(input) : {});
    setRawDraft(prettyJson(input));
    setError(null);
  }
  function toggleRaw() {
    if (mode === "edit" && objectInput) {
      if (!raw) {
        const v = fromDrafts(drafts);
        if ("error" in v) return setError(v.error);
        setRawDraft(prettyJson(v.value));
      } else {
        try {
          const parsed = JSON.parse(rawDraft);
          if (!isPlainObject(parsed)) return setError("Fields view needs a JSON object.");
          setDrafts(toDrafts(parsed));
        } catch {
          return setError("The raw input isn't valid JSON.");
        }
      }
      setError(null);
    }
    setRaw((r) => !r);
  }

  // If the card goes away mid-stamp (selection moved on), still report the decision.
  useEffect(
    () => () => {
      const pending = settle.current;
      settle.current = null;
      pending?.();
    },
    [],
  );

  async function decide(approved: boolean) {
    if (busy || stamped || props.waitingForAdmin) return;
    setError(null);
    const body: { approved: boolean; reason?: string; input?: unknown } = { approved };
    const invalid = "error" in current ? String(current.error) : null;
    if (approved && invalid) return setError(invalid);
    if (approved && isEdited && "value" in current) body.input = current.value;
    if (!approved && denyReason.trim()) body.reason = denyReason.trim();
    setBusy(approved ? "approve" : "deny");
    try {
      const res = await api.decide(runId, toolCallId, body);
      const info = {
        reason: body.reason,
        edited: approved && isEdited,
        executeAfter: res?.executeAfter ?? null,
      };
      const onDecided = props.onDecided;
      settle.current = () => onDecided(approved, info);
      setStamped(approved ? "approved" : "denied");
      setTimeout(() => {
        const pending = settle.current;
        settle.current = null;
        pending?.();
      }, STAMP_MS);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast("Already decided, or the task moved on. Refreshing.", "info");
        props.onConflict();
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(null);
    }
  }

  function openDeny() {
    if (stamped || props.waitingForAdmin) return;
    setDenying(true);
    setTimeout(() => denyInput.current?.focus(), 0);
  }

  useImperativeHandle(props.handle, () => ({
    approve: () => void decide(true),
    deny: openDeny,
    edit: () =>
      mode === "edit" || stamped || plan || props.waitingForAdmin ? undefined : startEdit(),
  }));

  const title = approvalTitle(preview, name);
  const { tool } = splitToolName(name);
  const locked = busy !== null || stamped !== null;

  return (
    <section
      ref={root}
      aria-labelledby={`${id}-title`}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void decide(true);
        }
      }}
      className={cx("slip relative", props.className)}
    >
      {props.glow ? (
        <span
          aria-hidden="true"
          className="anim-glow pointer-events-none absolute inset-0 rounded-[8px]"
        />
      ) : null}

      {/* The slip's header: what kind of paper this is and where it goes. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-dashed border-line-strong px-4 py-3 sm:px-6">
        {props.waitingForAdmin ? (
          <span className="flex items-center gap-2 text-13 font-medium text-fg-muted">
            <span aria-hidden="true" className="size-2 rounded-full bg-fg-faint" />
            Waiting for an admin
          </span>
        ) : (
          <span className="flex items-center gap-2 text-13 font-medium text-attention">
            <span aria-hidden="true" className="relative grid size-2 place-items-center">
              {stamped ? null : (
                <span className="m-ring absolute size-2 rounded-full bg-attention" />
              )}
              <span className="size-2 rounded-full bg-attention" />
            </span>
            {props.requester ? `Needs an admin · ${props.requester.name}` : "Needs your sign-off"}
          </span>
        )}
        <span className="ml-auto flex min-w-0 items-center gap-2">
          <ToolSource name={name} />
          <EffectPill effect={effect} />
        </span>
      </div>

      <div className="px-4 pt-5 sm:px-6">
        <h3
          id={`${id}-title`}
          className="font-serif text-[25px] leading-[1.15] tracking-[-0.01em] break-words text-fg sm:text-[30px]"
        >
          {title}
        </h3>
        {tainted || reason ? (
          <div className="mt-2.5 space-y-1">
            {tainted ? (
              <p className="flex items-start gap-1.5 text-13 font-medium text-attention">
                <ShieldAlert className="mt-[3px] size-3.5 shrink-0" />
                {TAINT_SENTENCE}
              </p>
            ) : null}
            {reason ? (
              <p className="text-13 text-fg-muted">
                {name === PLAN_TOOL
                  ? "Approve once: the steps you keep then run without asking again."
                  : reason}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="eyebrow truncate">
              {mode === "edit"
                ? "Editing"
                : plan
                  ? `Plan · ${keptCount} of ${plan.steps.length} steps`
                  : humanize(tool)}
            </span>
            {isEdited && !plan ? <Pill tone="accent">Edited</Pill> : null}
          </div>
          {objectInput || mode === "view" ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm -mr-2 shrink-0"
              aria-pressed={raw}
              onClick={toggleRaw}
              disabled={locked}
            >
              <Code className="size-3.5" />
              {raw
                ? mode === "edit"
                  ? "Edit fields"
                  : "Hide raw"
                : mode === "edit"
                  ? "Edit raw"
                  : "View raw"}
            </button>
          ) : null}
        </div>

        {mode === "edit" ? (
          raw || !objectInput ? (
            <textarea
              aria-label="Raw input (JSON)"
              data-autofocus
              spellCheck={false}
              className="input min-h-40 resize-y font-mono text-12"
              rows={Math.min(18, rawDraft.split("\n").length + 1)}
              value={rawDraft}
              onChange={(e) => setRawDraft(e.target.value)}
            />
          ) : (
            <PayloadEditor drafts={drafts} onChange={setDrafts} idPrefix={id} />
          )
        ) : raw ? (
          <pre className="code max-h-80">{prettyJson(input) || "(no input)"}</pre>
        ) : plan ? (
          <PlanSteps steps={plan.steps} kept={kept} onKept={setKept} locked={locked} />
        ) : (
          <PayloadView input={input} />
        )}

        {denying ? (
          <div className="anim-row-in mt-5">
            <label htmlFor={`${id}-deny`} className="label">
              Tell the agent why <span className="font-normal text-fg-faint">(optional)</span>
            </label>
            <input
              id={`${id}-deny`}
              ref={denyInput}
              className="input"
              value={denyReason}
              placeholder="e.g. Don't email people outside the company"
              onChange={(e) => setDenyReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  void decide(false);
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setDenying(false);
                }
              }}
            />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 text-13 text-danger">
            {error}
          </p>
        ) : null}
      </div>

      {props.waitingForAdmin ? (
        <div className="px-4 pt-6 pb-4 sm:px-6 sm:pb-5">
          <p className="text-13 text-fg-muted">
            Your team requires an admin to approve this. It's in their inbox; the task picks up as
            soon as they decide.
          </p>
          <div className="mt-3 border-t border-fg/25 pt-1.5">
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-fg-faint uppercase">
              An admin's signature
            </span>
          </div>
        </div>
      ) : (
        /* The signature line: the buttons sit on it like a pen on paper. */
        <div className="relative px-4 pt-6 pb-4 sm:px-6 sm:pb-5">
          <div className={cx("flex flex-wrap items-center gap-2", stamped && "opacity-40")}>
            <button
              type="button"
              className="btn btn-primary h-10 px-5"
              disabled={locked}
              onClick={() => void decide(true)}
              aria-keyshortcuts="Meta+Enter Control+Enter"
            >
              {busy === "approve" ? <LoaderCircle className="anim-spin" /> : <Check />}
              {busy === "approve"
                ? "Approving…"
                : plan
                  ? isEdited
                    ? `Approve ${keptCount} of ${plan.steps.length} steps`
                    : "Approve plan"
                  : isEdited
                    ? "Approve edited"
                    : "Approve"}
              <span
                aria-hidden="true"
                className="ml-1 hidden font-mono text-[11px] opacity-60 sm:inline"
              >
                ⌘↵
              </span>
            </button>
            {denying || plan ? null : mode === "edit" ? (
              <button type="button" className="btn h-10" onClick={resetEdit} disabled={locked}>
                <Undo2 className="size-4" />
                Discard edits
              </button>
            ) : (
              <button type="button" className="btn h-10" onClick={startEdit} disabled={locked}>
                <Pencil className="size-4" />
                Edit
              </button>
            )}
            {denying ? (
              <>
                <button
                  type="button"
                  className="btn btn-danger h-10"
                  disabled={locked}
                  onClick={() => void decide(false)}
                >
                  {busy === "deny" ? <LoaderCircle className="anim-spin" /> : <CircleSlash />}
                  {busy === "deny" ? "Denying…" : "Deny"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost h-10"
                  disabled={locked}
                  onClick={() => setDenying(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-ghost h-10 text-danger"
                disabled={locked}
                onClick={openDeny}
              >
                Deny…
              </button>
            )}
          </div>
          <div className="mt-3 flex items-baseline gap-3 border-t border-fg/55 pt-1.5">
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-fg-faint uppercase">
              {stamped === "approved"
                ? "Signed off by you"
                : stamped === "denied"
                  ? "Declined by you"
                  : props.requester
                    ? "Your signature, as a team admin"
                    : "Your signature"}
            </span>
            <Link
              href={`/settings?section=rules&allow=${encodeURIComponent(name)}`}
              className={cx(
                "ml-auto text-12 text-fg-muted underline-offset-2 transition-opacity hover:text-fg hover:underline",
                stamped && "opacity-0",
                // A plan only means something when a person signs it; a member's call
                // follows their team's rules, not the admin's own.
                (plan || props.requester) && "hidden",
              )}
            >
              Always allow…
            </Link>
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
      )}
    </section>
  );
}

const PAST: Record<Effect, string> = {
  read: "done",
  write: "done",
  send: "sent",
  destructive: "done",
};

/** One-line record of a decision, shown where the card was. */
export function ApprovalReceipt({
  name,
  preview,
  effect,
  approved,
  reason,
  phase,
  edited,
  undo,
  undone: undoneBefore,
  onUndone,
  className,
}: {
  name: string;
  preview: string | null;
  effect: Effect;
  approved: boolean;
  reason?: string | null;
  /** For approved calls: what happened after. */
  phase?: "running" | "done" | "failed" | "unknown" | "continuing";
  edited?: boolean;
  /** Set while an approved send or delete waits out its undo window. */
  undo?: UndoTarget | null;
  /** The person took it back inside the window. */
  undone?: boolean;
  onUndone?: () => void;
  className?: string;
}) {
  const [undoneHere, setUndoneHere] = useState(false);
  const left = useTimeLeft(undo?.executeAfter);
  const undone = undoneBefore || undoneHere;
  const waiting = approved && !undone && !!undo && left > 0 && phase !== "done";
  if (undone) {
    return (
      <div
        className={cx(
          "anim-fade-in flex min-w-0 items-center gap-3 rounded-[8px] bg-surface px-3 py-2.5 text-13 shadow-[0_0_0_1px_var(--line)]",
          className,
        )}
      >
        <MiniStamp tone="danger">Undone</MiniStamp>
        <span className="min-w-0 flex-1 truncate text-fg">{approvalTitle(preview, name)}</span>
        <span role="status" className="shrink-0 text-fg-muted">
          {effect === "send" ? "Not sent" : "Didn't run"}
        </span>
      </div>
    );
  }
  if (waiting && undo) {
    return (
      <div
        className={cx(
          "anim-fade-in relative flex min-w-0 items-center gap-3 rounded-[8px] bg-surface px-3 py-2.5 text-13 shadow-[0_0_0_1px_var(--line)]",
          className,
        )}
      >
        <MiniStamp tone="ok">Approved</MiniStamp>
        <span className="min-w-0 flex-1 truncate text-fg">{approvalTitle(preview, name)}</span>
        <UndoCountdown
          target={undo}
          effect={effect}
          onUndone={() => {
            setUndoneHere(true);
            onUndone?.();
          }}
          className="shrink-0 text-fg-muted"
        />
        <UndoFuse executeAfter={undo.executeAfter} />
      </div>
    );
  }
  const outcome = approved
    ? phase === "failed"
      ? "failed"
      : phase === "unknown"
        ? "outcome unknown"
        : phase === "continuing"
          ? "the task continues"
          : phase === "done"
            ? PAST[effect]
            : "running…"
    : null;
  const failed = approved && phase === "failed";
  return (
    <div
      className={cx(
        "anim-fade-in flex min-w-0 items-center gap-3 rounded-[8px] bg-surface px-3 py-2.5 text-13 shadow-[0_0_0_1px_var(--line)]",
        className,
      )}
    >
      <MiniStamp tone={approved ? "ok" : "danger"}>{approved ? "Approved" : "Denied"}</MiniStamp>
      <span className="min-w-0 flex-1 truncate text-fg">{approvalTitle(preview, name)}</span>
      <span
        className={cx(
          "flex shrink-0 items-center gap-1.5",
          failed ? "text-danger" : "text-fg-muted",
        )}
      >
        {approved ? (
          <>
            {phase === "running" || phase === undefined ? (
              <LoaderCircle className="anim-spin size-3.5 text-accent" />
            ) : null}
            <span>
              <span className="hidden sm:inline">By you{edited ? ", edited" : ""} · </span>
              {outcome}
            </span>
          </>
        ) : (
          <span className="block max-w-[40vw] truncate sm:max-w-80" title={reason ?? undefined}>
            {reason ? reason : "by you"}
          </span>
        )}
      </span>
    </div>
  );
}

/** A small inked mark for receipts and lists: the stamp, at desk size. */
export function MiniStamp({
  tone,
  children,
  className,
}: {
  tone: "ok" | "danger";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 -rotate-3 items-center rounded-[4px] border-[1.5px] border-current px-1.5 font-mono text-[10px] leading-none font-semibold tracking-[0.12em] uppercase",
        tone === "ok" ? "text-ok" : "text-danger",
        className,
      )}
    >
      {children}
    </span>
  );
}
