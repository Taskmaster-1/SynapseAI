"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api";
import { useChats } from "@/lib/chats-context";
import { Composer } from "./composer";

const SUGGESTIONS = [
  "Summarize my unread email from today and draft replies for anything urgent",
  "Find open GitHub issues assigned to me and group them by repo",
  "What's on my calendar this week? Flag any conflicts",
  "Search my knowledge base for our refund policy and explain it simply",
];

export function NewChat() {
  const router = useRouter();
  const toast = useToast();
  const { reload } = useChats();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  async function start(content: string) {
    const text = content.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { chat } = await api.createChat(text);
      void reload();
      router.push(`/c/${chat.id}`);
    } catch (err) {
      toast(errorMessage(err), "error");
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10">
        <div className="w-full max-w-2xl">
          <h1 className="mb-1 text-xl font-semibold">What should we get done?</h1>
          <p className="mb-6 text-fg-muted">
            SynapseAI works inside your connected tools. Anything that writes, sends or deletes
            waits for your approval unless your policy allows it.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={sending}
                onClick={() => void start(s)}
                className="card px-3 py-2.5 text-left text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-60"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-border">
        <div className="mx-auto w-full max-w-3xl px-4 py-3">
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => void start(draft)}
            active={false}
            sending={sending}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}
