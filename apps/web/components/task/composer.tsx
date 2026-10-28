"use client";

import { ArrowUp, CornerDownLeft, LoaderCircle, Paperclip } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cx } from "@/lib/format";
import { FileChip, type useAttachments } from "./files";

export interface ComposerHandle {
  focus: () => void;
}

/** Auto-growing textarea. Enter sends, Shift+Enter adds a line. Files attach by button, drop or paste. */
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
  attach,
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
  /** Attachments from `useAttachments`; omit to hide the paperclip. */
  attach?: ReturnType<typeof useAttachments>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
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

  const hasFiles = (attach?.ready.length ?? 0) > 0;
  const canSend = (value.trim().length > 0 || hasFiles) && !sending && !attach?.uploading;
  const note = queue ? "The agent will read this at its next step" : footer;

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  }

  const files = attach?.items ?? [];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      onDragOver={
        attach
          ? (e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              setDragging(true);
            }
          : undefined
      }
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={
        attach
          ? (e) => {
              if (e.dataTransfer.files.length === 0) return;
              e.preventDefault();
              setDragging(false);
              attach.add(e.dataTransfer.files);
              ref.current?.focus();
            }
          : undefined
      }
      className={cx(
        "relative rounded-[16px] bg-surface shadow-[var(--slip-shadow)] ring-1 transition-[box-shadow] duration-150 focus-within:ring-fg/30",
        dragging ? "ring-2 ring-accent" : "ring-line",
        size === "lg" ? "px-4 pt-4 pb-3" : "py-2 pr-2 pl-2 sm:pt-2.5 sm:pr-3 sm:pl-3",
      )}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[16px] bg-surface/85 text-14 font-medium text-fg">
          Drop to attach
        </div>
      ) : null}
      {files.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2 px-1" aria-label="Attached files">
          {files.map((f) => (
            <li key={f.key} className="max-w-full">
              <FileChip
                file={f}
                status={f.status}
                {...(f.error ? { error: f.error } : {})}
                previewUrl={f.previewUrl}
                onRemove={() => attach?.remove(f.key)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {attach ? (
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files?.length) attach.add(e.target.files);
            e.target.value = "";
            ref.current?.focus();
          }}
        />
      ) : null}
      {/* Phones: clip, textarea and send share a row. Wider: a dashed rule, then clip, hints and send. */}
      <div
        className={cx(
          "grid items-end gap-x-2 sm:gap-x-3",
          attach ? "grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        {attach ? (
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className={cx(
              "btn btn-ghost btn-icon col-start-1 row-start-1 h-9 self-end text-fg-muted sm:row-start-2",
              size === "lg" ? "sm:mt-3" : "sm:mt-2.5",
            )}
            aria-label="Attach files"
            title="Attach photos, videos, PDFs or any file (up to 25 MB each)"
          >
            <Paperclip className="size-[18px]" />
          </button>
        ) : null}
        <textarea
          id={id}
          ref={ref}
          rows={size === "lg" ? 2 : 1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={
            attach
              ? (e) => {
                  const pasted = [...e.clipboardData.files];
                  if (pasted.length === 0) return;
                  e.preventDefault();
                  attach.add(pasted);
                }
              : undefined
          }
          placeholder={placeholder}
          aria-describedby={note ? `${id}-hint` : undefined}
          className={cx(
            "row-start-1 block w-full resize-none bg-transparent text-fg outline-none placeholder:text-fg-faint sm:border-b sm:border-dashed sm:border-line",
            attach ? "col-start-2 sm:col-span-3 sm:col-start-1" : "col-start-1 sm:col-span-2",
            size === "lg"
              ? "min-h-14 px-1 text-16 leading-[1.6] sm:pb-3"
              : "min-h-10 px-1.5 py-1.5 text-14 leading-[1.6] sm:pb-2.5",
          )}
        />
        <div
          className={cx(
            "row-start-2 min-w-0 items-center gap-3 pt-1.5 pl-1.5 sm:col-span-1 sm:flex",
            attach ? "col-span-3 sm:col-start-2" : "col-span-2",
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
            "btn btn-primary row-start-1 h-9 self-end shadow-[0_6px_14px_-6px_rgb(0_0_0/0.45)] disabled:shadow-none sm:row-start-2",
            size === "lg" ? "sm:mt-3" : "sm:mt-2.5",
            queue ? "px-4" : "btn-icon",
            attach ? "col-start-3" : "col-start-2",
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
