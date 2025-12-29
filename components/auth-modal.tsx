"use client"

import { useEffect, useRef } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { gsap } from "gsap"
import Link from "next/link"

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  message?: string
}

export function AuthModal({ isOpen, onClose, message }: AuthModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"

      const ctx = gsap.context(() => {
        gsap.from(overlayRef.current, {
          opacity: 0,
          duration: 0.3,
        })

        gsap.from(modalRef.current, {
          opacity: 0,
          scale: 0.9,
          y: 20,
          duration: 0.4,
          ease: "back.out(1.7)",
        })
      })

      return () => {
        ctx.revert()
        document.body.style.overflow = "unset"
      }
    } else {
      document.body.style.overflow = "unset"
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md px-4"
      onClick={onClose}
    >
      <div ref={modalRef} className="relative w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        {/* Glass card */}
        <div className="relative rounded-3xl border border-white/20 bg-background/60 backdrop-blur-2xl shadow-[0_8px_32px_0_rgba(139,92,246,0.3)] overflow-hidden">
          {/* Animated gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/20 animate-gradient bg-[length:200%_200%]" />

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-10 rounded-full p-2 hover:bg-background/50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative p-8 text-center">
            {/* Content */}
            <h2 className="text-2xl font-bold mb-2">Sign in required</h2>
            <p className="text-muted-foreground mb-8">
              {message || "Please sign in to continue using AgentFlow and unlock all features."}
            </p>

            {/* Buttons */}
            <div className="space-y-3">
              <Link href="/sign-in" className="block">
                <Button className="w-full bg-gradient-to-r from-primary to-primary/80 hover:shadow-lg hover:shadow-primary/50 hover:scale-[1.02] transition-all">
                  Sign In
                </Button>
              </Link>
              <Link href="/sign-up" className="block">
                <Button
                  variant="outline"
                  className="w-full bg-background/50 backdrop-blur-sm border-white/10 hover:bg-background/80"
                >
                  Create Account
                </Button>
              </Link>
            </div>

            <p className="mt-6 text-xs text-muted-foreground">Free 14-day trial • No credit card required</p>
          </div>
        </div>
      </div>
    </div>
  )
}
