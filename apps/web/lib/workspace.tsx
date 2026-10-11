"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type Approval, api, type ChatSummary, type SessionUser } from "@/lib/api";

interface WorkspaceValue {
  tasks: ChatSummary[] | null;
  approvals: Approval[] | null;
  user: SessionUser | null;
  todaySpend: number | null;
  /** Refetch tasks + approvals (cheap; called after anything that changes them). */
  reload: () => Promise<void>;
  setUser: (u: SessionUser) => void;
}

const WorkspaceContext = createContext<WorkspaceValue>({
  tasks: null,
  approvals: null,
  user: null,
  todaySpend: null,
  reload: async () => {},
  setUser: () => {},
});

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

const SESSION_KEY = "synapse-session";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** Tasks, pending approvals and the signed-in user, shared by the rail and pages. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<ChatSummary[] | null>(null);
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [todaySpend, setTodaySpend] = useState<number | null>(null);
  const pathname = usePathname();

  const reload = useCallback(async () => {
    const [t, a, u] = await Promise.allSettled([api.chats(), api.approvals(), api.usage(1)]);
    if (t.status === "fulfilled") setTasks(t.value.chats);
    if (a.status === "fulfilled") setApprovals(a.value.approvals);
    if (u.status === "fulfilled") {
      const day = u.value.days.find((d) => d.date === todayKey());
      setTodaySpend(day?.costUsd ?? 0);
    }
  }, []);

  // The session rarely changes; cache it briefly so every page load isn't an auth round-trip.
  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as {
        at: number;
        user: SessionUser;
      } | null;
      if (cached && Date.now() - cached.at < 5 * 60_000) {
        setUser(cached.user);
        return;
      }
    } catch {
      // ignore unreadable cache
    }
    api
      .session()
      .then((s) => {
        if (!s) return;
        setUser(s.user);
        try {
          localStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now(), user: s.user }));
        } catch {}
      })
      .catch(() => {});
  }, []);

  const updateUser = useCallback((u: SessionUser) => {
    setUser(u);
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now(), user: u }));
    } catch {}
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

  const value = useMemo(
    () => ({ tasks, approvals, user, todaySpend, reload, setUser: updateUser }),
    [tasks, approvals, user, todaySpend, reload, updateUser],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
