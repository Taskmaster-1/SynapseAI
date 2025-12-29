"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Bot, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { gsap } from "gsap"
import { AuthModal } from "./auth-modal"

interface Message {
  id: number
  type: "user" | "bot"
  content: string
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      type: "bot",
      content:
        "Hi! I'm your AI assistant. I can help you automate tasks across Gmail, Slack, and 100+ other tools. What would you like to do today?",
    },
  ])
  const [input, setInput] = useState("")
  const [userMessageCount, setUserMessageCount] = useState(0)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(chatRef.current, {
        opacity: 0,
        y: 30,
        scale: 0.95,
        duration: 1,
        delay: 1,
        ease: "power3.out",
      })

      gsap.to(chatRef.current, {
        y: "+=10",
        duration: 3,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      })
    })

    return () => ctx.revert()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSend = () => {
    if (!input.trim()) return

    if (userMessageCount >= 2) {
      setShowAuthModal(true)
      return
    }

    const userMessage: Message = {
      id: messages.length + 1,
      type: "user",
      content: input,
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setUserMessageCount((prev) => prev + 1)

    setTimeout(() => {
      const botMessage: Message = {
        id: messages.length + 2,
        type: "bot",
        content: "I can help you with that! Let me connect to your tools and automate this task for you.",
      }
      setMessages((prev) => [...prev, botMessage])
    }, 1000)
  }

  return (
    <>
      <div ref={chatRef} className="mx-auto w-full max-w-3xl relative z-20">
        <div className="relative rounded-3xl border border-white/10 bg-[#121212]/80 backdrop-blur-xl shadow-2xl overflow-hidden min-h-[500px] flex flex-col">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />

          {/* Chat Messages Area */}
          <div className="relative flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-4 items-start ${message.type === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                <div
                  className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md shadow-lg ${
                    message.type === "bot"
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "bg-accent/20 text-accent border border-accent/30"
                  }`}
                >
                  {message.type === "bot" ? <Bot className="h-5 w-5" /> : <User className="h-5 w-5" />}
                </div>
                <div
                  className={`flex-1 max-w-[80%] rounded-2xl p-4 backdrop-blur-xl shadow-md ${
                    message.type === "bot"
                      ? "bg-white/5 border border-white/10 text-white/90"
                      : "bg-primary/20 border border-primary/20 text-white"
                  }`}
                >
                  <p className="text-base leading-relaxed">{message.content}</p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="relative border-t border-white/10 bg-[#0A0A0A]/90 backdrop-blur-2xl p-6 z-30">
            <div className="flex gap-4 items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Ask me to automate a task..."
                className="flex-1 rounded-2xl border border-white/20 bg-white/5 px-6 py-4 text-base md:text-lg text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all hover:bg-white/10 shadow-inner"
              />
              <Button
                onClick={handleSend}
                size="icon"
                className="h-14 w-14 rounded-2xl shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all duration-300 hover:scale-105 bg-gradient-to-br from-primary to-accent border border-white/10"
              >
                <Send className="h-6 w-6 text-white" />
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground text-center font-medium">
              Try: "Schedule a meeting" • "Summarize my emails" • "Create a Jira ticket"
            </p>
          </div>
        </div>
      </div>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="You've reached the message limit. Sign in to continue chatting and unlock unlimited conversations!"
      />
    </>
  )
}
