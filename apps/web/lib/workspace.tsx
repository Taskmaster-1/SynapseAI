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
import {
  type Approval,
  api,
  type ChatSummary,
  isTeamAdmin,
  type SessionUser,
  type WorkspaceRole,
} from "@/lib/api";

interface WorkspaceValue {
  tasks: ChatSummary[] | null;
  /** Calls in your own tasks that you can decide. */
  approvals: Approval[] | null;
  /** Team admins only: other members' calls their team says an admin must decide. */
  teamApprovals: Approval[];
  /** Your calls that wait for a team admin; you can't decide them. */
  waitingForAdmin: Approval[];
  /** Two-person sign-offs you gave the first approval of; they wait for someone else. */
  waitingForSecond: Approval[];
  /** Your role in your team workspace, or null when you're not in one. */
  teamRole: WorkspaceRole | null;
  user: SessionUser | null;
  todaySpend: number | null;
  /** Refetch tasks + approvals (cheap; called after anything that changes them). */
  reload: () => Promise<void>;
  setUser: (u: SessionUser) => void;
}

const WorkspaceContext = createContext<WorkspaceValue>({
  tasks: null,
  approvals: null,
  teamApprovals: [],
  waitingForAdmin: [],
  waitingForSecond: [],
  teamRole: null,
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
  const [teamApprovals, setTeamApprovals] = useState<Approval[]>([]);
  const [waitingForAdmin, setWaitingForAdmin] = useState<Approval[]>([]);
  const [teamRole, setTeamRole] = useState<WorkspaceRole | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [todaySpend, setTodaySpend] = useState<number | null>(null);
  const pathname = usePathname();

  const reload = useCallback(async () => {
    const [t, a, u, w] = await Promise.allSettled([
      api.chats(),
      api.approvals(),
      api.usage(1),
      api.workspace(),
    ]);
    if (t.status === "fulfilled") setTasks(t.value.chats);
    const role = w.status === "fulfilled" ? w.value.role : null;
    setTeamRole(role);
    // Team admins also decide members' calls that need an admin, their own included.
    const team = isTeamAdmin(role)
      ? await api.teamApprovals().then(
          (r) => r.approvals,
          () => [],
        )
      : [];
    const teamIds = new Set(team.map((x) => x.toolCallId));
    if (a.status === "fulfilled") {
      const own = a.value.approvals;
      const ownIds = new Set(own.map((x) => x.toolCallId));
      // Out of the team (left since): its rules no longer govern you, so it's yours to decide.
      const waits = (x: Approval) =>
        x.approver === "admin" && role !== null && !teamIds.has(x.toolCallId);
      setApprovals(own.filter((x) => !waits(x)));
      setWaitingForAdmin(own.filter(waits));
      setTeamApprovals(team.filter((x) => !ownIds.has(x.toolCallId)));
    }
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

  // Scheduled reminders and the agent's sense of "today" need a time zone: until the user
  // picks one in Settings, use this device's. Checked once per device.
  useEffect(() => {
    if (!user) return;
    const key = `synapse-tz:${user.id}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {}
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    api
      .settings()
      .then(async (s) => {
        if (!s.timezone && zone) await api.saveSettings({ timezone: zone });
        try {
          localStorage.setItem(key, "1");
        } catch {}
      })
      .catch(() => {});
  }, [user]);

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

  const value = useMemo(() => {
    // Two-person sign-offs you gave the first approval of wait for someone else, not you.
    const mine = (a: Approval) => !!user && a.signoffs?.first?.id === user.id;
    return {
      tasks,
      approvals: approvals?.filter((a) => !mine(a)) ?? null,
      teamApprovals: teamApprovals.filter((a) => !mine(a)),
      waitingForAdmin,
      waitingForSecond: [...(approvals ?? []), ...teamApprovals].filter(mine),
      teamRole,
      user,
      todaySpend,
      reload,
      setUser: updateUser,
    };
  }, [
    tasks,
    approvals,
    teamApprovals,
    waitingForAdmin,
    teamRole,
    user,
    todaySpend,
    reload,
    updateUser,
  ]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
