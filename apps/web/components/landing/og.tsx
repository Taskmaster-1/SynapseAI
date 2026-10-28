import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

/** Social card for the marketing pages: paper, ink, the brand check, and one line in blue. */
export function marketingOgImage({
  eyebrow,
  lines,
  accent,
}: {
  eyebrow: string;
  lines: string[];
  accent: string;
}) {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#f4f1ea",
        color: "#15140f",
        padding: "72px 80px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30 }}>
        <svg width="44" height="44" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M4.4 11.6 8.3 15.3 15.6 6.7"
            fill="none"
            stroke="#15140f"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="4.4" cy="11.6" r="2.3" fill="#15140f" />
          <circle cx="15.6" cy="6.7" r="2.6" fill="#3b48cc" />
        </svg>
        Synapse
        <span style={{ marginLeft: "auto", fontSize: 22, letterSpacing: 3, opacity: 0.6 }}>
          {eyebrow.toUpperCase()}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 84, lineHeight: 1.02 }}>
        {lines.map((l) => (
          <span key={l}>{l}</span>
        ))}
        <span style={{ color: "#3b48cc" }}>{accent}</span>
      </div>
      <div style={{ display: "flex", fontSize: 26, opacity: 0.65 }}>
        Open source · MIT · self-hosted · github.com/Taskmaster-1/SynapseAI
      </div>
    </div>,
    OG_SIZE,
  );
}
