import type { ReactNode } from "react";

export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{title}</h1>
          {description ? <p className="mt-1 text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="card mb-6">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-fg-muted">{description}</p> : null}
      </div>
      <div className="p-4">{children}</div>
      {footer ? (
        <div className="flex items-center justify-end gap-2 border-t border-border bg-subtle px-4 py-2.5">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-fg-muted">
      {children}
    </div>
  );
}

export function ErrorNote({ error }: { error: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-danger-fg/30 bg-danger-bg px-3 py-2 text-danger-fg"
    >
      {error}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-fg-muted" role="status">
      <span className="size-1.5 rounded-full bg-fg-faint animate-pulse-dot" />
      {label}…
    </div>
  );
}
