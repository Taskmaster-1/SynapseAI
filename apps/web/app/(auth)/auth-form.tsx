"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { type AppConfig, api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

function nextPath(): string {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next");
  // Only same-origin relative paths.
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/";
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
  // Sign-up closed: the form is only useful for existing accounts.
  const emailEnabled =
    (config?.auth.emailPassword ?? true) && (mode === "sign-in" || signupEnabled);
  const socials = (["github", "google"] as const).filter((p) => config?.auth[p]);
  const title = mode === "sign-in" ? "Sign in to SynapseAI" : "Create your account";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold">{title}</h1>
        <p className="mb-6 text-fg-muted">
          An agent that works inside your tools — and asks before it acts.
        </p>
        {socials.length > 0 ? (
          <div className="mb-4 space-y-2">
            {socials.map((p) => (
              <button key={p} type="button" className="btn w-full" onClick={() => void social(p)}>
                Continue with {p === "github" ? "GitHub" : "Google"}
              </button>
            ))}
            {emailEnabled ? (
              <div className="flex items-center gap-3 py-1 text-xs text-fg-faint">
                <span className="h-px flex-1 bg-border" /> or{" "}
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
          </div>
        ) : null}
        {mode === "sign-up" && !signupEnabled ? (
          <p className="mb-4 rounded-md bg-subtle px-3 py-2 text-fg-muted">
            Sign-ups are closed on this server. Ask the administrator for an account.
          </p>
        ) : null}
        {emailEnabled ? (
          <form onSubmit={onSubmit} className="space-y-3">
            {mode === "sign-up" ? (
              <div>
                <label htmlFor="name" className="label">
                  Name
                </label>
                <input
                  id="name"
                  className="input"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            ) : null}
            <div>
              <label htmlFor="email" className="label">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                className="input"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={mode === "sign-up" ? 8 : undefined}
                className="input"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-danger-fg">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
            </button>
          </form>
        ) : error ? (
          <p role="alert" className="text-danger-fg">
            {error}
          </p>
        ) : null}
        <p className="mt-6 text-center text-fg-muted">
          {mode === "sign-in" ? (
            signupEnabled ? (
              <>
                New here?{" "}
                <Link href="/sign-up" className="text-accent hover:underline">
                  Create an account
                </Link>
              </>
            ) : null
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/sign-in" className="text-accent hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
