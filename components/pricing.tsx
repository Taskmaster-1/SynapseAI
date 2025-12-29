"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Check } from "lucide-react"
import { useEffect, useRef } from "react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(ScrollTrigger)

const plans = [
  {
    name: "Starter",
    price: "$29",
    description: "Perfect for individuals and small teams getting started",
    features: [
      "Up to 5 team members",
      "10 connected integrations",
      "1,000 tasks per month",
      "Basic AI agents",
      "Email support",
      "14-day free trial",
    ],
    popular: false,
  },
  {
    name: "Professional",
    price: "$99",
    description: "For growing teams that need more power and flexibility",
    features: [
      "Up to 25 team members",
      "Unlimited integrations",
      "10,000 tasks per month",
      "Advanced AI agents",
      "Priority support",
      "Custom workflows",
      "Team analytics",
      "API access",
    ],
    popular: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For large organizations with advanced needs",
    features: [
      "Unlimited team members",
      "Unlimited integrations",
      "Unlimited tasks",
      "Enterprise AI agents",
      "Dedicated support",
      "Custom integrations",
      "Advanced security",
      "SLA guarantee",
    ],
    popular: false,
  },
]

export function Pricing() {
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
    <section ref={sectionRef} id="pricing" className="py-24 bg-muted/30 relative overflow-hidden">
      <div className="absolute top-0 right-1/4 -z-10 h-[600px] w-[600px] opacity-10 blur-[100px]">
        <div className="h-full w-full rounded-full bg-primary animate-pulse-slow" />
      </div>

      <div className="container mx-auto px-4">
        <div ref={headerRef} className="mx-auto max-w-3xl text-center mb-16">
          <h2 className="mb-4 text-balance text-3xl font-bold md:text-4xl lg:text-5xl">
            Simple,{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Transparent Pricing
            </span>
          </h2>
          <p className="text-pretty text-lg text-muted-foreground leading-relaxed">
            Choose the perfect plan for your team. All plans include a 14-day free trial.
          </p>
        </div>

        <div ref={cardsRef} className="mx-auto grid max-w-6xl gap-8 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={`border-border/50 bg-card/50 backdrop-blur-sm relative transition-all duration-300 group ${
                plan.popular
                  ? "border-primary/50 shadow-lg shadow-primary/10 scale-105 hover:scale-[1.08]"
                  : "hover:border-primary/30 hover:shadow-lg hover:scale-105"
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-primary to-accent rounded-full text-xs font-semibold text-primary-foreground">
                  Most Popular
                </div>
              )}

              <CardHeader className="pb-8">
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription className="text-sm">{plan.description}</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  {plan.price !== "Custom" && <span className="text-muted-foreground">/month</span>}
                </div>
              </CardHeader>

              <CardContent>
                <Button
                  className={`w-full mb-6 ${
                    plan.popular
                      ? "shadow-md shadow-primary/25 hover:shadow-lg hover:shadow-primary/30"
                      : "hover:bg-primary/90"
                  }`}
                  variant={plan.popular ? "default" : "outline"}
                >
                  {plan.price === "Custom" ? "Contact Sales" : "Start Free Trial"}
                </Button>

                <ul className="space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-sm text-muted-foreground">
            All plans include a 14-day free trial. No credit card required.
          </p>
        </div>
      </div>
    </section>
  )
}
