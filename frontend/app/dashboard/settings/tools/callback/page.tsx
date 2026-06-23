"use client";
// app/dashboard/settings/tools/callback/page.tsx
// Composio redirects here after OAuth. Shows success/error and redirects.
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
export default function OAuthCallbackPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [msg, setMsg] = useState("Completing connection…");
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      setOk(true);
      setMsg(`${connected} connected successfully!`);
      setTimeout(
        () => router.push("/dashboard/settings?tab=integrations"),
        2000,
      );
    } else if (error) {
      setOk(false);
      setMsg(`Connection failed: ${error}`);
      setTimeout(
        () => router.push("/dashboard/settings?tab=integrations"),
        3000,
      );
    } else {
      setOk(null);
      setMsg("Processing…");
      setTimeout(() => router.push("/dashboard/settings"), 3000);
    }
  }, [params, router]);
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0e1a",
        fontFamily: "system-ui",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      <div style={{ fontSize: "32px" }}>
        {ok === null ? "⏳" : ok ? "✅" : "❌"}
      </div>
      <div
        style={{
          color: ok === false ? "#e25c5c" : "#ccd6e8",
          fontSize: "15px",
        }}
      >
        {msg}
      </div>
      <div style={{ fontSize: "12px", color: "#444" }}>Redirecting…</div>
    </div>
  );
}
