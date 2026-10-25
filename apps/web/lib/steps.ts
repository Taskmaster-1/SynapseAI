import type { ToolOutput } from "@synapse/core";
import type { UiMessage, UiPart } from "@synapse/core/ui";

export type ToolPart = Extract<UiPart, { type: "tool" }>;

export interface Step {
  part: ToolPart;
  runId: string | null;
  messageId: string;
}

export function stepsOf(messages: UiMessage[]): Step[] {
  const out: Step[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const p of m.parts)
      if (p.type === "tool") out.push({ part: p, runId: m.runId, messageId: m.id });
  }
  return out;
}

/** Calls that went through a person: they render as approval cards or receipts, not steps. */
export function wasAsked(p: ToolPart) {
  return p.status === "awaiting_approval" || p.decision === "ask";
}

const DENY_PREFIX = /^the user denied this action:?\s*/i;

export function denialReason(output: ToolOutput | null, fallback?: string | null): string | null {
  if (output?.type === "denied") {
    const r = output.reason.replace(DENY_PREFIX, "").trim();
    return r || null;
  }
  return fallback ?? null;
}

/** Denied because the person pressed Undo inside the undo window. */
export function isUndone(output: ToolOutput | null): boolean {
  return output?.type === "denied" && /^the user undid this action/i.test(output.reason);
}

export function receiptPhase(p: ToolPart): "running" | "done" | "failed" | "unknown" {
  if (p.status === "succeeded") return "done";
  if (p.status === "failed") return "failed";
  if (p.status === "unknown") return "unknown";
  return "running";
}

/**
 * The stream doesn't say which step tainted a run, so we mark the first successful read
 * in a tainted run (untrusted output is what taints it).
 */
export function taintStepId(steps: Step[], taintedRuns: Set<string>): Set<string> {
  const marked = new Set<string>();
  const seen = new Set<string>();
  for (const s of steps) {
    const run = s.runId ?? "";
    if (!taintedRuns.has(run) || seen.has(run)) continue;
    if (
      s.part.effect === "read" &&
      s.part.status === "succeeded" &&
      s.part.output?.type !== "error"
    ) {
      marked.add(s.part.toolCallId);
      seen.add(run);
    }
  }
  return marked;
}

export function policySummary(steps: Step[]) {
  let auto = 0;
  let approved = 0;
  let denied = 0;
  let blocked = 0;
  let waiting = 0;
  for (const { part: p } of steps) {
    if (p.status === "awaiting_approval") waiting++;
    else if (p.decision === "block") blocked++;
    else if (p.status === "denied") denied++;
    else if (p.decision === "ask") approved++;
    else if (p.decision === "allow") auto++;
  }
  return { auto, approved, denied, blocked, waiting };
}
