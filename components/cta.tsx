"use client"

import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"
import { useEffect, useRef } from "react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(ScrollTrigger)

export function CTA() {
  const sectionRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(contentRef.current, {
        scrollTrigger: {
          trigger: contentRef.current,
          start: "top 80%",
          toggleActions: "play none none none",
        },
        opacity: 0,
        scale: 0.95,
        y: 30,
        duration: 1,
        ease: "power3.out",
      })
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} className="py-32 relative overflow-hidden">
       {/* Background Grid */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(#444_1px,transparent_1px)] [background-size:20px_20px] opacity-[0.15]" />
      
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-5xl">
          <div
            ref={contentRef}
            className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0A0A0A] px-8 py-20 text-center shadow-2xl group"
          >
            {/* Animated Background */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] bg-[conic-gradient(from_0deg,transparent_0_340deg,white_360deg)] animate-spin-slow opacity-10" />
            </div>
            <div className="absolute inset-[1px] rounded-[23px] bg-[#0A0A0A]" />

            <div className="relative z-10 max-w-3xl mx-auto">
              <h2 className="mb-6 text-4xl font-bold md:text-5xl lg:text-6xl tracking-tight text-white">
                Ready to transform your{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                  workflow
                </span>
                ?
              </h2>
              <p className="mb-10 text-xl text-muted-foreground leading-relaxed">
                Join thousands of teams already using AgentFlow to automate their workflows and save hours every day.
              </p>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Button
                  size="lg"
                  className="h-14 px-8 rounded-full text-base font-semibold gap-2 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all hover:scale-105"
                >
                  Get Started for Free
                  <ArrowRight className="h-5 w-5" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-14 px-8 rounded-full text-base font-semibold border-white/10 hover:bg-white/5 hover:text-white transition-all hover:scale-105"
                >
                  Schedule a Demo
                </Button>
              </div>
              <p className="mt-8 text-sm text-muted-foreground">No credit card required • 14-day free trial • Cancel anytime</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
