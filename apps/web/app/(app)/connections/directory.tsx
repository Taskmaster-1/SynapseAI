"use client";

import { Check, LoaderCircle, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { ErrorNote, Monogram, Pill, Skeleton } from "@/components/ui";
import { api, type CatalogApp, errorMessage } from "@/lib/api";
import { cx } from "@/lib/format";
import { useApi } from "@/lib/use-api";

/**
 * Apps that connect in one click: pick one, sign in on its site, and its tools show up under
 * your approval rules. Search matches the name, the description and the example asks.
 */
export function AppDirectory({
  version,
  onOpen,
  onConnected,
  onAuthorize,
}: {
  /** Bumped when connections change elsewhere, so "Connected" stays right. */
  version: number;
  onOpen: (connectionId: string) => void;
  onConnected: () => void;
  onAuthorize: (url: string) => void;
}) {
  const toast = useToast();
  // Refetch when connections change, so "Connected" stays right.
  const data = useApi(() => api.catalog(), String(version));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const apps = data.data?.apps;
  const categories = data.data?.categories ?? [];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (apps ?? []).filter(
      (a) =>
        (category === null || a.category === category) &&
        (!q ||
          [a.title, a.description, a.category, ...a.examples].some((s) =>
            s.toLowerCase().includes(q),
          )),
    );
  }, [apps, query, category]);

  async function connect(app: CatalogApp) {
    setBusy(app.id);
    try {
      const res = await api.connectApp(app.id);
      if (res.authorizationUrl) {
        toast(`Taking you to ${app.title} to sign in…`);
        onAuthorize(res.authorizationUrl);
        return;
      }
      if (res.connection.status === "active") toast(`${app.title} connected`, "success");
      else toast(res.connection.lastError ?? `Couldn't reach ${app.title} yet`, "error");
      onConnected();
      await data.reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
    setBusy(null);
  }

  return (
    <section aria-labelledby="directory-title" className="mt-12">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="directory-title" className="eyebrow">
            App directory
          </h2>
          <p className="mt-1.5 max-w-[38rem] text-14 text-fg-muted">
            Connect in one click and sign in on the app's own site. Anything that sends, changes or
            deletes still waits for your OK.
          </p>
        </div>
        <label className="relative w-full sm:w-64">
          <span className="sr-only">Search apps</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-faint" />
          <input
            id="directory-search"
            className="input pl-9"
            type="search"
            placeholder="Search apps"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {data.error ? <ErrorNote>{errorMessage(data.error)}</ErrorNote> : null}
      {!apps ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-36 rounded-card" />
          ))}
        </div>
      ) : (
        <>
          <fieldset aria-label="Category" className="mb-5 flex flex-wrap gap-1.5">
            {[null, ...categories].map((c) => {
              const on = category === c;
              return (
                <button
                  key={c ?? "all"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCategory(c)}
                  className={cx(
                    "h-8 rounded-full border px-3 text-13 transition-colors duration-150",
                    on
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {c ?? "All"}
                </button>
              );
            })}
          </fieldset>
          {shown.length === 0 ? (
            <p className="rounded-[12px] bg-sunken/70 px-4 py-6 text-center text-13 text-fg-muted">
              No app{category ? ` in ${category}` : ""} matches “{query.trim()}”. Any other MCP
              server works too: use <span className="font-medium text-fg">Add custom server</span>.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((app) => (
                <li key={app.id} className="flex">
                  <AppCard
                    app={app}
                    busy={busy === app.id}
                    disabled={busy !== null}
                    onConnect={() => void connect(app)}
                    onOpen={() => app.connectionId && onOpen(app.connectionId)}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function AppCard({
  app,
  busy,
  disabled,
  onConnect,
  onOpen,
}: {
  app: CatalogApp;
  busy: boolean;
  disabled: boolean;
  onConnect: () => void;
  onOpen: () => void;
}) {
  const connected = app.connectionId !== null;
  return (
    <article className="flex w-full flex-col rounded-[16px] border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <Monogram name={app.title} size={36} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-14 font-medium text-fg">{app.title}</h3>
          <p className="truncate font-mono text-[10.5px] tracking-[0.1em] text-fg-faint uppercase">
            {app.category}
          </p>
        </div>
        {app.auth === "none" ? <Pill tone="outline">No sign-in</Pill> : null}
      </div>
      <p className="mt-2.5 text-13 text-fg-muted">{app.description}</p>
      {app.examples[0] ? (
        <p className="mt-2 flex-1 text-13 text-fg-faint italic">“{app.examples[0]}”</p>
      ) : (
        <span className="flex-1" />
      )}
      <div className="mt-3.5 flex items-center justify-end border-t border-line pt-3">
        {connected ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>
            <Check className="size-3.5 text-ok" strokeWidth={2.5} />
            Connected
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={disabled}
            onClick={onConnect}
          >
            {busy ? <LoaderCircle className="anim-spin size-3.5" /> : null}
            Connect
          </button>
        )}
      </div>
    </article>
  );
}
