"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Check } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import Link from "next/link"

gsap.registerPlugin(ScrollTrigger)

const integrations = [
  {
    category: "Communication",
    tools: [
      {
        name: "Slack",
        description: "Send messages, search history, and manage channels with AI assistance.",
        features: ["Send messages to channels & users", "Search conversation history", "Set reminders"],
        status: "active",
      },
      {
        name: "Gmail",
        description: "Draft and send emails, search inbox, and manage your communications.",
        features: ["Draft and send emails", "Search your inbox", "Manage labels and filters"],
        status: "active",
      },
    ],
  },
  {
    category: "Productivity",
    tools: [
      {
        name: "Notion",
        description: "Organize tasks, notes, and knowledge with Notion integration.",
        features: ["Search across pages", "Create and update pages", "Append content blocks"],
        status: "active",
      },
      {
        name: "Google Drive",
        description: "Access and manage files with AI assistance.",
        features: ["Search & create documents", "Share files", "Manage permissions"],
        status: "active",
      },
    ],
  },
  {
    category: "Development",
    tools: [
      {
        name: "GitHub",
        description: "Supercharge your development workflow with GitHub integration.",
        features: ["Create & manage issues", "Comment on pull requests", "Search code"],
        status: "active",
      },
      {
        name: "Jira",
        description: "Manage projects and track issues with AI assistance.",
        features: ["Create and update issues", "Transition workflows", "Add comments"],
        status: "active",
      },
    ],
  },
  {
    category: "Design",
    tools: [
      {
        name: "Figma",
        description: "Access design files, leave comments, and check component details.",
        features: ["List team files", "Post comments on designs", "Search components"],
        status: "active",
      },
    ],
  },
]

export function Integrations() {
  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const categoriesRef = useRef<HTMLDivElement>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)

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

      const categories = categoriesRef.current?.children
      if (categories) {
        gsap.from(categories, {
          scrollTrigger: {
            trigger: categoriesRef.current,
            start: "top 80%",
            toggleActions: "play none none none",
          },
          opacity: 0,
          y: 50,
          stagger: 0.2,
          duration: 0.8,
          ease: "power3.out",
        })
      }
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} id="integrations" className="py-24 relative overflow-hidden">
      <div className="absolute top-1/3 right-0 -z-10 h-[700px] w-[700px] opacity-10 blur-[120px]">
        <div className="h-full w-full rounded-full bg-accent" />
      </div>

      <div className="container mx-auto px-4">
        <div ref={headerRef} className="mx-auto max-w-3xl text-center mb-16">
          <h2 className="mb-4 text-balance text-3xl font-bold md:text-4xl lg:text-5xl">
            Connect Your{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Favorite Tools
            </span>
          </h2>
          <p className="text-pretty text-lg text-muted-foreground leading-relaxed">
            A growing ecosystem of integrations to supercharge your workflow
          </p>
        </div>

        <div ref={categoriesRef} className="mx-auto max-w-6xl space-y-12">
          {integrations.map((category) => (
            <div key={category.category}>
              <h3 className="mb-6 text-2xl font-semibold">{category.category}</h3>
              <div className="grid gap-6 md:grid-cols-2">
                {category.tools.map((tool) => (
                  <Card
                    key={tool.name}
                    className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 group"
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-xl group-hover:text-primary transition-colors">
                            {tool.name}
                          </CardTitle>
                          <CardDescription className="mt-2">{tool.description}</CardDescription>
                        </div>
                        {tool.status === "active" && (
                          <Badge variant="outline" className="border-primary/50 text-primary">
                            Active
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2 mb-4">
                        {tool.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <Check className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                      <Link href="/sign-up">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full bg-transparent hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-all"
                        >
                          Connect
                        </Button>
                      </Link>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-muted-foreground mb-4">And 90+ more integrations coming soon</p>
          <Button variant="outline" className="hover:bg-accent/10 bg-transparent">
            View All Integrations
          </Button>
        </div>
      </div>
    </section>
  )
}
