"use client";

import { useIntegrations } from "@/hooks/use-integrations";
import { Loader2, Bot, Link as LinkIcon, Unlink, Mail, Calendar, Slack, Github, PenTool as Tool, CheckCircle2 } from "lucide-react";

const getAppIcon = (id: string) => {
  const normalized = id.toLowerCase();
  if (normalized.includes("gmail")) return Mail;
  if (normalized.includes("calendar")) return Calendar;
  if (normalized.includes("slack")) return Slack;
  if (normalized.includes("github")) return Github;
  return Tool;
};

export default function IntegrationsPage() {
  const { integrations, loading, connect, disconnect } = useIntegrations();

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 glass sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-black text-white tracking-tight">Integrations</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">
                Manage Connected Apps
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-5xl mx-auto w-full">
        <div className="mb-8">
          <h2 className="text-2xl font-black tracking-tight mb-2">Connect your tools</h2>
          <p className="text-white/40 text-sm font-medium">
            Link your favorite apps to give the Synapse Agent access to your data and workflows.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {integrations.map((app) => {
              const Icon = getAppIcon(app.id);
              const isConnected = app.connected;

              return (
                <div 
                  key={app.id} 
                  className={`p-5 rounded-2xl border transition-all duration-200 relative overflow-hidden group ${
                    isConnected 
                      ? "bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40" 
                      : "glass border-white/5 hover:border-white/20 hover:bg-white/[0.04]"
                  }`}
                >
                  {isConnected && (
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-[40px] -mr-10 -mt-10 pointer-events-none" />
                  )}
                  
                  <div className="flex items-start justify-between mb-4 relative z-10">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      isConnected 
                        ? "bg-emerald-500/20 text-emerald-400" 
                        : "bg-white/10 text-white/60 group-hover:text-white"
                    } transition-colors`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    {isConnected && (
                      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-md">
                        <CheckCircle2 className="w-3 h-3" />
                        Connected
                      </div>
                    )}
                  </div>

                  <h3 className="font-bold text-lg mb-1 capitalize relative z-10">{app.id}</h3>
                  <p className="text-xs text-white/40 mb-6 font-medium relative z-10">
                    Allow SynapseAI to securely interact with {app.id}.
                  </p>

                  <div className="relative z-10">
                    {isConnected ? (
                      <button
                        onClick={() => disconnect(app.id)}
                        className="w-full py-2.5 rounded-xl border border-rose-500/20 text-rose-400 text-sm font-bold hover:bg-rose-500/10 transition-colors flex items-center justify-center gap-2"
                      >
                        <Unlink className="w-4 h-4" />
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => connect(app.id)}
                        className="w-full py-2.5 rounded-xl bg-white/10 text-white text-sm font-bold hover:bg-white/20 transition-colors flex items-center justify-center gap-2 group-hover:bg-gradient-to-r group-hover:from-violet-500 group-hover:to-blue-500"
                      >
                        <LinkIcon className="w-4 h-4" />
                        Connect
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
