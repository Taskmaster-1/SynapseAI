import { redirect } from "next/navigation";

/** Old chat URLs live on as tasks. */
export default async function LegacyChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  redirect(`/t/${encodeURIComponent(chatId)}`);
}
