"use client"

import { Card, CardContent } from "@/components/ui/card"
import { MessageSquare, Zap, Lock, Network, Brain, Workflow } from "lucide-react"
import { useEffect, useRef } from "react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(ScrollTrigger)

const features = [
  {
    icon: MessageSquare,
    title: "AI Chat Interface",
    description:
      "Interact with intelligent AI agents through natural conversation. Get instant responses and actionable insights.",
  },
  {
    icon: Network,
    title: "100+ Tool Integrations",
    description:
      "Connect with all your favorite tools — Gmail, Slack, Notion, GitHub, and more. Works with your existing workflow.",
  },
  {
    icon: Workflow,
    title: "Workflow Automation",
    description:
      "Create custom workflows that chain multiple tools together. Build complex automations with simple natural language.",
  },
  {
    icon: Brain,
    title: "Adaptive AI Agents",
    description:
      "Choose between Quick, Medium, or Deep thinking modes based on your task complexity and time requirements.",
  },
  {
    icon: Zap,
    title: "Lightning Fast",
    description: "Execute tasks in seconds across multiple platforms. No more context switching or manual data entry.",
  },
  {
    icon: Lock,
    title: "Enterprise Security",
    description:
      "Bank-level encryption, SOC 2 compliance, and granular access controls. Your data is always protected.",
  },
]

export function Features() {
  const sectionRef = useRef<HTMLElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(headerRef.current, {
        scrollTrigger: {
          trigger: headerRef.current,
          start: "top 80%",
          toggleActions: "play none none none",
        },
        opacity: 0,
        y: 30,
        duration: 0.8,
        ease: "power3.out",
      })

      const cards = cardsRef.current?.children
      if (cards) {
        gsap.from(cards, {
          scrollTrigger: {
            trigger: cardsRef.current,
            start: "top 80%",
            toggleActions: "play none none none",
          },
          opacity: 0,
          y: 50,
          stagger: 0.1,
          duration: 0.8,
          ease: "power3.out",
        })
      }
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} id="features" className="py-32 bg-background relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      
      <div className="container mx-auto px-4">
        <div ref={headerRef} className="mx-auto max-w-3xl text-center mb-20">
          <h2 className="mb-6 text-4xl font-bold md:text-5xl lg:text-6xl tracking-tight">
            Unleash Your{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">Potential</span>
          </h2>
          <p className="text-xl text-muted-foreground leading-relaxed">
            Powerful tools designed to supercharge your workflow
          </p>
        </div>

        <div ref={cardsRef} className="mx-auto grid max-w-7xl gap-4 md:grid-cols-3 md:grid-rows-2">
          {/* Main Feature - Large */}
          <div className="md:col-span-2 md:row-span-2 group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all hover:border-white/20">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative z-10 h-full flex flex-col justify-between">
              <div>
                <div className="mb-4 inline-flex rounded-xl bg-primary/20 p-3 text-primary">
                  <MessageSquare className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-2xl font-bold text-white">AI Chat Interface</h3>
                <p className="text-muted-foreground max-w-md">
                  Interact with intelligent AI agents through natural conversation. Get instant responses, actionable insights, and automate tasks just by asking.
                </p>
              </div>
              <div className="mt-8 rounded-xl border border-white/10 bg-black/50 p-4 backdrop-blur-sm">
                <div className="flex gap-3 items-center mb-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                        <Brain className="w-4 h-4 text-primary" />
                    </div>
                    <div className="text-sm text-white">How can I help you today?</div>
                </div>
                <div className="flex gap-3 items-center justify-end">
                    <div className="text-sm text-muted-foreground">Schedule a meeting with the team</div>
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                        <div className="w-4 h-4 rounded-full bg-white/50" />
                    </div>
                </div>
              </div>
            </div>
          </div>

          {/* Secondary Feature */}
          <div className="md:col-span-1 md:row-span-1 group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all hover:border-white/20">
             <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
             <div className="relative z-10">
                <div className="mb-4 inline-flex rounded-xl bg-accent/20 p-3 text-accent">
                  <Zap className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-xl font-bold text-white">Lightning Fast</h3>
                <p className="text-sm text-muted-foreground">
                  Execute tasks in seconds across multiple platforms.
                </p>
             </div>
          </div>

          {/* Third Feature */}
          <div className="md:col-span-1 md:row-span-1 group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all hover:border-white/20">
             <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
             <div className="relative z-10">
                <div className="mb-4 inline-flex rounded-xl bg-blue-500/20 p-3 text-blue-400">
                  <Lock className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-xl font-bold text-white">Enterprise Security</h3>
                <p className="text-sm text-muted-foreground">
                  Bank-level encryption and SOC 2 compliance.
                </p>
             </div>
          </div>
        </div>
      </div>
    </section>
  )
}
