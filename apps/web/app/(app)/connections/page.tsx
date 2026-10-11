"use client";

import type { Effect } from "@synapse/core";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { EffectBadge } from "@/components/badges";
import { Empty, ErrorNote, Page, Section, Spinner } from "@/components/page";
import { useToast } from "@/components/toast";
import { api, type Connection, type ConnectionStatus, errorMessage } from "@/lib/api";
import { cx, hostOf } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const EFFECTS: Effect[] = ["read", "write", "send", "destructive"];

function startOAuth(url: string) {
  // Same tab: the callback redirects back to /connections?connected=… or ?error=…
  window.location.href = url;
}

export default function ConnectionsPage() {
  const router = useRouter();
  const toast = useToast();
  const conns = useApi(() => api.connections());
  const presets = useApi(() => api.presets());

  // Result of an OAuth round-trip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on mount
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const connected = q.get("connected");
    const error = q.get("error");
    if (!connected && !error) return;
    if (connected) toast("Connection authorized", "success");
    if (error) toast(`Authorization failed: ${error}`, "error");
    router.replace("/connections");
  }, []);

  const list = conns.data?.connections;
  const existingUrls = new Set((list ?? []).map((c) => c.url));
  const available = (presets.data?.presets ?? []).filter((p) => !existingUrls.has(p.url));

  async function add(body: { name: string; url: string; token?: string }) {
    const res = await api.addConnection(body);
    if (res.authorizationUrl) {
      toast("Redirecting to authorize…");
      startOAuth(res.authorizationUrl);
      return;
    }
    toast(`Connected ${res.connection.name}`, "success");
    await conns.reload();
  }

  return (
    <Page
      title="Connections"
      description="MCP servers the agent can use. Each tool has an effect — read, write, send or destructive — that drives your approval policy."
    >
      {conns.error ? <ErrorNote error={errorMessage(conns.error)} /> : null}
      {!list ? (
        conns.loading ? (
          <Spinner />
        ) : null
      ) : list.length === 0 ? (
        <div className="mb-6">
          <Empty>No connections yet. Add one below.</Empty>
        </div>
      ) : (
        <ul className="mb-6 space-y-3">
          {list.map((c) => (
            <li key={c.id}>
              <ConnectionCard
                connection={c}
                onChange={(next) =>
                  conns.setData((d) =>
                    d
                      ? { connections: d.connections.map((x) => (x.id === next.id ? next : x)) }
                      : d,
                  )
                }
                onReload={() => void conns.reload()}
              />
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 ? (
        <Section
          title="Popular servers"
          description="Official remote MCP servers. One click to add."
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {available.map((p) => (
              <li key={p.url}>
                <PresetCard
                  name={p.name}
                  description={p.description}
                  docs={p.docs}
                  url={p.url}
                  onAdd={() => add({ name: p.name, url: p.url })}
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <CustomForm onAdd={add} />
    </Page>
  );
}

function PresetCard(props: {
  name: string;
  description: string;
  docs: string;
  url: string;
  onAdd: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="card flex h-full flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{props.name}</div>
          <div className="truncate text-xs text-fg-faint">{hostOf(props.url) ?? props.url}</div>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await props.onAdd();
            } catch (err) {
              toast(errorMessage(err), "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      <p className="flex-1 text-fg-muted">{props.description}</p>
      {props.docs ? (
        <a
          href={props.docs}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-accent hover:underline"
        >
          Docs ({hostOf(props.docs)})
        </a>
      ) : null}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  active: "bg-ok-bg text-ok-fg",
  needs_auth: "bg-send-bg text-send-fg",
  error: "bg-danger-bg text-danger-fg",
  disabled: "bg-read-bg text-read-fg",
};
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  needs_auth: "Needs authorization",
  error: "Error",
  disabled: "Disabled",
};

function StatusPill({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 items-center rounded px-1.5 text-xs font-medium",
        STATUS_STYLE[status] ?? STATUS_STYLE.disabled,
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function ConnectionCard({
  connection: c,
  onChange,
  onReload,
}: {
  connection: Connection;
  onChange: (c: Connection) => void;
  onReload: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  const check = (authorize: boolean) =>
    act(authorize ? "authorize" : "check", async () => {
      const res = await api.checkConnection(c.id);
      if (res.authorizationUrl && authorize) return startOAuth(res.authorizationUrl);
      if (res.error) toast(res.error, "error");
      else if (res.status === "active") toast(`${c.name} is working`, "success");
      else if (res.status === "needs_auth" && res.authorizationUrl)
        toast("This connection needs authorization", "info");
      onReload();
    });

  async function setEffect(tool: string, effect: Effect) {
    const toolEffects: Record<string, Effect> = {};
    for (const t of c.tools ?? []) toolEffects[t.name] = t.name === tool ? effect : t.effect;
    await act(`effect:${tool}`, async () => {
      const res = await api.updateConnection(c.id, { toolEffects });
      onChange(res.connection);
    });
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{c.name}</span>
            <StatusPill status={c.status} />
          </div>
          <div className="truncate text-xs text-fg-faint" title={c.url}>
            {c.url} · {c.authType}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.status === "needs_auth" ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => void check(true)}
            >
              {busy === "authorize" ? "Opening…" : "Authorize"}
            </button>
          ) : null}
          {c.status === "error" ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() => void check(false)}
            >
              {busy === "check" ? "Checking…" : "Retry"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy !== null}
            onClick={() =>
              void act("toggle", async () => {
                const res = await api.updateConnection(c.id, {
                  status: c.status === "disabled" ? "active" : "disabled",
                });
                onChange(res.connection);
              })
            }
          >
            {c.status === "disabled" ? "Enable" : "Disable"}
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm(`Remove ${c.name}? The agent will lose access to its tools.`))
                return;
              void act("delete", async () => {
                await api.deleteConnection(c.id);
                onReload();
              });
            }}
          >
            Remove
          </button>
        </div>
      </div>
      {c.status === "error" && c.lastError ? (
        <p className="border-t border-border px-4 py-2 text-danger-fg">{c.lastError}</p>
      ) : null}
      {c.tools && c.tools.length > 0 ? (
        <details className="border-t border-border">
          <summary className="cursor-pointer px-4 py-2 text-fg-muted select-none hover:text-fg">
            {c.tools.length} tools
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {c.tools.map((t) => (
              <li key={t.name} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px]">{t.name}</span>
                    <EffectBadge effect={t.effect} />
                  </div>
                  {t.description ? (
                    <p className="line-clamp-2 text-xs text-fg-muted">{t.description}</p>
                  ) : null}
                </div>
                <label className="sr-only" htmlFor={`${c.id}-${t.name}`}>
                  Effect for {t.name}
                </label>
                <select
                  id={`${c.id}-${t.name}`}
                  className="input w-auto"
                  value={t.effect}
                  disabled={busy !== null}
                  onChange={(e) => void setEffect(t.name, e.target.value as Effect)}
                >
                  {EFFECTS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function CustomForm({
  onAdd,
}: {
  onAdd: (b: { name: string; url: string; token?: string }) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onAdd({
        name: name.trim(),
        url: url.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
      });
      setName("");
      setUrl("");
      setToken("");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Add a custom server"
      description="Any remote MCP server (Streamable HTTP). OAuth is detected automatically; use a bearer token for servers that need one."
    >
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="conn-name" className="label">
            Name
          </label>
          <input
            id="conn-name"
            className="input"
            required
            placeholder="e.g. linear"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="conn-url" className="label">
            URL
          </label>
          <input
            id="conn-url"
            className="input"
            type="url"
            required
            placeholder="https://mcp.example.com/mcp"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="conn-token" className="label">
            Bearer token (optional)
          </label>
          <input
            id="conn-token"
            className="input"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Connecting…" : "Add connection"}
          </button>
        </div>
      </form>
    </Section>
  );
}
