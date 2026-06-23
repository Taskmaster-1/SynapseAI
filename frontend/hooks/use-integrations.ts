"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export function useIntegrations() {
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchIntegrations = async () => {
    try {
      const { data }: { data: { session: any } } = await supabase.auth.getSession();
      const session = data.session;
      if (!session) return;

      const r = await fetch(`${API_BASE}/agent/tools/connected`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) throw new Error("Failed to fetch");
      const { connected, available } = await r.json();
      
      const apps = available.map((id: string) => ({
        id,
        name: id,
        connected: connected.includes(id),
        connecting: false,
      }));
      setIntegrations(apps);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIntegrations();
  }, []);

  const connect = async (appId: string) => {
    const { data: sessionData }: { data: { session: any } } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) return;

    const r = await fetch(`${API_BASE}/agent/tools/connect`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}` 
      },
      body: JSON.stringify({ app: appId }),
    });
    const data = await r.json();
    if (data.auth_url) window.location.href = data.auth_url;
  };

  const disconnect = async (appId: string) => {
    const { data: sessionData }: { data: { session: any } } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) return;

    await fetch(`${API_BASE}/agent/tools/disconnect`, {
      method: "DELETE",
      headers: { 
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}` 
      },
      body: JSON.stringify({ app: appId }),
    });
    setIntegrations(prev => prev.map(a => a.id === appId ? { ...a, connected: false } : a));
  };

  return { integrations, loading, connect, disconnect, refresh: fetchIntegrations };
}
