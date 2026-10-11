"use client";

import { ArrowRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { approvalTitle } from "@/components/approval/approval-card";
import { PayloadView } from "@/components/approval/payload";
import { Sheet } from "@/components/overlay";
import { OutputView } from "@/components/task/run-panel";
import {
  EffectPill,
  EmptyState,
  ErrorNote,
  Page,
  PageHeader,
  Skeleton,
  StatusPill,
  StepStatusIcon,
  taskStatus,
} from "@/components/ui";
import { type AuditToolCall, api, errorMessage, type RunRow, type UsageDay } from "@/lib/api";
import {
  cx,
  formatCost,
  formatDateTime,
  formatDuration,
  formatRelative,
  formatTokens,
  humanToolName,
  plural,
} from "@/lib/format";
import { useApi } from "@/lib/use-api";

const TRIGGER: Record<string, string> = { chat: "You", schedule: "Schedule", manual: "Run now" };

function lastNDays(days: UsageDay[], n: number) {
  const map = new Map(days.map((d) => [d.date, d]));
  const out: UsageDay[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i),
    );
    const key = d.toISOString().slice(0, 10);
    out.push(map.get(key) ?? { date: key, costUsd: 0, runs: 0, inputTokens: 0, outputTokens: 0 });
  }
  return out;
}

export default function ActivityPage() {
  const runs = useApi(() => api.runs(50));
  const usage = useApi(() => api.usage(30));
  const [selected, setSelected] = useState<RunRow | null>(null);
  const list = runs.data?.runs;
  const series = useMemo(() => lastNDays(usage.data?.days ?? [], 30), [usage.data]);
  const sum = (n: number) => series.slice(-n).reduce((t, d) => t + d.costUsd, 0);

  return (
    <Page wide>
      <PageHeader
        title="Activity"
        description="Every run, what it cost, and every tool call with the decision behind it."
        actions={
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              void runs.reload();
              void usage.reload();
            }}
            disabled={runs.loading}
          >
            <RefreshCw className={cx("size-3.5", runs.loading && "anim-spin")} />
            Refresh
          </button>
        }
      />

      <section
        aria-label="Spend"
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]"
      >
        <dl className="grid grid-cols-3 gap-3 md:grid-cols-1">
          {(
            [
              ["Today", sum(1)],
              ["7 days", sum(7)],
              ["30 days", sum(30)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-card border border-line bg-surface px-4 py-3">
              <dt className="text-12 text-fg-muted">{k}</dt>
              <dd className="tabular mt-0.5 text-20 font-medium text-fg">
                {usage.data ? formatCost(v) : <Skeleton className="mt-1 h-5 w-14" />}
              </dd>
            </div>
          ))}
        </dl>
        <SpendChart days={series} loading={!usage.data} />
      </section>

      <section className="mt-10" aria-labelledby="runs-h">
        <h2 id="runs-h" className="mb-3 text-13 font-medium text-fg-muted">
          Runs
        </h2>
        {runs.error ? <ErrorNote>{errorMessage(runs.error)}</ErrorNote> : null}
        {!list ? (
          <Skeleton className="h-64 rounded-card" />
        ) : list.length === 0 ? (
          <EmptyState compact title="No runs yet">
            Start a task and its runs show up here.
          </EmptyState>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-card border border-line bg-surface md:block">
              <table className="w-full table-fixed text-left text-13">
                <thead className="border-b border-line text-12 text-fg-muted">
                  <tr>
                    <th className="w-[120px] px-4 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Task</th>
                    <th className="w-[92px] px-3 py-2.5 font-medium">Trigger</th>
                    <th className="hidden w-[170px] px-3 py-2.5 font-medium xl:table-cell">
                      Model
                    </th>
                    <th className="w-[60px] px-3 py-2.5 text-right font-medium">Steps</th>
                    <th className="w-[80px] px-3 py-2.5 text-right font-medium">Tokens</th>
                    <th className="w-[76px] px-3 py-2.5 text-right font-medium">Cost</th>
                    <th className="w-[96px] px-4 py-2.5 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.map((r) => (
                    <tr
                      key={r.id}
                      tabIndex={0}
                      className="cursor-pointer transition-colors duration-150 hover:bg-hover focus-visible:bg-hover"
                      onClick={() => setSelected(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(r);
                        }
                      }}
                      aria-label={`Run of ${r.chatTitle}`}
                    >
                      <td className="px-4 py-2.5">
                        <StatusPill status={taskStatus(r.status)} />
                      </td>
                      <td className="truncate px-3 py-2.5 text-fg">{r.chatTitle || "Untitled"}</td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        {TRIGGER[r.trigger] ?? r.trigger}
                      </td>
                      <td className="hidden truncate px-3 py-2.5 font-mono text-12 text-fg-muted xl:table-cell">
                        {r.model?.replace(/^[a-z]+:/, "") ?? "—"}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-fg-muted">{r.steps}</td>
                      <td className="tabular px-3 py-2.5 text-right text-fg-muted">
                        {formatTokens(r.inputTokens + r.outputTokens)}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-fg">
                        {formatCost(r.costUsd)}
                      </td>
                      <td
                        className="px-4 py-2.5 text-right whitespace-nowrap text-fg-muted"
                        title={formatDateTime(r.createdAt)}
                      >
                        {formatRelative(r.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface md:hidden">
              {list.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-hover"
                    onClick={() => setSelected(r)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-14 text-fg">
                        {r.chatTitle || "Untitled"}
                      </span>
                      <span className="tabular text-13 text-fg">{formatCost(r.costUsd)}</span>
                    </span>
                    <span className="flex items-center gap-2 text-12 text-fg-muted">
                      <StatusPill status={taskStatus(r.status)} />
                      <span>{TRIGGER[r.trigger] ?? r.trigger}</span>
                      <span>· {plural(r.steps, "step")}</span>
                      <span className="ml-auto">{formatRelative(r.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.chatTitle || "Run"}
        description={selected ? `Run started ${formatDateTime(selected.createdAt)}` : undefined}
        width={600}
      >
        {selected ? <RunDetail run={selected} /> : null}
      </Sheet>
    </Page>
  );
}

function SpendChart({ days, loading }: { days: UsageDay[]; loading: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.costUsd), 0);
  const label = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const h = hover !== null ? days[hover] : null;
  return (
    <figure className="flex flex-col rounded-card border border-line bg-surface px-4 pt-3 pb-3">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-12 text-fg-muted">Daily spend · last 30 days</span>
        <span className="tabular text-12 text-fg" aria-live="polite">
          {h
            ? `${label(h.date)} · ${formatCost(h.costUsd)} · ${h.runs} runs`
            : `Peak ${formatCost(max)}`}
        </span>
      </figcaption>
      {loading ? (
        <Skeleton className="mt-3 h-[132px]" />
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: hover readout only; the same data is in the table below
        <div className="relative mt-3 h-[132px]" onMouseLeave={() => setHover(null)}>
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-line" />
          <div className="absolute inset-0 flex items-end gap-[2px]" aria-hidden="true">
            {days.map((d, i) => {
              const pct = max > 0 ? (d.costUsd / max) * 100 : 0;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover readout only; the same data is in the table below
                <div
                  key={d.date}
                  className="flex h-full flex-1 items-end"
                  onMouseEnter={() => setHover(i)}
                  title={`${label(d.date)}: ${formatCost(d.costUsd)}`}
                >
                  <div
                    className={cx(
                      "w-full rounded-t-[4px] transition-colors duration-150",
                      d.costUsd > 0 ? (hover === i ? "bg-accent-hover" : "bg-accent") : "bg-line",
                      hover !== null && hover !== i && d.costUsd > 0 && "opacity-60",
                    )}
                    style={{ height: d.costUsd > 0 ? `max(${pct}%, 3px)` : "2px" }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-1.5 flex justify-between text-[11px] text-fg-faint" aria-hidden="true">
        <span>{days[0] ? label(days[0].date) : ""}</span>
        <span>Today</span>
      </div>
      <table className="sr-only">
        <caption>Daily spend</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Spend</th>
            <th>Runs</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{formatCost(d.costUsd)}</td>
              <td>{d.runs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function decidedBy(c: AuditToolCall) {
  if (c.decision === "block") return "Blocked by a rule";
  if (c.decision === "allow") return "Allowed automatically";
  if (c.status === "awaiting_approval") return "Waiting for you";
  if (c.status === "denied") return c.decidedBy ? "Denied by you" : "Denied";
  return c.decidedBy ? "Approved by you" : "Approved";
}

function RunDetail({ run }: { run: RunRow }) {
  const detail = useApi(() => api.run(run.id), run.id);
  const r = detail.data?.run ?? run;
  const calls = detail.data?.toolCalls;
  const duration =
    r.finishedAt && r.createdAt
      ? formatDuration(new Date(r.finishedAt).getTime() - new Date(r.createdAt).getTime())
      : null;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={taskStatus(r.status)} />
        <Link
          href={`/t/${r.chatId}`}
          className="inline-flex items-center gap-1 text-13 font-medium text-accent hover:underline"
        >
          Open task <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
        {(
          [
            [
              "Model",
              <span key="m" className="font-mono text-12">
                {r.model ?? "—"}
              </span>,
            ],
            ["Trigger", TRIGGER[r.trigger] ?? r.trigger],
            ["Steps", r.steps],
            ["Tokens", `${formatTokens(r.inputTokens)} in · ${formatTokens(r.outputTokens)} out`],
            ["Cost", formatCost(r.costUsd)],
            ["Duration", duration ?? "—"],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="bg-surface px-3 py-2.5">
            <dt className="text-12 text-fg-muted">{k}</dt>
            <dd className="tabular mt-0.5 truncate text-13 text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      {r.error ? <ErrorNote>{r.error}</ErrorNote> : null}

      <section>
        <h3 className="mb-3 text-13 font-medium text-fg-muted">
          Tool calls{calls ? ` · ${calls.length}` : ""}
        </h3>
        {detail.error ? <ErrorNote>{errorMessage(detail.error)}</ErrorNote> : null}
        {!calls ? (
          <Skeleton className="h-24 rounded-card" />
        ) : calls.length === 0 ? (
          <p className="text-13 text-fg-muted">This run didn't use any tools.</p>
        ) : (
          <ol className="space-y-2">
            {calls.map((c) => (
              <li key={c.id}>
                <details className="group rounded-[10px] border border-line bg-surface">
                  <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
                    <StepStatusIcon status={c.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-13 text-fg">
                        {approvalTitle(null, c.name)}
                      </span>
                      <span className="block text-12 text-fg-muted">
                        {decidedBy(c)}
                        {c.decidedAt ? ` · ${formatDateTime(c.decidedAt)}` : ""}
                      </span>
                    </span>
                    <EffectPill effect={c.effect} />
                  </summary>
                  <div className="space-y-3 border-t border-line px-3.5 py-3">
                    {c.decisionReason ? (
                      <p className="text-13 text-fg-muted">
                        <span className="text-fg-faint">Why · </span>
                        {c.decisionReason}
                      </p>
                    ) : null}
                    <p className="text-12 text-fg-faint">
                      {humanToolName(c.name)} · proposed {formatDateTime(c.createdAt)}
                      {c.inputEdited ? " · input edited by you" : ""}
                    </p>
                    <div>
                      <div className="eyebrow mb-1.5">Input</div>
                      <div className="rounded-[8px] border border-line p-2.5 text-13">
                        <PayloadView input={c.input} />
                      </div>
                    </div>
                    <div>
                      <div className="eyebrow mb-1.5">Output</div>
                      <OutputView output={c.output} reason={c.decisionReason} />
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
