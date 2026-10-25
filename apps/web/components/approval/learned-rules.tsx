"use client";

import type { RuleSuggestion } from "@synapse/core";
import { Check, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { errorMessage } from "@/lib/api";
import { cx } from "@/lib/format";
import { acceptSuggestion, dismissSuggestion, useSuggestions } from "@/lib/suggestions";

const RULES_HREF = "/settings?section=rules";
const CAVEAT = "Tasks that read outside content still ask.";

function useDecide() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function run(id: string, accept: boolean) {
    if (busy) return false;
    setBusy(id);
    try {
      if (accept) await acceptSuggestion(id);
      else await dismissSuggestion(id);
      return true;
    } catch (err) {
      toast(errorMessage(err), "error");
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { busy, run };
}

/** Inbox: a quiet note at the top when the user keeps approving the same kind of action. */
export function SuggestionStrip({ className }: { className?: string }) {
  const suggestions = useSuggestions();
  const toast = useToast();
  const { busy, run } = useDecide();
  if (!suggestions?.length) return null;
  return (
    <section
      aria-label="Suggested rules"
      className={cx("anim-fade-in rounded-[8px] bg-sunken/70 px-3.5 py-3", className)}
    >
      <p className="eyebrow">You keep approving these</p>
      <p className="mt-1 text-13 text-fg">Allow them automatically?</p>
      <ul className="mt-2.5 space-y-3">
        {suggestions.slice(0, 3).map((s) => (
          <li key={s.id} className="border-t border-line pt-2.5">
            <p className="text-13 text-fg-muted">{s.sentence}</p>
            {s.examples[0] ? (
              <p className="mt-0.5 truncate text-12 text-fg-faint" title={s.examples.join("\n")}>
                {s.examples[0]}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy !== null}
                onClick={async () => {
                  if (await run(s.id, true)) toast(`Now allowed: ${s.label}`, "success");
                }}
              >
                {busy === s.id ? (
                  <LoaderCircle className="anim-spin size-3.5" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Allow
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy !== null}
                onClick={() => void run(s.id, false)}
              >
                Not now
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-12 text-fg-faint">
        {CAVEAT}{" "}
        <Link href={RULES_HREF} className="text-fg-muted underline-offset-2 hover:underline">
          Approval rules
        </Link>
      </p>
    </section>
  );
}

/**
 * Under a fresh approval: if that approval tipped a suggestion for this tool, offer it once.
 * Mounted after the stamp settles, so it never competes with the stamp.
 */
export function LearnPrompt({ tool, className }: { tool: string; className?: string }) {
  const suggestions = useSuggestions(tool);
  const { busy, run } = useDecide();
  const [done, setDone] = useState<RuleSuggestion | null>(null);
  const s = suggestions?.find((x) => x.tool === tool);

  if (done) {
    return (
      <p className={cx("anim-fade-in px-1 text-12 text-fg-muted", className)} role="status">
        Done. {capitalize(done.label)} are now allowed. {CAVEAT}{" "}
        <Link href={RULES_HREF} className="underline-offset-2 hover:text-fg hover:underline">
          Approval rules
        </Link>
      </p>
    );
  }
  if (!s) return null;
  return (
    <div
      className={cx(
        "anim-fade-in flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-13",
        className,
      )}
    >
      <span className="min-w-0 flex-1 text-fg-muted" title={`${s.sentence} ${CAVEAT}`}>
        Always allow {s.label}?
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy !== null}
          onClick={async () => {
            if (await run(s.id, true)) setDone(s);
          }}
        >
          {busy === s.id ? <LoaderCircle className="anim-spin size-3.5" /> : null}
          Allow
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy !== null}
          onClick={() => void run(s.id, false)}
        >
          No thanks
        </button>
      </span>
    </div>
  );
}

function capitalize(s: string) {
  return s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s;
}
