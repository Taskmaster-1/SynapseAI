"use client";

import type { Effect } from "@synapse/core";
import { Check, CircleSlash, Code, LoaderCircle, Pencil, ShieldAlert, Undo2 } from "lucide-react";
import Link from "next/link";
import { type Ref, useId, useImperativeHandle, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { EffectPill, Monogram, Pill, TAINT_SENTENCE } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";
import { cx, humanToolName, prettyJson, splitToolName } from "@/lib/format";
import {
  type Drafts,
  fromDrafts,
  isPlainObject,
  PayloadEditor,
  PayloadView,
  sameJson,
  toDrafts,
} from "./payload";

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
  onDecided: (approved: boolean, info: { reason?: string; edited: boolean }) => void;
  /** Called on 409 (already decided / run moved on) so the caller can refetch. */
  onConflict: () => void;
  handle?: Ref<ApprovalHandle>;
  className?: string;
}

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
  const root = useRef<HTMLElement>(null);
  const denyInput = useRef<HTMLInputElement>(null);

  /** The input as currently edited, or an error. */
  function edited(): { value: unknown } | { error: string } {
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
  const isEdited = mode === "edit" && "value" in current && !sameJson(current.value, input);

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

  async function decide(approved: boolean) {
    if (busy) return;
    setError(null);
    const body: { approved: boolean; reason?: string; input?: unknown } = { approved };
    const invalid = "error" in current ? String(current.error) : null;
    if (approved && invalid) return setError(invalid);
    if (approved && isEdited && "value" in current) body.input = current.value;
    if (!approved && denyReason.trim()) body.reason = denyReason.trim();
    setBusy(approved ? "approve" : "deny");
    try {
      await api.decide(runId, toolCallId, body);
      props.onDecided(approved, { reason: body.reason, edited: approved && isEdited });
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
    setDenying(true);
    setTimeout(() => denyInput.current?.focus(), 0);
  }

  useImperativeHandle(props.handle, () => ({
    approve: () => void decide(true),
    deny: openDeny,
    edit: () => (mode === "edit" ? undefined : startEdit()),
  }));

  const title = approvalTitle(preview, name);
  const { tool } = splitToolName(name);

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
      className={cx(
        "overflow-hidden rounded-card border border-attention/35 bg-surface",
        props.glow && "anim-glow",
        props.className,
      )}
    >
      <div className="bg-attention-soft px-4 pt-3.5 pb-3.5 sm:px-5">
        <div className="flex items-center gap-2 text-12 font-medium text-attention">
          <span className="size-1.5 rounded-full bg-attention" />
          Needs your approval
        </div>
        <h3 id={`${id}-title`} className="mt-1.5 text-16 font-medium break-words text-fg">
          {title}
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {tainted ? (
            <span className="inline-flex items-center gap-1 text-13 font-medium text-attention">
              <ShieldAlert className="size-3.5" />
              {TAINT_SENTENCE}
            </span>
          ) : null}
          <ToolSource name={name} />
          <EffectPill effect={effect} className="bg-surface/80" />
          {reason ? <span className="min-w-0 text-13 text-fg-muted">{reason}</span> : null}
        </div>
      </div>

      <div className="border-t border-attention/20 px-4 py-4 sm:px-5">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="eyebrow">
              {mode === "edit" ? "Editing" : preview ? humanToolName(name) : tool}
            </span>
            {isEdited ? <Pill tone="accent">Edited</Pill> : null}
          </div>
          <div className="flex items-center gap-1">
            {mode === "edit" ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={resetEdit}
                disabled={busy !== null}
              >
                <Undo2 className="size-3.5" />
                Discard edits
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={startEdit}
                disabled={busy !== null}
              >
                <Pencil className="size-3.5" />
                Edit
              </button>
            )}
            {objectInput || mode === "view" ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-pressed={raw}
                onClick={toggleRaw}
                disabled={busy !== null}
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
        ) : (
          <PayloadView input={input} />
        )}

        {denying ? (
          <div className="anim-row-in mt-4">
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

      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3 sm:px-5">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() => void decide(true)}
          aria-keyshortcuts="Meta+Enter Control+Enter"
        >
          {busy === "approve" ? <LoaderCircle className="anim-spin" /> : <Check />}
          {busy === "approve" ? "Approving…" : isEdited ? "Approve edited" : "Approve"}
          <span className="ml-1 hidden items-center gap-0.5 opacity-70 sm:inline-flex">
            <span className="text-12">⌘↵</span>
          </span>
        </button>
        {denying ? (
          <>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy !== null}
              onClick={() => void decide(false)}
            >
              {busy === "deny" ? <LoaderCircle className="anim-spin" /> : <CircleSlash />}
              {busy === "deny" ? "Denying…" : "Deny"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy !== null}
              onClick={() => setDenying(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn" disabled={busy !== null} onClick={openDeny}>
            Deny…
          </button>
        )}
        <Link
          href={`/settings?section=rules&allow=${encodeURIComponent(name)}`}
          className="ml-auto text-12 text-fg-muted underline-offset-2 hover:text-fg hover:underline"
        >
          Always allow…
        </Link>
      </div>
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
  className?: string;
}) {
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
  return (
    <div
      className={cx(
        "anim-fade-in flex min-w-0 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2 text-13",
        className,
      )}
    >
      {approved ? (
        phase === "running" || phase === undefined ? (
          <LoaderCircle className="anim-spin shrink-0 text-accent" />
        ) : (
          <Check className={cx("shrink-0", phase === "failed" ? "text-danger" : "text-ok")} />
        )
      ) : (
        <CircleSlash className="shrink-0 text-danger" />
      )}
      <span className="min-w-0 flex-1 truncate text-fg">{approvalTitle(preview, name)}</span>
      <span className="shrink-0 text-fg-muted">
        {approved ? (
          <>
            Approved by you{edited ? " (edited)" : ""} · {outcome}
          </>
        ) : (
          <span className="block max-w-[46vw] truncate sm:max-w-80" title={reason ?? undefined}>
            Denied{reason ? `: ${reason}` : ""}
          </span>
        )}
      </span>
    </div>
  );
}
