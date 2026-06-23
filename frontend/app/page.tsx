"use client";
import Link from "next/link";
import { ArrowRight, Bot, Zap, Shield, BarChart3, Star, Github, Slack, Mail, Calendar } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#030303] text-white overflow-x-hidden">

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4 glass border-b border-white/5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">
              Synapse<span className="gradient-text">AI</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/sign-in"
              className="px-5 py-2 text-sm font-semibold text-white/60 hover:text-white transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 text-sm font-bold text-white shadow-lg shadow-violet-500/25 hover:opacity-90 transition-opacity"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center pt-24 pb-20 overflow-hidden">
        {/* Background orbs */}
        <div className="absolute top-1/4 left-1/4 w-[700px] h-[700px] bg-violet-600/15 rounded-full blur-[140px] -translate-x-1/2 pointer-events-none animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-blue-600/15 rounded-full blur-[140px] translate-x-1/2 pointer-events-none animate-pulse" style={{ animationDelay: '1s' }} />

        <div className="relative text-center px-6 max-w-5xl mx-auto z-10">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border border-white/10 mb-10 hover:border-violet-500/30 transition-colors cursor-default">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">
              Agent Version 2.0 Now Live
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter leading-[0.95] mb-8">
            The future of
            <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-blue-400 to-emerald-400">productivity</span>
          </h1>

          <p className="text-lg md:text-xl text-white/40 max-w-2xl mx-auto mb-12 leading-relaxed font-medium">
            Meet SynapseAI — the first agent that natively understands your 
            workflow across Gmail, Slack, and GitHub. Build, send, and automate 
            without lifting a finger.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
            <Link
              href="/sign-up"
              className="group relative flex items-center gap-3 px-10 py-5 rounded-2xl bg-white text-black text-base font-black hover:scale-105 active:scale-95 transition-all duration-300 shadow-2xl shadow-white/10"
            >
              Start Building Free
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/sign-in"
              className="flex items-center gap-3 px-10 py-5 rounded-2xl glass border border-white/10 text-base font-bold text-white/60 hover:text-white hover:border-white/30 hover:bg-white/5 transition-all duration-300"
            >
              Sign in to dashboard
            </Link>
          </div>

          {/* App preview mockup */}
          <div className="mt-24 relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-violet-500/20 to-blue-500/20 rounded-[40px] blur-2xl opacity-50 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
            <div className="relative glass rounded-[32px] border border-white/10 p-5 max-w-4xl mx-auto shadow-2xl shadow-black/50 overflow-hidden">
              {/* Fake UI controls */}
              <div className="flex items-center gap-2 mb-5 pb-4 border-b border-white/5">
                <div className="flex gap-1.5 mr-4">
                  <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
                  <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
                  <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
                </div>
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
                  <Bot className="w-4 h-4" />
                </div>
                <span className="text-xs font-black uppercase tracking-widest opacity-80">Synapse Intelligence</span>
                <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">System Ready</span>
                </div>
              </div>
              
              <div className="space-y-4 text-left max-w-3xl mx-auto">
                <div className="flex justify-end animate-in fade-in slide-in-from-right-4 duration-700">
                  <div className="bg-violet-500 text-white text-sm px-5 py-3 rounded-2xl rounded-tr-sm font-bold shadow-lg shadow-violet-500/20">
                    Search my docs for the "Synapse Contract" and summarize clause 4
                  </div>
                </div>
                <div className="flex items-start gap-3 animate-in fade-in slide-in-from-left-4 duration-700 delay-300">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex-shrink-0 flex items-center justify-center mt-0.5 shadow-lg">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="glass rounded-2xl rounded-tl-sm px-5 py-4 text-sm text-white/90 font-medium leading-relaxed max-w-lg shadow-xl">
                    <p className="mb-2">Searching your knowledge base... 📂</p>
                    I found the document. <strong>Clause 4 (Liability)</strong> states that the contractor is responsible for up to $1M in damages, excluding indirect losses. 
                    <br /><br />
                    <span className="text-violet-400 font-bold">Would you like me to draft an amendment?</span>
                    <span className="inline-block w-1.5 h-4 bg-violet-400 ml-1 animate-pulse align-middle rounded-full" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Logos ───────────────────────────────────────────────────────────── */}
      <section className="py-12 border-y border-white/5 bg-white/[0.01]">
        <div className="max-w-6xl mx-auto px-6">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-center text-white/20 mb-10">
            Natively Integrated With
          </p>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-8 opacity-40 grayscale hover:grayscale-0 transition-all duration-700">
            {[
              { icon: Mail, label: "Gmail" },
              { icon: Slack, label: "Slack" },
              { icon: Github, label: "GitHub" },
              { icon: Calendar, label: "Calendar" },
              { icon: BarChart3, label: "Notion" },
              { icon: Zap, label: "Linear" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center justify-center gap-2 group cursor-default">
                <Icon className="w-5 h-5 group-hover:text-violet-400 transition-colors" />
                <span className="text-sm font-bold tracking-tight">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              Everything you need,
              <br />
              <span className="gradient-text">nothing you don't</span>
            </h2>
            <p className="text-white/40 text-lg max-w-xl mx-auto font-medium">
              Built for professionals who value their time.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                icon: Bot,
                title: "Natural Language",
                desc: "Just tell the agent what you need in plain English. No commands, no syntax.",
              },
              {
                icon: Zap,
                title: "Instant Execution",
                desc: "Sends emails, creates calendar events, posts to Slack — in seconds.",
              },
              {
                icon: Shield,
                title: "Always Asks First",
                desc: "Sensitive actions require your approval before executing. You stay in control.",
              },
              {
                icon: BarChart3,
                title: "Usage Analytics",
                desc: "Track how your agent works for you with detailed usage insights.",
              },
              {
                icon: Star,
                title: "Conversation Memory",
                desc: "Remembers context across sessions. No need to repeat yourself.",
              },
              {
                icon: Github,
                title: "10+ Integrations",
                desc: "GitHub, Linear, Notion, LinkedIn, and more — with new ones added regularly.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="glass rounded-2xl p-6 border border-white/5 hover:border-violet-500/20 hover:bg-white/[0.04] transition-all group"
              >
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center mb-4 group-hover:bg-violet-500/20 transition-colors">
                  <Icon className="w-5 h-5 text-violet-400" />
                </div>
                <h3 className="font-bold text-white mb-2">{title}</h3>
                <p className="text-sm text-white/40 leading-relaxed font-medium">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="glass rounded-3xl p-12 border border-violet-500/10 glow-sm relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-600/5 to-blue-600/5" />
            <div className="relative">
              <h2 className="text-4xl font-black tracking-tight mb-4">
                Ready to get started?
              </h2>
              <p className="text-white/40 mb-8 font-medium">
                Free forever. No credit card required.
              </p>
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-violet-500 to-blue-500 text-base font-bold text-white shadow-2xl shadow-violet-500/30 hover:opacity-90 hover:scale-105 transition-all"
              >
                Create free account <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-8 px-6 text-center text-white/20 text-xs font-medium">
        © 2025 SynapseAI. Built with ❤️
      </footer>
    </div>
  );
}
