"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Bot, Plus, LogOut, MessageSquare, Trash2, Loader2, Blocks } from "lucide-react";

interface Session { id: string; title: string | null; created_at: string | null; }

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

async function fetchSessions(token: string): Promise<Session[]> {
  const r = await fetch(`${API}/agent/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return [];
  const d = await r.json();
  return d.sessions ?? [];
}

async function deleteSession(id: string, token: string) {
  await fetch(`${API}/agent/sessions/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const activeId = searchParams.get("session");
  const [loading, setLoading] = useState(true);

  const setActiveId = (id: string | null) => {
    if (id) {
      router.push(`/dashboard?session=${id}`);
    } else {
      router.push("/dashboard");
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }: { data: { session: any } }) => {
      const session = data.session;
      if (!session) { router.push("/sign-in"); return; }
      setUser({
        email: session.user.email ?? "",
        name: session.user.user_metadata?.full_name ?? session.user.email ?? "User",
      });
      const list = await fetchSessions(session.access_token);
      setSessions(list);
      if (list.length > 0) setActiveId(list[0].id);
      setLoading(false);
    });
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/sign-in");
  };

  const handleNewSession = async () => {
    const { data }: { data: { session: any } } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) return;
    const r = await fetch(`${API}/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ title: null }),
    });
    if (r.ok) {
      const s = await r.json();
      setSessions(prev => [s, ...prev]);
      setActiveId(s.id);
    }
  };

  const handleDeleteSession = async (id: string) => {
    const { data }: { data: { session: any } } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) return;
    await deleteSession(id, session.access_token);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeId === id) setActiveId(sessions.find(s => s.id !== id)?.id ?? null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030303] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#030303] text-white overflow-hidden">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 flex flex-col border-r border-white/5 bg-white/[0.01]">
        {/* Logo + Navigation icons */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/20 group-hover:scale-105 transition-transform">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-black tracking-tight">
              Synapse<span className="gradient-text">AI</span>
            </span>
          </Link>
            <button
              onClick={handleNewSession}
              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-violet-500/20 text-white/40 hover:text-violet-400 flex items-center justify-center transition-all"
              title="New chat"
            >
              <Plus className="w-4 h-4" />
            </button>
        </div>

        {/* Sessions */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          {sessions.length === 0 ? (
            <div className="py-12 text-center px-4">
              <MessageSquare className="w-8 h-8 text-white/10 mx-auto mb-3" />
              <p className="text-xs text-white/20 font-bold uppercase tracking-wider mb-3">No chats yet</p>
              <button onClick={handleNewSession} className="text-xs text-violet-400 hover:text-violet-300 font-bold transition-colors">
                Start a conversation →
              </button>
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`group relative flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                  activeId === s.id
                    ? "bg-violet-500/10 border border-violet-500/20"
                    : "hover:bg-white/5 border border-transparent"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-bold truncate ${activeId === s.id ? "text-white" : "text-white/40"}`}>
                    {s.title ?? "New conversation"}
                  </p>
                  <p className="text-[10px] text-white/20 mt-0.5">
                    {s.created_at ? new Date(s.created_at).toLocaleDateString() : "Just now"}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                  className="opacity-0 group-hover:opacity-100 ml-1 p-1 rounded-lg hover:bg-rose-500/10 hover:text-rose-400 text-white/20 transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Integrations */}
        <div className="px-3 pb-2 border-t border-white/5 pt-3">
          <Link
            href="/dashboard/integrations"
            className="w-full flex items-center gap-2.5 p-3 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-all border border-blue-500/20 group"
          >
            <Blocks className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold">App Integrations</span>
          </Link>
        </div>

        {/* User / Logout */}
        <div className="p-3 border-t border-white/5">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-white/3 hover:bg-rose-500/10 hover:text-rose-400 transition-all group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/30 to-blue-500/30 flex items-center justify-center text-xs font-black text-violet-300 flex-shrink-0">
                {user?.name?.[0]?.toUpperCase() ?? "U"}
              </div>
              <span className="text-xs font-bold text-white/50 group-hover:text-rose-400 truncate transition-colors">
                {user?.name ?? "User"}
              </span>
            </div>
            <LogOut className="w-3.5 h-3.5 text-white/20 group-hover:text-rose-400 transition-colors flex-shrink-0" />
          </button>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}
