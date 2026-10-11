"use client";

import type { Effect } from "@synapse/core";
import {
  ChevronRight,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Plug,
  Plus,
  RefreshCw,
  Trash,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Sheet } from "@/components/overlay";
import { useToast } from "@/components/toast";
import {
  EFFECT_EXPLAINER,
  EffectPill,
  EmptyState,
  ErrorNote,
  Field,
  Monogram,
  Page,
  PageHeader,
  Pill,
  Segmented,
  Skeleton,
  Switch,
} from "@/components/ui";
import { api, type Connection, type ConnectionStatus, errorMessage, type Preset } from "@/lib/api";
import { hostOf, humanize } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const EFFECTS: Effect[] = ["read", "write", "send", "destructive"];

function startOAuth(url: string) {
  // Same tab: the callback redirects back to /connections?connected=… or ?error=…
  window.location.href = url;
}

const STATUS: Record<string, { label: string; tone: "ok" | "attention" | "danger" | "neutral" }> = {
  active: { label: "Connected", tone: "ok" },
  needs_auth: { label: "Needs authorization", tone: "attention" },
  error: { label: "Error", tone: "danger" },
  disabled: { label: "Off", tone: "neutral" },
};

function StatusPill({ status }: { status: ConnectionStatus }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Pill tone={s.tone}>
      <span className="size-1.5 rounded-full bg-current" />
      {s.label}
    </Pill>
  );
}

export default function ConnectionsPage() {
  const router = useRouter();
  const toast = useToast();
  const conns = useApi(() => api.connections());
  const presets = useApi(() => api.presets());
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Result of an OAuth round-trip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on mount
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const connected = q.get("connected");
    const error = q.get("error");
    if (connected) toast("Connection authorized", "success");
    if (error) toast(`Authorization failed: ${error}`, "error");
    if (q.has("add")) setAdding(true);
    if (connected || error || q.has("add")) router.replace("/connections");
  }, []);

  const list = conns.data?.connections;
  const open = list?.find((c) => c.id === openId) ?? null;
  const replace = (next: Connection) =>
    conns.setData((d) =>
      d ? { connections: d.connections.map((x) => (x.id === next.id ? next : x)) } : d,
    );

  async function add(body: { name: string; url: string; token?: string }) {
    const res = await api.addConnection(body);
    if (res.authorizationUrl) {
      toast("Redirecting to authorize…");
      startOAuth(res.authorizationUrl);
      return;
    }
    toast(`Connected ${res.connection.name}`, "success");
    setAdding(false);
    await conns.reload();
  }

  return (
    <Page wide>
      <PageHeader
        title="Connections"
        description="MCP servers the agent can work in. Every tool has an effect — read, write, send or destructive — and your approval rules key off it."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus />
            Add connection
          </button>
        }
      />
      {conns.error ? <ErrorNote>{errorMessage(conns.error)}</ErrorNote> : null}
      {!list ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-card" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Plug className="size-5" />}
          title="No connections yet"
          action={
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              Add your first connection
            </button>
          }
        >
          Connect GitHub, Linear or any MCP server, and the agent can work inside it.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpenId(c.id)}
                className="group flex h-full w-full flex-col rounded-card border border-line bg-surface p-4 text-left transition-colors duration-150 hover:border-line-strong"
              >
                <div className="flex items-start gap-3">
                  <Monogram name={c.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-16 font-medium text-fg">
                      {humanizeName(c.name)}
                    </div>
                    <div className="truncate text-12 text-fg-faint" title={c.url}>
                      {hostOf(c.url) ?? c.url}
                    </div>
                  </div>
                  <ChevronRight className="mt-1 text-fg-faint transition-transform duration-150 group-hover:translate-x-0.5" />
                </div>
                <div className="mt-5 flex items-center justify-between gap-2">
                  <StatusPill status={c.status} />
                  <span className="tabular text-12 text-fg-muted">
                    {c.tools ? `${c.tools.length} tools` : "Tools not loaded"}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open ? humanizeName(open.name) : ""}
        description={open ? (hostOf(open.url) ?? open.url) : undefined}
        width={560}
      >
        {open ? (
          <ConnectionDetail
            connection={open}
            onChange={replace}
            onRemoved={() => {
              setOpenId(null);
              void conns.reload();
            }}
            onReload={() => void conns.reload()}
          />
        ) : null}
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a connection" width={600}>
        <AddConnection
          presets={(presets.data?.presets ?? []).filter(
            (p) => !(list ?? []).some((c) => c.url === p.url),
          )}
          onAdd={add}
        />
      </Sheet>
    </Page>
  );
}

const KNOWN_NAMES: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  hubspot: "HubSpot",
  paypal: "PayPal",
};

function humanizeName(name: string) {
  const known = KNOWN_NAMES[name.toLowerCase()];
  if (known) return known;
  return name.length <= 3 ? name.toUpperCase() : name[0]!.toUpperCase() + name.slice(1);
}

function ConnectionDetail({
  connection: c,
  onChange,
  onRemoved,
  onReload,
}: {
  connection: Connection;
  onChange: (c: Connection) => void;
  onRemoved: () => void;
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
      else if (res.status === "active") toast(`${humanizeName(c.name)} is working`, "success");
      else if (res.status === "needs_auth") toast("This connection needs authorization", "info");
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
    <div className="space-y-7">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={c.status} />
        <span className="text-12 text-fg-faint">
          {c.authType === "oauth" ? "OAuth" : c.authType === "bearer" ? "Bearer token" : "No auth"}
        </span>
      </div>

      {c.status === "needs_auth" ? (
        <div className="rounded-[10px] border border-attention/30 bg-attention-soft px-4 py-3.5">
          <p className="text-14 text-fg">
            Authorize {humanizeName(c.name)} so the agent can use it.
          </p>
          <p className="mt-0.5 text-13 text-fg-muted">
            You'll sign in on their site, then come back here.
          </p>
          <button
            type="button"
            className="btn btn-primary mt-3"
            disabled={busy !== null}
            onClick={() => void check(true)}
          >
            {busy === "authorize" ? <LoaderCircle className="anim-spin" /> : <KeyRound />}
            Authorize
          </button>
        </div>
      ) : null}
      {c.status === "error" && c.lastError ? <ErrorNote>{c.lastError}</ErrorNote> : null}

      <div className="flex items-center justify-between rounded-[10px] border border-line px-4 py-3">
        <div>
          <p className="text-14 text-fg">Available to the agent</p>
          <p className="text-12 text-fg-muted">
            Turn off to hide every tool without removing the connection.
          </p>
        </div>
        <Switch
          checked={c.status !== "disabled"}
          label="Available to the agent"
          disabled={busy !== null}
          onChange={(on) =>
            void act("toggle", async () => {
              const res = await api.updateConnection(c.id, { status: on ? "active" : "disabled" });
              onChange(res.connection);
            })
          }
        />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-13 font-medium text-fg-muted">
            Tools{c.tools ? ` · ${c.tools.length}` : ""}
          </h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy !== null}
            onClick={() => void check(false)}
          >
            {busy === "check" ? (
              <LoaderCircle className="anim-spin size-3.5" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Check connection
          </button>
        </div>
        {!c.tools || c.tools.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-line-strong px-4 py-5 text-center text-13 text-fg-muted">
            {c.tools
              ? "This server doesn't offer any tools."
              : "Tools appear after a successful check."}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-[10px] border border-line">
            {c.tools.map((t) => (
              <li key={t.name} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0">
                    <p className="text-14 text-fg">{t.title || humanize(t.name)}</p>
                    <p className="font-mono text-12 text-fg-faint">{t.name}</p>
                  </div>
                  <Segmented<Effect>
                    label={`Effect for ${t.name}`}
                    size="sm"
                    value={t.effect}
                    onChange={(e) => void setEffect(t.name, e)}
                    options={EFFECTS.map((e) => ({
                      value: e,
                      label: e === "destructive" ? "Destr." : humanize(e),
                      tone:
                        e === "write"
                          ? "accent"
                          : e === "send"
                            ? "attention"
                            : e === "destructive"
                              ? "danger"
                              : undefined,
                    }))}
                  />
                </div>
                {t.description ? (
                  <p className="mt-1.5 line-clamp-2 text-13 text-fg-muted">{t.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[10px] bg-sunken px-4 py-3.5">
        <h3 className="mb-2.5 text-13 font-medium text-fg">What effects mean</h3>
        <dl className="space-y-2">
          {EFFECTS.map((e) => (
            <div key={e} className="flex items-baseline gap-3">
              <dt className="w-24 shrink-0">
                <EffectPill effect={e} />
              </dt>
              <dd className="text-13 text-fg-muted">{EFFECT_EXPLAINER[e]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-12 text-fg-faint">
          Reads run on their own. Everything else asks first unless an approval rule says otherwise.
        </p>
      </section>

      <div className="border-t border-line pt-5">
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy !== null}
          onClick={() => {
            if (
              !window.confirm(
                `Remove ${humanizeName(c.name)}? The agent loses access to its tools.`,
              )
            )
              return;
            void act("delete", async () => {
              await api.deleteConnection(c.id);
              onRemoved();
            });
          }}
        >
          <Trash className="size-3.5" />
          Remove connection
        </button>
      </div>
    </div>
  );
}

function AddConnection({
  presets,
  onAdd,
}: {
  presets: Preset[];
  onAdd: (b: { name: string; url: string; token?: string }) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, body: { name: string; url: string; token?: string }) {
    setBusy(key);
    setError(null);
    try {
      await onAdd(body);
    } catch (err) {
      if (key === "custom") setError(errorMessage(err));
      else toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run("custom", {
      name: name.trim(),
      url: url.trim(),
      ...(token.trim() ? { token: token.trim() } : {}),
    });
  }

  return (
    <div className="space-y-8">
      {presets.length > 0 ? (
        <section>
          <h3 className="mb-3 text-13 font-medium text-fg-muted">Popular servers</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {presets.map((p) => (
              <li key={p.url}>
                <div className="flex h-full flex-col rounded-[10px] border border-line p-3.5">
                  <div className="flex items-center gap-2.5">
                    <Monogram name={p.name} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-14 font-medium text-fg">
                        {humanizeName(p.name)}
                      </div>
                      <div className="truncate text-12 text-fg-faint">{hostOf(p.url)}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(p.url, {
                          name: p.name.toLowerCase().replace(/\s+/g, "-"),
                          url: p.url,
                        })
                      }
                    >
                      {busy === p.url ? <LoaderCircle className="anim-spin size-3.5" /> : null}
                      Add
                    </button>
                  </div>
                  <p className="mt-2 line-clamp-2 flex-1 text-13 text-fg-muted">{p.description}</p>
                  {p.docs ? (
                    <a
                      href={p.docs}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-12 text-fg-faint hover:text-fg"
                    >
                      Docs · {hostOf(p.docs)} <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="text-13 font-medium text-fg-muted">Custom server</h3>
        <p className="mt-1 mb-4 text-13 text-fg-faint">
          Any remote MCP server (Streamable HTTP). OAuth is detected automatically.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Field label="Name" htmlFor="conn-name">
              <input
                id="conn-name"
                className="input"
                required
                placeholder="linear"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="URL" htmlFor="conn-url">
              <input
                id="conn-url"
                className="input"
                type="url"
                required
                placeholder="https://mcp.example.com/mcp"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Bearer token"
            htmlFor="conn-token"
            hint="Optional. Stored encrypted; never shown again."
          >
            <input
              id="conn-token"
              className="input"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </Field>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <button type="submit" className="btn btn-primary" disabled={busy !== null}>
            {busy === "custom" ? <LoaderCircle className="anim-spin" /> : null}
            Connect
          </button>
        </form>
      </section>
    </div>
  );
}
