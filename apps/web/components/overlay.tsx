"use client";

import { X } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/format";

/** Escape closes, focus moves inside on open and back to the opener on close, Tab stays inside. */
export function useDialogFocus(
  open: boolean,
  panel: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = panel.current;
    const auto = el?.querySelector<HTMLElement>("[data-autofocus]");
    (auto ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = el.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, panel]);
}

/** Overlays only ever open after hydration, so rendering straight into body is safe. */
function Portal({ children }: { children: ReactNode }) {
  return typeof document === "undefined" ? null : createPortal(children, document.body);
}

/**
 * Side sheet on desktop, bottom sheet on mobile.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useDialogFocus(open, panel, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-end justify-end md:items-stretch">
        <button
          type="button"
          aria-label="Close"
          tabIndex={-1}
          className="anim-fade-in absolute inset-0 cursor-default bg-scrim"
          onClick={onClose}
        />
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-t`}
          tabIndex={-1}
          style={{ ["--sheet-w" as string]: `${width}px` }}
          className="anim-sheet-bottom md:anim-sheet-right relative flex max-h-[88dvh] w-full flex-col rounded-t-[16px] border-line bg-surface shadow-pop outline-none md:max-h-none md:w-[var(--sheet-w)] md:max-w-[calc(100vw-48px)] md:rounded-none md:border-l"
        >
          <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong md:hidden" />
          <header className="flex items-start gap-3 px-5 pt-4 pb-3 md:px-6 md:pt-5">
            <div className="min-w-0 flex-1">
              <h2 id={`${id}-t`} className="font-serif text-28 leading-tight text-fg">
                {title}
              </h2>
              {description ? <p className="mt-1 text-13 text-fg-muted">{description}</p> : null}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon -mr-2"
              aria-label="Close"
              onClick={onClose}
            >
              <X />
            </button>
          </header>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-6 md:px-6">
            {children}
          </div>
          {footer ? (
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3 md:px-6">
              {footer}
            </footer>
          ) : null}
        </div>
      </div>
    </Portal>
  );
}

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  hint?: ReactNode;
}

/** Small dropdown menu. `trigger` gets the props to spread onto a button. */
export function Menu({
  trigger,
  items,
  header,
  align = "end",
  side = "bottom",
  className,
}: {
  trigger: (p: {
    ref: RefObject<HTMLButtonElement | null>;
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
    "aria-controls": string;
  }) => ReactNode;
  items: (MenuItem | "sep")[];
  header?: ReactNode;
  align?: "start" | "end";
  side?: "top" | "bottom";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const first = list.current?.querySelector<HTMLElement>("[role=menuitem]");
    first?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const els = Array.from(
          list.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [],
        );
        const i = els.indexOf(document.activeElement as HTMLElement);
        const n = e.key === "ArrowDown" ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
        els[n]?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={cx("relative", className)}>
      {trigger({
        ref: btn,
        onClick: () => setOpen((o) => !o),
        "aria-expanded": open,
        "aria-haspopup": "menu",
        "aria-controls": id,
      })}
      {open ? (
        <div
          ref={list}
          id={id}
          role="menu"
          className={cx(
            "anim-pop-in absolute z-50 min-w-52 rounded-[10px] bg-surface p-1 shadow-pop",
            align === "end" ? "right-0" : "left-0",
            side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
          )}
        >
          {header}
          {items.map((it, i) =>
            it === "sep" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: static separators
              <hr key={`sep-${i}`} className="my-1 border-line" />
            ) : (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: static menu
                key={i}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close();
                  it.onSelect();
                }}
                className={cx(
                  "flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-13 outline-none hover:bg-hover focus-visible:bg-hover",
                  it.danger ? "text-danger" : "text-fg",
                )}
              >
                {it.icon ? (
                  <span className={it.danger ? "" : "text-fg-muted"}>{it.icon}</span>
                ) : null}
                <span className="flex-1">{it.label}</span>
                {it.hint}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  label,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(open, panel, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
        <button
          type="button"
          aria-label="Close"
          tabIndex={-1}
          className="anim-fade-in absolute inset-0 cursor-default bg-scrim"
          onClick={onClose}
        />
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className={cx(
            "anim-pop-in relative w-full rounded-[14px] bg-surface shadow-pop outline-none",
            className,
          )}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}
