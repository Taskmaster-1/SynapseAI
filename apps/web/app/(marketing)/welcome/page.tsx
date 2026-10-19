import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";

export const metadata: Metadata = {
  title: { absolute: "Synapse: an AI agent that asks before it acts" },
  description:
    "Open-source AI agent for GitHub, Linear, Notion and any MCP server. It reads on its own and asks before anything is sent, changed or deleted. Self-host in one command.",
  openGraph: {
    title: "Synapse: an AI agent that asks before it acts",
    description:
      "Hand off real work across your tools. Approvals enforced in code, any model, self-hosted.",
    type: "website",
  },
};

export default function WelcomePage() {
  return <Landing />;
}
