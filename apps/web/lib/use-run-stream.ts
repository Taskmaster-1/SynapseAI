"use client";

import type { RunStatus, SeqEvent } from "@synapse/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type StreamState = "idle" | "connecting" | "open" | "reconnecting" | "done" | "gone";

const STOP_STATUSES: ReadonlySet<RunStatus> = new Set([
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);
const MAX_BACKOFF_MS = 10_000;

/** Parses one SSE block (lines between blank lines). Returns the event, or null for comments/pings. */
function parseBlock(block: string): SeqEvent | null {
  let data = "";
  for (const raw of block.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    // `id:` mirrors `seq` in the payload; we resume from the payload's seq.
    if (field === "data") data = data ? `${data}\n${value}` : value;
  }
  if (!data) return null;
  try {
    return JSON.parse(data) as SeqEvent;
  } catch {
    return null;
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Streams a run's events over fetch + ReadableStream (not EventSource, so reconnects are ours).
 *
 * - Resumes from the last received seq on every (re)connect with exponential backoff (≤ 10s).
 * - Stops after a run.status of waiting/completed/failed/cancelled; 404 means the run is gone.
 * - Disconnects while the tab is hidden and resumes when it becomes visible.
 * - Batches events per animation frame and hands them to `onEvents`, which should fold them
 *   through `applyEvent` (idempotent per seq, so replays are harmless).
 *
 * Call `reopen()` after sending a message or deciding an approval.
 */
export function useRunStream(
  runId: string | null,
  lastSeq: number,
  onEvents: (events: SeqEvent[]) => void,
) {
  const [state, setState] = useState<StreamState>("idle");
  const [epoch, setEpoch] = useState(0);
  const seqRef = useRef(lastSeq);
  const runRef = useRef(runId);
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;

  // A new run resets the resume point to the caller's lastSeq.
  if (runRef.current !== runId) {
    runRef.current = runId;
    seqRef.current = lastSeq;
  } else if (lastSeq > seqRef.current) {
    seqRef.current = lastSeq;
  }

  /** Reconnect now; `fromSeq` rewinds the resume point (e.g. after replacing state with a snapshot). */
  const reopen = useCallback((fromSeq?: number) => {
    if (fromSeq !== undefined) seqRef.current = fromSeq;
    setEpoch((e) => e + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch forces a reconnect
  useEffect(() => {
    if (!runId) {
      setState("idle");
      return;
    }
    let finished = false;
    let controller: AbortController | null = null;
    let buffer: SeqEvent[] = [];
    let frame: { raf: number } | { timeout: ReturnType<typeof setTimeout> } | null = null;

    const flush = () => {
      frame = null;
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      onEventsRef.current(batch);
    };
    const schedule = () => {
      if (frame) return;
      // rAF doesn't fire in hidden tabs, so fall back to a timer there.
      frame = document.hidden
        ? { timeout: setTimeout(flush, 16) }
        : { raf: requestAnimationFrame(flush) };
    };

    const run = async (signal: AbortSignal) => {
      let attempt = 0;
      while (!signal.aborted && !finished) {
        setState(attempt === 0 ? "connecting" : "reconnecting");
        try {
          const res = await fetch(
            `/api/runs/${encodeURIComponent(runId)}/events?after=${seqRef.current}`,
            {
              headers: { accept: "text/event-stream" },
              credentials: "same-origin",
              cache: "no-store",
              signal,
            },
          );
          if (res.status === 404) {
            finished = true;
            setState("gone");
            return;
          }
          if (res.status === 401) {
            window.location.replace("/sign-in");
            return;
          }
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          setState("open");
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let text = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            attempt = 0;
            text += value;
            text = text.replace(/\r\n/g, "\n");
            let idx = text.indexOf("\n\n");
            while (idx >= 0) {
              const block = text.slice(0, idx);
              text = text.slice(idx + 2);
              idx = text.indexOf("\n\n");
              const event = parseBlock(block);
              if (!event || event.runId !== runId) continue;
              if (event.seq <= seqRef.current) continue;
              seqRef.current = event.seq;
              buffer.push(event);
              schedule();
              if (event.type === "run.status" && STOP_STATUSES.has(event.status)) finished = true;
            }
            if (finished) {
              await reader.cancel().catch(() => {});
              break;
            }
          }
          if (finished) {
            setState("done");
            return;
          }
          // Stream ended without a final status: the server or a proxy dropped it. Resume.
        } catch {
          if (signal.aborted) return;
        }
        if (signal.aborted || finished) return;
        const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
        attempt++;
        setState("reconnecting");
        await sleep(delay, signal);
      }
    };

    const start = () => {
      if (finished || controller) return;
      const mine = new AbortController();
      controller = mine;
      void run(mine.signal).finally(() => {
        if (controller === mine) controller = null;
      });
    };
    const stop = () => {
      controller?.abort();
      controller = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      finished = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      if (frame) {
        if ("raf" in frame) cancelAnimationFrame(frame.raf);
        else clearTimeout(frame.timeout);
      }
      flush();
    };
  }, [runId, epoch]);

  return { state, reopen };
}
