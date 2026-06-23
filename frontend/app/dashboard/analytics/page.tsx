"use client";
// app/dashboard/analytics/page.tsx
import { useState, useEffect } from "react";
import Link from "next/link";
import { analyticsApi, type UsageSummary, type DailyUsage } from "@/lib/api";
export default function AnalyticsPage() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [timeline, setTimeline] = useState<DailyUsage[]>([]);
  const [period, setPeriod] = useState<"today" | "7d" | "30d">("30d");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    Promise.all([
      analyticsApi.usage(period),
      analyticsApi.timeline(period === "today" ? 1 : period === "7d" ? 7 : 30),
    ])
      .then(([s, t]) => {
        setSummary(s);
        setTimeline(t.days);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [period]);
  const maxTokens = Math.max(...timeline.map((d) => d.tokens), 1);
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0e1a",
        fontFamily: "'DM Sans', system-ui, sans-serif",
        color: "#c8d4e8",
      }}
    >
      <style>{`* { box-sizing: border-box; }`}</style>
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
          Analytics
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
          {(["today", "7d", "30d"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: "5px 14px",
                borderRadius: "6px",
                fontSize: "12px",
                background:
                  period === p ? "rgba(126,184,247,0.1)" : "transparent",
                border:
                  period === p
                    ? "1px solid rgba(126,184,247,0.2)"
                    : "1px solid rgba(255,255,255,0.07)",
                color: period === p ? "#7eb8f7" : "#555",
                cursor: "pointer",
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div
        style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}
      >
        {loading ? (
          <div style={{ color: "#444", fontSize: "13px" }}>
            Loading analytics…
          </div>
        ) : summary ? (
          <>
            {/* Summary cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "12px",
                marginBottom: "32px",
              }}
            >
              {[
                {
                  label: "Messages",
                  value: summary.total_messages.toLocaleString(),
                },
                {
                  label: "Agent turns",
                  value: summary.total_agent_turns.toLocaleString(),
                },
                {
                  label: "Tool calls",
                  value: summary.tool_call_count.toLocaleString(),
                },
                {
                  label: "Est. cost",
                  value: `$${summary.estimated_cost_usd.toFixed(4)}`,
                },
              ].map((card) => (
                <div
                  key={card.label}
                  style={{
                    padding: "20px",
                    borderRadius: "10px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#555",
                      marginBottom: "6px",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {card.label}
                  </div>
                  <div
                    style={{
                      fontSize: "22px",
                      fontWeight: 700,
                      color: "#e8edf5",
                    }}
                  >
                    {card.value}
                  </div>
                </div>
              ))}
            </div>
            {/* Token usage */}
            <div
              style={{
                padding: "20px",
                borderRadius: "10px",
                marginBottom: "20px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#e8edf5",
                  marginBottom: "16px",
                }}
              >
                Token usage
              </div>
              <div
                style={{ display: "flex", gap: "24px", marginBottom: "16px" }}
              >
                <div>
                  <div style={{ fontSize: "11px", color: "#555" }}>Input</div>
                  <div style={{ fontSize: "16px", color: "#7eb8f7" }}>
                    {summary.total_input_tokens.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "#555" }}>Output</div>
                  <div style={{ fontSize: "16px", color: "#4eca8a" }}>
                    {summary.total_output_tokens.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: "#555" }}>Total</div>
                  <div style={{ fontSize: "16px", color: "#e8edf5" }}>
                    {(
                      summary.total_input_tokens + summary.total_output_tokens
                    ).toLocaleString()}
                  </div>
                </div>
              </div>
              {/* Bar chart */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: "3px",
                  height: "80px",
                }}
              >
                {timeline.slice(-28).map((d, i) => (
                  <div
                    key={i}
                    title={`${d.date}: ${d.tokens.toLocaleString()} tokens`}
                    style={{
                      flex: 1,
                      borderRadius: "2px 2px 0 0",
                      background: "rgba(126,184,247,0.5)",
                      height: `${Math.max((d.tokens / maxTokens) * 100, 2)}%`,
                      transition: "height 0.3s",
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: "4px",
                }}
              >
                <span style={{ fontSize: "10px", color: "#444" }}>
                  {timeline[0]?.date}
                </span>
                <span style={{ fontSize: "10px", color: "#444" }}>
                  {timeline.at(-1)?.date}
                </span>
              </div>
            </div>
            {/* Most used tools */}
            {summary.most_used_tools.length > 0 && (
              <div
                style={{
                  padding: "20px",
                  borderRadius: "10px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#e8edf5",
                    marginBottom: "16px",
                  }}
                >
                  Most used tools
                </div>
                {summary.most_used_tools.map((t) => {
                  const max = summary.most_used_tools[0].count;
                  return (
                    <div key={t.name} style={{ marginBottom: "10px" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: "4px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "12px",
                            color: "#ccd6e8",
                            fontFamily: "monospace",
                          }}
                        >
                          {t.name.replace(/_/g, " ").toLowerCase()}
                        </span>
                        <span style={{ fontSize: "12px", color: "#555" }}>
                          {t.count}×
                        </span>
                      </div>
                      <div
                        style={{
                          height: "4px",
                          borderRadius: "2px",
                          background: "rgba(255,255,255,0.06)",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            borderRadius: "2px",
                            background: "rgba(126,184,247,0.5)",
                            width: `${(t.count / max) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#444", fontSize: "13px" }}>
            No data yet. Start chatting!
          </div>
        )}
      </div>
    </div>
  );
}
