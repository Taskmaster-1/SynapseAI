"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Zap,
  BookOpen,
  History,
  Settings,
  LogOut,
  Send,
  Paperclip,
  Sparkles,
  Mail,
  MessageSquare,
  Calendar,
  FileText,
  Github,
  Trello,
  Figma,
  Bot,
  UserIcon,
  ChevronDown,
} from "lucide-react"
import Link from "next/link"
import { gsap } from "gsap"
import { getUser, clearUser, type User } from "@/lib/auth"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

interface ChatHistory {
  id: string
  title: string
  lastMessage: string
}

const chatHistory: ChatHistory[] = [
  { id: "1", title: "Chat 1", lastMessage: "Hello!" },
  { id: "2", title: "Chat 2", lastMessage: "How are you?" },
]

export default function DashboardPage() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [activeChat, setActiveChat] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const userData = getUser()
    if (userData) {
      setUser(userData)
    } else {
      // Redirect to sign-in if no user data
      window.location.href = "/sign-in"
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (chatContainerRef.current) {
      gsap.from(chatContainerRef.current, {
        opacity: 0,
        y: 20,
        duration: 0.8,
        ease: "power3.out",
      })
    }
  }, [])

  const handleLogout = () => {
    clearUser()
    window.location.href = "/"
  }

  const getUserInitials = () => {
    if (!user) return "U"
    const names = user.name.split(" ")
    if (names.length >= 2) {
      return `${names[0][0]}${names[1][0]}`.toUpperCase()
    }
    return user.name.substring(0, 2).toUpperCase()
  }

  const getFirstName = () => {
    if (!user) return "there"
    return user.name.split(" ")[0]
  }

  const handleSendMessage = () => {
    if (!inputValue.trim()) return

    const newMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue,
      timestamp: new Date(),
    }

    setMessages([...messages, newMessage])
    setInputValue("")

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "I'm processing your request. I can help you with that task using the connected integrations.",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, aiResponse])
    }, 1000)
  }

  const handleQuickAction = (action: string) => {
    setInputValue(action)
  }

  if (!user) {
    return null
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-background via-background to-primary/5 overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${sidebarCollapsed ? "w-0" : "w-64"} transition-all duration-300 border-r border-white/10 bg-background/80 backdrop-blur-xl flex flex-col overflow-hidden`}
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            {!sidebarCollapsed && <span className="font-bold text-lg">AgentFlow</span>}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hover:bg-white/5"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        {!sidebarCollapsed && (
          <>
            {/* New Chat Button */}
            <div className="p-4">
              <Button
                className="w-full bg-gradient-to-r from-primary to-primary/80 hover:shadow-lg hover:shadow-primary/30 transition-all group"
                onClick={() => {
                  setMessages([])
                  setActiveChat(null)
                }}
              >
                <Plus className="mr-2 h-4 w-4 group-hover:rotate-90 transition-transform" />
                New Chat
              </Button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
              <Button variant="ghost" className="w-full justify-start hover:bg-white/5 text-primary" onClick={() => {}}>
                <Zap className="mr-2 h-4 w-4" />
                Integrations
                <span className="ml-auto text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                  {integrations.length} active
                </span>
              </Button>

              <Button variant="ghost" className="w-full justify-start hover:bg-white/5">
                <Sparkles className="mr-2 h-4 w-4" />
                Boost
              </Button>

              <Button variant="ghost" className="w-full justify-start hover:bg-white/5">
                <BookOpen className="mr-2 h-4 w-4" />
                Spellbooks
              </Button>

              {/* History Section */}
              <div className="pt-6">
                <div className="flex items-center gap-2 px-2 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <History className="h-3 w-3" />
                  History
                </div>
                <div className="space-y-1 mt-2">
                  {chatHistory.map((chat) => (
                    <Button
                      key={chat.id}
                      variant="ghost"
                      className={`w-full justify-start hover:bg-white/5 text-left h-auto py-2 ${
                        activeChat === chat.id ? "bg-white/10" : ""
                      }`}
                      onClick={() => setActiveChat(chat.id)}
                    >
                      <div className="flex flex-col items-start overflow-hidden">
                        <span className="text-sm font-medium truncate w-full">{chat.title}</span>
                        <span className="text-xs text-muted-foreground truncate w-full">{chat.lastMessage}</span>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>
            </nav>

            {/* User Profile */}
            <div className="p-4 border-t border-white/10">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="w-full justify-start hover:bg-white/5 h-auto py-2">
                    <Avatar className="h-8 w-8 mr-2">
                      <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name} />
                      <AvatarFallback>{getUserInitials()}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col items-start overflow-hidden">
                      <span className="text-sm font-medium">{user.name}</span>
                      <span className="text-xs text-muted-foreground">{user.email}</span>
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-background/95 backdrop-blur-xl border-white/10">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem className="cursor-pointer hover:bg-white/5">
                    <UserIcon className="mr-2 h-4 w-4" />
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer hover:bg-white/5">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onClick={handleLogout} className="cursor-pointer hover:bg-white/5 text-red-500">
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div ref={chatContainerRef} className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
          {messages.length === 0 ? (
            // Welcome Screen
            <div className="max-w-3xl w-full space-y-8">
              {/* Greeting */}
              <div className="text-center space-y-2">
                <h1 className="text-5xl font-bold bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                  Hi, {getFirstName()}
                </h1>
                <p className="text-2xl text-muted-foreground">What can I help you with?</p>
              </div>

              {/* Input Area */}
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20 blur-2xl rounded-3xl" />
                <div className="relative rounded-2xl border border-white/10 bg-background/60 backdrop-blur-2xl p-4 shadow-lg">
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" className="hover:bg-white/5 shrink-0">
                      <Paperclip className="h-5 w-5" />
                    </Button>
                    <Input
                      placeholder="Your AI assistant ready to help with any task"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                      className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-base"
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="border-white/10 hover:bg-white/5 bg-transparent shrink-0"
                          title="Priority: High"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="bg-background/95 backdrop-blur-xl border-white/10">
                        <DropdownMenuItem>Low</DropdownMenuItem>
                        <DropdownMenuItem>Medium</DropdownMenuItem>
                        <DropdownMenuItem>High</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="border-white/10 hover:bg-white/5 bg-transparent shrink-0 relative"
                          title={`${integrations.length} integrations active`}
                        >
                          <Zap className="h-4 w-4" />
                          <span className="absolute -top-1 -right-1 h-4 w-4 bg-primary rounded-full flex items-center justify-center text-[10px] font-semibold">
                            {integrations.length}
                          </span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="bg-background/95 backdrop-blur-xl border-white/10 w-48">
                        <DropdownMenuLabel>Active Integrations</DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-white/10" />
                        {integrations.map((integration) => {
                          const Icon = integration.icon
                          return (
                            <DropdownMenuItem key={integration.name} className="cursor-pointer hover:bg-white/5">
                              <Icon className="mr-2 h-4 w-4" />
                              {integration.name}
                            </DropdownMenuItem>
                          )
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      size="icon"
                      onClick={handleSendMessage}
                      className="bg-gradient-to-r from-primary to-accent hover:shadow-lg hover:shadow-primary/30 shrink-0"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="grid grid-cols-2 gap-3">
                {quickActions.map((action, index) => (
                  <button
                    key={index}
                    onClick={() => handleQuickAction(action)}
                    className="text-left p-4 rounded-xl border border-white/10 bg-background/40 backdrop-blur-sm hover:bg-background/60 hover:border-primary/30 hover:scale-[1.02] transition-all group"
                  >
                    <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                      {action}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // Chat Messages
            <div className="max-w-3xl w-full space-y-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {message.role === "assistant" && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
                      <Bot className="h-5 w-5 text-primary-foreground" />
                    </div>
                  )}
                  <div
                    className={`rounded-2xl px-4 py-3 max-w-[80%] ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background/60 backdrop-blur-sm border border-white/10"
                    }`}
                  >
                    <p className="text-sm">{message.content}</p>
                  </div>
                  {message.role === "user" && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent">
                      <UserIcon className="h-5 w-5 text-accent-foreground" />
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Fixed Input at Bottom (when chatting) */}
        {messages.length > 0 && (
          <div className="border-t border-white/10 bg-background/80 backdrop-blur-xl p-4">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-background/60 backdrop-blur-sm p-3">
                <Button variant="ghost" size="icon" className="hover:bg-white/5 shrink-0">
                  <Paperclip className="h-5 w-5" />
                </Button>
                <Input
                  placeholder="Type your message..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Button
                  size="icon"
                  onClick={handleSendMessage}
                  className="bg-gradient-to-r from-primary to-accent hover:shadow-lg hover:shadow-primary/30 shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

const integrations = [
  { name: "Gmail", icon: Mail, status: "active" },
  { name: "Slack", icon: MessageSquare, status: "active" },
  { name: "Calendar", icon: Calendar, status: "active" },
  { name: "Notion", icon: FileText, status: "active" },
  { name: "GitHub", icon: Github, status: "active" },
  { name: "Trello", icon: Trello, status: "active" },
  { name: "Figma", icon: Figma, status: "active" },
]

const quickActions = [
  "Summarize today's Jira tickets assigned to me",
  "Share this Confluence doc in the design Slack channel",
  'Get a list of unread emails tagged "Urgent"',
  "Draft a response to my last received email in Gmail",
  "Summarize emails from leads in Gmail",
  "Search Google Drive for the latest sales deck",
]
