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
import { LinearCard } from "@/components/linear-card";
import { Sheet } from "@/components/overlay";
import { useToast } from "@/components/toast";
import {
  EFFECT_EXPLAINER,
  EffectPill,
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
  type SlackIntegration,
} from "@/lib/api";
import { hostOf, humanize } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { AppDirectory } from "./directory";
import { GitHubCard } from "./github-card";

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
  const integrations = useApi(() => api.integrations());
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // Bumped whenever connections change, so the directory's "Connected" marks follow.
  const [version, setVersion] = useState(0);
  const changed = () => {
    setVersion((v) => v + 1);
    return conns.reload();
  };

  // Result of an OAuth round-trip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on mount
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const connected = q.get("connected");
    const error = q.get("error");
    if (connected === "google") toast("Google connected", "success");
    else if (connected === "slack") toast("Slack connected", "success");
    else if (connected === "github") toast("GitHub connected", "success");
    else if (connected === "linear") toast("Linear connected", "success");
    else if (connected) toast("Connection authorized", "success");
    if (error) toast(error.includes(" ") ? error : `Authorization failed: ${error}`, "error");
    // "Add a connection" links land on the directory.
    if (q.has("add"))
      setTimeout(() => {
        document.getElementById("directory-title")?.scrollIntoView({ behavior: "smooth" });
        document.getElementById("directory-search")?.focus({ preventScroll: true });
      }, 300);
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
    await changed();
  }

  return (
    <Page wide>
      <PageHeader
        eyebrow="Tools"
        title="Connections"
        description="Where the agent can work. Google (Gmail, Calendar, Drive, Sheets, Contacts), Slack, GitHub and Linear are built in; the app directory below adds dozens more in one click. Every tool has an effect (read, write, send or destructive) and your approval rules key off it."
        actions={
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <Plus />
            Add custom server
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
            <GitHubCard
              github={integrations.data.github}
              onChange={() => void integrations.reload()}
            />
            <LinearCard
              linear={integrations.data.linear}
              onChange={() => void integrations.reload()}
            />
          </div>
        ) : (
          <Skeleton className="h-40 rounded-card" />
        )}
      </section>

      {conns.error ? <ErrorNote>{errorMessage(conns.error)}</ErrorNote> : null}
      {list && list.length > 0 ? (
        <section aria-labelledby="yours-title">
          <h2 id="yours-title" className="eyebrow mb-3">
            Your apps
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className="group flex h-full w-full flex-col rounded-[16px] border border-line bg-surface p-5 text-left transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--slip-shadow)]"
                >
                  <div className="flex items-start gap-3.5">
                    <Monogram name={displayName(c)} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-serif text-[24px] leading-[1.1] text-fg">
                        {displayName(c)}
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
        </section>
      ) : !list && !conns.error ? (
        <Skeleton className="h-32 rounded-card" />
      ) : null}

      <AppDirectory
        version={version}
        onOpen={setOpenId}
        onConnected={() => void conns.reload()}
        onAuthorize={startOAuth}
      />

      <Sheet
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open ? displayName(open) : ""}
        description={open ? (hostOf(open.url) ?? open.url) : undefined}
        width={560}
      >
        {open ? (
          <ConnectionDetail
            connection={open}
            onChange={replace}
            onRemoved={() => {
              setOpenId(null);
              void changed();
            }}
            onReload={() => void conns.reload()}
          />
        ) : null}
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a custom server" width={600}>
        <AddConnection onAdd={add} />
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

/** The directory's name for it ("Jira & Confluence"), else its own name, tidied. */
const displayName = (c: Connection): string => c.title ?? humanizeName(c.name);

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
      else if (res.status === "active") toast(`${displayName(c)} is working`, "success");
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
          <p className="text-14 text-fg">Authorize {displayName(c)} so the agent can use it.</p>
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
            if (!window.confirm(`Remove ${displayName(c)}? The agent loses access to its tools.`))
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
  onAdd,
}: {
  onAdd: (b: { name: string; url: string; token?: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onAdd({
        name: name.trim(),
        url: url.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <p className="mb-4 text-13 text-fg-muted">
          Any remote MCP server (Streamable HTTP) that isn't in the app directory. OAuth is detected
          automatically; for servers that use API keys, paste one as the bearer token.
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
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <LoaderCircle className="anim-spin" /> : null}
            Connect
          </button>
        </form>
      </section>
    </div>
  );
}

/** "Drive", "Drive and Sheets", "Drive, Contacts and Sheets". */
const andList = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? "");

const GOOGLE_SETUP = "https://github.com/Taskmaster-1/SynapseAI/blob/main/docs/google.md";

/** Gmail, Calendar, Drive, Sheets and Contacts, built in: one OAuth consent, no MCP server to run. */
function GoogleCard({ google, onChange }: { google: GoogleIntegration; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const conn = google.connection;
  const connected = conn?.status === "active";
  // A grant from before Drive, Contacts or Sheets existed: those tools wait for a reconnect.
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
        "Disconnect Google? The agent loses access to Gmail, Calendar, Drive, Sheets and Contacts, and email automations stop.",
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
              : "Answer email, book meetings, read and write Docs and Sheets, look up contacts."}
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
            Reconnect to let the agent use {andList(missing.map((m) => m.label))}. Gmail and
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
  /** Connected before the agent tools existed, or Slack revoked the user token. */
  const needsReconnect = connected && !conn.agentTools;

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
    if (
      !window.confirm(
        "Disconnect Slack? Approvals stop arriving as Slack messages, and the agent loses access to Slack.",
      )
    )
      return;
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
              : "Approve from Slack, and let the agent search, read and post as you."}
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
              {connected && !needsReconnect ? (
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
      {needsReconnect ? (
        <p className="px-5 pb-3 text-13 text-fg">
          Reconnect Slack to let the agent search, read and post as you. Approvals keep arriving in
          Slack meanwhile.
        </p>
      ) : null}
      {!slack.available ? (
        <p className="border-t border-dashed border-line px-5 py-3.5 text-13 text-fg-muted">
          This server has no Slack app yet. Whoever runs it creates one from the manifest in the
          guide and sets <code className="font-mono text-12">SLACK_CLIENT_ID</code>,{" "}
          <code className="font-mono text-12">SLACK_CLIENT_SECRET</code> and{" "}
          <code className="font-mono text-12">SLACK_SIGNING_SECRET</code>.
        </p>
      ) : (
        <div className="border-t border-dashed border-line px-5 py-4">
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {slack.tools.map((t) => (
              <li key={t.name} className="flex items-center justify-between gap-3 text-13">
                <span className={connected && !needsReconnect ? "text-fg" : "text-fg-muted"}>
                  {t.title}
                </span>
                <EffectPill effect={t.effect} />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-13 text-fg-muted">
            {connected
              ? "When a task needs your OK, Synapse messages you in Slack. Only you can press its buttons, and the message updates wherever you decide. Posting as you asks for your OK by default."
              : "Synapse messages you about approvals, and the agent reads only the conversations you're in. Posting as you asks for your OK by default."}
          </p>
        </div>
      )}
    </article>
  );
}
