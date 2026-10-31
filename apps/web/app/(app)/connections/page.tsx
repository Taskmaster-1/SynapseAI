"use client";

import type { Effect } from "@synapse/core";
import {
  ChevronRight,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  Trash,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Sheet } from "@/components/overlay";
import { useToast } from "@/components/toast";
import {
  BrandGlyph,
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
import {
  api,
  type Connection,
  type ConnectionStatus,
  errorMessage,
  type GoogleIntegration,
  type Preset,
  type SlackIntegration,
} from "@/lib/api";
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
  const integrations = useApi(() => api.integrations());
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Result of an OAuth round-trip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on mount
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const connected = q.get("connected");
    const error = q.get("error");
    if (connected === "google") toast("Google connected", "success");
    else if (connected === "slack") toast("Slack connected", "success");
    else if (connected) toast("Connection authorized", "success");
    if (error) toast(error.includes(" ") ? error : `Authorization failed: ${error}`, "error");
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
        eyebrow="Tools"
        title="Connections"
        description="Where the agent can work. Gmail and Calendar are built in; add any MCP server for the rest. Every tool has an effect (read, write, send or destructive) and your approval rules key off it."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus />
            Add connection
          </button>
        }
      />
      <section aria-labelledby="builtin-title" className="mb-10">
        <h2 id="builtin-title" className="eyebrow mb-3">
          Built in
        </h2>
        {integrations.data ? (
          <div className="space-y-3">
            <GoogleCard
              google={integrations.data.google}
              onChange={() => void integrations.reload()}
            />
            <SlackCard
              slack={integrations.data.slack}
              onChange={() => void integrations.reload()}
            />
          </div>
        ) : (
          <Skeleton className="h-40 rounded-card" />
        )}
      </section>

      <h2 className="eyebrow mb-3">MCP servers</h2>
      {conns.error ? <ErrorNote>{errorMessage(conns.error)}</ErrorNote> : null}
      {!list ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-card" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          illustration={<SampleConnections />}
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
                className="group flex h-full w-full flex-col rounded-[16px] border border-line bg-surface p-5 text-left transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--slip-shadow)]"
              >
                <div className="flex items-start gap-3.5">
                  <Monogram name={c.name} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-serif text-[24px] leading-[1.1] text-fg">
                      {humanizeName(c.name)}
                    </div>
                    <div className="truncate text-12 text-fg-faint" title={c.url}>
                      {hostOf(c.url) ?? c.url}
                    </div>
                  </div>
                  <ChevronRight className="mt-1 text-fg-faint transition-transform duration-150 group-hover:translate-x-0.5" />
                </div>
                <div className="mt-6 flex items-center justify-between gap-2 border-t border-dashed border-line pt-3.5">
                  <StatusPill status={c.status} />
                  <span className="tabular font-mono text-[11px] tracking-[0.06em] text-fg-muted uppercase">
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
          <p className="rounded-[12px] bg-sunken/70 px-4 py-5 text-center text-13 text-fg-muted">
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

/** Empty-state art: three tools wired into the agent with dotted lines. */
function SampleConnections() {
  const tools = [
    { name: "GitHub", y: 34, note: "read" },
    { name: "Linear", y: 100, note: "write" },
    { name: "Notion", y: 166, note: "read" },
  ];
  return (
    <div className="relative h-[200px] w-[290px]">
      <svg
        aria-hidden="true"
        viewBox="0 0 290 200"
        className="absolute inset-0 h-full w-full"
        fill="none"
      >
        {tools.map((t) => (
          <path
            key={t.name}
            d={`M 112 ${t.y} C 170 ${t.y}, 180 100, 228 100`}
            stroke="var(--fg-faint)"
            strokeWidth="1.5"
            strokeDasharray="1 5"
            strokeLinecap="round"
          />
        ))}
        <circle cx="228" cy="100" r="3" fill="var(--accent)" />
      </svg>
      {tools.map((t, i) => (
        <div
          key={t.name}
          className="slip absolute left-0 flex h-11 w-[112px] items-center gap-2 rounded-full py-1 pr-3 pl-1.5"
          style={{ top: t.y - 22, rotate: `${[-2, 1.5, -1][i]}deg` }}
        >
          <Monogram name={t.name} size={30} round />
          <span className="min-w-0">
            <span className="block truncate text-[12px] leading-tight font-medium text-fg">
              {t.name}
            </span>
            <span className="block font-mono text-[9px] tracking-[0.08em] text-fg-faint uppercase">
              {t.note}
            </span>
          </span>
        </div>
      ))}
      <div className="absolute top-[72px] right-0 grid size-14 place-items-center rounded-[16px] bg-fg text-canvas shadow-[var(--slip-shadow)]">
        <BrandGlyph className="size-7" />
      </div>
    </div>
  );
}

const GOOGLE_SETUP = "https://github.com/Taskmaster-1/SynapseAI/blob/main/docs/google.md";

/** Gmail, Calendar, Drive and Contacts, built in: one OAuth consent, no MCP server to run. */
function GoogleCard({ google, onChange }: { google: GoogleIntegration; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const conn = google.connection;
  const connected = conn?.status === "active";
  // A grant from before Drive and Contacts existed: those tools wait for a reconnect.
  const missing = connected ? (conn.missing ?? []) : [];
  const withheld = new Set(missing.map((m) => m.group));

  async function connect() {
    setBusy("connect");
    try {
      const { url } = await api.connectGoogle();
      startOAuth(url);
    } catch (err) {
      toast(errorMessage(err), "error");
      setBusy(null);
    }
  }

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect Google? The agent loses access to Gmail, Calendar, Drive and Contacts, and email automations stop.",
      )
    )
      return;
    setBusy("disconnect");
    try {
      await api.disconnectGoogle();
      toast("Google disconnected", "success");
      onChange();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="overflow-hidden rounded-[16px] border border-line bg-surface">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <span className="flex -space-x-1.5">
          <Monogram name="Gmail" size={40} className="ring-2 ring-surface" />
          <Monogram name="Calendar" size={40} className="ring-2 ring-surface" />
          <Monogram name="Drive" size={40} className="ring-2 ring-surface" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[24px] leading-[1.1] text-fg">Google</div>
          <div className="mt-0.5 truncate text-13 text-fg-muted">
            {conn
              ? conn.account
              : "Answer email, book meetings, read and write Docs, look up contacts."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conn ? <StatusPill status={conn.status} /> : null}
          {!google.available ? (
            <a href={GOOGLE_SETUP} target="_blank" rel="noreferrer" className="btn btn-sm">
              Setup guide
              <ExternalLink className="size-3.5" />
            </a>
          ) : connected ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm text-danger"
              disabled={busy !== null}
              onClick={() => void disconnect()}
            >
              {busy === "disconnect" ? <LoaderCircle className="anim-spin size-3.5" /> : null}
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => void connect()}
            >
              {busy === "connect" ? <LoaderCircle className="anim-spin size-3.5" /> : null}
              {conn ? "Reconnect Google" : "Connect Google"}
            </button>
          )}
        </div>
      </div>
      {conn?.lastError && !connected ? (
        <p className="px-5 pb-3 text-13 text-danger">{conn.lastError}</p>
      ) : null}
      {missing.length > 0 && google.available ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-dashed border-line px-5 py-3">
          <p className="min-w-0 flex-1 text-13 text-fg-muted">
            Reconnect to let the agent use {missing.map((m) => m.label).join(" and ")}. Gmail and
            Calendar keep working until then.
          </p>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy !== null}
            onClick={() => void connect()}
          >
            {busy === "connect" ? (
              <LoaderCircle className="anim-spin size-3.5" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Reconnect Google
          </button>
        </div>
      ) : null}
      {!google.available ? (
        <p className="border-t border-dashed border-line px-5 py-3.5 text-13 text-fg-muted">
          This server has no Google app yet. Whoever runs it sets{" "}
          <code className="font-mono text-12">GOOGLE_CLIENT_ID</code> and{" "}
          <code className="font-mono text-12">GOOGLE_CLIENT_SECRET</code>; it takes about five
          minutes.
        </p>
      ) : (
        <div className="border-t border-dashed border-line px-5 py-4">
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {google.tools.map((t) => (
              <li key={t.name} className="flex items-center justify-between gap-3 text-13">
                <span
                  className={connected && !withheld.has(t.group) ? "text-fg" : "text-fg-muted"}
                  title={withheld.has(t.group) ? "Reconnect Google to turn this on" : undefined}
                >
                  {t.title}
                </span>
                <EffectPill effect={t.effect} />
              </li>
            ))}
          </ul>
          {connected ? (
            <p className="mt-4 flex flex-wrap items-center gap-x-2 text-13 text-fg-muted">
              <Mail className="size-3.5 text-accent" />
              Let it act when mail arrives:
              <Link
                href="/automations?new=email"
                className="font-medium text-accent hover:underline"
              >
                Create an email automation
              </Link>
            </p>
          ) : null}
        </div>
      )}
    </article>
  );
}

const SLACK_SETUP = "https://github.com/Taskmaster-1/SynapseAI/blob/main/docs/slack.md";

function SlackCard({ slack, onChange }: { slack: SlackIntegration; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"connect" | "disconnect" | "test" | null>(null);
  const conn = slack.connection;
  const connected = conn?.status === "active";

  async function connect() {
    setBusy("connect");
    try {
      const { url } = await api.connectSlack();
      startOAuth(url);
    } catch (err) {
      toast(errorMessage(err), "error");
      setBusy(null);
    }
  }

  async function run(label: "disconnect" | "test", fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  const disconnect = () => {
    if (!window.confirm("Disconnect Slack? Approvals stop arriving as Slack messages.")) return;
    void run("disconnect", async () => {
      await api.disconnectSlack();
      toast("Slack disconnected", "success");
      onChange();
    });
  };

  const test = () =>
    void run("test", async () => {
      await api.testSlack();
      toast("Sent. Check your Slack messages from Synapse.", "success");
      onChange();
    });

  return (
    <article className="overflow-hidden rounded-[16px] border border-line bg-surface">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <Monogram name="Slack" size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[24px] leading-[1.1] text-fg">Slack</div>
          <div className="mt-0.5 truncate text-13 text-fg-muted">
            {conn
              ? `${conn.team} workspace`
              : "Approve or deny from a Slack message when a task needs your OK."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conn ? <StatusPill status={conn.status} /> : null}
          {!slack.available ? (
            <a href={SLACK_SETUP} target="_blank" rel="noreferrer" className="btn btn-sm">
              Setup guide
              <ExternalLink className="size-3.5" />
            </a>
          ) : conn ? (
            <>
              {connected ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy !== null}
                  onClick={test}
                >
                  {busy === "test" ? <LoaderCircle className="anim-spin size-3.5" /> : null}
                  Send a test DM
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy !== null}
                  onClick={() => void connect()}
                >
                  {busy === "connect" ? <LoaderCircle className="anim-spin size-3.5" /> : null}
                  Reconnect Slack
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm text-danger"
                disabled={busy !== null}
                onClick={disconnect}
              >
                {busy === "disconnect" ? <LoaderCircle className="anim-spin size-3.5" /> : null}
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => void connect()}
            >
              {busy === "connect" ? <LoaderCircle className="anim-spin size-3.5" /> : null}
              Connect Slack
            </button>
          )}
        </div>
      </div>
      {conn?.lastError && !connected ? (
        <p className="px-5 pb-3 text-13 text-danger">{conn.lastError}</p>
      ) : null}
      <p className="border-t border-dashed border-line px-5 py-3.5 text-13 text-fg-muted">
        {!slack.available ? (
          <>
            This server has no Slack app yet. Whoever runs it creates one from the manifest in the
            guide and sets <code className="font-mono text-12">SLACK_CLIENT_ID</code>,{" "}
            <code className="font-mono text-12">SLACK_CLIENT_SECRET</code> and{" "}
            <code className="font-mono text-12">SLACK_SIGNING_SECRET</code>.
          </>
        ) : connected ? (
          "When a task needs your OK, Synapse messages you in Slack. Only you can press its buttons, and the message updates wherever you decide."
        ) : (
          "Synapse messages you directly; it can't read your channels or messages."
        )}
      </p>
    </article>
  );
}
