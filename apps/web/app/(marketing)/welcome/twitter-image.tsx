import { marketingOgImage, OG_SIZE } from "@/components/landing/og";

export const alt =
  "Synapse: Hand off the work. Keep the last word. An open-source agent that asks before it acts.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return marketingOgImage({
    eyebrow: "Asks before it acts",
    lines: ["Hand off the work."],
    accent: "Keep the last word.",
  });
}
