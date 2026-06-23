"use client";
import { useRef, useEffect, useState, useCallback } from "react";
import { Bot, Send, User, Sparkles, Loader2, Check, X, AlertTriangle, Paperclip } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useAgentWS, type ChatMessage } from "@/hooks/use-agent-ws";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center bg-[#030303]"><Loader2 className="w-8 h-8 animate-spin text-violet-400" /></div>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const searchParams = useSearchParams();
  const activeSessionId = searchParams.get("session") || undefined;

  const { messages, status, sendMessage, confirmAction } = useAgentWS({ activeSessionId });
  const [uploading, setUploading] = useState(false);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || status === "connecting") return;
    setInput("");
    sendMessage(text);
    if (textareaRef.current) {
        textareaRef.current.style.height = "40px";
    }
  }, [input, status, sendMessage]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const { supabase } = await import("@/lib/supabase");
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const resp = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/files/upload`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: formData,
      });

      if (resp.ok) {
        sendMessage(`[Uploaded file: ${file.name}] - Please analyze this document.`);
      } else {
        console.error("Upload failed");
      }
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const statusConfig = {
    disconnected: { dot: "bg-rose-400", label: "Reconnecting…", pulse: true },
    connecting:   { dot: "bg-amber-400", label: "Connecting…", pulse: true },
    connected:    { dot: "bg-emerald-400", label: "Ready", pulse: false },
    typing:       { dot: "bg-blue-400", label: "Thinking…", pulse: true },
  }[status ?? "disconnected"];

  const suggestions = [
    "What can you help me with?",
    "Summarize my unread emails",
    "What's on my calendar today?",
    "Check my GitHub PRs",
  ];

  return (
    <div className="flex flex-col h-full bg-[#030303]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 glass sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-black text-white tracking-tight leading-none">SynapseAI</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot} ${statusConfig.pulse ? "animate-pulse" : ""}`} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">
                {statusConfig.label}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full pb-20 text-center">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-violet-600/5 rounded-full blur-[80px] pointer-events-none" />
            <div className="relative">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center mb-6 ring-1 ring-white/10 shadow-2xl mx-auto">
                <Sparkles className="w-10 h-10 text-violet-400" />
              </div>
              <h2 className="text-2xl font-black text-white mb-2 tracking-tight">How can I help?</h2>
              <p className="text-white/30 text-sm font-medium mb-8 max-w-xs">
                Ask me anything — I can manage your apps, answer questions, and more.
              </p>
              <div className="grid grid-cols-2 gap-2.5 max-w-md mx-auto">
                {suggestions.map(s => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                    className="p-3.5 rounded-2xl glass border border-white/5 text-xs text-white/50 hover:text-white hover:border-violet-500/20 hover:bg-violet-500/5 transition-all text-left font-semibold"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map(msg => <MessageBubble key={msg.id} msg={msg} onConfirm={confirmAction} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/5 bg-gradient-to-t from-[#030303] to-transparent">
        <div className="relative group max-w-4xl mx-auto">
          <div className="absolute -inset-px bg-gradient-to-r from-violet-500/30 to-blue-500/30 rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 blur-sm" />
          <div className="relative flex items-end gap-3 bg-white/[0.04] border border-white/8 rounded-2xl p-3 group-focus-within:border-violet-500/30 transition-colors">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
              accept=".pdf,.csv,.txt,.md"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5 transition-all disabled:opacity-20"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKey}
              placeholder="Message SynapseAI…"
              rows={1}
              className="flex-1 bg-transparent border-0 focus:ring-0 outline-none text-white placeholder:text-white/20 px-2 py-2 text-sm resize-none font-medium leading-relaxed"
              style={{ minHeight: "40px", maxHeight: "160px" }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || status === "connecting"}
              className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-violet-500 to-blue-500 text-white shadow-lg shadow-violet-500/20 hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {status === "typing" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
        <p className="text-center mt-2 text-[10px] text-white/15 font-bold uppercase tracking-widest">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ msg, onConfirm }: { msg: ChatMessage, onConfirm?: (id: string, approved: boolean) => void }) {
  const isUser   = msg.role === "user";
  const isSystem = msg.role === "system";
  const conf     = msg.confirmation;

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 font-medium max-w-sm text-center">
          <ReactMarkdown
            components={{
              strong: ({children}) => <strong className="font-black text-amber-300">{children}</strong>,
            }}
          >
            {msg.content}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-end gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center ${
        isUser
          ? "bg-white/8 ring-1 ring-white/10"
          : "bg-gradient-to-br from-violet-500 to-blue-500 shadow-lg shadow-violet-500/20"
      }`}>
        {isUser ? <User className="w-4 h-4 text-white/50" /> : <Bot className="w-4 h-4 text-white" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm leading-relaxed font-medium overflow-hidden ${
        isUser
          ? "bg-violet-500 text-white rounded-br-sm shadow-lg shadow-violet-500/15"
          : "glass border border-white/8 text-white/85 rounded-bl-sm"
      }`}>
        {isUser ? (
          <span className="whitespace-pre-wrap text-white">{msg.content}</span>
        ) : (
          <div className="prose prose-invert prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl max-w-none text-sm font-medium">
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({children}) => <p className="mb-2 last:mb-0 text-white/90">{children}</p>,
                a: ({href, children}) => <a href={href} target="_blank" rel="noreferrer" className="text-violet-400 hover:text-violet-300 underline underline-offset-2">{children}</a>,
                code: ({className, children}) => {
                  const isInline = !className;
                  return isInline 
                    ? <code className="bg-white/10 px-1.5 py-0.5 rounded-md text-xs font-mono">{children}</code>
                    : <code className="block bg-black/50 p-3 rounded-xl border border-white/10 text-xs font-mono overflow-x-auto my-2">{children}</code>
                },
                ul: ({children}) => <ul className="list-disc pl-4 mb-2 space-y-1 marker:text-white/30 text-white/90">{children}</ul>,
                ol: ({children}) => <ol className="list-decimal pl-4 mb-2 space-y-1 marker:text-white/30 text-white/90">{children}</ol>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          </div>
        )}

        {/* 🛡️ Confirmation Card */}
        {conf && (
          <div className="mt-4 p-4 rounded-xl bg-white/[0.03] border border-white/10 shadow-inner">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                Action Required
              </span>
            </div>
            
            <div className="text-xs text-white/70 mb-4 leading-normal">
              <ReactMarkdown 
                components={{
                  strong: ({children}) => <strong className="font-black text-white">{children}</strong>
                }}
              >
                {conf.summary}
              </ReactMarkdown>
            </div>

            {conf.status === "pending" ? (
              <div className="flex gap-2">
                <button
                  onClick={() => onConfirm?.(conf.id, true)}
                  className="flex-1 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[11px] font-bold transition-colors flex items-center justify-center gap-1.5 border border-emerald-500/20"
                >
                  <Check className="w-3.5 h-3.5" />
                  Approve
                </button>
                <button
                  onClick={() => onConfirm?.(conf.id, false)}
                  className="flex-1 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] font-bold transition-colors flex items-center justify-center gap-1.5 border border-rose-500/20"
                >
                  <X className="w-3.5 h-3.5" />
                  Reject
                </button>
              </div>
            ) : (
              <div className={`py-2 rounded-lg text-center text-[11px] font-bold flex items-center justify-center gap-1.5 border ${
                conf.status === "approved" 
                  ? "bg-emerald-500/5 text-emerald-500/50 border-emerald-500/10" 
                  : "bg-rose-500/5 text-rose-500/50 border-rose-500/10"
              }`}>
                {conf.status === "approved" ? (
                  <><Check className="w-3.5 h-3.5" /> Approved</>
                ) : (
                  <><X className="w-3.5 h-3.5" /> Rejected</>
                )}
              </div>
            )}
          </div>
        )}

        {msg.streaming && (
          <span className="inline-block w-1 h-4 bg-violet-400 ml-1 animate-pulse align-middle rounded-full" />
        )}
      </div>
    </div>
  );
}
