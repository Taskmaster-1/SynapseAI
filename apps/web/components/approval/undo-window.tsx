"use client";

import type { Effect } from "@synapse/core";
import { type CSSProperties, useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { ApiError, api, errorMessage } from "@/lib/api";
import { cx } from "@/lib/format";

/** An approved call inside its undo window. */
export interface UndoTarget {
  runId: string;
  toolCallId: string;
  /** When it runs (ISO, server time). */
  executeAfter: string;
}

function msLeft(deadline: string | null | undefined) {
  return deadline ? Math.max(0, Date.parse(deadline) - Date.now()) : 0;
}

/** Milliseconds until `deadline`, re-rendering a few times a second; 0 once it passed. */
export function useTimeLeft(deadline: string | null | undefined): number {
  const [left, setLeft] = useState(() => msLeft(deadline));
  useEffect(() => {
    setLeft(msLeft(deadline));
    if (msLeft(deadline) <= 0) return;
    const timer = setInterval(() => {
      const next = msLeft(deadline);
      setLeft(next);
      if (next <= 0) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [deadline]);
  return left;
}

/** True while an approved call still waits on its window. */
export function inUndoWindow(executeAfter: string | null | undefined) {
  return msLeft(executeAfter) > 0;
}

/**
 * "Sending in 9s · Undo". Renders nothing once the window is over; the caller then shows
 * the normal running/done state. `onUndone` fires after the server took it back.
 */
export function UndoCountdown({
  target,
  effect,
  onUndone,
  className,
}: {
  target: UndoTarget;
  effect: Effect;
  onUndone: () => void;
  className?: string;
}) {
  const toast = useToast();
  const left = useTimeLeft(target.executeAfter);
  const [busy, setBusy] = useState(false);
  if (left <= 0) return null;
  const seconds = Math.ceil(left / 1000);
  const verb = effect === "send" ? "Sending" : "Running";

  async function undo() {
    if (busy) return;
    setBusy(true);
    try {
      await api.undo(target.runId, target.toolCallId);
      onUndone();
    } catch (err) {
      toast(
        err instanceof ApiError && err.status === 409
          ? "Too late to undo: it already ran."
          : errorMessage(err),
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={cx("inline-flex items-center gap-1.5", className)}>
      <span className="tabular-nums">
        {verb} in {seconds}s
      </span>
      <span aria-hidden="true" className="text-fg-faint">
        ·
      </span>
      <button
        type="button"
        className="font-medium text-accent underline-offset-2 hover:underline disabled:opacity-60"
        disabled={busy}
        onClick={() => void undo()}
        aria-label={`Undo. ${verb} in ${seconds} seconds`}
      >
        {busy ? "Undoing…" : "Undo"}
      </button>
    </span>
  );
}

/** A thin fuse along the bottom edge that burns down with the window. Hidden for reduced motion. */
export function UndoFuse({ executeAfter }: { executeAfter: string }) {
  // Fixed at mount: the CSS animation runs the rest of the way on its own.
  const [ms] = useState(() => msLeft(executeAfter));
  if (ms <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="undo-fuse pointer-events-none absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-accent/60"
      style={{ "--fuse": `${ms}ms` } as CSSProperties}
    />
  );
}
