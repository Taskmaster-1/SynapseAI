"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { Slip } from "@/components/landing/approval-slip";
import { Brand, Field } from "@/components/ui";
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
  // Switching between sign in and sign up keeps where to go after (e.g. an invite link).
  const [carry, setCarry] = useState("");

  useEffect(() => {
    const next = nextPath();
    setCarry(next === "/" ? "" : `?next=${encodeURIComponent(next)}`);
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
    <div className="landing grain grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-field-amber px-12 py-10 text-ink lg:flex">
        <Link href="/welcome" className="w-fit rounded-md" aria-label="Synapse home">
          <Brand animated />
        </Link>
        <div className="mx-auto w-full max-w-[520px]">
          <h2 className="font-serif text-[clamp(48px,4.6vw,72px)] leading-[0.95] tracking-[-0.02em]">
            <span className="landing-line">
              <span style={{ "--d": "80ms" } as CSSProperties}>Nothing leaves</span>
            </span>
            <span className="landing-line">
              <span className="italic" style={{ "--d": "180ms" } as CSSProperties}>
                without you.
              </span>
            </span>
          </h2>
          <Slip
            className="landing-rise mt-12 max-w-[440px]"
            style={{ "--d": "350ms" } as CSSProperties}
            stampDelay={1100}
          />
        </div>
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase opacity-70">
          Open source · MIT · runs on your server
        </p>
      </aside>

      <main className="flex flex-col px-4 py-8 sm:px-8">
        <div className="lg:hidden">
          <Link href="/welcome" className="w-fit rounded-md" aria-label="Synapse home">
            <Brand />
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-[360px] flex-1 flex-col justify-center py-10">
          <p className="eyebrow">{mode === "sign-in" ? "Sign in" : "Get started"}</p>
          <h1 className="mt-3 font-serif text-[52px] leading-[0.98] tracking-[-0.02em] text-fg">
            {mode === "sign-in" ? (
              <>
                Welcome <span className="italic">back.</span>
              </>
            ) : (
              <>
                Hand it <span className="italic">off.</span>
              </>
            )}
          </h1>
          <p className="mt-3 mb-9 text-14 text-fg-muted">
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
                  className="btn h-11 w-full"
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
                    className="input h-11"
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
                  className="input h-11"
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
                  className="input h-11"
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
              <button
                type="submit"
                className="btn btn-primary h-12 w-full text-[15px]"
                disabled={busy}
              >
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
                  <Link
                    href={`/sign-up${carry}`}
                    className="font-medium text-accent hover:underline"
                  >
                    Create an account
                  </Link>
                </>
              ) : null
            ) : (
              <>
                Already have an account?{" "}
                <Link href={`/sign-in${carry}`} className="font-medium text-accent hover:underline">
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
