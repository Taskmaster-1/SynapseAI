"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import Link from "next/link"
import { useState, useEffect, useRef } from "react"
import { gsap } from "gsap"
import { Mail, Lock, User, Chrome, Github, Sparkles } from "lucide-react"
import { saveUser } from "@/lib/auth"

export default function SignUpPage() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [agreed, setAgreed] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLDivElement>(null)

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveUser({ name, email })
    window.location.href = "/dashboard"
  }

  const handleSocialSignUp = (provider: string) => {
    const mockName = provider === "Google" ? "Google User" : "GitHub User"
    const mockEmail = `user@${provider.toLowerCase()}.com`
    saveUser({ name: mockName, email: mockEmail })
    window.location.href = "/dashboard"
  }

  return (
    <div
      ref={containerRef}
      className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-background via-background to-accent/5 py-12"
    >
      {/* Animated background orbs */}
      <div className="float-orb absolute top-20 right-20 h-64 w-64 rounded-full bg-accent/20 blur-[120px]" />
      <div
        className="float-orb absolute bottom-20 left-20 h-80 w-80 rounded-full bg-primary/20 blur-[140px]"
        style={{ animationDelay: "1s" }}
      />
      <div
        className="float-orb absolute top-1/2 right-1/3 h-72 w-72 rounded-full bg-accent/10 blur-[100px]"
        style={{ animationDelay: "2s" }}
      />

      <div ref={formRef} className="relative z-10 w-full max-w-md px-4">
        {/* Glass card */}
        <div className="relative rounded-3xl border border-white/20 bg-background/40 backdrop-blur-2xl shadow-[0_8px_32px_0_rgba(139,92,246,0.2)] overflow-hidden">
          {/* Animated gradient border */}
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-accent via-primary to-accent opacity-20 blur-xl animate-gradient bg-[length:200%_200%]" />

          {/* Inner glass layer */}
          <div className="relative rounded-3xl bg-background/60 backdrop-blur-3xl border border-white/10 m-[1px]">
            <div className="p-8">
              {/* Logo and title */}
              <div className="text-center mb-8">
                <Link href="/" className="inline-flex items-center gap-2 mb-6 group">
                  <span className="text-2xl font-bold">AgentFlow</span>
                </Link>
                <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  Start Your Journey
                </h1>
                <p className="text-sm text-muted-foreground">Create your account and automate anything</p>
              </div>

              {/* Social signup buttons */}
              <div className="space-y-3 mb-6">
                <Button
                  variant="outline"
                  className="w-full bg-background/50 backdrop-blur-sm hover:bg-background/80 hover:scale-[1.02] transition-all border-white/10 group"
                  onClick={() => handleSocialSignUp("Google")}
                  type="button"
                >
                  <Chrome className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" />
                  Sign up with Google
                </Button>
                <Button
                  variant="outline"
                  className="w-full bg-background/50 backdrop-blur-sm hover:bg-background/80 hover:scale-[1.02] transition-all border-white/10 group"
                  onClick={() => handleSocialSignUp("GitHub")}
                  type="button"
                >
                  <Github className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" />
                  Sign up with GitHub
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

              {/* Sign up form */}
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-medium">
                    Full Name
                  </Label>
                  <div className="relative group">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                      id="name"
                      type="text"
                      placeholder="John Doe"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="pl-10 bg-background/50 backdrop-blur-sm border-white/10 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  </div>
                </div>

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
                  <Label htmlFor="password" className="text-sm font-medium">
                    Password
                  </Label>
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
                  <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="terms"
                    checked={agreed}
                    onCheckedChange={(checked) => setAgreed(checked as boolean)}
                    className="border-white/20 data-[state=checked]:bg-primary"
                  />
                  <label
                    htmlFor="terms"
                    className="text-sm text-muted-foreground leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    I agree to the{" "}
                    <Link href="#" className="text-primary hover:text-primary/80 transition-colors">
                      Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link href="#" className="text-primary hover:text-primary/80 transition-colors">
                      Privacy Policy
                    </Link>
                  </label>
                </div>

                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-primary to-accent hover:shadow-lg hover:shadow-primary/50 hover:scale-[1.02] transition-all duration-300 group"
                  disabled={!agreed}
                >
                  <Sparkles className="mr-2 h-4 w-4 group-hover:rotate-12 transition-transform" />
                  Create Account
                </Button>
              </form>

              {/* Sign in link */}
              <p className="mt-6 text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/sign-in" className="text-primary hover:text-primary/80 transition-colors font-medium">
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </div>

        {/* Features badges */}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-background/30 backdrop-blur-sm border border-white/10 px-4 py-2 text-xs">
            <Sparkles className="h-3 w-3 text-primary" />
            <span>Free 14-day trial</span>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-background/30 backdrop-blur-sm border border-white/10 px-4 py-2 text-xs">
            <Sparkles className="h-3 w-3 text-accent" />
            <span>No credit card required</span>
          </div>
        </div>
      </div>
    </div>
  )
}
