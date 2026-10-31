"use client";

import { ExternalLink, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { EffectPill, Monogram, Pill } from "@/components/ui";
import { api, errorMessage, type GitHubIntegration } from "@/lib/api";

const GITHUB_SETUP = "https://github.com/Taskmaster-1/SynapseAI/blob/main/docs/github.md";

const STATUS = {
  active: { label: "Connected", tone: "ok" },
  needs_auth: { label: "Needs authorization", tone: "attention" },
  error: { label: "Error", tone: "danger" },
} as const;

/** Issues, pull requests and code on GitHub, built in: one OAuth consent, acting as you. */
export function GitHubCard({
  github,
  onChange,
}: {
  github: GitHubIntegration;
  onChange: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const conn = github.connection;
  const connected = conn?.status === "active";
  const status = conn ? STATUS[conn.status] : null;

  async function connect() {
    setBusy("connect");
    try {
      const { url } = await api.connectGitHub();
      // Same tab: the callback redirects back to /connections?connected=… or ?error=…
      window.location.href = url;
    } catch (err) {
      toast(errorMessage(err), "error");
      setBusy(null);
    }
  }

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect GitHub? The agent loses access to your issues, pull requests and code, and Synapse's access is revoked at GitHub.",
      )
    )
      return;
    setBusy("disconnect");
    try {
      await api.disconnectGitHub();
      toast("GitHub disconnected", "success");
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
        <Monogram name="GitHub" size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[24px] leading-[1.1] text-fg">GitHub</div>
          <div className="mt-0.5 truncate text-13 text-fg-muted">
            {conn
              ? `@${conn.account}`
              : "Triage issues and pull requests, read code, comment and file issues as you."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status ? (
            <Pill tone={status.tone}>
              <span className="size-1.5 rounded-full bg-current" />
              {status.label}
            </Pill>
          ) : null}
          {!github.available ? (
            <a href={GITHUB_SETUP} target="_blank" rel="noreferrer" className="btn btn-sm">
              Setup guide
              <ExternalLink className="size-3.5" />
            </a>
          ) : (
            <>
              {connected ? null : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy !== null}
                  onClick={() => void connect()}
                >
                  {busy === "connect" ? <LoaderCircle className="anim-spin size-3.5" /> : null}
                  {conn ? "Reconnect GitHub" : "Connect GitHub"}
                </button>
              )}
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
      {!github.available ? (
        <p className="border-t border-dashed border-line px-5 py-3.5 text-13 text-fg-muted">
          This server has no GitHub app yet. Whoever runs it sets{" "}
          <code className="font-mono text-12">GITHUB_CLIENT_ID</code> and{" "}
          <code className="font-mono text-12">GITHUB_CLIENT_SECRET</code> and adds this server's
          callback URL to the OAuth app.
        </p>
      ) : (
        <div className="border-t border-dashed border-line px-5 py-4">
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {github.tools.map((t) => (
              <li key={t.name} className="flex items-center justify-between gap-3 text-13">
                <span className={connected ? "text-fg" : "text-fg-muted"}>{t.title}</span>
                <EffectPill effect={t.effect} />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-13 text-fg-muted">
            The agent sees what your GitHub account can see. Comments, new issues and changes go out
            under your name and ask for your OK by default.
          </p>
        </div>
      )}
    </article>
  );
}
