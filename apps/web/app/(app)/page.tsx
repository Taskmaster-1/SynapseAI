"use client";

import { ArrowRight, Plug, Repeat } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApprovalCompact } from "@/components/approval/approval-compact";
import { Composer, type ComposerHandle } from "@/components/task/composer";
import { useToast } from "@/components/toast";
import {
  EmptyState,
  Page,
  SectionTitle,
  Skeleton,
  StatusDot,
  TaintShield,
  taskStatus,
} from "@/components/ui";
import { api, type ChatSummary, type Connection, errorMessage } from "@/lib/api";
import { describeCron } from "@/lib/cron";
import {
  cx,
  firstName,
  formatCost,
  formatDateTime,
  formatRelative,
  greeting,
  plural,
  stripMarkdown,
} from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useWorkspace } from "@/lib/workspace";

const SUGGESTIONS: Record<string, string[]> = {
  github: ["Triage my open PRs", "Summarise new issues in my repos"],
  linear: ["What's on my plate this week?", "Draft a weekly update from Linear"],
  gmail: ["Draft replies to anything urgent in my inbox"],
  google: ["What's on my calendar tomorrow?"],
  notion: ["Find my latest meeting notes in Notion"],
  slack: ["Catch me up on Slack since yesterday"],
  sentry: ["What new errors showed up this week?"],
};
const GENERAL = [
  "Search my knowledge base for our refund policy",
  "What do you remember about me?",
];

function suggestionsFor(conns: Connection[] | undefined): string[] {
  const out: string[] = [];
  for (const c of conns ?? []) {
    if (c.status !== "active") continue;
    const key = Object.keys(SUGGESTIONS).find((k) => c.name.toLowerCase().includes(k));
    if (key) out.push(...SUGGESTIONS[key]!);
  }
  return [...out, ...GENERAL].slice(0, 4);
}

export default function HomePage() {
  const router = useRouter();
  const toast = useToast();
  const { tasks, approvals, user, todaySpend, reload } = useWorkspace();
  const conns = useApi(() => api.connections());
  const autos = useApi(() => api.automations());
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const composer = useRef<ComposerHandle>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("new")) {
      composer.current?.focus();
      router.replace("/");
    }
  }, [router]);

  async function start(content: string) {
    const text = content.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { chat } = await api.createChat(text);
      void reload();
      router.push(`/t/${chat.id}`);
    } catch (err) {
      toast(errorMessage(err), "error");
      setSending(false);
    }
  }

  const running = (tasks ?? []).filter((t) => taskStatus(t.status) === "running").length;
  const needs = approvals?.length ?? 0;
  const name = firstName(user?.name);
  const summary = [
    needs ? `${plural(needs, "thing")} ${needs === 1 ? "needs" : "need"} you` : "Nothing needs you",
    running ? `${plural(running, "task")} running` : null,
    todaySpend != null ? `${formatCost(todaySpend)} today` : null,
  ].filter(Boolean);
  const suggestions = useMemo(() => suggestionsFor(conns.data?.connections), [conns.data]);
  const noConnections = conns.data && conns.data.connections.length === 0;

  return (
    <Page>
      <section className="pt-2 md:pt-6">
        <h1 className="font-serif text-[34px] leading-[1.1] tracking-[-0.01em] text-fg md:text-40">
          {greeting()}
          {name ? `, ${name}` : ""}.
        </h1>
        <p className="mt-2 text-14 text-fg-muted">
          {tasks === null ? (
            <Skeleton className="inline-block h-4 w-64 align-middle" />
          ) : (
            summary.join(" · ")
          )}
        </p>
      </section>

      <section className="mt-8">
        <Composer
          id="home-composer"
          handle={composer}
          size="lg"
          label="New task"
          value={draft}
          onChange={setDraft}
          onSend={() => void start(draft)}
          sending={sending}
          placeholder="What should I take care of?"
          autoFocus
          footer="Anything that sends, changes or deletes waits for your OK."
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={sending}
              onClick={() => void start(s)}
              className="inline-flex h-8 items-center rounded-full border border-line bg-surface px-3 text-13 text-fg-muted transition-colors duration-150 hover:border-line-strong hover:text-fg disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {noConnections ? (
        <section className="mt-10">
          <EmptyState
            compact
            icon={<Plug className="size-5" />}
            title="Connect your tools"
            action={
              <Link href="/connections" className="btn btn-primary">
                Add a connection
              </Link>
            }
          >
            Connect GitHub, Linear or any MCP server, and the agent can work inside them.
          </EmptyState>
        </section>
      ) : null}

      {needs > 0 ? (
        <section className="mt-12" aria-labelledby="needs-you">
          <SectionTitle
            action={
              <Link
                href="/inbox"
                className="inline-flex items-center gap-1 text-13 text-fg-muted hover:text-fg"
              >
                Open inbox <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            <span id="needs-you" className="inline-flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-attention" />
              Needs you
            </span>
          </SectionTitle>
          <ul className="space-y-2">
            {approvals!.slice(0, 3).map((a) => (
              <li key={a.toolCallId}>
                <ApprovalCompact approval={a} onDone={() => void reload()} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-12" aria-labelledby="recent">
        <SectionTitle>
          <span id="recent">Recent tasks</span>
        </SectionTitle>
        {tasks === null ? (
          <TaskRowsSkeleton />
        ) : tasks.length === 0 ? (
          <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-13 text-fg-muted">
            Your tasks will show up here. Try one of the suggestions above.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {tasks.slice(0, 6).map((t) => (
              <li key={t.id}>
                <TaskRow task={t} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="scheduled">
        <SectionTitle
          action={
            <Link
              href="/automations"
              className="inline-flex items-center gap-1 text-13 text-fg-muted hover:text-fg"
            >
              All automations <ArrowRight className="size-3.5" />
            </Link>
          }
        >
          <span id="scheduled">Scheduled</span>
        </SectionTitle>
        {!autos.data ? (
          <TaskRowsSkeleton rows={1} />
        ) : autos.data.automations.length === 0 ? (
          <Link
            href="/automations?new=1"
            className="flex items-center gap-3 rounded-card border border-dashed border-line-strong px-4 py-4 text-13 text-fg-muted hover:text-fg"
          >
            <Repeat className="text-fg-faint" />
            Run a prompt on a schedule, like a morning brief every weekday.
          </Link>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {autos.data.automations.map((a) => (
              <li key={a.id}>
                <Link
                  href={a.chatId ? `/t/${a.chatId}` : "/automations"}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-hover"
                >
                  <Repeat className={a.enabled ? "text-accent" : "text-fg-faint"} />
                  <span className="min-w-0 flex-1 truncate text-14 text-fg">{a.name}</span>
                  <span
                    className="shrink-0 text-13 text-fg-muted"
                    title={formatDateTime(a.nextRunAt)}
                  >
                    {a.enabled
                      ? `${describeCron(a.schedule)?.replace(" at ", " ") ?? a.schedule} · ${formatRelative(a.nextRunAt)}`
                      : "Paused"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}

function TaskRow({ task: t }: { task: ChatSummary }) {
  const status = t.pendingApprovals > 0 ? "needs" : taskStatus(t.status);
  const snippet = stripMarkdown(t.snippet);
  return (
    <Link
      href={`/t/${t.id}`}
      className="flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-hover"
    >
      <span className="pt-[7px]">
        <StatusDot status={status} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-14 font-medium text-fg">{t.title || "Untitled"}</span>
          {t.tainted ? <TaintShield interactive={false} /> : null}
        </span>
        {snippet ? (
          <span className="mt-0.5 line-clamp-1 text-13 text-fg-muted">{snippet}</span>
        ) : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 pt-px">
        <span className="text-12 text-fg-faint" title={formatDateTime(t.updatedAt)}>
          {formatRelative(t.updatedAt)}
        </span>
        <span className={cx("tabular text-12", t.costUsd ? "text-fg-muted" : "text-fg-faint")}>
          {formatCost(t.costUsd)}
        </span>
      </span>
    </Link>
  );
}

function TaskRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line rounded-card border border-line bg-surface">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="size-2 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
