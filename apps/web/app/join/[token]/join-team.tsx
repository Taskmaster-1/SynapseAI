"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/ui";
import { api, errorMessage, type SessionUser, type WorkspaceInfo } from "@/lib/api";

/**
 * Accepting an invite link. Signed out: sign in (or up) first, then come back here.
 * Joining is a deliberate click, never automatic: it puts you under the team's rules.
 */
export function JoinTeam({ token }: { token: string }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<WorkspaceInfo | null>(null);

  useEffect(() => {
    api
      .session()
      .then((s) => {
        if (s) return setUser(s.user);
        setUser(null);
        const next = encodeURIComponent(`/join/${token}`);
        window.location.replace(`/sign-in?next=${next}`);
      })
      .catch(() => setUser(null));
  }, [token]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      setJoined(await api.joinWorkspace(token));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grain flex min-h-dvh items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-[480px]">
        <div className="mb-8">
          <Brand />
        </div>
        <section className="slip px-6 py-7">
          <p className="eyebrow">Team invite</p>
          {joined ? (
            <>
              <h1 className="mt-3 font-serif text-[34px] leading-tight text-fg">
                You're in {joined.workspace?.name}.
              </h1>
              <p className="mt-3 text-14 text-fg-muted">
                Your team's rules now apply to your tasks. When one needs an admin to sign off,
                you'll see it waiting in your inbox.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link href="/settings?section=team" className="btn btn-primary">
                  See your team
                  <ArrowRight className="size-3.5" />
                </Link>
                <Link href="/" className="btn btn-ghost">
                  Home
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="mt-3 font-serif text-[34px] leading-tight text-fg">
                Join a team on Synapse
              </h1>
              <ul className="mt-4 space-y-2 text-14 text-fg-muted">
                <li>The team's approval rules apply to every task you run, on top of yours.</li>
                <li>Some actions may need a team admin to sign off before they run.</li>
                <li>Admins can export an audit log of the actions your tasks take.</li>
                <li>Your tasks, connections and memory stay yours.</li>
              </ul>
              {user ? <p className="mt-5 text-13 text-fg-faint">Joining as {user.email}</p> : null}
              {error ? (
                <p role="alert" className="mt-4 text-13 text-danger">
                  {error}
                </p>
              ) : null}
              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!user || busy}
                  onClick={() => void join()}
                >
                  {busy || user === undefined ? <LoaderCircle className="anim-spin" /> : null}
                  {busy ? "Joining…" : "Join team"}
                </button>
                <Link href="/" className="btn btn-ghost">
                  Not now
                </Link>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
