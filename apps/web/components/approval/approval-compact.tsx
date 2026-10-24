"use client";

import { Check, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { EffectPill, Monogram } from "@/components/ui";
import { ApiError, type Approval, api, errorMessage } from "@/lib/api";
import { cx, formatDateTime, formatRelative, splitToolName } from "@/lib/format";
import { approvalTitle } from "./approval-card";

/** How long the stamp sits on the slip before the row leaves. */
const STAMP_MS = 800;

/** Home's "Needs you" row: enough to decide simple things, a link for the rest. */
export function ApprovalCompact({
  approval: a,
  onDone,
}: {
  approval: Approval;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [stamped, setStamped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settle = useRef<(() => void) | null>(null);
  const { source } = splitToolName(a.name);

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
      await api.decide(a.runId, a.toolCallId, { approved: true });
      settle.current = () => {
        toast("Approved", "success");
        onDone();
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
          {error ? <p className="mt-1 text-12 text-danger">{error}</p> : null}
        </div>
      </div>
      <div
        className={cx("flex shrink-0 items-center gap-2 pl-[34px] sm:pl-0", stamped && "invisible")}
      >
        <Link href={`/inbox?id=${encodeURIComponent(a.toolCallId)}`} className="btn btn-sm">
          Review
        </Link>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || stamped}
          onClick={() => void approve()}
        >
          {busy ? <LoaderCircle className="anim-spin size-3.5" /> : <Check className="size-3.5" />}
          {busy ? "Approving…" : "Approve"}
        </button>
      </div>
      {stamped ? (
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
