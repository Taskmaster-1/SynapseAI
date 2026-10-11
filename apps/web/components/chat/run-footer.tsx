import type { UiRun } from "@synapse/core/ui";
import { RunStatusBadge } from "@/components/badges";
import { formatCost, formatTokens } from "@/lib/format";
import type { StreamState } from "@/lib/use-run-stream";

export function RunFooter({ run, stream }: { run: UiRun | null; stream: StreamState }) {
  if (!run) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      <RunStatusBadge status={run.status} />
      <span title="Input / output tokens">
        {formatTokens(run.inputTokens)} in · {formatTokens(run.outputTokens)} out
      </span>
      <span title="Cost of this run">{formatCost(run.costUsd)}</span>
      {stream === "reconnecting" ? <span className="text-send-fg">Reconnecting…</span> : null}
      {run.error ? <span className="text-danger-fg">{run.error}</span> : null}
    </div>
  );
}
