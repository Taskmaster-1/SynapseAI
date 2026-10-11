"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef } from "react";

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  active,
  sending,
  placeholder = "Ask SynapseAI to do something…",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  active: boolean;
  sending: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to ~10 lines.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize when value changes
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim() && !sending) onSend();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (value.trim() && !sending) onSend();
  }

  return (
    <form onSubmit={onSubmit} className="card flex items-end gap-2 p-2 focus-within:border-accent">
      <label htmlFor="composer" className="sr-only">
        Message
      </label>
      <textarea
        id="composer"
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          active ? "Add to the running task — it'll be read at the next step…" : placeholder
        }
        className="max-h-60 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 outline-none placeholder:text-fg-faint"
      />
      {active && onStop ? (
        <button type="button" className="btn" onClick={onStop} title="Stop the run now">
          Stop
        </button>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={!value.trim() || sending}>
        {sending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
