"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApprovalCard,
  type ApprovalHandle,
  ApprovalReceipt,
  approvalTitle,
  MiniStamp,
} from "@/components/approval/approval-card";
import { ApprovalBatch, PLAN_TOOL } from "@/components/approval/checklist";
import { LearnPrompt, SuggestionStrip } from "@/components/approval/learned-rules";
import { UndoCountdown, type UndoTarget, useTimeLeft } from "@/components/approval/undo-window";
import { Markdown } from "@/components/markdown";
import { EffectPill, Kbd, Monogram, Pill, Skeleton, StatusDot } from "@/components/ui";
import { type Approval, api } from "@/lib/api";
import { cx, formatDateTime, formatRelative, splitToolName } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useMedia } from "@/lib/use-media";
import { useWorkspace } from "@/lib/workspace";

interface Decided {
  approved: boolean;
  reason?: string;
  edited: boolean;
  /** Set when an approved send or delete waits out its undo window. */
  executeAfter?: string | null;
  /** Taken back inside the undo window. */
  undone?: boolean;
}

function undoTarget(a: Approval, d: Decided): UndoTarget | null {
  return d.executeAfter
    ? { runId: a.runId, toolCallId: a.toolCallId, executeAfter: d.executeAfter }
    : null;
}

/** A signed row whose send is still inside its undo window. */
function rowUndo(a: Approval, d: Decided | undefined): UndoTarget | null {
  return d?.approved && !d.undone ? undoTarget(a, d) : null;
}

/** The row's age, or nothing while its undo countdown sits in that corner. */
function RowTime({ createdAt, undo }: { createdAt: string; undo: UndoTarget | null }) {
  const left = useTimeLeft(undo?.executeAfter);
  if (undo && left > 0) return null;
  return (
    <span className="ml-auto shrink-0" title={formatDateTime(createdAt)}>
      {formatRelative(createdAt)}
    </span>
  );
}

/** "Sending in 9s · Undo" on the row itself, so it stays reachable after the pane moves on. */
function RowUndo({
  target,
  effect,
  onUndone,
}: {
  target: UndoTarget;
  effect: Approval["effect"];
  onUndone: () => void;
}) {
  return (
    <UndoCountdown
      target={target}
      effect={effect}
      onUndone={onUndone}
      className="absolute right-3.5 bottom-3 text-12 text-fg-muted"
    />
  );
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

export default function InboxPage() {
  const { approvals, teamApprovals, waitingForAdmin, waitingForSecond, tasks, reload, user } =
    useWorkspace();
  // Team workspaces: other members' calls an admin must decide (admins only), your own
  // calls waiting on an admin, and two-person sign-offs you already gave the first approval
  // of (shown, not signable).
  const waitingIds = useMemo(
    () => new Set([...waitingForAdmin, ...waitingForSecond].map((a) => a.toolCallId)),
    [waitingForAdmin, waitingForSecond],
  );
  const [kept, setKept] = useState<Record<string, Approval>>({});
  const [decided, setDecided] = useState<Record<string, Decided>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const desktop = useMedia("(min-width: 768px)");
  const card = useRef<ApprovalHandle>(null);

  // Items stay in the list (as receipts) after you decide them, for this visit.
  const items = useMemo(() => {
    const map = new Map<string, Approval>();
    for (const a of Object.values(kept)) map.set(a.toolCallId, a);
    for (const a of [
      ...(approvals ?? []),
      ...teamApprovals,
      ...waitingForAdmin,
      ...waitingForSecond,
    ])
      map.set(a.toolCallId, a);
    return Array.from(map.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [approvals, teamApprovals, waitingForAdmin, waitingForSecond, kept]);

  // Members' calls (they carry a requester) form one "Needs an admin" group, first.
  const groups = useMemo(() => {
    const g = new Map<
      string,
      { chatId: string; title: string; items: Approval[]; team?: boolean }
    >();
    const team = items.filter((a) => a.requester);
    if (team.length)
      g.set("team", { chatId: "team", title: "Needs an admin", items: team, team: true });
    for (const a of items) {
      if (a.requester) continue;
      const cur = g.get(a.chatId) ?? { chatId: a.chatId, title: a.chatTitle, items: [] };
      cur.items.push(a);
      g.set(a.chatId, cur);
    }
    return Array.from(g.values());
  }, [items]);
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const pending = ordered.filter((a) => !decided[a.toolCallId] && !waitingIds.has(a.toolCallId));

  // Initial selection: ?id= or the first pending item.
  useEffect(() => {
    if (selected || ordered.length === 0) return;
    const want = new URLSearchParams(window.location.search).get("id");
    const first = ordered.find((a) => a.toolCallId === want) ?? pending[0] ?? ordered[0];
    if (first) setSelected(first.toolCallId);
    if (want && first?.toolCallId === want) setMobileDetail(true);
  }, [ordered, pending, selected]);

  const current = ordered.find((a) => a.toolCallId === selected) ?? null;
  // Open asks from the same run sign off together as one checklist (plans keep their card).
  const batch = useMemo(() => {
    if (
      !current ||
      decided[current.toolCallId] ||
      current.name === PLAN_TOOL ||
      current.signoffs?.needed === 2 ||
      waitingIds.has(current.toolCallId)
    )
      return [];
    // Two-person sign-offs keep their own card: they show who approved first.
    const same = pending.filter(
      (a) => a.runId === current.runId && a.name !== PLAN_TOOL && a.signoffs?.needed !== 2,
    );
    return same.length >= 2 ? same.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
  }, [current, decided, pending, waitingIds]);
  const tainted = (chatId: string) => tasks?.find((t) => t.id === chatId)?.tainted ?? false;

  const move = useCallback(
    (dir: 1 | -1) => {
      if (ordered.length === 0) return;
      const i = ordered.findIndex((a) => a.toolCallId === selected);
      const n = ordered[Math.min(ordered.length - 1, Math.max(0, i + dir))];
      if (n) setSelected(n.toolCallId);
    },
    [ordered, selected],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        isTyping(e) ||
        document.querySelector("[aria-modal=true]")
      )
        return;
      const pendingSel = current && !decided[current.toolCallId];
      if (e.key === "j") move(1);
      else if (e.key === "k") move(-1);
      else if (e.key === "a" && pendingSel) card.current?.approve();
      else if (e.key === "d" && pendingSel) card.current?.deny();
      else if (e.key === "e" && pendingSel) card.current?.edit();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [move, current, decided]);

  function markUndone(id: string) {
    setDecided((m) => (m[id] ? { ...m, [id]: { ...m[id], undone: true } } : m));
    void reload();
  }

  function onDecided(a: Approval, d: Decided) {
    setKept((k) => ({ ...k, [a.toolCallId]: a }));
    // Undo stays with the member who owns the task, not the admin who signed it.
    setDecided((m) => ({ ...m, [a.toolCallId]: a.requester ? { ...d, executeAfter: null } : d }));
    const next = pending.find((x) => x.toolCallId !== a.toolCallId);
    if (next && desktop) setSelected(next.toolCallId);
    void reload();
  }

  function onBatchDecided(list: Approval[], outcome: Record<string, boolean>) {
    setKept((k) => ({ ...k, ...Object.fromEntries(list.map((a) => [a.toolCallId, a])) }));
    setDecided((m) => ({
      ...m,
      ...Object.fromEntries(
        list.map((a) => [
          a.toolCallId,
          { approved: outcome[a.toolCallId] ?? false, edited: false },
        ]),
      ),
    }));
    const done = new Set(list.map((a) => a.toolCallId));
    const next = pending.find((x) => !done.has(x.toolCallId));
    if (next && desktop) setSelected(next.toolCallId);
    void reload();
  }

  const loading = approvals === null;
  const empty = !loading && ordered.length === 0;
  // Calls waiting for a team admin are in the list but are neither yours to sign nor signed.
  const withAdmin = ordered.filter((a) =>
    waitingForAdmin.some((w) => w.toolCallId === a.toolCallId),
  ).length;
  const withSecond = ordered.filter((a) =>
    waitingForSecond.some((w) => w.toolCallId === a.toolCallId),
  ).length;
  const signed = ordered.length - pending.length - withAdmin - withSecond;
  const adminNote =
    (withAdmin ? ` · ${withAdmin === 1 ? "one" : withAdmin} waiting for an admin` : "") +
    (withSecond ? ` · ${withSecond === 1 ? "one" : withSecond} waiting for a second approval` : "");

  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="Approvals"
        className={cx(
          "flex min-h-0 w-full flex-col border-line md:w-[340px] md:shrink-0 md:border-r lg:w-[380px]",
          mobileDetail && "hidden md:flex",
        )}
      >
        <header className="shrink-0 px-5 pt-8 pb-5 md:pt-10">
          <h1 className="flex items-baseline gap-3 font-serif text-[44px] leading-none tracking-[-0.02em] text-fg md:text-[52px]">
            Inbox
            {pending.length > 0 ? (
              <span className="text-attention italic tabular-nums">{pending.length}</span>
            ) : null}
          </h1>
          <p className="mt-2.5 text-13 text-fg-muted">
            {loading
              ? "Loading…"
              : pending.length
                ? `${pending.length === 1 ? "One thing" : `${pending.length} things`} waiting for your signature${signed ? ` · ${signed} signed` : ""}${adminNote}`
                : signed
                  ? `All signed · ${signed} this visit${adminNote}`
                  : withAdmin || withSecond
                    ? `Nothing for you to sign${adminNote}`
                    : "Nothing waiting on you"}
          </p>
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-6">
          <SuggestionStrip className="mx-2 mb-5" />
          {loading ? (
            <div className="space-y-2.5 px-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[84px] rounded-[8px]" />
              ))}
            </div>
          ) : empty ? (
            <div className="px-2 md:hidden">
              <InboxEmpty heading={false} />
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.chatId} className="mb-5">
                <div className="flex items-center gap-2 px-2 pb-2">
                  <StatusDot
                    status={
                      g.items.some((a) => !decided[a.toolCallId] && !waitingIds.has(a.toolCallId))
                        ? "needs"
                        : g.items.some((a) => waitingIds.has(a.toolCallId))
                          ? "idle"
                          : "done"
                    }
                  />
                  {g.team ? (
                    // Members' tasks stay theirs: admins see the call, not the task.
                    <span className="eyebrow min-w-0 truncate">{g.title}</span>
                  ) : (
                    <Link
                      href={`/t/${g.chatId}`}
                      className="min-w-0 truncate text-12 text-fg-muted hover:text-fg"
                    >
                      {g.title || "Untitled task"}
                    </Link>
                  )}
                </div>
                <ul className="space-y-2">
                  {g.items.map((a) => {
                    const d = decided[a.toolCallId];
                    const on = a.toolCallId === selected;
                    const { source } = splitToolName(a.name);
                    return (
                      <li key={a.toolCallId} className="relative">
                        <button
                          type="button"
                          aria-current={on ? "true" : undefined}
                          onClick={() => {
                            setSelected(a.toolCallId);
                            setMobileDetail(true);
                          }}
                          className={cx(
                            "relative flex w-full flex-col gap-2 rounded-[8px] px-3.5 py-3 text-left transition-[background-color,box-shadow,translate] duration-150",
                            on
                              ? "bg-surface shadow-[var(--slip-shadow)] md:translate-x-1"
                              : d
                                ? "hover:bg-hover"
                                : "bg-surface/60 shadow-[0_0_0_1px_var(--line)] hover:bg-surface",
                          )}
                        >
                          {on && !d ? (
                            <span
                              aria-hidden="true"
                              className="absolute top-3 bottom-3 left-0 w-[3px] rounded-r-full bg-attention"
                            />
                          ) : null}
                          <span
                            className={cx(
                              "line-clamp-2 font-serif text-[19px] leading-[1.2] text-fg",
                              d && "text-fg-muted",
                            )}
                          >
                            {approvalTitle(a.preview, a.name)}
                          </span>
                          <span className="flex min-w-0 items-center gap-2 text-12 text-fg-faint">
                            <Monogram name={source ?? "Synapse"} size={16} />
                            {d ? (
                              <MiniStamp tone={d.approved && !d.undone ? "ok" : "danger"}>
                                {d.undone ? "Undone" : d.approved ? "Approved" : "Denied"}
                              </MiniStamp>
                            ) : waitingIds.has(a.toolCallId) ? (
                              <Pill>
                                {a.signoffs?.first?.id === user?.id
                                  ? "1 of 2 · waiting"
                                  : "Waiting for an admin"}
                              </Pill>
                            ) : (
                              <>
                                <EffectPill effect={a.effect} />
                                {a.signoffs?.needed === 2 ? (
                                  <Pill tone="outline">
                                    {a.signoffs.first ? "1 of 2" : "2 approvals"}
                                  </Pill>
                                ) : null}
                                {a.escalatedAt ? <Pill tone="attention">Escalated</Pill> : null}
                              </>
                            )}
                            {a.requester ? (
                              <span className="min-w-0 truncate text-fg-muted">
                                {a.requester.name}
                              </span>
                            ) : null}
                            <RowTime createdAt={a.createdAt} undo={rowUndo(a, d)} />
                          </span>
                        </button>
                        {rowUndo(a, d) ? (
                          <RowUndo
                            target={rowUndo(a, d)!}
                            effect={a.effect}
                            onUndone={() => markUndone(a.toolCallId)}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
          {!loading ? (
            <Link
              href="/activity"
              className="mx-2 mt-2 flex items-center gap-1.5 text-12 text-fg-muted hover:text-fg"
            >
              Earlier decisions are kept in Activity
              <ArrowRight className="size-3" />
            </Link>
          ) : null}
        </div>
        {!empty && !loading ? (
          <footer className="hidden shrink-0 items-center gap-3 border-t border-line px-5 py-2.5 text-12 text-fg-faint md:flex">
            <span className="inline-flex items-center gap-1">
              <Kbd>j</Kbd>
              <Kbd>k</Kbd> move
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>a</Kbd> approve
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>d</Kbd> deny
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>e</Kbd> edit
            </span>
          </footer>
        ) : null}
      </section>

      <section
        aria-label="Selected approval"
        className={cx(
          "scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto",
          !mobileDetail && "hidden md:block",
        )}
      >
        {empty ? (
          <div className="mx-auto max-w-[560px] px-8 pt-16 md:pt-24">
            <InboxEmpty />
          </div>
        ) : current ? (
          <div className="mx-auto w-full max-w-[720px] px-4 pt-4 pb-12 md:px-8 md:pt-10">
            <button
              type="button"
              className="btn btn-ghost btn-sm -ml-2 mb-3 md:hidden"
              onClick={() => setMobileDetail(false)}
            >
              <ArrowLeft className="size-3.5" />
              Inbox
            </button>
            {decided[current.toolCallId] ? (
              <div className="space-y-3">
                <ApprovalReceipt
                  name={current.name}
                  preview={current.preview}
                  effect={current.effect}
                  approved={decided[current.toolCallId]!.approved}
                  reason={decided[current.toolCallId]!.reason}
                  edited={decided[current.toolCallId]!.edited}
                  undo={undoTarget(current, decided[current.toolCallId]!)}
                  undone={decided[current.toolCallId]!.undone}
                  onUndone={() => markUndone(current.toolCallId)}
                  phase="continuing"
                />
                {decided[current.toolCallId]!.approved &&
                !decided[current.toolCallId]!.edited &&
                !current.requester ? (
                  <LearnPrompt tool={current.name} />
                ) : null}
                {pending.length === 0 ? (
                  <div className="anim-fade-in pt-10 pb-4 text-center">
                    <p className="font-serif text-40 text-fg">
                      All <span className="italic">clear.</span>
                    </p>
                    <p className="mt-2 text-13 text-fg-muted">
                      Everything that needed your signature has it.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : batch.length > 0 ? (
              <ApprovalBatch
                key={batch.map((a) => a.toolCallId).join()}
                handle={card}
                runId={current.runId}
                items={batch}
                tainted={current.tainted ?? tainted(current.chatId)}
                onDecided={(outcome) => onBatchDecided(batch, outcome)}
                onConflict={() => void reload()}
              />
            ) : (
              <ApprovalCard
                key={current.toolCallId}
                handle={card}
                runId={current.runId}
                toolCallId={current.toolCallId}
                name={current.name}
                effect={current.effect}
                input={current.input}
                reason={current.reason}
                preview={current.preview}
                tainted={current.tainted ?? tainted(current.chatId)}
                waitingForAdmin={waitingForAdmin.some((w) => w.toolCallId === current.toolCallId)}
                requester={current.requester ?? null}
                meta={current}
                onPartial={() => void reload()}
                onDecided={(approved, info) => onDecided(current, { approved, ...info })}
                onConflict={() => void reload()}
              />
            )}
            {current.requester ? (
              <section className="mt-10" aria-label="Who asked">
                <h2 className="eyebrow mb-3">Asked by</h2>
                <div className="border-t border-line pt-4">
                  <p className="font-serif text-[22px] leading-tight text-fg">
                    {current.requester.name}
                  </p>
                  <p className="mt-1 text-13 text-fg-muted">
                    {current.requester.email} · in “{current.chatTitle || "Untitled task"}”
                  </p>
                  <p className="mt-3 text-13 text-fg-faint">
                    {current.approver === "admin"
                      ? "Your team requires an admin to approve this."
                      : current.escalatedAt
                        ? "Nobody decided this in time, so it was escalated to your team's admins."
                        : "Your team needs two people to approve actions like this."}{" "}
                    The task stays theirs; your decision lets it continue.
                  </p>
                </div>
              </section>
            ) : (
              <TaskContext chatId={current.chatId} title={current.chatTitle} />
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** Nothing waiting: a faded example of what will land here, so the page teaches itself. */
function InboxEmpty({ heading = true }: { heading?: boolean }) {
  return (
    <div className="pt-2 pb-8">
      {heading ? (
        <p className="mb-3 font-serif text-[48px] leading-none tracking-[-0.02em] text-fg">
          All <span className="italic">clear.</span>
        </p>
      ) : null}
      <p className="max-w-[420px] text-14 text-fg-muted">
        When the agent wants to send, change or delete something, it lands here for your signature.
      </p>
      <div aria-hidden="true" className="relative mt-12 select-none">
        <span className="eyebrow absolute -top-7 left-1">For example</span>
        <span className="stamp pointer-events-none absolute right-6 bottom-[22%] z-10 text-[22px] text-ok opacity-50">
          Approved
        </span>
        <div className="slip rotate-[-1.5deg] opacity-60 [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]">
          <div className="flex items-center gap-2 border-b border-dashed border-line-strong px-5 py-3 text-13">
            <span className="size-2 rounded-full bg-attention" />
            <span className="font-medium text-attention">Needs your sign-off</span>
            <span className="ml-auto flex items-center gap-1.5 text-fg-muted">
              <Monogram name="gmail" size={16} />
              gmail
            </span>
            <EffectPill effect="send" />
          </div>
          <div className="space-y-1.5 px-5 pt-4 text-13">
            <div className="flex gap-3">
              <span className="w-14 text-fg-faint">To</span>
              <span className="font-medium text-fg">priya@northwind.co</span>
            </div>
            <div className="flex gap-3">
              <span className="w-14 text-fg-faint">Subject</span>
              <span className="text-fg">Contract, signed copy</span>
            </div>
          </div>
          <p className="px-5 pt-4 font-serif text-[21px] leading-[1.3] text-fg">
            Hi Priya, the countersigned contract is attached. Looking forward to kicking off on
            Monday.
          </p>
          <div className="flex items-center gap-2 px-5 pt-5 pb-5">
            <span className="inline-flex h-9 items-center rounded-full bg-fg px-4 text-13 font-medium text-canvas">
              Approve
            </span>
            <span className="inline-flex h-9 items-center rounded-full border border-line-strong px-4 text-13 text-fg">
              Edit
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskContext({ chatId, title }: { chatId: string; title: string }) {
  const chat = useApi(() => api.chat(chatId), chatId);
  const last = useMemo(() => {
    const msgs = chat.data?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]!;
      if (m.role !== "assistant") continue;
      const text = m.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("\n")
        .trim();
      if (text) return text;
    }
    return null;
  }, [chat.data]);
  const ask = chat.data?.messages.find((m) => m.role === "user");
  const askText = ask?.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

  return (
    <section className="mt-10" aria-label="Task context">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="eyebrow">From the task</h2>
        <Link
          href={`/t/${chatId}`}
          className="inline-flex items-center gap-1 text-13 font-medium text-accent hover:underline"
        >
          Open task <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="border-t border-line pt-4">
        <p className="font-serif text-[22px] leading-tight text-fg">{title || "Untitled task"}</p>
        {chat.loading && !chat.data ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        ) : (
          <>
            {askText && askText !== title ? (
              <p className="mt-2 text-13 text-fg-muted">You asked: “{askText}”</p>
            ) : null}
            {last ? (
              <div className="mt-3 border-l-2 border-line-strong pl-3.5 text-fg-muted">
                <Markdown text={last} />
              </div>
            ) : (
              <p className="mt-2 text-13 text-fg-faint">The agent hasn't said anything yet.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
