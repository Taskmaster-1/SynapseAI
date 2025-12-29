"use client"
import { Sparkles } from "lucide-react"
import { useEffect, useRef } from "react"
import { gsap } from "gsap"
import { ChatInterface } from "./chat-interface"

export function Hero() {
  const heroRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const subtitleRef = useRef<HTMLParagraphElement>(null)
  const imageRef = useRef<HTMLDivElement>(null)
  const badgeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(badgeRef.current, {
        opacity: 0,
        y: -20,
        duration: 0.6,
        ease: "power3.out",
      })

      gsap.from(titleRef.current, {
        opacity: 0,
        y: 30,
        duration: 0.8,
        delay: 0.2,
        ease: "power3.out",
      })

      gsap.from(subtitleRef.current, {
        opacity: 0,
        y: 20,
        duration: 0.8,
        delay: 0.4,
        ease: "power3.out",
      })

      gsap.from(imageRef.current, {
        opacity: 0,
        y: 40,
        scale: 0.95,
        duration: 1,
        delay: 0.8,
        ease: "power3.out",
      })
    }, heroRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={heroRef} className="relative overflow-hidden pt-32 pb-20 md:pt-48 md:pb-32">
      {/* Dynamic Background */}
      <div className="absolute inset-0 -z-10 bg-background">
        <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:50px_50px]" />
        <div className="absolute h-full w-full bg-background [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[400px] opacity-30 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-primary to-accent blur-[100px] animate-pulse-slow" />
        </div>
      </div>

      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-5xl text-center relative z-10">
          <div
            ref={badgeRef}
            className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-white/80 backdrop-blur-md hover:bg-white/10 transition-colors cursor-default"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            <span>AI-Powered Workflow Automation</span>
          </div>

          <h1 ref={titleRef} className="mb-8 text-6xl font-bold tracking-tight md:text-8xl bg-clip-text text-transparent bg-gradient-to-b from-white via-white/90 to-white/50 pb-4">
            Productivity,{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-primary animate-gradient bg-[length:200%_auto]">
              Evolved.
            </span>
          </h1>

          <p
            ref={subtitleRef}
            className="mb-12 text-lg text-muted-foreground md:text-xl leading-relaxed max-w-3xl mx-auto font-medium"
          >
            Connect your tools, chat with intelligent AI agents, and complete tasks without switching apps. 
            The next generation of automation is here.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
             <button className="h-12 px-8 rounded-full bg-white text-black font-semibold hover:scale-105 transition-transform">
               Start for free
             </button>
             <button className="h-12 px-8 rounded-full bg-white/5 text-white border border-white/10 font-semibold hover:bg-white/10 transition-colors">
               View Documentation
             </button>
          </div>
        </div>

        <div ref={imageRef} className="mx-auto max-w-6xl relative">
          {/* Main Interface Container */}
          <div className="relative rounded-2xl border border-white/10 bg-[#0A0A0A] shadow-2xl overflow-hidden group">
            {/* Top Bar */}
            <div className="h-10 border-b border-white/5 bg-white/5 flex items-center px-4 gap-2">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
              </div>
              <div className="mx-auto text-[10px] text-muted-foreground font-mono">agentflow.app</div>
            </div>
            
            <div className="relative p-12 md:p-20 flex items-center justify-center bg-black/50 min-h-[600px]">
               <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-transparent to-transparent pointer-events-none" />
               <ChatInterface />
            </div>
          </div>
          
          {/* Glow Behind */}
          <div className="absolute -inset-4 bg-gradient-to-r from-primary to-accent opacity-20 blur-3xl -z-10" />
        </div>
      </div>
    </section>
  )
}
