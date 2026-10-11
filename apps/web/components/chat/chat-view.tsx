"use client";

import type { SeqEvent } from "@synapse/core";
import {
  applyEvent,
  type ChatState,
  isActive,
  type UiMessage,
  type UiPart,
} from "@synapse/core/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApprovalCard } from "@/components/approval-card";
import { EffectBadge } from "@/components/badges";
import { ErrorNote, Spinner } from "@/components/page";
import { useToast } from "@/components/toast";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useChats } from "@/lib/chats-context";
import { splitToolName } from "@/lib/format";
import { useRunStream } from "@/lib/use-run-stream";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { RunFooter } from "./run-footer";

type ToolPart = Extract<UiPart, { type: "tool" }>;

export function ChatView({ chatId }: { chatId: string }) {
  const router = useRouter();
  const toast = useToast();
  const { reload: reloadChats } = useChats();
  const [title, setTitle] = useState("");
  const [state, setState] = useState<ChatState | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [streamRunId, setStreamRunId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, boolean>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const snapshotRef = useRef<() => Promise<void>>(async () => {});
  /** Refetches the chat and replaces local state with the stored view. */
  const snapshot = useCallback(() => snapshotRef.current(), []);

  const onEvents = useCallback(
    (events: SeqEvent[]) => {
      setState((s) => (s ? events.reduce(applyEvent, s) : s));
      let refresh = false;
      for (const e of events) {
        if (e.type === "message.start") setQueuedId(null);
        if (e.type === "run.status" && !isActive(e.status)) {
          setQueuedId(null);
          refresh = true;
        }
        if (e.type === "error" && !e.retryable) toast(e.message, "error");
      }
      if (refresh) {
        void reloadChats();
        // Reconcile with stored rows (canonical ids, handover summaries) once the stream is closed.
        void snapshot();
      }
    },
    [toast, reloadChats, snapshot],
  );

  const lastSeq = state?.run && state.run.id === streamRunId ? state.run.lastSeq : 0;
  const { state: streamState, reopen } = useRunStream(streamRunId, lastSeq, onEvents);

  /** Start (or restart) streaming a run, resuming from what we already have. */
  const follow = useCallback(
    (runId: string, fromSeq?: number) => {
      if (runId === streamRunId) reopen(fromSeq);
      else setStreamRunId(runId);
    },
    [streamRunId, reopen],
  );

  snapshotRef.current = async () => {
    try {
      const data = await api.chat(chatId);
      setTitle(data.chat.title);
      setState({ messages: data.messages, run: data.run });
      setDecided({});
      if (data.run && isActive(data.run.status)) follow(data.run.id, data.run.lastSeq);
    } catch (err) {
      if (!state) setLoadError(err);
    }
  };

  // Initial load.
  useEffect(() => {
    setState(null);
    setLoadError(null);
    setStreamRunId(null);
    setQueuedId(null);
    const ctrl = new AbortController();
    api
      .chat(chatId, ctrl.signal)
      .then((data) => {
        setTitle(data.chat.title);
        setState({ messages: data.messages, run: data.run });
        if (data.run && isActive(data.run.status)) setStreamRunId(data.run.id);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setLoadError(err);
      });
    return () => ctrl.abort();
  }, [chatId]);

  // Keep the view pinned to the bottom while the user hasn't scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  });

  const run = state?.run ?? null;
  const active = isActive(run?.status);

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
      const res = await api.sendMessage(chatId, content);
      setQueuedId(res.queued === "pending_input" ? localId : null);
      follow(res.runId);
      void reloadChats();
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
    if (!window.confirm("Delete this chat? This can't be undone.")) return;
    try {
      await api.deleteChat(chatId);
      await reloadChats();
      router.push("/");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  function renderApproval(part: ToolPart, message: UiMessage) {
    const runId = message.runId ?? run?.id;
    if (!runId) return null;
    const outcome = decided[part.toolCallId];
    if (outcome !== undefined) {
      const { source, tool } = splitToolName(part.name);
      return (
        <div className="card flex items-center gap-2 px-3 py-2 text-fg-muted">
          <span className="font-mono text-[13px]">
            {source ? `${source} · ` : ""}
            {tool}
          </span>
          <EffectBadge effect={part.effect} />
          <span className="ml-auto text-xs">
            {outcome ? "Approved — continuing…" : "Denied — continuing…"}
          </span>
        </div>
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
        onDecided={(approved) => {
          setDecided((d) => ({ ...d, [part.toolCallId]: approved }));
          follow(runId);
          void reloadChats();
        }}
        onConflict={() => void snapshot()}
      />
    );
  }

  if (loadError) {
    const notFound = loadError instanceof ApiError && loadError.status === 404;
    return (
      <div className="p-6">
        <ErrorNote error={notFound ? "This chat doesn't exist." : errorMessage(loadError)} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <h1 className="min-w-0 flex-1 truncate font-medium">{title || "Chat"}</h1>
        <button type="button" className="btn btn-ghost btn-sm text-fg-muted" onClick={remove}>
          Delete
        </button>
      </header>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {state ? (
            <MessageList
              messages={state.messages}
              streaming={active}
              queuedId={queuedId}
              renderApproval={renderApproval}
            />
          ) : (
            <Spinner />
          )}
        </div>
      </div>
      <div className="shrink-0 border-t border-border bg-bg">
        <div className="mx-auto w-full max-w-3xl space-y-2 px-4 py-3">
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => void send()}
            onStop={() => void stop()}
            active={active}
            sending={sending}
            autoFocus
          />
          <RunFooter run={run} stream={streamState} />
        </div>
      </div>
    </div>
  );
}
