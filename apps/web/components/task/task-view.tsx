"use client";

import type { SeqEvent } from "@synapse/core";
import { applyEvent, isActive, type UiMessage } from "@synapse/core/ui";
import { Ellipsis, PanelRight, PanelRightClose, Pencil, Square, Trash } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApprovalCard, ApprovalReceipt } from "@/components/approval/approval-card";
import { ApprovalBatch, PLAN_TOOL } from "@/components/approval/checklist";
import { LearnPrompt } from "@/components/approval/learned-rules";
import { Menu } from "@/components/overlay";
import { useToast } from "@/components/toast";
import { EmptyState, Skeleton, StatusPill, TaintShield, taskStatus } from "@/components/ui";
import { ApiError, api, errorMessage, type TaskRun } from "@/lib/api";
import { cx, formatCost } from "@/lib/format";
import { denialReason, isUndone, receiptPhase, type ToolPart } from "@/lib/steps";
import { useMedia } from "@/lib/use-media";
import { useRunStream } from "@/lib/use-run-stream";
import { useWorkspace } from "@/lib/workspace";
import { Composer, type ComposerHandle } from "./composer";
import { Conversation, RunReceipt } from "./conversation";
import { type PanelTab, RunPanel } from "./run-panel";

interface State {
  messages: UiMessage[];
  run: TaskRun | null;
}
interface Decided {
  approved: boolean;
  reason?: string;
  edited: boolean;
  /** Set when an approved send or delete waits out its undo window. */
  executeAfter?: string | null;
}

const PANEL_KEY = "synapse-run-panel";

export function TaskView({ taskId }: { taskId: string }) {
  const router = useRouter();
  const toast = useToast();
  const { reload: reloadWorkspace, tasks } = useWorkspace();
  const [title, setTitle] = useState("");
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [streamRunId, setStreamRunId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, Decided>>({});
  const [initialAwaiting, setInitialAwaiting] = useState<Set<string> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const composer = useRef<ComposerHandle>(null);

  // ---------- Run panel ----------
  const wide = useMedia("(min-width: 1200px)");
  const [docked, setDocked] = useState(true);
  const [overlay, setOverlay] = useState(false);
  const [tab, setTab] = useState<PanelTab>("activity");
  const [focusStep, setFocusStep] = useState<string | null>(null);
  useEffect(() => {
    try {
      setDocked(localStorage.getItem(PANEL_KEY) !== "closed");
    } catch {}
  }, []);
  const panelOpen = wide ? docked : overlay;
  const togglePanel = useCallback(
    (open?: boolean) => {
      if (wide) {
        setDocked((d) => {
          const next = open ?? !d;
          try {
            localStorage.setItem(PANEL_KEY, next ? "open" : "closed");
          } catch {}
          return next;
        });
      } else setOverlay((o) => open ?? !o);
    },
    [wide],
  );
  const openStep = useCallback(
    (id: string) => {
      setTab("activity");
      setFocusStep(id);
      togglePanel(true);
    },
    [togglePanel],
  );

  // ---------- Data ----------
  const snapshotRef = useRef<() => Promise<void>>(async () => {});
  const snapshot = useCallback(() => snapshotRef.current(), []);

  const onEvents = useCallback(
    (events: SeqEvent[]) => {
      setState((s) => (s ? (events.reduce(applyEvent, s) as State) : s));
      let refresh = false;
      for (const e of events) {
        if (e.type === "message.start") setQueuedId(null);
        if (e.type === "run.status" && !isActive(e.status)) {
          setQueuedId(null);
          refresh = true;
        }
      }
      if (refresh) {
        void reloadWorkspace();
        void snapshot();
      }
    },
    [reloadWorkspace, snapshot],
  );

  const lastSeq = state?.run && state.run.id === streamRunId ? state.run.lastSeq : 0;
  const { state: streamState, reopen } = useRunStream(streamRunId, lastSeq, onEvents);

  const follow = useCallback(
    (runId: string, fromSeq?: number) => {
      if (runId === streamRunId) reopen(fromSeq);
      else setStreamRunId(runId);
    },
    [streamRunId, reopen],
  );

  snapshotRef.current = async () => {
    try {
      const data = await api.chat(taskId);
      setTitle(data.chat.title);
      setState({ messages: data.messages, run: data.run });
      setDecided({});
      if (data.run && isActive(data.run.status)) follow(data.run.id, data.run.lastSeq);
    } catch (err) {
      if (!state) setLoadError(err);
    }
  };

  useEffect(() => {
    setState(null);
    setLoadError(null);
    setStreamRunId(null);
    setQueuedId(null);
    setInitialAwaiting(null);
    const ctrl = new AbortController();
    api
      .chat(taskId, ctrl.signal)
      .then((data) => {
        setTitle(data.chat.title);
        setState({ messages: data.messages, run: data.run });
        const awaiting = new Set<string>();
        for (const m of data.messages)
          for (const p of m.parts)
            if (p.type === "tool" && p.status === "awaiting_approval") awaiting.add(p.toolCallId);
        setInitialAwaiting(awaiting);
        if (data.run && isActive(data.run.status)) setStreamRunId(data.run.id);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setLoadError(err);
      });
    return () => ctrl.abort();
  }, [taskId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  });

  const run = state?.run ?? null;
  const active = isActive(run?.status);
  const summary = tasks?.find((t) => t.id === taskId);
  const tainted = Boolean(run?.tainted ?? summary?.tainted);
  const taintedRuns = useMemo(
    () => new Set(run?.tainted && run.id ? [run.id] : []),
    [run?.tainted, run?.id],
  );
  const hasAwaiting = state?.messages.some((m) =>
    m.parts.some(
      (p) => p.type === "tool" && p.status === "awaiting_approval" && !decided[p.toolCallId],
    ),
  );
  const status = hasAwaiting ? "needs" : taskStatus(run?.status);

  async function send() {
    const content = draft.trim();
    if (!content || !state) return;
    const localId = `local-${Date.now()}`;
    const local: UiMessage = {
      id: localId,
      role: "user",
      parts: [{ type: "text", text: content }],
      runId: null,
    };
    setSending(true);
    setDraft("");
    stickToBottom.current = true;
    setState((s) => (s ? { ...s, messages: [...s.messages, local] } : s));
    try {
      const res = await api.sendMessage(taskId, content);
      setQueuedId(res.queued === "pending_input" ? localId : null);
      follow(res.runId);
      void reloadWorkspace();
    } catch (err) {
      setState((s) => (s ? { ...s, messages: s.messages.filter((m) => m.id !== localId) } : s));
      setDraft(content);
      toast(errorMessage(err), "error");
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!run) return;
    try {
      await api.cancel(run.id, "now");
      follow(run.id);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function remove() {
    if (!window.confirm("Delete this task and its history? This can't be undone.")) return;
    try {
      await api.deleteChat(taskId);
      await reloadWorkspace();
      router.push("/");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  function renderAsked(part: ToolPart, message: UiMessage) {
    const runId = message.runId ?? run?.id;
    const d = decided[part.toolCallId];
    const executeAfter = d?.executeAfter ?? part.executeAfter;
    const undo =
      runId && executeAfter && (part.status === "approved" || part.status === "awaiting_approval")
        ? { runId, toolCallId: part.toolCallId, executeAfter }
        : null;
    if (d) {
      return (
        <>
          <ApprovalReceipt
            name={part.name}
            preview={part.preview}
            effect={part.effect}
            approved={d.approved}
            reason={d.reason}
            edited={d.edited}
            undo={undo}
            undone={isUndone(part.output)}
            phase={part.status === "awaiting_approval" ? "running" : receiptPhase(part)}
          />
          {d.approved && !d.edited ? <LearnPrompt tool={part.name} className="mt-2" /> : null}
        </>
      );
    }
    // Two or more open asks from one step sign off together, as one checklist shown in
    // place of the first. Plans keep their own card (they are a checklist already).
    const group = runId
      ? message.parts.filter(
          (p): p is ToolPart =>
            p.type === "tool" &&
            p.status === "awaiting_approval" &&
            p.name !== PLAN_TOOL &&
            !decided[p.toolCallId],
        )
      : [];
    if (runId && group.length >= 2 && group.some((p) => p.toolCallId === part.toolCallId)) {
      if (group[0]!.toolCallId !== part.toolCallId) return null;
      return (
        <ApprovalBatch
          key={group.map((p) => p.toolCallId).join()}
          runId={runId}
          items={group}
          tainted={tainted}
          glow={initialAwaiting !== null && group.some((p) => !initialAwaiting.has(p.toolCallId))}
          onDecided={(outcome) => {
            setDecided((m) => ({
              ...m,
              ...Object.fromEntries(
                Object.entries(outcome).map(([id, approved]) => [id, { approved, edited: false }]),
              ),
            }));
            follow(runId);
            void reloadWorkspace();
          }}
          onConflict={() => {
            void snapshot();
            void reloadWorkspace();
          }}
        />
      );
    }
    if (part.status !== "awaiting_approval" || !runId) {
      return (
        <ApprovalReceipt
          name={part.name}
          preview={part.preview}
          effect={part.effect}
          approved={part.status !== "denied"}
          reason={denialReason(part.output)}
          undo={undo}
          undone={isUndone(part.output)}
          phase={receiptPhase(part)}
        />
      );
    }
    return (
      <ApprovalCard
        runId={runId}
        toolCallId={part.toolCallId}
        name={part.name}
        effect={part.effect}
        input={part.input}
        reason={part.reason}
        preview={part.preview}
        tainted={tainted}
        glow={initialAwaiting !== null && !initialAwaiting.has(part.toolCallId)}
        onDecided={(approved, info) => {
          setDecided((m) => ({ ...m, [part.toolCallId]: { approved, ...info } }));
          follow(runId);
          void reloadWorkspace();
        }}
        onConflict={() => {
          void snapshot();
          void reloadWorkspace();
        }}
      />
    );
  }

  if (loadError) {
    const notFound = loadError instanceof ApiError && loadError.status === 404;
    return (
      <div className="mx-auto max-w-[560px] px-4 pt-20">
        <EmptyState
          title={notFound ? "This task doesn't exist." : "Couldn't load this task."}
          action={
            <Link href="/" className="btn">
              Back home
            </Link>
          }
        >
          {notFound ? "It may have been deleted." : errorMessage(loadError)}
        </EmptyState>
      </div>
    );
  }

  const panel = (closable: boolean) =>
    state ? (
      <RunPanel
        onClose={closable ? () => togglePanel(false) : undefined}
        messages={state.messages}
        run={run}
        taintedRuns={taintedRuns}
        tab={tab}
        onTab={setTab}
        focusStep={focusStep}
      />
    ) : null;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <TaskHeader
          title={title}
          loading={!state}
          status={status}
          tainted={tainted}
          active={active}
          cost={run?.costUsd}
          panelOpen={panelOpen}
          onTogglePanel={() => togglePanel()}
          onStop={() => void stop()}
          onDelete={() => void remove()}
          onRename={async (t) => {
            const prev = title;
            setTitle(t);
            try {
              await api.renameChat(taskId, t);
              void reloadWorkspace();
            } catch (err) {
              setTitle(prev);
              toast(errorMessage(err), "error");
            }
          }}
        />
        <div
          ref={scroller}
          className="scroll-thin min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="mx-auto w-full max-w-[800px] px-4 pt-8 pb-12 md:px-8 md:pt-12">
            {state ? (
              <Conversation
                messages={state.messages}
                active={active}
                queuedId={queuedId}
                renderAsked={renderAsked}
                onOpenStep={openStep}
              />
            ) : (
              <ConversationSkeleton />
            )}
            {state && run?.status === "completed" && !hasAwaiting ? (
              <div className="mt-10">
                <RunReceipt run={run} messages={state.messages} tainted={tainted} />
              </div>
            ) : null}
            {run?.status === "failed" && run.error ? (
              <div className="mt-8 md:grid md:grid-cols-[76px_minmax(0,1fr)] md:gap-x-6">
                <div className="eyebrow pt-3 text-danger md:text-right">Failed</div>
                <p className="mt-2 max-w-[68ch] rounded-[8px] border-l-2 border-danger bg-danger-soft px-4 py-3 text-13 text-danger md:mt-0">
                  The task failed: {run.error}{" "}
                  <Link
                    href="/settings?section=models"
                    className="font-medium underline underline-offset-2"
                  >
                    Models &amp; keys
                  </Link>
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <div className="relative shrink-0 bg-canvas">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-linear-to-t from-canvas to-transparent"
          />
          <div className="mx-auto w-full max-w-[800px] px-3 pb-3 md:px-8 md:pb-5">
            <Composer
              handle={composer}
              value={draft}
              onChange={setDraft}
              onSend={() => void send()}
              sending={sending}
              queue={active}
              placeholder={
                active ? "Add something for the agent…" : "Reply or ask for something else…"
              }
              autoFocus
              footer={
                streamState === "reconnecting" ? (
                  <span className="text-attention">Reconnecting…</span>
                ) : null
              }
            />
          </div>
        </div>
      </div>

      {wide ? (
        panelOpen ? (
          <aside
            aria-label="Run panel"
            className="w-[360px] shrink-0 border-l border-line bg-sunken/40"
          >
            {panel(false)}
          </aside>
        ) : null
      ) : panelOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-end md:items-stretch">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close panel"
            className="anim-fade-in absolute inset-0 bg-scrim"
            onClick={() => togglePanel(false)}
          />
          <aside
            aria-label="Run panel"
            className="anim-sheet-bottom md:anim-sheet-right relative flex h-[78dvh] w-full flex-col rounded-t-[16px] bg-surface shadow-pop md:h-full md:w-[360px] md:rounded-none md:border-l md:border-line"
          >
            <div className="min-h-0 flex-1">{panel(true)}</div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div className="space-y-9 md:pl-[100px]" aria-busy="true">
      <div className="space-y-2.5">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-7 w-4/5" />
      </div>
      <div className="space-y-2.5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    </div>
  );
}

function TaskHeader({
  title,
  loading,
  status,
  tainted,
  active,
  cost,
  panelOpen,
  onTogglePanel,
  onStop,
  onDelete,
  onRename,
}: {
  title: string;
  loading: boolean;
  status: ReturnType<typeof taskStatus>;
  tainted: boolean;
  active: boolean;
  cost: number | undefined;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onStop: () => void;
  onDelete: () => void;
  onRename: (t: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(title), [title]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function commit() {
    setEditing(false);
    const t = value.trim();
    if (t && t !== title) onRename(t);
    else setValue(title);
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas px-3 md:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {loading ? (
          <Skeleton className="h-5 w-56" />
        ) : editing ? (
          <input
            ref={input}
            aria-label="Task title"
            className="input h-9 min-h-9 max-w-md py-0 font-serif text-[21px]"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setValue(title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Rename"
            className="group -ml-1.5 flex min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-left hover:bg-hover"
          >
            <h1 className="truncate font-serif text-[21px] leading-[1.15] tracking-[-0.01em] text-fg">
              {title || "Untitled task"}
            </h1>
            <Pencil className="size-3.5 shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
        {!loading && status !== "idle" ? (
          <span className="hidden sm:inline-flex">
            <StatusPill status={status} />
          </span>
        ) : null}
        {tainted ? <TaintShield /> : null}
        {cost ? (
          <span
            className="tabular hidden font-mono text-[11.5px] text-fg-faint lg:inline"
            title="Cost of the latest run"
          >
            {formatCost(cost)}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {active ? (
          <button type="button" className="btn btn-sm" onClick={onStop} title="Stop the task now">
            <Square className="size-3 fill-current" />
            Stop
          </button>
        ) : null}
        <button
          type="button"
          className={cx("btn btn-ghost btn-icon", panelOpen && "bg-hover text-fg")}
          aria-label={panelOpen ? "Hide run panel" : "Show run panel"}
          aria-pressed={panelOpen}
          title={panelOpen ? "Hide activity" : "Show activity"}
          onClick={onTogglePanel}
        >
          {panelOpen ? <PanelRightClose /> : <PanelRight />}
        </button>
        <Menu
          items={[
            { label: "Rename", icon: <Pencil />, onSelect: () => setEditing(true) },
            "sep",
            { label: "Delete task", icon: <Trash />, danger: true, onSelect: onDelete },
          ]}
          trigger={(p) => (
            <button
              {...p}
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label="Task actions"
            >
              <Ellipsis />
            </button>
          )}
        />
      </div>
    </header>
  );
}
