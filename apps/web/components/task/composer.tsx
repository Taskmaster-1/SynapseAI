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
        "rounded-[14px] border border-line-strong bg-surface transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_16%,transparent)]",
        size === "lg" ? "p-3 shadow-[0_1px_2px_rgb(0_0_0/0.04)]" : "p-2",
      )}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={size === "lg" ? 2 : 1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={cx(
          "block w-full resize-none bg-transparent text-fg outline-none placeholder:text-fg-faint",
          size === "lg" ? "min-h-14 px-1.5 pt-1 text-16" : "min-h-9 px-2 py-1.5 text-14",
        )}
      />
      <div className="mt-1 flex items-center gap-2 pl-1.5">
        <div className="min-w-0 flex-1 text-12 text-fg-faint">
          {queue ? "The agent will read this at its next step" : footer}
        </div>
        <span className="hidden items-center gap-1 text-12 text-fg-faint sm:inline-flex">
          <CornerDownLeft className="size-3" /> to {queue ? "queue" : "send"}
        </span>
        <button
          type="submit"
          disabled={!canSend}
          className={cx("btn btn-primary btn-sm", !queue && "btn-icon")}
          aria-label={queue ? "Queue message" : "Send"}
        >
          {sending ? (
            <LoaderCircle className="anim-spin size-3.5" />
          ) : queue ? null : (
            <ArrowUp className="size-4" />
          )}
          {queue ? "Queue" : null}
        </button>
      </div>
    </form>
  );
}
