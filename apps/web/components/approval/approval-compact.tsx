"use client";

import { Check, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { EffectPill, Monogram } from "@/components/ui";
import { ApiError, type Approval, api, errorMessage } from "@/lib/api";
import { formatDateTime, formatRelative, splitToolName } from "@/lib/format";
import { approvalTitle } from "./approval-card";

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
  const [error, setError] = useState<string | null>(null);
  const { source } = splitToolName(a.name);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await api.decide(a.runId, a.toolCallId, { approved: true });
      toast("Approved", "success");
      onDone();
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
    <div className="flex flex-col gap-3 rounded-card border border-attention/30 bg-surface px-4 py-3.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5">
          <Monogram name={source ?? "Synapse"} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-14 font-medium text-fg">{approvalTitle(a.preview, a.name)}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-12 text-fg-muted">
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
      <div className="flex shrink-0 items-center gap-2 pl-[34px] sm:pl-0">
        <Link href={`/inbox?id=${encodeURIComponent(a.toolCallId)}`} className="btn btn-sm">
          Review
        </Link>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => void approve()}
        >
          {busy ? <LoaderCircle className="anim-spin size-3.5" /> : <Check className="size-3.5" />}
          {busy ? "Approving…" : "Approve"}
        </button>
      </div>
    </div>
  );
}
