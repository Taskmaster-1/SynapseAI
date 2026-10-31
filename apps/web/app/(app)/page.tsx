"use client";

import { type Attachment, withAttachments } from "@synapse/core/ui";
import { ArrowRight, Check, LoaderCircle, Repeat } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ApprovalCompact } from "@/components/approval/approval-compact";
import { Composer, type ComposerHandle } from "@/components/task/composer";
import { useAttachments } from "@/components/task/files";
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
  type Onboarding,
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
    // Directory apps bring their own starter asks; one each, so several apps all get a turn.
    if (c.examples[0]) {
      out.push(c.examples[0]);
      continue;
    }
    const key = Object.keys(SUGGESTIONS).find((k) => c.name.toLowerCase().includes(k));
    if (key) out.push(...SUGGESTIONS[key]!);
  }
  return [...new Set([...out, ...GENERAL])].slice(0, 4);
}

const GUIDE_HIDDEN_KEY = "synapse-guide-hidden";

export default function HomePage() {
  const router = useRouter();
  const toast = useToast();
  const { tasks, approvals, user, todaySpend, reload } = useWorkspace();
  const conns = useApi(() => api.connections());
  const autos = useApi(() => api.automations());
  const onboarding = useApi(() => api.onboarding());
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [guideHidden, setGuideHidden] = useState(true);
  const composer = useRef<ComposerHandle>(null);
  const attach = useAttachments();

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

  async function start(content: string, files: Attachment[] = []) {
    const text = withAttachments(content.trim(), files);
    if (!text || sending || attach.uploading) return;
    setSending(true);
    try {
      const { chat } = await api.createChat(text);
      attach.clear();
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
  const hasTask = (tasks?.length ?? 0) > 0;
  const steps = guideSteps(onboarding.data, (conns.data?.connections.length ?? 0) > 0);
  const showGuide =
    !guideHidden &&
    steps !== null &&
    conns.data !== undefined &&
    tasks !== null &&
    tasks.length < 5 &&
    !steps.every((s) => s.done);

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
          onSend={() => void start(draft, attach.ready)}
          attach={attach}
          sending={sending}
          placeholder="What should I take care of?"
          autoFocus
          footer="Attach photos, videos or any file. Anything that sends, changes or deletes waits for your OK."
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

      {showGuide && steps ? (
        <FirstRunGuide
          steps={steps}
          waiting={needs}
          onChanged={() => void onboarding.reload()}
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

type GuideStepId = "google" | "tool" | "style" | "automation" | "approve";

/**
 * The getting-started steps, from real state. Without Google on this server, the first
 * step is any connection and there's no writing style to learn.
 */
function guideSteps(
  o: Onboarding | undefined,
  hasConnection: boolean,
): { id: GuideStepId; done: boolean }[] | null {
  if (!o) return null;
  const rest = [
    { id: "automation" as const, done: o.steps.automation },
    { id: "approve" as const, done: o.steps.approved },
  ];
  if (!o.googleAvailable) return [{ id: "tool", done: hasConnection }, ...rest];
  return [
    { id: "google", done: o.steps.google },
    { id: "style", done: o.steps.writingStyle },
    ...rest,
  ];
}

const FIELDS = ["var(--lilac)", "var(--sage)", "var(--blush)", "var(--field-amber)"];

function FirstRunGuide({
  steps,
  waiting,
  onChanged,
  onWrite,
  onHide,
}: {
  steps: { id: GuideStepId; done: boolean }[];
  waiting: number;
  onChanged: () => void;
  onWrite: () => void;
  onHide: () => void;
}) {
  const toast = useToast();
  const [learning, setLearning] = useState(false);
  const count = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);
  const googleDone = steps.find((s) => s.id === "google")?.done ?? false;
  const words = ["", "One", "Two", "Three", "Four"];

  async function learn() {
    setLearning(true);
    try {
      const { samples } = await api.learnWritingStyle();
      toast(`Learned your style from ${samples} sent emails`, "success");
      onChanged();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setLearning(false);
    }
  }

  const content = (id: GuideStepId, done: boolean) => {
    switch (id) {
      case "google":
        return {
          title: "Connect Google",
          body: "Gmail and Calendar. It reads on its own; sending and changing things waits for you.",
          art: (
            <div className="flex items-center">
              {["Gmail", "Calendar"].map((n, i) => (
                <span
                  key={n}
                  className="-ml-1.5 rounded-full p-[3px] first:ml-0"
                  style={{ background: FIELDS[0], zIndex: 2 - i }}
                >
                  <Monogram name={n} size={30} round />
                </span>
              ))}
            </div>
          ),
          action: done ? (
            <DoneLine>Google connected</DoneLine>
          ) : (
            <InkLink href="/connections">Connect Google</InkLink>
          ),
        };
      case "tool":
        return {
          title: "Connect a tool",
          body: "Notion, Jira, Stripe and dozens more in one click, or any MCP server. The agent works inside them.",
          art: (
            <div className="flex items-center">
              {["GitHub", "Linear", "Notion"].map((n, i) => (
                <span
                  key={n}
                  className="-ml-1.5 rounded-full p-[3px] first:ml-0"
                  style={{ background: FIELDS[0], zIndex: 3 - i }}
                >
                  <Monogram name={n} size={30} round />
                </span>
              ))}
            </div>
          ),
          action: done ? (
            <DoneLine>Connected</DoneLine>
          ) : (
            <InkLink href="/connections?add=1">Browse the app directory</InkLink>
          ),
        };
      case "style":
        return {
          title: "Learn your writing style",
          body: "It reads your recent sent mail once and keeps a short description, so drafts sound like you.",
          art: (
            <span
              className="rounded-[10px] bg-[#fffdf8] px-3 py-1.5 font-serif text-[18px] italic shadow-[0_6px_16px_-8px_rgb(21_20_15/0.45)]"
              style={ink}
            >
              Cheers, A.
            </span>
          ),
          action: done ? (
            <DoneLine>Style learned · edit it in Memory</DoneLine>
          ) : googleDone ? (
            <InkButton onClick={() => void learn()} busy={learning}>
              {learning ? "Reading sent mail…" : "Learn it now"}
            </InkButton>
          ) : (
            <span className="text-12" style={{ ...ink, opacity: 0.7 }}>
              Connect Google first.
            </span>
          ),
        };
      case "automation":
        return {
          title: "Turn on an automation",
          body: "Pick a ready-made one, like a morning brief or reply drafts, and edit it to taste.",
          art: (
            <div
              className="flex items-center gap-2 rounded-[10px] bg-[#fffdf8] py-1.5 pr-3 pl-2.5 shadow-[0_6px_16px_-8px_rgb(21_20_15/0.45)]"
              style={ink}
            >
              <Repeat className="size-3.5 opacity-60" />
              <span className="font-serif text-[18px] leading-none">8:00</span>
              <span className="font-mono text-[9px] tracking-[0.1em] uppercase opacity-60">
                Weekdays
              </span>
            </div>
          ),
          action: done ? (
            <DoneLine>An automation is on</DoneLine>
          ) : (
            <InkLink href="/automations">Pick a template</InkLink>
          ),
        };
      case "approve":
        return {
          title: "Approve your first action",
          body: "Before it sends, changes or deletes anything, it asks. You approve, edit or deny.",
          art: (
            <span className="stamp text-[13px]" style={{ color: "var(--ink)" }}>
              Approved
            </span>
          ),
          action: done ? (
            <DoneLine>You've signed one off</DoneLine>
          ) : waiting > 0 ? (
            <InkLink href="/inbox">
              Review {waiting === 1 ? "the request" : `${waiting} requests`}
            </InkLink>
          ) : (
            <InkButton onClick={onWrite} up>
              Give it a task
            </InkButton>
          ),
        };
    }
  };

  return (
    <section className="mt-14" aria-labelledby="guide-h">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <p className="eyebrow">
            Getting started · {count} of {steps.length} done
          </p>
          <h2
            id="guide-h"
            className="mt-2 font-serif text-[32px] leading-[1.02] tracking-[-0.015em] text-fg md:text-[38px]"
          >
            {words[steps.length]} steps to your first <span className="italic">sign-off</span>.
          </h2>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onHide}>
          Hide guide
        </button>
      </div>
      <ol className={cx("grid gap-3", steps.length === 4 ? "sm:grid-cols-2" : "md:grid-cols-3")}>
        {steps.map((step, i) => {
          const c = content(step.id, step.done);
          return (
            <GuideStep
              key={step.id}
              n={i + 1}
              field={FIELDS[step.id === "approve" ? 3 : i]!}
              done={step.done}
              next={next === i}
              title={c.title}
              body={c.body}
              art={c.art}
              action={c.action}
            />
          );
        })}
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
          {/* Done steps carry a stamp in this corner instead. */}
          {done ? null : next ? "Up next" : `Step ${n}`}
        </span>
      </div>
      <div aria-hidden="true" className="my-5 flex h-10 items-center">
        {art}
      </div>
      <h3 className="font-serif text-[23px] leading-[1.05] tracking-[-0.01em]">
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

/** `up`: the action happens above (the composer); otherwise it happens right here. */
function InkButton({
  onClick,
  children,
  up = false,
  busy = false,
}: {
  onClick: () => void;
  children: ReactNode;
  up?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cx(inkPill, "disabled:opacity-80")}
    >
      {children}
      {busy ? (
        <LoaderCircle className="anim-spin size-3.5" />
      ) : (
        <ArrowRight
          className={cx(
            "size-3.5 transition-transform duration-200",
            up ? "-rotate-90 group-hover:-translate-y-0.5" : "group-hover:translate-x-0.5",
          )}
        />
      )}
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
