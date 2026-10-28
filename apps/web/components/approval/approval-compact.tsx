"use client";

import { Check, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { EffectPill, Monogram } from "@/components/ui";
import { ApiError, type Approval, api, errorMessage } from "@/lib/api";
import { cx, formatDateTime, formatRelative, splitToolName } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace";
import { approvalTitle, MiniStamp } from "./approval-card";
import { useExpiresIn } from "./signals";
import { UndoCountdown, UndoFuse, type UndoTarget, useTimeLeft } from "./undo-window";

/** How long the stamp sits on the slip before the row leaves. */
const STAMP_MS = 800;
/** How long "Undone" stays before the row leaves. */
const UNDONE_MS = 1500;

/** Home's "Needs you" row: enough to decide simple things, a link for the rest. */
export function ApprovalCompact({
  approval: a,
  onDone,
  onHold,
}: {
  approval: Approval;
  onDone: () => void;
  /** The approved action waits out an undo window: keep this row until `onDone`. */
  onHold?: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [stamped, setStamped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Undo window: shown after the stamp, until it ends or is undone. */
  const [undo, setUndo] = useState<UndoTarget | null>(null);
  const [undone, setUndone] = useState(false);
  const left = useTimeLeft(undo?.executeAfter);
  const settle = useRef<(() => void) | null>(null);
  const { source } = splitToolName(a.name);
  const { user } = useWorkspace();
  const signedByMe = !!user && a.signoffs?.first?.id === user.id;
  const expires = useExpiresIn(a.expiresAt);
  const fact = a.facts?.[0];

  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const over = !!undo && (undone || left <= 0);

  // The window ended (or was undone): let the row leave.
  useEffect(() => {
    if (!over) return;
    const timer = setTimeout(() => doneRef.current(), undone ? UNDONE_MS : 0);
    return () => clearTimeout(timer);
  }, [over, undone]);

  // If the row unmounts mid-stamp, still let the caller know.
  useEffect(
    () => () => {
      const pending = settle.current;
      settle.current = null;
      pending?.();
    },
    [],
  );

  async function approve() {
    if (busy || stamped) return;
    setBusy(true);
    setError(null);
    try {
      const { executeAfter, partial } = (await api.decide(a.runId, a.toolCallId, {
        approved: true,
      })) ?? { executeAfter: null };
      if (partial) {
        // Two-person sign-off: yours was the first approval; it waits for someone else.
        toast("Approved. It needs a second person to approve it too.", "success");
        onDone();
        return;
      }
      if (executeAfter) onHold?.();
      settle.current = () => {
        toast("Approved", "success");
        if (executeAfter) setUndo({ runId: a.runId, toolCallId: a.toolCallId, executeAfter });
        else onDone();
      };
      setStamped(true);
      setTimeout(() => {
        const pending = settle.current;
        settle.current = null;
        pending?.();
      }, STAMP_MS);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast("Already decided, or the task moved on.", "info");
        onDone();
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="slip relative flex flex-col gap-3 py-3.5 pr-4 pl-5 sm:flex-row sm:items-center">
      <span
        aria-hidden="true"
        className="absolute top-3.5 bottom-3.5 left-0 w-[3px] rounded-r-full bg-attention"
      />
      <div className={cx("flex min-w-0 flex-1 items-start gap-3", stamped && "opacity-50")}>
        <span className="mt-1">
          <Monogram name={source ?? "Synapse"} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-[20px] leading-tight text-fg">
            {approvalTitle(a.preview, a.name)}
          </p>
          <p className="mt-1 flex min-w-0 items-center gap-2 text-12 text-fg-muted">
            <EffectPill effect={a.effect} />
            <Link href={`/t/${a.chatId}`} className="truncate hover:text-fg hover:underline">
              {a.chatTitle || "Untitled task"}
            </Link>
            <span className="shrink-0 text-fg-faint" title={formatDateTime(a.createdAt)}>
              {formatRelative(a.createdAt)}
            </span>
          </p>
          {fact || expires || a.signoffs?.needed === 2 ? (
            <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 text-12 text-fg-muted">
              {fact ? <span className="font-medium text-attention">{fact}</span> : null}
              {a.signoffs?.needed === 2 ? (
                <span>{a.signoffs.first ? "1 of 2 approvals" : "Needs 2 approvals"}</span>
              ) : null}
              {expires ? <span>Expires in {expires}</span> : null}
            </p>
          ) : null}
          {error ? <p className="mt-1 text-12 text-danger">{error}</p> : null}
        </div>
      </div>
      {undo ? (
        <div className="flex shrink-0 items-center gap-2.5 pl-[34px] text-13 text-fg-muted sm:pl-0">
          <MiniStamp tone={undone ? "danger" : "ok"}>{undone ? "Undone" : "Approved"}</MiniStamp>
          {undone ? (
            <span role="status">{a.effect === "send" ? "Not sent" : "Didn't run"}</span>
          ) : (
            <UndoCountdown target={undo} effect={a.effect} onUndone={() => setUndone(true)} />
          )}
          {undone ? null : <UndoFuse executeAfter={undo.executeAfter} />}
        </div>
      ) : (
        <div
          className={cx(
            "flex shrink-0 items-center gap-2 pl-[34px] sm:pl-0",
            stamped && "invisible",
          )}
        >
          <Link href={`/inbox?id=${encodeURIComponent(a.toolCallId)}`} className="btn btn-sm">
            Review
          </Link>
          <button
            type="button"
            className={cx("btn btn-primary btn-sm", signedByMe && "hidden")}
            disabled={busy || stamped || signedByMe}
            onClick={() => void approve()}
          >
            {busy ? (
              <LoaderCircle className="anim-spin size-3.5" />
            ) : (
              <Check className="size-3.5" />
            )}
            {busy ? "Approving…" : "Approve"}
          </button>
        </div>
      )}
      {stamped && !undo ? (
        <span
          role="status"
          className="stamp stamp-in pointer-events-none absolute right-6 bottom-3 text-[18px] text-ok sm:top-1/2 sm:bottom-auto sm:-mt-[18px]"
        >
          Approved
        </span>
      ) : null}
    </div>
  );
}
