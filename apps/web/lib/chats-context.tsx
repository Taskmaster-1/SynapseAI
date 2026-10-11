"use client";

import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, type ChatSummary } from "@/lib/api";

interface ChatsValue {
  chats: ChatSummary[] | null;
  pendingApprovals: number;
  reload: () => Promise<void>;
}

const ChatsContext = createContext<ChatsValue>({
  chats: null,
  pendingApprovals: 0,
  reload: async () => {},
});

export function useChats() {
  return useContext(ChatsContext);
}

/** Chat list shared by the sidebar and pages. 401 redirects to /sign-in (handled in lib/api). */
export function ChatsProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const pathname = usePathname();

  const reload = useCallback(async () => {
    try {
      const { chats } = await api.chats();
      setChats(chats);
    } catch {
      // keep the last list; 401 already redirected
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh on navigation
  useEffect(() => {
    void reload();
  }, [pathname, reload]);

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) void reload();
    };
    const timer = setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload]);

  const pendingApprovals = (chats ?? []).reduce((n, c) => n + c.pendingApprovals, 0);
  return (
    <ChatsContext.Provider value={{ chats, pendingApprovals, reload }}>
      {children}
    </ChatsContext.Provider>
  );
}
