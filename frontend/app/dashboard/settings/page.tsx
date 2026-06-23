"use client";
// app/dashboard/settings/page.tsx
// Replaces hardcoded connected booleans and fake preference saves
// with real Composio OAuth and backend preferences API.
import { useState, useEffect } from "react";
import Link from "next/link";
import { useIntegrations } from "@/hooks/use-integrations";
import { preferencesApi, type UserPreferences } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
type Tab = "integrations" | "preferences" | "account";
export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("integrations");
  const {
    integrations,
    connect,
    disconnect,
    loading: intLoading,
  } = useIntegrations();
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [prefLoading, setPrefLoading] = useState(true);
  const [prefSaving, setPrefSaving] = useState(false);
  const [prefSaved, setPrefSaved] = useState(false);
  // Load preferences
  useEffect(() => {
    preferencesApi
      .get()
      .then(setPrefs)
      .catch(console.error)
      .finally(() => setPrefLoading(false));
  }, []);
  const savePref = async <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) => {
    if (!prefs) return;
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    setPrefSaving(true);
    try {
      await preferencesApi.update({ [key]: value });
      setPrefSaved(true);
      setTimeout(() => setPrefSaved(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setPrefSaving(false);
    }
  };
  const TABS: { id: Tab; label: string }[] = [
    { id: "integrations", label: "Integrations" },
    { id: "preferences", label: "Preferences" },
    { id: "account", label: "Account" },
  ];
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0e1a",
        fontFamily: "'DM Sans', system-ui, sans-serif",
        color: "#c8d4e8",
      }}
    >
      <style>{`* { box-sizing: border-box; }
                                                                input, select, textarea { outline: none; }
                                                                a { text-decoration: none; }
                                                `}</style>
      {/* Header */}
      <div
        style={{
          padding: "16px 32px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <Link href="/dashboard" style={{ color: "#555", fontSize: "13px" }}>
          ← Dashboard
        </Link>
        <span style={{ color: "#333" }}>|</span>
        <span style={{ color: "#e8edf5", fontWeight: 600, fontSize: "15px" }}>
          Settings
        </span>
      </div>
      <div
        style={{ maxWidth: "760px", margin: "0 auto", padding: "32px 24px" }}
      >
        {/* Tabs */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "32px" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "8px 20px",
                borderRadius: "8px",
                fontSize: "13px",
                background:
                  tab === t.id ? "rgba(126,184,247,0.1)" : "transparent",
                border:
                  tab === t.id
                    ? "1px solid rgba(126,184,247,0.2)"
                    : "1px solid transparent",
                color: tab === t.id ? "#7eb8f7" : "#555",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* ── Integrations tab ───────────────────────────────────────────── */}
        {tab === "integrations" && (
          <div>
            <h2
              style={{
                color: "#e8edf5",
                fontSize: "16px",
                fontWeight: 600,
                marginBottom: "8px",
              }}
            >
              Connected tools
            </h2>
            <p
              style={{ color: "#555", fontSize: "13px", marginBottom: "24px" }}
            >
              Connect apps to let the agent act on your behalf. You'll be
              redirected to grant access via OAuth.
            </p>
            {intLoading ? (
              <div style={{ color: "#444", fontSize: "13px" }}>Loading…</div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                }}
              >
                {integrations.map((app) => (
                  <div
                    key={app.id}
                    style={{
                      padding: "16px",
                      borderRadius: "10px",
                      background: "rgba(255,255,255,0.03)",
                      border: app.connected
                        ? "1px solid rgba(78,202,138,0.25)"
                        : "1px solid rgba(255,255,255,0.07)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <div
                        style={{
                          width: "36px",
                          height: "36px",
                          borderRadius: "8px",
                          background: "rgba(255,255,255,0.05)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "16px",
                        }}
                      >
                        {app.icon}
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 600,
                            color: "#e8edf5",
                          }}
                        >
                          {app.name}
                        </div>
                        <div style={{ fontSize: "11px", color: "#555" }}>
                          {app.description}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        app.connected ? disconnect(app.id) : connect(app.id)
                      }
                      disabled={app.connecting}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        cursor: app.connecting ? "not-allowed" : "pointer",
                        fontWeight: 600,
                        transition: "all 0.15s",
                        flexShrink: 0,
                        ...(app.connected
                          ? {
                              background: "rgba(226,92,92,0.1)",
                              border: "1px solid rgba(226,92,92,0.3)",
                              color: "#e25c5c",
                            }
                          : {
                              background: app.connecting
                                ? "rgba(255,255,255,0.04)"
                                : "rgba(126,184,247,0.1)",
                              border: "1px solid rgba(126,184,247,0.25)",
                              color: app.connecting ? "#555" : "#7eb8f7",
                            }),
                      }}
                    >
                      {app.connecting
                        ? "Connecting…"
                        : app.connected
                          ? "Disconnect"
                          : "Connect"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* ── Preferences tab ────────────────────────────────────────────── */}
        {tab === "preferences" && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "24px",
              }}
            >
              <h2
                style={{ color: "#e8edf5", fontSize: "16px", fontWeight: 600 }}
              >
                Agent preferences
              </h2>
              {prefSaved && (
                <span style={{ fontSize: "12px", color: "#4eca8a" }}>
                  ✓ Saved
                </span>
              )}
            </div>
            {prefLoading || !prefs ? (
              <div style={{ color: "#444", fontSize: "13px" }}>Loading…</div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "24px",
                }}
              >
                {/* Agent tone */}
                <div>
                  <label
                    style={{
                      display: "block",
                      color: "#888",
                      fontSize: "12px",
                      marginBottom: "8px",
                    }}
                  >
                    Response tone
                  </label>
                  <div
                    style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
                  >
                    {(
                      ["professional", "casual", "concise", "detailed"] as const
                    ).map((t) => (
                      <button
                        key={t}
                        onClick={() => savePref("agent_tone", t)}
                        style={{
                          padding: "6px 16px",
                          borderRadius: "20px",
                          fontSize: "12px",
                          cursor: "pointer",
                          transition: "all 0.15s",
                          textTransform: "capitalize",
                          background:
                            prefs.agent_tone === t
                              ? "rgba(126,184,247,0.15)"
                              : "rgba(255,255,255,0.04)",
                          border:
                            prefs.agent_tone === t
                              ? "1px solid rgba(126,184,247,0.3)"
                              : "1px solid rgba(255,255,255,0.08)",
                          color: prefs.agent_tone === t ? "#7eb8f7" : "#666",
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Custom instructions */}
                <div>
                  <label
                    style={{
                      display: "block",
                      color: "#888",
                      fontSize: "12px",
                      marginBottom: "8px",
                    }}
                  >
                    Custom instructions
                    <span style={{ color: "#444", marginLeft: "8px" }}>
                      Appended to every system prompt
                    </span>
                  </label>
                  <textarea
                    value={prefs.agent_instructions ?? ""}
                    onChange={(e) =>
                      setPrefs((p) =>
                        p ? { ...p, agent_instructions: e.target.value } : p,
                      )
                    }
                    onBlur={(e) =>
                      savePref("agent_instructions", e.target.value || null)
                    }
                    placeholder="e.g. Always reply in bullet points. My name is Alex."
                    rows={3}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "#ccd6e8",
                      fontSize: "13px",
                      resize: "vertical",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
                {/* Timezone */}
                <div>
                  <label
                    style={{
                      display: "block",
                      color: "#888",
                      fontSize: "12px",
                      marginBottom: "8px",
                    }}
                  >
                    Timezone
                  </label>
                  <input
                    value={prefs.timezone}
                    onChange={(e) =>
                      setPrefs((p) =>
                        p ? { ...p, timezone: e.target.value } : p,
                      )
                    }
                    onBlur={(e) => savePref("timezone", e.target.value)}
                    placeholder="UTC"
                    style={{
                      padding: "8px 12px",
                      borderRadius: "8px",
                      width: "200px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "#ccd6e8",
                      fontSize: "13px",
                    }}
                  />
                </div>
                {/* Toggles */}
                {(
                  [
                    [
                      "confirm_before_send",
                      "Confirm before sending emails or messages",
                    ],
                    [
                      "auto_execute_safe_tools",
                      "Auto-execute read-only tools (no confirmation)",
                    ],
                    ["daily_digest_enabled", "Daily briefing email"],
                    ["email_notifications", "Email notifications"],
                  ] as [keyof UserPreferences, string][]
                ).map(([key, label]) => (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontSize: "13px", color: "#ccd6e8" }}>
                      {label}
                    </span>
                    <button
                      onClick={() =>
                        savePref(
                          key,
                          !prefs[key] as UserPreferences[typeof key],
                        )
                      }
                      style={{
                        width: "44px",
                        height: "24px",
                        borderRadius: "12px",
                        background: prefs[key]
                          ? "#1e5fa8"
                          : "rgba(255,255,255,0.08)",
                        border: "none",
                        cursor: "pointer",
                        position: "relative",
                        transition: "background 0.2s",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: "3px",
                          left: prefs[key] ? "22px" : "3px",
                          width: "18px",
                          height: "18px",
                          borderRadius: "50%",
                          background: "#fff",
                          transition: "left 0.2s",
                        }}
                      />
                    </button>
                  </div>
                ))}
                {/* Daily digest time */}
                {prefs.daily_digest_enabled && (
                  <div>
                    <label
                      style={{
                        display: "block",
                        color: "#888",
                        fontSize: "12px",
                        marginBottom: "8px",
                      }}
                    >
                      Digest time (HH:MM in your timezone)
                    </label>
                    <input
                      type="time"
                      value={prefs.daily_digest_time}
                      onChange={(e) =>
                        savePref("daily_digest_time", e.target.value)
                      }
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "#ccd6e8",
                        fontSize: "13px",
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* ── Account tab ────────────────────────────────────────────────── */}
        {tab === "account" && (
          <div>
            <h2
              style={{
                color: "#e8edf5",
                fontSize: "16px",
                fontWeight: 600,
                marginBottom: "24px",
              }}
            >
              Account
            </h2>
            <div
              style={{
                padding: "20px",
                borderRadius: "10px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                marginBottom: "16px",
              }}
            >
              <div
                style={{ fontSize: "13px", color: "#888", marginBottom: "4px" }}
              >
                Name
              </div>
              <div style={{ fontSize: "15px", color: "#e8edf5" }}>
                {user?.full_name ?? "—"}
              </div>
              <div
                style={{
                  fontSize: "13px",
                  color: "#888",
                  marginTop: "12px",
                  marginBottom: "4px",
                }}
              >
                Email
              </div>
              <div style={{ fontSize: "15px", color: "#e8edf5" }}>
                {user?.email ?? "—"}
              </div>
              <div
                style={{
                  fontSize: "13px",
                  color: "#888",
                  marginTop: "12px",
                  marginBottom: "4px",
                }}
              >
                Subscription
              </div>
              <div style={{ fontSize: "13px" }}>
                <span
                  style={{
                    padding: "3px 10px",
                    borderRadius: "20px",
                    fontSize: "11px",
                    background:
                      user?.subscription_status === "active"
                        ? "rgba(78,202,138,0.1)"
                        : "rgba(255,255,255,0.06)",
                    border: `1px solid ${user?.subscription_status === "active" ? "rgba(78,202,138,0.3)" : "rgba(255,255,255,0.1)"}`,
                    color:
                      user?.subscription_status === "active"
                        ? "#4eca8a"
                        : "#888",
                    textTransform: "capitalize",
                  }}
                >
                  {user?.subscription_status ?? "free"}
                </span>
              </div>
            </div>
            <Link
              href="/dashboard/billing"
              style={{
                display: "inline-block",
                padding: "10px 20px",
                borderRadius: "8px",
                background: "rgba(126,184,247,0.1)",
                border: "1px solid rgba(126,184,247,0.2)",
                color: "#7eb8f7",
                fontSize: "13px",
              }}
            >
              Manage billing →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
