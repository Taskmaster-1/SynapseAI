import type { Effect, RunStatus, ToolCallStatus } from "@synapse/core";
import { cx } from "@/lib/format";

const EFFECT_STYLE: Record<Effect, string> = {
  read: "bg-read-bg text-read-fg",
  write: "bg-write-bg text-write-fg",
  send: "bg-send-bg text-send-fg",
  destructive: "bg-danger-bg text-danger-fg",
};

export function EffectBadge({ effect, className }: { effect: Effect; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium uppercase tracking-wide",
        EFFECT_STYLE[effect] ?? EFFECT_STYLE.read,
        className,
      )}
      title={`Effect: ${effect}`}
    >
      {effect}
    </span>
  );
}

const RUN_DOT: Record<RunStatus, string> = {
  queued: "bg-fg-faint animate-pulse-dot",
  running: "bg-accent animate-pulse-dot",
  waiting: "bg-send-fg",
  completed: "bg-ok-fg",
  failed: "bg-danger-fg",
  cancelled: "bg-fg-faint",
};

const RUN_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting for you",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function runStatusLabel(status: RunStatus | null | undefined): string {
  return status ? (RUN_LABEL[status] ?? status) : "Idle";
}

export function StatusDot({ status }: { status: RunStatus | null | undefined }) {
  return (
    <span
      role="img"
      aria-label={runStatusLabel(status)}
      title={runStatusLabel(status)}
      className={cx(
        "inline-block size-2 shrink-0 rounded-full",
        status ? RUN_DOT[status] : "bg-border-strong",
      )}
    />
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <StatusDot status={status} />
      {runStatusLabel(status)}
    </span>
  );
}

const TOOL_LABEL: Record<ToolCallStatus, string> = {
  proposed: "Proposed",
  awaiting_approval: "Needs approval",
  approved: "Approved",
  denied: "Denied",
  executing: "Running",
  succeeded: "Done",
  failed: "Failed",
  unknown: "Unknown outcome",
};

const TOOL_STYLE: Record<ToolCallStatus, string> = {
  proposed: "text-fg-faint",
  awaiting_approval: "text-send-fg",
  approved: "text-fg-muted",
  denied: "text-danger-fg",
  executing: "text-accent",
  succeeded: "text-ok-fg",
  failed: "text-danger-fg",
  unknown: "text-send-fg",
};

export function ToolStatus({ status }: { status: ToolCallStatus }) {
  return (
    <span className={cx("text-xs font-medium whitespace-nowrap", TOOL_STYLE[status])}>
      {status === "executing" ? (
        <span className="mr-1 inline-block size-1.5 rounded-full bg-accent align-middle animate-pulse-dot" />
      ) : null}
      {TOOL_LABEL[status] ?? status}
    </span>
  );
}
