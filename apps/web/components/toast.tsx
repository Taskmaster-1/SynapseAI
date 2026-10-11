"use client";

import { Check, CircleAlert, Info, X } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { cx } from "@/lib/format";

type Tone = "info" | "success" | "error";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

/** Transient confirmations only. Errors that need action belong inline, next to the thing. */
export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: Tone = "info") => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-2), { id, message, tone }]);
      setTimeout(() => dismiss(id), tone === "error" ? 6000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-5 md:bottom-5 md:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="anim-row-in pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-[10px] bg-surface py-2.5 pr-2 pl-3 text-13 text-fg shadow-pop"
          >
            <span
              className={cx(
                "grid size-5 shrink-0 place-items-center rounded-full",
                t.tone === "error"
                  ? "bg-danger-soft text-danger"
                  : t.tone === "success"
                    ? "bg-ok-soft text-ok"
                    : "bg-sunken text-fg-muted",
              )}
            >
              {t.tone === "error" ? (
                <CircleAlert className="size-3.5" />
              ) : t.tone === "success" ? (
                <Check className="size-3.5" />
              ) : (
                <Info className="size-3.5" />
              )}
            </span>
            <span className="min-w-0 flex-1">{t.message}</span>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
