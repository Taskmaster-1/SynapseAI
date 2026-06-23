// hooks/use-agent-ws.ts
// WebSocket hook — uses Supabase session token for auth
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  streaming?: boolean;
  timestamp: Date;
  confirmation?: {
    id: string;
    action: string;
    summary: string;
    status: "pending" | "approved" | "rejected";
  };
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "typing";

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

interface Options {
  onSessionReady?: (sessionId: string) => void;
  activeSessionId?: string;
}

export function useAgentWS({ onSessionReady, activeSessionId }: Options = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [sessionId, setSessionId] = useState<string | null>(null);

  const wsRef          = useRef<WebSocket | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const reconnectRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectingRef  = useRef(false);
  const sessionIdRef   = useRef<string | null>(null);
  const pendingRef     = useRef<string | null>(null);

  // keep ref in sync
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Handle external session changes
  useEffect(() => {
    if (activeSessionId && activeSessionId !== sessionId) {
      setSessionId(activeSessionId);
      setMessages([]); // Clear immediately to prevent old history from persisting
      
      // Fetch history
      const fetchHistory = async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.access_token) return;
          
          const r = await fetch(`${env.WS_BASE_URL.replace('ws', 'http')}/api/v1/agent/sessions/${activeSessionId}/history`, {
            headers: { Authorization: `Bearer ${session.access_token}` }
          });
          if (r.ok) {
            const data = await r.json();
            // Convert to ChatMessage format
            const history = (data.messages || []).map((m: any) => ({
              id: m.id || newId(),
              role: m.role,
              content: m.content,
              timestamp: new Date(m.created_at || Date.now()),
            }));
            setMessages(history);
          }
        } catch (err) {
          console.error("Failed to load history", err);
        }
      };
      fetchHistory();

      // Switch on WS if connected
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "switch_session", session_id: activeSessionId }));
      }
    }
  }, [activeSessionId, sessionId]);

  // ── message helpers ───────────────────────────────────────────────────────

  const appendMessage = (msg: Omit<ChatMessage, "id" | "timestamp">) =>
    setMessages(prev => [...prev, { id: newId(), timestamp: new Date(), ...msg }]);

  const appendChunk = useCallback((text: string) => {
    setMessages(prev => {
      const id = streamingIdRef.current;
      if (!id) {
        const nid = newId();
        streamingIdRef.current = nid;
        return [...prev, { id: nid, role: "assistant", content: text, streaming: true, timestamp: new Date() }];
      }
      return prev.map(m => m.id === id ? { ...m, content: m.content + text } : m);
    });
  }, []);

  const finalizeMsg = useCallback(() => {
    setMessages(prev => prev.map(m =>
      m.id === streamingIdRef.current ? { ...m, streaming: false } : m
    ));
    streamingIdRef.current = null;
  }, []);

  // ── connect ───────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (connectingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    connectingRef.current = true;
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }

    setStatus("connecting");

    // Get fresh Supabase token
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setStatus("disconnected");
      connectingRef.current = false;
      window.location.href = "/sign-in";
      return;
    }

    const ws = new WebSocket(`${env.WS_BASE_URL}/agent/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected. Sending auth message...");
      ws.send(JSON.stringify({ type: "auth", token }));
    };

    ws.onmessage = (e: MessageEvent) => {
      console.log("WebSocket message received:", e.data);
      let data: Record<string, unknown>;
      try { data = JSON.parse(e.data); } catch { return; }

      switch (data.type as string) {
        case "session_ready": {
          connectingRef.current = false;
          setStatus("connected");
          const sid = data.session_id as string | undefined;
          if (sid) {
            setSessionId(sid);
            sessionIdRef.current = sid;
            onSessionReady?.(sid);
          }
          // flush pending message
          if (pendingRef.current && ws.readyState === WebSocket.OPEN) {
            const msg = pendingRef.current;
            pendingRef.current = null;
            ws.send(JSON.stringify({ type: "chat", message: msg, session_id: sessionIdRef.current }));
          }
          break;
        }
        case "chunk":
          setStatus("typing");
          {
            const text = data.text as string;
            if (!streamingIdRef.current) {
              streamingIdRef.current = newId();
            }
            const sid = streamingIdRef.current;
            setMessages(prev => {
              const existing = prev.find(m => m.id === sid);
              if (!existing) {
                return [...prev, { id: sid, role: "assistant", content: text, streaming: true, timestamp: new Date() }];
              }
              return prev.map(m => m.id === sid ? { ...m, content: m.content + text } : m);
            });
          }
          break;
        case "tool_call":
          setStatus("typing");
          {
            const name = data.name as string;
            const id = newId();
            setMessages(prev => [...prev, { id, role: "system", content: `Calling tool: **${name}**...`, timestamp: new Date() }]);
          }
          break;
        case "require_confirmation":
          setStatus("connected");
          {
            const id = newId();
            setMessages(prev => [...prev, { 
              id, 
              role: "assistant", 
              content: data.summary as string,
              timestamp: new Date(),
              confirmation: {
                id: data.id as string,
                action: data.action as string,
                summary: data.summary as string,
                status: "pending"
              }
            }]);
          }
          break;
        case "turn_done":
          setStatus("connected");
          {
            const sid = streamingIdRef.current;
            if (sid) {
              setMessages(prev => prev.map(m => m.id === sid ? { ...m, streaming: false } : m));
              streamingIdRef.current = null;
            }
          }
          break;
        case "error": {
          setStatus("connected");
          streamingIdRef.current = null;
          const detail = data.detail as string;
          appendMessage({ role: "system", content: `⚠ ${detail}` });
          break;
        }
        case "pong": break;
      }
    };

    ws.onclose = (ev) => {
      connectingRef.current = false;
      setStatus("disconnected");
      if (ev.code !== 4001 && !reconnectRef.current) {
        reconnectRef.current = setTimeout(() => { reconnectRef.current = null; connect(); }, 3000);
      }
    };

    ws.onerror = () => { connectingRef.current = false; setStatus("disconnected"); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // auto-connect + ping
  useEffect(() => {
    connect();
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 25_000);
    return () => {
      clearInterval(ping);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // ── send ──────────────────────────────────────────────────────────────────

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    appendMessage({ role: "user", content: text });

    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      pendingRef.current = text;
      connect();
      return;
    }
    wsRef.current.send(JSON.stringify({
      type: "chat",
      message: text,
      session_id: sessionIdRef.current,
    }));
  }, [connect]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmAction = useCallback((confirmationId: string, approved: boolean) => {
    // Update local UI state
    setMessages(prev => prev.map(m => {
      if (m.confirmation?.id === confirmationId) {
        return { 
          ...m, 
          confirmation: { ...m.confirmation, status: approved ? "approved" : "rejected" } 
        };
      }
      return m;
    }));

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "confirm_action",
        confirmation_id: confirmationId,
        approved,
        session_id: sessionIdRef.current,
      }));
    }
  }, []);

  const clearMessages = () => { setMessages([]); streamingIdRef.current = null; };

  return { messages, status, sessionId, sendMessage, confirmAction, clearMessages };
}
