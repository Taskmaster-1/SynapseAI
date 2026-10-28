import { marketingOgImage, OG_SIZE } from "@/components/landing/og";

export const alt =
  "Synapse trust and security: effects, rules, taint, approval and an undo window between the model and the world.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return marketingOgImage({
    eyebrow: "Trust",
    lines: ["The model proposes."],
    accent: "Code decides.",
  });
}
