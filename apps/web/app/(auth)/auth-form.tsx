"use client";

import { Check, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { Brand, EffectPill, Field, Monogram } from "@/components/ui";
import { type AppConfig, api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

function nextPath(): string {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next");
  // Only same-origin relative paths.
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** Static illustration of the product's core moment. Not interactive. */
function MockApproval() {
  return (
    <div aria-hidden="true" className="w-full max-w-[420px] select-none">
      <div className="mb-3 ml-auto w-fit max-w-[80%] rounded-[14px] rounded-br-[4px] bg-sunken px-3.5 py-2 text-13 text-fg">
        Tell Bob 3pm tomorrow works for me
      </div>
      <div className="overflow-hidden rounded-card border border-attention/35 bg-surface shadow-pop">
        <div className="bg-attention-soft px-4 py-3">
          <div className="flex items-center gap-2 text-12 font-medium text-attention">
            <span className="size-1.5 rounded-full bg-attention" />
            Needs your approval
          </div>
          <p className="mt-1 text-14 font-medium text-fg">
            Email bob@acme.com: “Re: Sync tomorrow?”
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-12 text-fg-muted">
            <Monogram name="gmail" size={16} />
            gmail
            <EffectPill effect="send" className="bg-surface/80" />
          </div>
        </div>
        <div className="space-y-1 border-t border-attention/20 px-4 py-3 text-13">
          <p>
            <span className="inline-block w-12 text-fg-muted">To</span>bob@acme.com
          </p>
          <p className="pt-1.5 leading-relaxed text-fg">
            Hi Bob,
            <br />
            3pm tomorrow works for me — talk then.
            <br />
            Ada
          </p>
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <span className="btn btn-primary btn-sm pointer-events-none">
            <Check className="size-3.5" />
            Approve
          </span>
          <span className="btn btn-sm pointer-events-none">Deny…</span>
        </div>
      </div>
    </div>
  );
}

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: name || email.split("@")[0]! });
    if (res.error) {
      setError(res.error.message ?? "Could not sign in");
      setBusy(false);
      return;
    }
    try {
      localStorage.removeItem("synapse-session");
    } catch {}
    window.location.href = nextPath();
  }

  async function social(provider: "github" | "google") {
    setError(null);
    const res = await authClient.signIn.social({
      provider,
      callbackURL: `${window.location.origin}${nextPath()}`,
    });
    if (res.error) setError(res.error.message ?? "Could not start sign-in");
  }

  const signupEnabled = config?.auth.signup !== false;
  const emailEnabled =
    (config?.auth.emailPassword ?? true) && (mode === "sign-in" || signupEnabled);
  const socials = (["github", "google"] as const).filter((p) => config?.auth[p]);

  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface px-12 py-10 lg:flex">
        <Brand />
        <div className="mx-auto w-full max-w-[460px]">
          <h2 className="font-serif text-[52px] leading-[1.02] tracking-[-0.015em] text-fg">
            An agent that asks
            <br />
            before it acts.
          </h2>
          <p className="mt-4 max-w-sm text-14 text-fg-muted">
            Hand off the busywork. Synapse works inside your tools and waits for your yes before it
            sends, changes or deletes anything.
          </p>
          <div className="mt-10">
            <MockApproval />
          </div>
        </div>
        <p className="text-12 text-fg-faint">Open source · runs on your own server</p>
      </aside>

      <main className="flex flex-col px-4 py-8 sm:px-8">
        <div className="lg:hidden">
          <Brand />
        </div>
        <div className="mx-auto flex w-full max-w-[360px] flex-1 flex-col justify-center py-10">
          <h1 className="font-serif text-40 leading-tight text-fg">
            {mode === "sign-in" ? "Welcome back." : "Create your account."}
          </h1>
          <p className="mt-2 mb-8 text-14 text-fg-muted">
            {mode === "sign-in"
              ? "Sign in to pick up where you left off."
              : "It takes a minute. Bring a task."}
          </p>

          {socials.length > 0 ? (
            <div className="mb-5 space-y-2">
              {socials.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="btn h-10 w-full"
                  onClick={() => void social(p)}
                >
                  Continue with {p === "github" ? "GitHub" : "Google"}
                </button>
              ))}
              {emailEnabled ? (
                <div className="flex items-center gap-3 pt-2 text-12 text-fg-faint">
                  <span className="h-px flex-1 bg-line" /> or{" "}
                  <span className="h-px flex-1 bg-line" />
                </div>
              ) : null}
            </div>
          ) : null}

          {mode === "sign-up" && !signupEnabled ? (
            <p className="mb-4 rounded-control bg-sunken px-3 py-2 text-13 text-fg-muted">
              Sign-ups are closed on this server. Ask the administrator for an account.
            </p>
          ) : null}

          {emailEnabled ? (
            <form onSubmit={onSubmit} className="space-y-4">
              {mode === "sign-up" ? (
                <Field label="Name" htmlFor="name">
                  <input
                    id="name"
                    className="input h-10"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
              ) : null}
              <Field label="Email" htmlFor="email">
                <input
                  id="email"
                  type="email"
                  required
                  className="input h-10"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field
                label="Password"
                htmlFor="password"
                hint={mode === "sign-up" ? "At least 8 characters." : undefined}
              >
                <input
                  id="password"
                  type="password"
                  required
                  minLength={mode === "sign-up" ? 8 : undefined}
                  className="input h-10"
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {error ? (
                <p role="alert" className="text-13 text-danger">
                  {error}
                </p>
              ) : null}
              <button type="submit" className="btn btn-primary h-10 w-full" disabled={busy}>
                {busy ? <LoaderCircle className="anim-spin size-4" /> : null}
                {mode === "sign-in" ? "Sign in" : "Create account"}
              </button>
            </form>
          ) : error ? (
            <p role="alert" className="text-13 text-danger">
              {error}
            </p>
          ) : null}

          <p className="mt-8 text-13 text-fg-muted">
            {mode === "sign-in" ? (
              signupEnabled ? (
                <>
                  New here?{" "}
                  <Link href="/sign-up" className="font-medium text-accent hover:underline">
                    Create an account
                  </Link>
                </>
              ) : null
            ) : (
              <>
                Already have an account?{" "}
                <Link href="/sign-in" className="font-medium text-accent hover:underline">
                  Sign in
                </Link>
              </>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
