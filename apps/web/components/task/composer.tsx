"use client";

import { ArrowUp, CornerDownLeft, LoaderCircle } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { cx } from "@/lib/format";

export interface ComposerHandle {
  focus: () => void;
}

/** Auto-growing textarea. Enter sends, Shift+Enter adds a line. */
export function Composer({
  id = "composer",
  value,
  onChange,
  onSend,
  sending,
  queue = false,
  placeholder,
  autoFocus,
  size = "md",
  footer,
  handle,
  label = "Message",
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  /** While a run is active the message is queued for its next step. */
  queue?: boolean;
  placeholder: string;
  autoFocus?: boolean;
  size?: "md" | "lg";
  footer?: ReactNode;
  handle?: Ref<ComposerHandle>;
  label?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(handle, () => ({ focus: () => ref.current?.focus() }));
  const max = size === "lg" ? 320 : 240;

  // biome-ignore lint/correctness/useExhaustiveDependencies: resize when value changes
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value, max]);

  useEffect(() => {
    if (autoFocus && window.matchMedia("(min-width: 768px)").matches) ref.current?.focus();
  }, [autoFocus]);

  const canSend = value.trim().length > 0 && !sending;
  const note = queue ? "The agent will read this at its next step" : footer;

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      className={cx(
        "relative rounded-[16px] bg-surface shadow-[var(--slip-shadow)] ring-1 ring-line transition-[box-shadow] duration-150 focus-within:ring-fg/30",
        size === "lg" ? "px-4 pt-4 pb-3" : "py-2 pr-2 pl-3 sm:pt-2.5 sm:pr-3",
      )}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {/* Phones: textarea and send share a row. Wider: a dashed rule, then hints and send. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3">
        <textarea
          id={id}
          ref={ref}
          rows={size === "lg" ? 2 : 1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-describedby={note ? `${id}-hint` : undefined}
          className={cx(
            "col-start-1 row-start-1 block w-full resize-none bg-transparent text-fg outline-none placeholder:text-fg-faint sm:col-span-2 sm:border-b sm:border-dashed sm:border-line",
            size === "lg"
              ? "min-h-14 px-1 text-16 leading-[1.6] sm:pb-3"
              : "min-h-10 px-1.5 py-1.5 text-14 leading-[1.6] sm:pb-2.5",
          )}
        />
        <div
          className={cx(
            "col-span-2 row-start-2 min-w-0 items-center gap-3 pt-1.5 pl-1.5 sm:col-span-1 sm:flex",
            size === "lg" ? "sm:pt-3" : "sm:pt-2.5",
            note ? "flex" : "hidden",
          )}
        >
          <div id={`${id}-hint`} className="min-w-0 flex-1 text-12 text-fg-faint sm:truncate">
            {note}
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 text-12 text-fg-faint sm:inline-flex">
            <kbd className="kbd">
              <CornerDownLeft className="size-3" />
            </kbd>
            {queue ? "queue" : "send"}
            <span className="text-line-strong">·</span>
            <kbd className="kbd">⇧</kbd>
            <kbd className="kbd -ml-1">
              <CornerDownLeft className="size-3" />
            </kbd>
            new line
          </span>
        </div>
        <button
          type="submit"
          disabled={!canSend}
          className={cx(
            "btn btn-primary col-start-2 row-start-1 h-9 self-end shadow-[0_6px_14px_-6px_rgb(0_0_0/0.45)] disabled:shadow-none sm:row-start-2",
            size === "lg" ? "sm:mt-3" : "sm:mt-2.5",
            queue ? "px-4" : "btn-icon",
          )}
          aria-label={queue ? "Queue message" : "Send"}
        >
          {sending ? (
            <LoaderCircle className="anim-spin size-4" />
          ) : queue ? null : (
            <ArrowUp className="size-[18px]" strokeWidth={2.25} />
          )}
          {queue ? "Queue" : null}
        </button>
      </div>
    </form>
  );
}
