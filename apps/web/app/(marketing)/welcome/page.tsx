import type { Metadata } from "next";
import { githubStars } from "@/components/landing/github";
import { Landing } from "@/components/landing/landing";

// Static, re-rendered at most hourly so the GitHub star count stays fresh.
export const revalidate = 3600;

const TITLE = "Synapse: the open-source agent that asks before it acts";
const DESCRIPTION =
  "An open-source AI agent for Gmail, Calendar and any MCP server. It reads on its own, asks before anything is sent, changed or deleted, asks less as it learns your rules, and gives you ten seconds to undo. Self-host in one command.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description:
      "Approve from your phone, Slack or the app. Learned rules, plan approval, an undo window, and a policy prompt injection can't talk its way past.",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function WelcomePage() {
  return <Landing stars={await githubStars()} />;
}
