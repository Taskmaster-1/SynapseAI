import type { Metadata } from "next";
import { githubStars } from "@/components/landing/github";
import { TrustPage } from "@/components/landing/trust";

export const revalidate = 3600;

const TITLE = "Trust and security";
const DESCRIPTION =
  "How Synapse contains an AI agent: effects, rules, taint, approval and an undo window. The permission model, where your data lives, the audit trail, honest limits, and how to report a vulnerability.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: `${TITLE} · Synapse`, description: DESCRIPTION, type: "article" },
  twitter: { card: "summary_large_image", title: `${TITLE} · Synapse`, description: DESCRIPTION },
};

export default async function Trust() {
  return <TrustPage stars={await githubStars()} />;
}
