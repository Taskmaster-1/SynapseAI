"use client";

import { ArrowLeft, ArrowRight, Inbox as InboxIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApprovalCard,
  type ApprovalHandle,
  ApprovalReceipt,
  approvalTitle,
} from "@/components/approval/approval-card";
import { Markdown } from "@/components/markdown";
import { EffectPill, EmptyState, Kbd, Skeleton, StatusDot } from "@/components/ui";
import { type Approval, api } from "@/lib/api";
import { cx, formatDateTime, formatRelative } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useMedia } from "@/lib/use-media";
import { useWorkspace } from "@/lib/workspace";

interface Decided {
  approved: boolean;
  reason?: string;
  edited: boolean;
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

export default function InboxPage() {
  const { approvals, tasks, reload } = useWorkspace();
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
    for (const a of approvals ?? []) map.set(a.toolCallId, a);
    return Array.from(map.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [approvals, kept]);

  const groups = useMemo(() => {
    const g = new Map<string, { chatId: string; title: string; items: Approval[] }>();
    for (const a of items) {
      const cur = g.get(a.chatId) ?? { chatId: a.chatId, title: a.chatTitle, items: [] };
      cur.items.push(a);
      g.set(a.chatId, cur);
    }
    return Array.from(g.values());
  }, [items]);
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const pending = ordered.filter((a) => !decided[a.toolCallId]);

  // Initial selection: ?id= or the first pending item.
  useEffect(() => {
    if (selected || ordered.length === 0) return;
    const want = new URLSearchParams(window.location.search).get("id");
    const first = ordered.find((a) => a.toolCallId === want) ?? pending[0] ?? ordered[0];
    if (first) setSelected(first.toolCallId);
    if (want && first?.toolCallId === want) setMobileDetail(true);
  }, [ordered, pending, selected]);

  const current = ordered.find((a) => a.toolCallId === selected) ?? null;
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

  function onDecided(a: Approval, d: Decided) {
    setKept((k) => ({ ...k, [a.toolCallId]: a }));
    setDecided((m) => ({ ...m, [a.toolCallId]: d }));
    const next = pending.find((x) => x.toolCallId !== a.toolCallId);
    if (next && desktop) setSelected(next.toolCallId);
    void reload();
  }

  const loading = approvals === null;
  const empty = !loading && ordered.length === 0;

  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="Approvals"
        className={cx(
          "flex min-h-0 w-full flex-col border-line md:w-[340px] md:shrink-0 md:border-r lg:w-[380px]",
          mobileDetail && "hidden md:flex",
        )}
      >
        <header className="shrink-0 px-5 pt-8 pb-4 md:pt-10">
          <h1 className="font-serif text-[34px] leading-none text-fg md:text-40">Inbox</h1>
          <p className="mt-2 text-13 text-fg-muted">
            {loading
              ? "Loading…"
              : pending.length
                ? `${pending.length} waiting on you`
                : "Nothing waiting"}
          </p>
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-6">
          {loading ? (
            <div className="space-y-2 px-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 rounded-[10px]" />
              ))}
            </div>
          ) : empty ? null : (
            groups.map((g) => (
              <div key={g.chatId} className="mb-4">
                <div className="flex items-center gap-2 px-2 pb-1.5">
                  <StatusDot
                    status={g.items.some((a) => !decided[a.toolCallId]) ? "needs" : "done"}
                  />
                  <Link
                    href={`/t/${g.chatId}`}
                    className="min-w-0 truncate text-12 font-medium text-fg-muted hover:text-fg"
                  >
                    {g.title || "Untitled task"}
                  </Link>
                </div>
                <ul className="space-y-1">
                  {g.items.map((a) => {
                    const d = decided[a.toolCallId];
                    const on = a.toolCallId === selected;
                    return (
                      <li key={a.toolCallId}>
                        <button
                          type="button"
                          aria-current={on ? "true" : undefined}
                          onClick={() => {
                            setSelected(a.toolCallId);
                            setMobileDetail(true);
                          }}
                          className={cx(
                            "flex w-full flex-col gap-1.5 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-150",
                            on
                              ? "bg-surface shadow-[0_0_0_1px_var(--line-strong)]"
                              : "hover:bg-hover",
                            d && "opacity-60",
                          )}
                        >
                          <span
                            className={cx(
                              "line-clamp-2 text-13 font-medium text-fg",
                              d && "line-through decoration-fg-faint",
                            )}
                          >
                            {approvalTitle(a.preview, a.name)}
                          </span>
                          <span className="flex items-center gap-2 text-12 text-fg-faint">
                            <EffectPill effect={a.effect} />
                            {d ? (
                              <span className={d.approved ? "text-ok" : "text-danger"}>
                                {d.approved ? "Approved" : "Denied"}
                              </span>
                            ) : null}
                            <span className="ml-auto" title={formatDateTime(a.createdAt)}>
                              {formatRelative(a.createdAt)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
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
          <div className="mx-auto max-w-[520px] px-4 pt-16 md:pt-28">
            <EmptyState icon={<InboxIcon className="size-5" />} title="All clear.">
              When the agent wants to send, change or delete something, it waits here for your yes
              or no.
            </EmptyState>
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
                  phase="continuing"
                />
                {pending.length === 0 ? (
                  <p className="pt-6 text-center font-serif text-28 text-fg">All clear.</p>
                ) : null}
              </div>
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
                tainted={tainted(current.chatId)}
                onDecided={(approved, info) => onDecided(current, { approved, ...info })}
                onConflict={() => void reload()}
              />
            )}
            <TaskContext chatId={current.chatId} title={current.chatTitle} />
          </div>
        ) : null}
      </section>
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
    <section className="mt-8" aria-label="Task context">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-13 font-medium text-fg-muted">From the task</h2>
        <Link
          href={`/t/${chatId}`}
          className="inline-flex items-center gap-1 text-13 font-medium text-accent hover:underline"
        >
          Open task <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <div className="rounded-card border border-line bg-surface px-4 py-4">
        <p className="text-14 font-medium text-fg">{title || "Untitled task"}</p>
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
              <div className="mt-3 border-l-2 border-line pl-3 text-fg-muted">
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
