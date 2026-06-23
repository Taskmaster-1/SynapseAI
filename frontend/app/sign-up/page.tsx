"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Eye, EyeOff, Loader2, Github, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      if (err) throw err;
      // Auto sign-in after signup
      const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
      if (loginErr) throw loginErr;
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: "github" | "google") => {
    setSocialLoading(provider);
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/dashboard` }
      });
      if (err) throw err;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `${provider} signup failed`);
      setSocialLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#030303] flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background orbs */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-violet-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />

      <Link 
        href="/" 
        className="absolute top-8 left-8 flex items-center gap-2 text-white/30 hover:text-white transition-colors text-sm font-bold group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        Back to home
      </Link>

      <div className="w-full max-w-[440px] relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <Link href="/" className="inline-flex items-center gap-3 group">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-xl shadow-violet-500/20 group-hover:scale-105 transition-transform duration-300">
              <Bot className="w-7 h-7 text-white" />
            </div>
            <span className="text-2xl font-black tracking-tighter">
              Synapse<span className="gradient-text">AI</span>
            </span>
          </Link>
          <h1 className="text-3xl font-black mt-8 mb-2 tracking-tight">Create account</h1>
          <p className="text-white/40 font-medium text-sm">Join the future of productivity</p>
        </div>

        <div className="glass rounded-[32px] p-10 border border-white/10 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />

          {error && (
            <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-bold flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-8">
            <button
              onClick={() => handleSocialLogin("github")}
              disabled={!!socialLoading}
              className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all text-xs font-bold disabled:opacity-50"
            >
              {socialLoading === "github" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github className="w-4 h-4" />}
              GitHub
            </button>
            <button
              onClick={() => handleSocialLogin("google")}
              disabled={!!socialLoading}
              className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all text-xs font-bold disabled:opacity-50"
            >
              {socialLoading === "google" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
              Google
            </button>
          </div>

          <div className="relative mb-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/5"></div>
            </div>
            <div className="relative flex justify-center text-[10px] font-black uppercase tracking-widest text-white/20">
              <span className="bg-[#0b0b0b] px-4">Or continue with email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-white/30 mb-2.5 ml-1">
                Full Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What should we call you?"
                required
                className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-4 text-sm text-white placeholder:text-white/10 focus:outline-none focus:border-violet-500/40 focus:bg-white/[0.06] transition-all duration-300 shadow-inner"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-white/30 mb-2.5 ml-1">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-4 text-sm text-white placeholder:text-white/10 focus:outline-none focus:border-violet-500/40 focus:bg-white/[0.06] transition-all duration-300 shadow-inner"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-white/30 mb-2.5 ml-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  required
                  className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-4 pr-12 text-sm text-white placeholder:text-white/10 focus:outline-none focus:border-violet-500/40 focus:bg-white/[0.06] transition-all duration-300 shadow-inner"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/50 transition-colors"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-500 to-blue-500 text-sm font-black text-white shadow-xl shadow-violet-500/20 hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-3 mt-4"
            >
              {loading && <Loader2 className="w-5 h-5 animate-spin" />}
              Create Workspace
            </button>
          </form>

          <p className="text-center mt-10 text-sm text-white/20 font-medium">
            Already have an account?{" "}
            <Link href="/sign-in" className="text-violet-400 hover:text-violet-300 font-bold transition-colors underline underline-offset-4 decoration-violet-500/30">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
