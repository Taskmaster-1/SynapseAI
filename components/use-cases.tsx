"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useState, useRef, useEffect } from "react"
import { Code, ShoppingCart, Users, Briefcase, DollarSign } from "lucide-react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(ScrollTrigger)

const teams = [
  { id: "product", label: "Product", icon: Briefcase },
  { id: "engineering", label: "Engineering", icon: Code },
  { id: "sales", label: "Sales", icon: DollarSign },
  { id: "hr", label: "HR", icon: Users },
  { id: "marketing", label: "Marketing", icon: ShoppingCart },
]

const useCases = {
  product: {
    title: "Product Team",
    subtitle: "Manage features & roadmaps",
    tools: ["Jira", "Notion", "Figma", "Slack", "Confluence"],
    example: {
      prompt:
        'Read the feature spec for "Instant Checkout" from Notion and create testing criteria for PROD-3421 in Jira.',
      response: "✓ Task completed successfully across your connected tools",
    },
  },
  engineering: {
    title: "Engineering Team",
    subtitle: "Build better software",
    tools: ["GitHub", "Jira", "Slack", "Linear", "Notion"],
    example: {
      prompt:
        "Create a GitHub issue for the bug reported in Slack channel #bug-reports and assign it to the on-call engineer.",
      response: "✓ Issue created and assigned successfully",
    },
  },
  sales: {
    title: "Sales Team",
    subtitle: "Close deals faster",
    tools: ["Salesforce", "Gmail", "Calendar", "Slack", "HubSpot"],
    example: {
      prompt:
        "Draft a follow-up email for all prospects who attended yesterday's demo and schedule a meeting for next week.",
      response: "✓ 12 emails drafted and 12 meetings scheduled",
    },
  },
  hr: {
    title: "HR Team",
    subtitle: "Streamline hiring process",
    tools: ["Greenhouse", "Gmail", "Calendar", "Slack", "Notion"],
    example: {
      prompt:
        "Send interview feedback request to all interviewers for today's candidates and compile responses in Notion.",
      response: "✓ Feedback requests sent and tracker created",
    },
  },
  marketing: {
    title: "Marketing Team",
    subtitle: "Scale your campaigns",
    tools: ["HubSpot", "Mailchimp", "Analytics", "Slack", "Notion"],
    example: {
      prompt:
        "Generate a weekly performance report from our latest email campaign and share it in the #marketing Slack channel.",
      response: "✓ Report generated and shared successfully",
    },
  },
}

export function UseCases() {
  const [activeTeam, setActiveTeam] = useState("product")
  const useCase = useCases[activeTeam as keyof typeof useCases]
  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

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
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  useEffect(() => {
    if (cardRef.current) {
      gsap.fromTo(cardRef.current, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" })
    }
  }, [activeTeam])

  return (
    <section ref={sectionRef} id="use-cases" className="py-24 bg-muted/30 relative overflow-hidden">
      <div className="absolute bottom-0 left-1/4 -z-10 h-[600px] w-[600px] opacity-10 blur-[100px]">
        <div className="h-full w-full rounded-full bg-primary animate-pulse-slow" />
      </div>

      <div className="container mx-auto px-4">
        <div ref={headerRef} className="mx-auto max-w-3xl text-center mb-16">
          <h2 className="mb-4 text-balance text-3xl font-bold md:text-4xl lg:text-5xl">
            Designed for{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Every Team</span>
          </h2>
          <p className="text-pretty text-lg text-muted-foreground leading-relaxed">
            From product managers to engineers, every team gets tools tailored to their workflow
          </p>
        </div>

        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-wrap justify-center gap-2">
            {teams.map((team) => (
              <Button
                key={team.id}
                variant={activeTeam === team.id ? "default" : "outline"}
                onClick={() => setActiveTeam(team.id)}
                className="gap-2 transition-all duration-300 hover:scale-105"
              >
                <team.icon className="h-4 w-4" />
                {team.label}
              </Button>
            ))}
          </div>

          <div ref={cardRef}>
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-xl">
              <CardContent className="p-8">
                <div className="grid gap-8 lg:grid-cols-2">
                  <div>
                    <h3 className="text-2xl font-bold mb-2">{useCase.title}</h3>
                    <p className="text-muted-foreground mb-6">{useCase.subtitle}</p>

                    <div className="mb-6">
                      <h4 className="text-sm font-semibold mb-3 text-muted-foreground">Integrated Tools</h4>
                      <div className="flex flex-wrap gap-2">
                        {useCase.tools.map((tool) => (
                          <div
                            key={tool}
                            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:border-primary/50 hover:bg-primary/5 transition-all"
                          >
                            {tool}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold mb-3 text-muted-foreground">Real-world Example</h4>
                    <div className="space-y-4">
                      <div className="rounded-lg border border-border bg-background p-4 hover:border-primary/30 transition-colors">
                        <p className="text-sm text-muted-foreground mb-1">You can ask:</p>
                        <p className="text-sm">&quot;{useCase.example.prompt}&quot;</p>
                      </div>
                      <div className="rounded-lg border border-primary/50 bg-primary/5 p-4 hover:bg-primary/10 transition-colors">
                        <p className="text-sm text-muted-foreground mb-1">AI Response:</p>
                        <p className="text-sm font-semibold text-primary">{useCase.example.response}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  )
}
