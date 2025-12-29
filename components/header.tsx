"use client"

import { Button } from "@/components/ui/button"
import Link from "next/link"
import { useEffect, useState } from "react"

export function Header() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }

    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <header
      className={`fixed top-4 left-0 right-0 z-50 mx-auto max-w-5xl transition-all duration-300 ${
        scrolled
          ? "top-4 rounded-full border border-white/10 bg-black/50 backdrop-blur-xl shadow-lg shadow-primary/5"
          : "top-4 bg-transparent"
      }`}
    >
      <div className="flex h-14 items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 group">
          <span className="text-xl font-bold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">AgentFlow</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {["Features", "Integrations", "Use Cases", "Pricing"].map((item) => (
            <Link
              key={item}
              href={`#${item.toLowerCase().replace(" ", "-")}`}
              className="text-sm font-medium text-muted-foreground hover:text-white transition-colors"
            >
              {item}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <Link href="/sign-in">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-white hover:bg-white/5 transition-colors rounded-full">
              Sign In
            </Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm" className="rounded-full bg-white text-black hover:bg-white/90 transition-transform hover:scale-105">
              Get Started
            </Button>
          </Link>
        </div>
      </div>
    </header>
  )
}
