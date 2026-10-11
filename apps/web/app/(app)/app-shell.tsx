"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { StatusDot } from "@/components/badges";
import { authClient } from "@/lib/auth-client";
import { ChatsProvider, useChats } from "@/lib/chats-context";
import { cx } from "@/lib/format";

const NAV = [
  { href: "/approvals", label: "Approvals" },
  { href: "/automations", label: "Automations" },
  { href: "/connections", label: "Connections" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/memory", label: "Memory" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer on navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run on route change
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <ChatsProvider>
      <div className="flex h-dvh overflow-hidden">
        {open ? (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-30 bg-black/30 md:hidden"
            onClick={() => setOpen(false)}
          />
        ) : null}
        <aside
          id="sidebar"
          className={cx(
            "fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-border bg-subtle transition-transform md:static md:translate-x-0",
            open ? "translate-x-0 shadow-xl" : "-translate-x-full",
          )}
        >
          <Sidebar />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="sidebar"
              onClick={() => setOpen(true)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            <span className="font-semibold">SynapseAI</span>
          </div>
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </ChatsProvider>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const { chats, pendingApprovals } = useChats();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <Link href="/" className="px-1 font-semibold tracking-tight">
          SynapseAI
        </Link>
        <Link href="/" className="btn btn-sm" aria-label="New chat">
          + New chat
        </Link>
      </div>
      <nav aria-label="Main" className="px-2 pb-2">
        <ul className="space-y-px">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex h-8 items-center justify-between rounded-md px-2 text-fg-muted hover:bg-hover hover:text-fg",
                    active && "bg-muted text-fg",
                  )}
                >
                  {item.label}
                  {item.href === "/approvals" && pendingApprovals > 0 ? (
                    <span className="rounded-full bg-send-bg px-1.5 text-xs font-semibold text-send-fg">
                      {pendingApprovals}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="px-4 pt-2 pb-1 text-xs font-medium tracking-wide text-fg-faint uppercase">
        Chats
      </div>
      <nav aria-label="Chats" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {chats === null ? (
          <p className="px-2 py-1 text-fg-faint">Loading…</p>
        ) : chats.length === 0 ? (
          <p className="px-2 py-1 text-fg-faint">No chats yet</p>
        ) : (
          <ul className="space-y-px">
            {chats.map((chat) => {
              const href = `/c/${chat.id}`;
              const active = pathname === href;
              return (
                <li key={chat.id}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex h-8 items-center gap-2 rounded-md px-2 hover:bg-hover",
                      active ? "bg-muted text-fg" : "text-fg-muted",
                    )}
                  >
                    <StatusDot status={chat.status} />
                    <span className="min-w-0 flex-1 truncate">{chat.title || "Untitled"}</span>
                    {chat.pendingApprovals > 0 ? (
                      <span
                        className="rounded-full bg-send-bg px-1.5 text-xs font-semibold text-send-fg"
                        title={`${chat.pendingApprovals} awaiting approval`}
                      >
                        {chat.pendingApprovals}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
      <div className="border-t border-border p-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm w-full justify-start text-fg-muted"
          onClick={async () => {
            await authClient.signOut().catch(() => {});
            window.location.href = "/sign-in";
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
