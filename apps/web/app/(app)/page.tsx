"use client";

import { ArrowRight, ArrowUpRight, Check, Repeat } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ApprovalCompact } from "@/components/approval/approval-compact";
import { Composer, type ComposerHandle } from "@/components/task/composer";
import { useToast } from "@/components/toast";
import {
  Monogram,
  Page,
  SectionTitle,
  Skeleton,
  StatusDot,
  statusLabel,
  TaintShield,
  taskStatus,
} from "@/components/ui";
import {
  type Approval,
  type Automation,
  api,
  type ChatSummary,
  type Connection,
  errorMessage,
} from "@/lib/api";
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

const GUIDE_HIDDEN_KEY = "synapse-guide-hidden";

/**
 * Whether you've ever decided on an approval. Only asked while the first-run guide could
 * show, and only of the latest few runs.
 */
function useSignedOff(enabled: boolean, hasTasks: boolean) {
  const [signedOff, setSignedOff] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (!hasTasks) {
      setSignedOff(false);
      return;
    }
    let live = true;
    (async () => {
      try {
        const { runs } = await api.runs(5);
        const details = await Promise.all(runs.map((r) => api.run(r.id).catch(() => null)));
        const any = details.some((d) => d?.toolCalls.some((c) => c.decidedBy));
        if (live) setSignedOff(any);
      } catch {
        if (live) setSignedOff(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [enabled, hasTasks]);
  return signedOff;
}

export default function HomePage() {
  const router = useRouter();
  const toast = useToast();
  const { tasks, approvals, user, todaySpend, reload } = useWorkspace();
  const conns = useApi(() => api.connections());
  const autos = useApi(() => api.automations());
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [guideHidden, setGuideHidden] = useState(true);
  const composer = useRef<ComposerHandle>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("new")) {
      composer.current?.focus();
      router.replace("/");
    }
  }, [router]);

  useEffect(() => {
    try {
      setGuideHidden(localStorage.getItem(GUIDE_HIDDEN_KEY) === "1");
    } catch {
      setGuideHidden(false);
    }
  }, []);

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
  // Rows approved here stay while their undo window runs, even after a reload drops them.
  const [held, setHeld] = useState<Record<string, Approval>>({});
  const rows = useMemo(() => {
    if (!approvals) return approvals;
    const live = new Set(approvals.map((a) => a.toolCallId));
    const kept = Object.values(held).filter((a) => !live.has(a.toolCallId));
    return [...kept, ...approvals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [approvals, held]);
  const listed = rows?.length ?? 0;
  const name = firstName(user?.name);
  const suggestions = useMemo(() => suggestionsFor(conns.data?.connections), [conns.data]);

  // First-run guide: shown to new accounts until every step is done (or it's hidden).
  const connectionCount = conns.data?.connections.length;
  const hasConnection = (connectionCount ?? 0) > 0;
  const hasTask = (tasks?.length ?? 0) > 0;
  const guideCandidate =
    !guideHidden && connectionCount !== undefined && tasks !== null && tasks.length < 5;
  const signedOff = useSignedOff(guideCandidate, hasTask);
  const showGuide =
    guideCandidate && signedOff !== null && !(hasConnection && hasTask && signedOff);

  function hideGuide() {
    setGuideHidden(true);
    try {
      localStorage.setItem(GUIDE_HIDDEN_KEY, "1");
    } catch {
      // storage unavailable: hidden for this visit only
    }
  }

  const list = autos.data?.automations;

  return (
    <Page>
      <section className="pt-2 md:pt-4">
        <p className="eyebrow" suppressHydrationWarning>
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
        <h1
          className="mt-3 font-serif text-[46px] leading-[0.98] tracking-[-0.025em] text-fg md:text-[64px]"
          suppressHydrationWarning
        >
          {greeting()}
          {name ? (
            <>
              , <span className="text-accent italic">{name}</span>
            </>
          ) : null}
          .
        </h1>
        <div className="mt-4 text-14 text-fg-muted">
          {tasks === null ? (
            <Skeleton className="h-4 w-64" />
          ) : (
            <Summary needs={needs} running={running} spend={todaySpend} />
          )}
        </div>
      </section>

      <section className="mt-9">
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

      {showGuide ? (
        <FirstRunGuide
          hasConnection={hasConnection}
          connections={conns.data?.connections ?? []}
          hasTask={hasTask}
          signedOff={!!signedOff}
          waiting={needs}
          onWrite={() => composer.current?.focus()}
          onHide={hideGuide}
        />
      ) : null}

      {listed > 0 || !showGuide ? (
        <section className="mt-14" aria-labelledby="needs-you">
          <SectionTitle
            action={
              needs > 0 ? (
                <Link
                  href="/inbox"
                  className="inline-flex items-center gap-1 text-13 text-fg-muted hover:text-fg"
                >
                  Open inbox <ArrowRight className="size-3.5" />
                </Link>
              ) : undefined
            }
          >
            <span id="needs-you" className="inline-flex items-baseline gap-2.5">
              Waiting for you
              {needs > 0 ? (
                <span className="tabular translate-y-[-4px] rounded-full bg-attention-soft px-2 py-0.5 font-sans text-12 font-medium text-attention">
                  {needs}
                </span>
              ) : null}
            </span>
          </SectionTitle>
          {approvals === null ? (
            <Skeleton className="h-16 rounded-card" />
          ) : listed === 0 ? (
            <p className="flex items-center gap-2.5 text-14 text-fg-muted">
              <span className="grid size-5 place-items-center rounded-full bg-ok-soft text-ok">
                <Check className="size-3" strokeWidth={2.5} />
              </span>
              Nothing to sign. Anything that sends, changes or deletes will wait here.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {rows!.slice(0, 3).map((a) => (
                <li key={a.toolCallId}>
                  <ApprovalCompact
                    approval={a}
                    onHold={() => setHeld((h) => ({ ...h, [a.toolCallId]: a }))}
                    onDone={() => {
                      setHeld((h) => {
                        const { [a.toolCallId]: _gone, ...rest } = h;
                        return rest;
                      });
                      void reload();
                    }}
                  />
                </li>
              ))}
              {listed > 3 ? (
                <li>
                  <Link href="/inbox" className="text-13 text-fg-muted hover:text-fg">
                    and {plural(listed - 3, "more")} in the inbox
                  </Link>
                </li>
              ) : null}
            </ul>
          )}
        </section>
      ) : null}

      {hasTask || tasks === null || !showGuide ? (
        <section className="mt-14" aria-labelledby="recent">
          <SectionTitle
            action={
              hasTask ? (
                <Link
                  href="/activity"
                  className="inline-flex items-center gap-1 text-13 text-fg-muted hover:text-fg"
                >
                  Activity <ArrowRight className="size-3.5" />
                </Link>
              ) : undefined
            }
          >
            <span id="recent">Recently</span>
          </SectionTitle>
          {tasks === null ? (
            <TaskRowsSkeleton />
          ) : tasks.length === 0 ? (
            <p className="text-14 text-fg-muted">
              Nothing yet. Your tasks will collect here, newest first.
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">
              {tasks.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <TaskRow task={t} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {(list && list.length > 0) || !showGuide ? (
        <section className="mt-14" aria-labelledby="scheduled">
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
          {!list ? (
            <TaskRowsSkeleton rows={1} />
          ) : list.length === 0 ? (
            <ScheduleInvite />
          ) : (
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {list.map((a) => (
                <li key={a.id}>
                  <ScheduleTicket automation={a} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </Page>
  );
}

function Summary({
  needs,
  running,
  spend,
}: {
  needs: number;
  running: number;
  spend: number | null;
}) {
  const parts: { key: string; node: ReactNode }[] = [
    {
      key: "needs",
      node: needs ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-attention">
          <span className="size-1.5 rounded-full bg-attention" />
          {plural(needs, "thing")} {needs === 1 ? "needs" : "need"} you
        </span>
      ) : (
        "Nothing needs you"
      ),
    },
  ];
  if (running)
    parts.push({
      key: "running",
      node: (
        <span className="inline-flex items-center gap-1.5">
          <span className="anim-pulse size-1.5 rounded-full bg-accent" />
          {plural(running, "task")} running
        </span>
      ),
    });
  if (spend != null)
    parts.push({
      key: "spend",
      node: <span className="tabular">{formatCost(spend)} spent today</span>,
    });
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {parts.map((p, i) => (
        <span key={p.key} className="inline-flex items-center gap-2.5">
          {i > 0 ? <span className="text-fg-faint">·</span> : null}
          {p.node}
        </span>
      ))}
    </p>
  );
}

// ---------- First run ----------

const ink = { color: "var(--ink)" } as CSSProperties;
/** Fields stay paper-coloured in both themes, so shared bits inside render the light way. */
const lightScope = {
  "--surface": "#fffdf8",
  "--fg": "#15140f",
  "--mono-mix": "22%",
} as CSSProperties;

function FirstRunGuide({
  hasConnection,
  connections,
  hasTask,
  signedOff,
  waiting,
  onWrite,
  onHide,
}: {
  hasConnection: boolean;
  connections: Connection[];
  hasTask: boolean;
  signedOff: boolean;
  waiting: number;
  onWrite: () => void;
  onHide: () => void;
}) {
  const done = [hasConnection, hasTask, signedOff];
  const count = done.filter(Boolean).length;
  const next = done.indexOf(false);
  const firstConn = connections[0];

  return (
    <section className="mt-14" aria-labelledby="guide-h">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <p className="eyebrow">Getting started · {count} of 3 done</p>
          <h2
            id="guide-h"
            className="mt-2 font-serif text-[32px] leading-[1.02] tracking-[-0.015em] text-fg md:text-[38px]"
          >
            Three steps to your first <span className="italic">sign-off</span>.
          </h2>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onHide}>
          Hide guide
        </button>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        <GuideStep
          n={1}
          field="var(--lilac)"
          done={hasConnection}
          next={next === 0}
          title="Connect a tool"
          body="GitHub, Linear, Notion or any MCP server. The agent works inside them."
          art={
            <div className="flex items-center">
              {["GitHub", "Linear", "Notion"].map((n, i) => (
                <span
                  key={n}
                  className="-ml-1.5 rounded-full p-[3px] first:ml-0"
                  style={{ background: "var(--lilac)", zIndex: 3 - i }}
                >
                  <Monogram name={n} size={30} round />
                </span>
              ))}
            </div>
          }
          action={
            hasConnection ? (
              <DoneLine>
                {firstConn ? `${firstConn.name} connected` : "Connected"}
                {connections.length > 1 ? ` + ${connections.length - 1}` : ""}
              </DoneLine>
            ) : (
              <InkLink href="/connections?add=1">Add a connection</InkLink>
            )
          }
        />
        <GuideStep
          n={2}
          field="var(--sage)"
          done={hasTask}
          next={next === 1}
          title="Give it a task"
          body="Plain words, like you'd ask a colleague. It reads on its own and reports back."
          art={
            <div
              className="flex w-full max-w-[220px] items-center gap-2 rounded-full bg-[#fffdf8] py-1.5 pr-1.5 pl-3.5 text-12 shadow-[0_6px_16px_-8px_rgb(21_20_15/0.45)]"
              style={ink}
            >
              <span className="min-w-0 flex-1 truncate opacity-70">Triage my open PRs</span>
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#15140f] text-[#f4f1ea]">
                <ArrowUpRight className="size-3.5" />
              </span>
            </div>
          }
          action={
            hasTask ? (
              <DoneLine>First task started</DoneLine>
            ) : (
              <InkButton onClick={onWrite}>Write one above</InkButton>
            )
          }
        />
        <GuideStep
          n={3}
          field="var(--field-amber)"
          done={signedOff}
          next={next === 2}
          title="Sign off on what it does"
          body="Before it sends, changes or deletes anything, it asks. You approve, edit or deny."
          art={
            <span className="stamp text-[13px]" style={{ color: "var(--ink)" }}>
              Approved
            </span>
          }
          action={
            signedOff ? (
              <DoneLine>You've signed one off</DoneLine>
            ) : waiting > 0 ? (
              <InkLink href="/inbox">
                Review {waiting === 1 ? "the request" : `${waiting} requests`}
              </InkLink>
            ) : (
              <span className="text-12" style={{ ...ink, opacity: 0.7 }}>
                Requests show up here and in the Inbox.
              </span>
            )
          }
        />
      </ol>
    </section>
  );
}

function GuideStep({
  n,
  field,
  done,
  next,
  title,
  body,
  art,
  action,
}: {
  n: number;
  field: string;
  done: boolean;
  next: boolean;
  title: string;
  body: string;
  art: ReactNode;
  action: ReactNode;
}) {
  return (
    <li
      className={cx(
        "relative flex flex-col overflow-hidden rounded-[18px] p-5 transition-[opacity,box-shadow] duration-200",
        next && "shadow-[var(--slip-shadow)]",
      )}
      style={{ background: field, ...ink, ...lightScope }}
      aria-current={next ? "step" : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-serif text-[52px] leading-[0.8] italic">{n}</span>
        <span
          className="mt-1 font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase"
          style={{ opacity: 0.65 }}
        >
          {done ? "Done" : next ? "Up next" : `Step ${n}`}
        </span>
      </div>
      <div aria-hidden="true" className="my-5 flex h-10 items-center">
        {art}
      </div>
      <h3 className="font-serif text-[25px] leading-[1.05] tracking-[-0.01em]">
        {done ? <span className="sr-only">Done: </span> : null}
        {title}
      </h3>
      <p className="mt-1.5 flex-1 text-13" style={{ opacity: 0.72 }}>
        {body}
      </p>
      <div className="mt-5 flex min-h-9 items-center">{action}</div>
      {done ? (
        <span
          aria-hidden="true"
          className="stamp pointer-events-none absolute top-5 right-4 bg-[color-mix(in_srgb,var(--paper)_35%,transparent)] text-[12px]"
          style={{ color: "#18794e", rotate: "6deg" }}
        >
          Done
        </span>
      ) : null}
    </li>
  );
}

function DoneLine({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-13 font-medium">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#15140f] text-[#f4f1ea]">
        <Check className="size-3" strokeWidth={2.75} />
      </span>
      <span className="truncate">{children}</span>
    </span>
  );
}

const inkPill =
  "group inline-flex h-9 items-center gap-1.5 rounded-full bg-[#15140f] px-4 text-13 font-medium text-[#f4f1ea] transition-colors duration-150 hover:bg-[#2b36b8]";

function InkLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={inkPill}>
      {children}
      <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

function InkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={inkPill}>
      {children}
      <ArrowRight className="size-3.5 -rotate-90 transition-transform duration-200 group-hover:-translate-y-0.5" />
    </button>
  );
}

// ---------- Rows ----------

function TaskRow({ task: t }: { task: ChatSummary }) {
  const status = t.pendingApprovals > 0 ? "needs" : taskStatus(t.status);
  const snippet = stripMarkdown(t.snippet);
  const loud = status === "needs" || status === "running" || status === "failed";
  return (
    <Link
      href={`/t/${t.id}`}
      className="flex items-start gap-3.5 px-4 py-3.5 transition-colors duration-150 hover:bg-hover md:px-5"
    >
      <span className="pt-[8px]">
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
          {loud ? (
            <span
              className={cx(
                "font-medium",
                status === "needs" && "text-attention",
                status === "running" && "text-accent",
                status === "failed" && "text-danger",
              )}
            >
              {statusLabel(status)}
            </span>
          ) : (
            formatRelative(t.updatedAt)
          )}
        </span>
        <span className={cx("tabular text-12", t.costUsd ? "text-fg-muted" : "text-fg-faint")}>
          {formatCost(t.costUsd)}
        </span>
      </span>
    </Link>
  );
}

function splitSchedule(cron: string): [string, string | null] {
  const d = describeCron(cron);
  if (!d) return [cron, null];
  const [when, at] = d.split(" at ");
  return at ? [when!, at] : [d, null];
}

function ScheduleTicket({ automation: a }: { automation: Automation }) {
  const [when, at] = splitSchedule(a.schedule);
  return (
    <Link
      href={a.chatId ? `/t/${a.chatId}` : "/automations"}
      className={cx(
        "flex h-full items-stretch overflow-hidden rounded-[14px] border border-line bg-surface transition-colors duration-150 hover:border-line-strong",
        !a.enabled && "opacity-70",
      )}
    >
      <span className="flex w-[86px] shrink-0 flex-col justify-center border-r border-dashed border-line-strong bg-sunken/60 px-3 py-3 text-center">
        <span className="tabular font-serif text-[24px] leading-none text-fg">{at ?? "—"}</span>
        <span className="mt-1 truncate font-mono text-[10px] tracking-[0.1em] text-fg-faint uppercase">
          {at ? when : "Custom"}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center px-4 py-3">
        <span className="truncate text-14 font-medium text-fg">{a.name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-12 text-fg-muted">
          <Repeat className={cx("size-3", a.enabled ? "text-accent" : "text-fg-faint")} />
          <span className="truncate" title={formatDateTime(a.nextRunAt)}>
            {a.enabled
              ? at
                ? `Next ${formatRelative(a.nextRunAt)}`
                : `${when} · next ${formatRelative(a.nextRunAt)}`
              : "Paused"}
          </span>
        </span>
      </span>
    </Link>
  );
}

function ScheduleInvite() {
  return (
    <Link
      href="/automations?new=1"
      className="group flex items-center gap-4 rounded-[14px] border border-line bg-surface p-3 pr-4 transition-colors duration-150 hover:border-line-strong"
    >
      <span
        aria-hidden="true"
        className="flex w-[86px] shrink-0 flex-col items-center rounded-[10px] border border-dashed border-line-strong px-2 py-2.5 text-fg-faint"
      >
        <span className="tabular font-serif text-[22px] leading-none">8:00</span>
        <span className="mt-1 font-mono text-[9.5px] tracking-[0.1em] uppercase">Weekdays</span>
      </span>
      <span className="min-w-0 flex-1 text-13 text-fg-muted">
        <span className="block text-14 font-medium text-fg">Put something on a schedule</span>A
        morning brief every weekday, a Friday wrap-up. Set it once.
      </span>
      <ArrowRight className="size-4 shrink-0 text-fg-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg" />
    </Link>
  );
}

function TaskRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line rounded-[16px] border border-line bg-surface">
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
