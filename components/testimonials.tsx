"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useEffect, useRef } from "react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { Star } from "lucide-react"

gsap.registerPlugin(ScrollTrigger)

const testimonials = [
  {
    name: "Sarah Chen",
    role: "Product Manager at TechCorp",
    content:
      "AgentFlow has transformed how our product team works. We've cut down weekly planning time from 4 hours to 30 minutes by automating our Jira and Notion workflows.",
    avatar: "https://avatar.vercel.sh/sarah",
    rating: 5,
  },
  {
    name: "Michael Rodriguez",
    role: "Engineering Lead at StartupXYZ",
    content:
      "The GitHub integration alone is worth it. Our team saves 10+ hours per week on routine tasks. The AI agents understand context better than any tool we've tried.",
    avatar: "https://avatar.vercel.sh/michael",
    rating: 5,
  },
  {
    name: "Emily Taylor",
    role: "Head of Sales at GrowthCo",
    content:
      "Game changer for our sales team. Automated follow-ups, meeting scheduling, and CRM updates have increased our productivity by 300%. Best investment this year.",
    avatar: "https://avatar.vercel.sh/emily",
    rating: 5,
  },
]

export function Testimonials() {
  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)

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
          stagger: 0.15,
          duration: 0.8,
          ease: "power3.out",
        })
      }
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} className="py-32 relative overflow-hidden bg-background">
      {/* Background decoration */}
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="absolute bottom-0 left-0 w-full h-[500px] bg-gradient-to-t from-background to-transparent pointer-events-none" />

      <div className="container mx-auto px-4">
        <div ref={headerRef} className="mx-auto max-w-3xl text-center mb-20">
          <h2 className="mb-6 text-4xl font-bold md:text-5xl lg:text-6xl tracking-tight">
            Loved by{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
              Innovators
            </span>
          </h2>
          <p className="text-xl text-muted-foreground leading-relaxed">
            See how teams are transforming their workflows with AgentFlow
          </p>
        </div>

        <div ref={cardsRef} className="mx-auto grid max-w-7xl gap-6 md:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((testimonial) => (
            <Card
              key={testimonial.name}
              className="border-white/5 bg-white/5 backdrop-blur-sm hover:bg-white/10 transition-colors duration-300"
            >
              <CardContent className="p-8">
                <div className="flex items-center gap-4 mb-6">
                  <Avatar className="h-12 w-12 border border-white/10">
                    <AvatarImage src={testimonial.avatar} alt={testimonial.name} />
                    <AvatarFallback>{testimonial.name[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold text-white">{testimonial.name}</div>
                    <div className="text-sm text-muted-foreground">{testimonial.role}</div>
                  </div>
                </div>
                
                <div className="flex mb-4 text-primary">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-current" />
                  ))}
                </div>

                <p className="text-muted-foreground leading-relaxed">
                  "{testimonial.content}"
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
