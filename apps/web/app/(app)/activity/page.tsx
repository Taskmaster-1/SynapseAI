"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { EffectBadge, RunStatusBadge, ToolStatus } from "@/components/badges";
import { ToolOutputView } from "@/components/chat/tool-card";
import { Drawer } from "@/components/drawer";
import { Empty, ErrorNote, Page, Spinner } from "@/components/page";
import { api, errorMessage, type RunRow } from "@/lib/api";
import { formatCost, formatDateTime, formatRelative, formatTokens, prettyJson } from "@/lib/format";
import { useApi } from "@/lib/use-api";

export default function ActivityPage() {
  const runs = useApi(() => api.runs(50));
  const usage = useApi(() => api.usage(30));
  const [selected, setSelected] = useState<RunRow | null>(null);
  const close = useCallback(() => setSelected(null), []);
  const list = runs.data?.runs;
  const totals = (usage.data?.days ?? []).reduce(
    (t, d) => ({
      cost: t.cost + d.costUsd,
      runs: t.runs + d.runs,
      tokens: t.tokens + d.inputTokens + d.outputTokens,
    }),
    { cost: 0, runs: 0, tokens: 0 },
  );

  return (
    <Page
      title="Activity"
      description="Every run, what it cost, and every tool call with the policy decision behind it."
      actions={
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void runs.reload()}
          disabled={runs.loading}
        >
          Refresh
        </button>
      }
    >
      {usage.data ? (
        <dl className="mb-6 grid grid-cols-3 gap-2">
          {[
            ["Cost (30 days)", formatCost(totals.cost)],
            ["Runs", String(totals.runs)],
            ["Tokens", formatTokens(totals.tokens)],
          ].map(([k, v]) => (
            <div key={k} className="card px-3 py-2">
              <dt className="text-xs text-fg-muted">{k}</dt>
              <dd className="text-base font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {runs.error ? <ErrorNote error={errorMessage(runs.error)} /> : null}
      {!list ? (
        runs.loading ? (
          <Spinner />
        ) : null
      ) : list.length === 0 ? (
        <Empty>No runs yet.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead className="border-b border-border bg-subtle text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Chat</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">Tokens</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 font-medium">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-hover"
                  onClick={() => setSelected(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(r);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Run in ${r.chatTitle}, ${r.status}`}
                >
                  <td className="max-w-56 truncate px-3 py-2">
                    {r.chatTitle || "Untitled"}
                    {r.trigger && r.trigger !== "chat" ? (
                      <span className="ml-2 text-xs text-fg-faint">{r.trigger}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <RunStatusBadge status={r.status} />
                  </td>
                  <td className="max-w-44 truncate px-3 py-2 font-mono text-xs text-fg-muted">
                    {r.model ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                    {formatTokens(r.inputTokens + r.outputTokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCost(r.costUsd)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-fg-muted">
                    {formatRelative(r.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Drawer open={selected !== null} onClose={close} title={selected?.chatTitle || "Run"}>
        {selected ? <RunDetail run={selected} /> : null}
      </Drawer>
    </Page>
  );
}

function RunDetail({ run }: { run: RunRow }) {
  const detail = useApi(() => api.run(run.id), run.id);
  const r = detail.data?.run ?? run;
  const calls = detail.data?.toolCalls;

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {(
          [
            ["Status", <RunStatusBadge key="s" status={r.status} />],
            ["Model", r.model ?? "—"],
            ["Steps", r.steps],
            ["Tokens", `${formatTokens(r.inputTokens)} in · ${formatTokens(r.outputTokens)} out`],
            ["Cost", formatCost(r.costUsd)],
            ["Trigger", r.trigger],
            ["Started", formatDateTime(r.createdAt)],
            ["Finished", formatDateTime(r.finishedAt)],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-fg-muted">{k}</dt>
            <dd className="truncate">{v}</dd>
          </div>
        ))}
      </dl>
      {r.error ? <ErrorNote error={r.error} /> : null}
      <Link href={`/c/${r.chatId}`} className="inline-block text-accent hover:underline">
        Open chat →
      </Link>
      <div>
        <h3 className="mb-2 font-semibold">Tool calls</h3>
        {detail.error ? <ErrorNote error={errorMessage(detail.error)} /> : null}
        {!calls ? (
          detail.loading ? (
            <Spinner />
          ) : null
        ) : calls.length === 0 ? (
          <p className="text-fg-muted">No tool calls in this run.</p>
        ) : (
          <ol className="space-y-2">
            {calls.map((c) => (
              <li key={c.id}>
                <details className="card">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 select-none hover:bg-hover">
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{c.name}</span>
                    <EffectBadge effect={c.effect} />
                    <ToolStatus status={c.status} />
                  </summary>
                  <div className="space-y-3 border-t border-border p-3">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                      <div>
                        <dt className="text-xs text-fg-muted">Decision</dt>
                        <dd>{c.decision ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-fg-muted">Decided by</dt>
                        <dd>{c.decidedBy ?? (c.decision === "allow" ? "policy" : "—")}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-fg-muted">Reason</dt>
                        <dd>{c.decisionReason ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-fg-muted">Proposed</dt>
                        <dd>{formatDateTime(c.createdAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-fg-muted">Decided</dt>
                        <dd>{formatDateTime(c.decidedAt)}</dd>
                      </div>
                    </dl>
                    <div>
                      <div className="label">Input</div>
                      <pre className="code max-h-64">{prettyJson(c.input) || "(none)"}</pre>
                    </div>
                    <div>
                      <div className="label">Output</div>
                      <ToolOutputView output={c.output} />
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
