"use client";

import type { Effect } from "@synapse/core";
import { orgDomain, riskFacts } from "@synapse/core/risk";
import { AlertTriangle, Clock, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { ApprovalMeta, ApprovalSignoffs } from "@/lib/api";
import { cx } from "@/lib/format";

/**
 * The small signals around an approval: plain-language risk facts, when it expires, whether
 * it was escalated to the team's admins, and two-person sign-off progress.
 */

/** Risk facts from the server, or derived here when the server didn't send them. */
export function factsFor(
  call: { name: string; effect: Effect; input: unknown; tainted?: boolean },
  meta: ApprovalMeta | null | undefined,
  email: string | null | undefined,
): string[] {
  if (meta?.facts) return meta.facts;
  return riskFacts({ ...call, domain: orgDomain(email) });
}

/** "45 min", "3 h", "2 days" until `iso`; re-renders each minute. */
export function useExpiresIn(iso: string | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [iso]);
  if (!iso) return null;
  return timeLeft(Date.parse(iso) - now);
}

export function timeLeft(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "under a minute";
  if (min < 90) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

/** Reassuring facts ("Only people at acme.com") read calmer than warnings. */
const calm = (fact: string) => fact.startsWith("Only ");

export function RiskChips({ facts, className }: { facts: string[]; className?: string }) {
  if (facts.length === 0) return null;
  return (
    <ul aria-label="What approving does" className={cx("flex flex-wrap gap-1.5", className)}>
      {facts.map((f) => (
        <li
          key={f}
          className={cx(
            "inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-12 font-medium",
            calm(f) ? "bg-sunken text-fg-muted" : "bg-attention-soft text-attention",
          )}
        >
          {calm(f) ? null : <AlertTriangle aria-hidden="true" className="size-3 shrink-0" />}
          {f}
        </li>
      ))}
    </ul>
  );
}

/** Who still has to sign, in words. */
export function signoffText(
  s: ApprovalSignoffs | undefined,
  me: string | null | undefined,
  team: "admin" | "teammate" = "teammate",
): string | null {
  if (!s || s.needed < 2) return null;
  if (!s.first) return "Needs 2 approvals from different people";
  if (s.first.id === me) return `1 of 2 approvals · you approved, waiting for another ${team}`;
  return `1 of 2 approvals · ${s.first.name} approved, yours completes it`;
}

/** One quiet line: two-person progress, escalation, expiry. */
export function ApprovalStatusLine({
  meta,
  me,
  admin,
  className,
}: {
  meta: ApprovalMeta | null | undefined;
  me: string | null | undefined;
  /** An admin must give the approvals (a team rule), so the second is "another admin". */
  admin?: boolean;
  className?: string;
}) {
  const expires = useExpiresIn(meta?.expiresAt);
  const signoff = signoffText(meta?.signoffs, me, admin ? "admin" : "teammate");
  if (!expires && !signoff && !meta?.escalatedAt) return null;
  return (
    <p
      className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-fg-muted", className)}
    >
      {signoff ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-fg">
          <UsersRound aria-hidden="true" className="size-3.5" />
          {signoff}
        </span>
      ) : null}
      {meta?.escalatedAt ? (
        <span className="inline-flex items-center gap-1.5 text-attention">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-attention" />
          Escalated to admins
        </span>
      ) : null}
      {expires ? (
        <span
          className="inline-flex items-center gap-1.5"
          title={meta?.expiresAt ? new Date(meta.expiresAt).toLocaleString() : undefined}
        >
          <Clock aria-hidden="true" className="size-3.5" />
          Expires in {expires}
        </span>
      ) : null}
    </p>
  );
}
