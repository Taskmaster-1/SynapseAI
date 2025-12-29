"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { useState, useEffect, useRef } from "react"
import { gsap } from "gsap"
import { Mail, Lock, Chrome, Github } from "lucide-react"
import { saveUser } from "@/lib/auth"

export default function SignInPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLDivElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const name = email.split("@")[0].charAt(0).toUpperCase() + email.split("@")[0].slice(1)
    saveUser({ name, email })
    window.location.href = "/dashboard"
  }

  const handleSocialSignIn = (provider: string) => {
    // For demo, using mock data
    const mockName = provider === "Google" ? "Google User" : "GitHub User"
    const mockEmail = `user@${provider.toLowerCase()}.com`
    saveUser({ name: mockName, email: mockEmail })
    window.location.href = "/dashboard"
  }

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(formRef.current, {
        opacity: 0,
        y: 50,
        scale: 0.95,
        duration: 1,
        ease: "power3.out",
      })

      gsap.to(".float-orb", {
        y: "+=30",
        x: "+=20",
        rotation: 360,
        duration: 20,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      })
    })

    return () => ctx.revert()
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-background via-background to-primary/5"
    >
      {/* Animated background orbs */}
      <div className="float-orb absolute top-20 left-20 h-64 w-64 rounded-full bg-primary/20 blur-[120px]" />
      <div
        className="float-orb absolute bottom-20 right-20 h-80 w-80 rounded-full bg-accent/20 blur-[140px]"
        style={{ animationDelay: "1s" }}
      />
      <div
        className="float-orb absolute top-1/2 left-1/3 h-72 w-72 rounded-full bg-primary/10 blur-[100px]"
        style={{ animationDelay: "2s" }}
      />

      <div ref={formRef} className="relative z-10 w-full max-w-md px-4">
        {/* Glass card */}
        <div className="relative rounded-3xl border border-white/20 bg-background/40 backdrop-blur-2xl shadow-[0_8px_32px_0_rgba(139,92,246,0.2)] overflow-hidden">
          {/* Animated gradient border */}
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-primary via-accent to-primary opacity-20 blur-xl animate-gradient bg-[length:200%_200%]" />

          {/* Inner glass layer */}
          <div className="relative rounded-3xl bg-background/60 backdrop-blur-3xl border border-white/10 m-[1px]">
            <div className="p-8">
              {/* Logo and title */}
              <div className="text-center mb-8">
                <Link href="/" className="inline-flex items-center gap-2 mb-6 group">
                  <span className="text-2xl font-bold">AgentFlow</span>
                </Link>
                <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  Welcome Back
                </h1>
                <p className="text-sm text-muted-foreground">Sign in to continue your automation journey</p>
              </div>

              {/* Social login buttons */}
              <div className="space-y-3 mb-6">
                <Button
                  variant="outline"
                  className="w-full bg-background/50 backdrop-blur-sm hover:bg-background/80 hover:scale-[1.02] transition-all border-white/10 group"
                  onClick={() => handleSocialSignIn("Google")}
                  type="button"
                >
                  <Chrome className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" />
                  Continue with Google
                </Button>
                <Button
                  variant="outline"
                  className="w-full bg-background/50 backdrop-blur-sm hover:bg-background/80 hover:scale-[1.02] transition-all border-white/10 group"
                  onClick={() => handleSocialSignIn("GitHub")}
                  type="button"
                >
                  <Github className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" />
                  Continue with GitHub
                </Button>
              </div>

              {/* Divider */}
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background/80 backdrop-blur-sm px-2 text-muted-foreground">
                    Or continue with email
                  </span>
                </div>
              </div>

              {/* Email/Password form */}
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">
                    Email
                  </Label>
                  <div className="relative group">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 bg-background/50 backdrop-blur-sm border-white/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-medium">
                      Password
                    </Label>
                    <Link href="#" className="text-xs text-primary hover:text-primary/80 transition-colors">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 bg-background/50 backdrop-blur-sm border-white/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-primary to-primary/80 hover:shadow-lg hover:shadow-primary/50 hover:scale-[1.02] transition-all duration-300"
                >
                  Sign In
                </Button>
              </form>

              {/* Sign up link */}
              <p className="mt-6 text-center text-sm text-muted-foreground">
                Don't have an account?{" "}
                <Link href="/sign-up" className="text-primary hover:text-primary/80 transition-colors font-medium">
                  Sign up for free
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
