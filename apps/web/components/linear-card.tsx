"use client";

import { ExternalLink, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { EffectPill, Monogram, Pill } from "@/components/ui";
import { api, errorMessage, type LinearIntegration } from "@/lib/api";

const LINEAR_SETUP = "https://github.com/Taskmaster-1/SynapseAI/blob/main/docs/linear.md";

const STATUS = {
  active: { label: "Connected", tone: "ok" },
  needs_auth: { label: "Needs authorization", tone: "attention" },
  error: { label: "Error", tone: "danger" },
} as const;

/** Linear, built in: search, read and file issues as the person, one OAuth consent. */
export function LinearCard({
  linear,
  onChange,
}: {
  linear: LinearIntegration;
  onChange: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const conn = linear.connection;
  const connected = conn?.status === "active";
  const status = conn ? STATUS[conn.status] : null;

  async function connect() {
    setBusy("connect");
    try {
      const { url } = await api.connectLinear();
      // Same tab: the callback redirects back to /connections?connected=linear or ?error=…
      window.location.href = url;
    } catch (err) {
      toast(errorMessage(err), "error");
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Linear? The agent loses access to your Linear issues.")) return;
    setBusy("disconnect");
    try {
      await api.disconnectLinear();
      toast("Linear disconnected", "success");
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
        <Monogram name="Linear" size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[24px] leading-[1.1] text-fg">Linear</div>
          <div className="mt-0.5 truncate text-13 text-fg-muted">
            {conn
              ? [conn.workspace && `${conn.workspace} workspace`, conn.name ?? conn.account]
                  .filter(Boolean)
                  .join(" · ")
              : "Find, read and triage issues, file new ones and comment, as you."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status ? (
            <Pill tone={status.tone}>
              <span className="size-1.5 rounded-full bg-current" />
              {status.label}
            </Pill>
          ) : null}
          {!linear.available ? (
            <a href={LINEAR_SETUP} target="_blank" rel="noreferrer" className="btn btn-sm">
              Setup guide
              <ExternalLink className="size-3.5" />
            </a>
          ) : (
            <>
              {!connected ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy !== null}
                  onClick={() => void connect()}
                >
                  {busy === "connect" ? <LoaderCircle className="anim-spin size-3.5" /> : null}
                  {conn ? "Reconnect Linear" : "Connect Linear"}
                </button>
              ) : null}
              {conn ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-danger"
                  disabled={busy !== null}
                  onClick={() => void disconnect()}
                >
                  {busy === "disconnect" ? <LoaderCircle className="anim-spin size-3.5" /> : null}
                  Disconnect
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
      {conn?.lastError && !connected ? (
        <p className="px-5 pb-3 text-13 text-danger">{conn.lastError}</p>
      ) : null}
      {!linear.available ? (
        <p className="border-t border-dashed border-line px-5 py-3.5 text-13 text-fg-muted">
          This server has no Linear app yet. Whoever runs it creates an OAuth app in Linear and sets{" "}
          <code className="font-mono text-12">LINEAR_CLIENT_ID</code> and{" "}
          <code className="font-mono text-12">LINEAR_CLIENT_SECRET</code>.
        </p>
      ) : (
        <div className="border-t border-dashed border-line px-5 py-4">
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {linear.tools.map((t) => (
              <li key={t.name} className="flex items-center justify-between gap-3 text-13">
                <span className={connected ? "text-fg" : "text-fg-muted"}>{t.title}</span>
                <EffectPill effect={t.effect} />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-13 text-fg-muted">
            The agent sees what you can see in Linear. Creating, changing and commenting on issues
            asks for your OK by default.
          </p>
        </div>
      )}
    </article>
  );
}
