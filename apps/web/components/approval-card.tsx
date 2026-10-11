"use client";

import type { Effect } from "@synapse/core";
import { type ReactNode, useId, useState } from "react";
import { EffectBadge } from "@/components/badges";
import { useToast } from "@/components/toast";
import { ApiError, api, errorMessage } from "@/lib/api";
import { cx, prettyJson, splitToolName } from "@/lib/format";

export interface ApprovalCardProps {
  runId: string;
  toolCallId: string;
  name: string;
  effect: Effect;
  input: unknown;
  reason: string | null;
  preview?: string | null;
  header?: ReactNode;
  /** Called after the server accepted the decision (204). */
  onDecided: (approved: boolean) => void;
  /** Called on 409 (already decided / run moved on) so the caller can refetch. */
  onConflict: () => void;
}

/**
 * Shows the full payload of a gated tool call. Nothing is marked decided until the server
 * returns 204 — the card only shows a pending state while the request is in flight.
 */
export function ApprovalCard(props: ApprovalCardProps) {
  const { runId, toolCallId, name, effect, input, reason, preview, header } = props;
  const toast = useToast();
  const id = useId();
  const original = prettyJson(input);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(original);
  const [denying, setDenying] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { source, tool } = splitToolName(name);

  async function decide(approved: boolean) {
    setError(null);
    const body: { approved: boolean; reason?: string; input?: unknown } = { approved };
    if (approved && editing && draft.trim() !== original.trim()) {
      try {
        body.input = JSON.parse(draft);
      } catch {
        setError("The edited input isn't valid JSON.");
        return;
      }
    }
    if (!approved && denyReason.trim()) body.reason = denyReason.trim();
    setBusy(approved ? "approve" : "deny");
    try {
      await api.decide(runId, toolCallId, body);
      toast(approved ? "Approved" : "Denied", approved ? "success" : "info");
      props.onDecided(approved);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast("This action was already decided or the run moved on.", "info");
        props.onConflict();
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className={cx(
        "card overflow-hidden border-l-[3px]",
        effect === "destructive"
          ? "border-l-danger-fg"
          : effect === "send"
            ? "border-l-send-fg"
            : "border-l-write-fg",
      )}
      aria-labelledby={`${id}-title`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-subtle px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-send-fg">
          Approval needed
        </span>
        <span id={`${id}-title`} className="min-w-0 truncate font-mono text-[13px]">
          {source ? <span className="text-fg-faint">{source} · </span> : null}
          {tool}
        </span>
        <EffectBadge effect={effect} />
        {header ? <span className="ml-auto">{header}</span> : null}
      </div>
      <div className="space-y-3 p-3">
        {reason ? <p className="text-fg-muted">{reason}</p> : null}
        {preview ? <div className="code max-h-48 text-fg">{preview}</div> : null}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor={`${id}-input`} className="label mb-0">
              {editing ? "Edit input (JSON)" : "Full input"}
            </label>
            {!editing ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditing(true)}
                disabled={busy !== null}
              >
                Edit
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setEditing(false);
                  setDraft(original);
                  setError(null);
                }}
                disabled={busy !== null}
              >
                Reset
              </button>
            )}
          </div>
          {editing ? (
            <textarea
              id={`${id}-input`}
              className="input min-h-40 font-mono text-[13px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              rows={Math.min(20, draft.split("\n").length + 1)}
            />
          ) : (
            <pre id={`${id}-input`} className="code max-h-80">
              {original || "(no input)"}
            </pre>
          )}
        </div>
        {denying ? (
          <div>
            <label htmlFor={`${id}-deny`} className="label">
              Reason for the agent (optional)
            </label>
            <input
              id={`${id}-deny`}
              className="input"
              value={denyReason}
              placeholder="e.g. don't email external people"
              onChange={(e) => setDenyReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void decide(false);
                if (e.key === "Escape") setDenying(false);
              }}
              // biome-ignore lint/a11y/noAutofocus: the user just asked to deny
              autoFocus
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-danger-fg">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() => void decide(true)}
          >
            {busy === "approve" ? "Approving…" : editing ? "Approve edited" : "Approve"}
          </button>
          {denying ? (
            <>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy !== null}
                onClick={() => void decide(false)}
              >
                {busy === "deny" ? "Denying…" : "Confirm deny"}
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
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy !== null}
              onClick={() => setDenying(true)}
            >
              Deny
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
