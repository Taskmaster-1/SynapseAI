import type { ToolOutput } from "@synapse/core";
import type { UiPart } from "@synapse/core/ui";
import { EffectBadge, ToolStatus } from "@/components/badges";
import { prettyJson, splitToolName } from "@/lib/format";

type ToolPart = Extract<UiPart, { type: "tool" }>;

export function ToolOutputView({ output }: { output: ToolOutput | null }) {
  if (!output) return <p className="text-fg-faint">No output yet.</p>;
  switch (output.type) {
    case "text":
      return <pre className="code max-h-80">{output.value}</pre>;
    case "json":
      return <pre className="code max-h-80">{prettyJson(output.value)}</pre>;
    case "error":
      return <pre className="code max-h-80 text-danger-fg">{output.value}</pre>;
    case "denied":
      return <p className="text-danger-fg">Denied: {output.reason}</p>;
    default:
      return <pre className="code max-h-80">{prettyJson(output)}</pre>;
  }
}

/** Compact, collapsible card for one tool call in the timeline. */
export function ToolCard({ part }: { part: ToolPart }) {
  const { source, tool } = splitToolName(part.name);
  return (
    <details className="group card overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 select-none hover:bg-hover [&::-webkit-details-marker]:hidden">
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
          className="shrink-0 text-fg-faint transition-transform group-open:rotate-90"
        >
          <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
          {source ? <span className="text-fg-faint">{source} · </span> : null}
          {tool}
        </span>
        <EffectBadge effect={part.effect} />
        <ToolStatus status={part.status} />
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3">
        {part.reason ? (
          <p className="text-fg-muted">
            <span className="font-medium text-fg">Policy: </span>
            {part.decision ? `${part.decision} — ` : null}
            {part.reason}
          </p>
        ) : null}
        <div>
          <div className="label">Input</div>
          <pre className="code max-h-80">{prettyJson(part.input) || "(none)"}</pre>
        </div>
        <div>
          <div className="label">Output</div>
          <ToolOutputView output={part.output} />
        </div>
      </div>
    </details>
  );
}
