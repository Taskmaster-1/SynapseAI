import type { Metadata } from "next";
import { JoinTeam } from "./join-team";

export const metadata: Metadata = { title: "Join a team" };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinTeam token={token} />;
}
