"use client";

import { LogOut, Monitor, Moon, Plus, Search, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Menu } from "@/components/overlay";
import { Brand, Kbd, Monogram, Segmented, Skeleton, StatusDot, taskStatus } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { cx, formatCost, formatDateTime, formatRelative } from "@/lib/format";
import { type ThemePref, useTheme } from "@/lib/theme";
import { useWorkspace } from "@/lib/workspace";
import { usePalette } from "./command-palette";
import { isActivePath, PRIMARY_NAV, SECONDARY_NAV } from "./nav";

export async function signOut() {
  try {
    localStorage.removeItem("synapse-session");
  } catch {}
  await authClient.signOut().catch(() => {});
  window.location.href = "/sign-in";
}

export function Rail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { tasks, approvals } = useWorkspace();
  const palette = usePalette();
  const [query, setQuery] = useState("");
  const inboxCount = approvals?.length ?? 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!tasks) return null;
    return q ? tasks.filter((t) => (t.title || "Untitled").toLowerCase().includes(q)) : tasks;
  }, [tasks, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Link href="/" onClick={onNavigate} className="rounded-md" aria-label="Synapse home">
          <Brand />
        </Link>
      </div>

      <div className="flex gap-1.5 px-3 pb-3">
        <button
          type="button"
          className="btn h-9 flex-1 justify-start gap-2 bg-surface pr-2 pl-3 text-13 shadow-[0_1px_0_rgb(0_0_0/0.03)]"
          onClick={() => {
            onNavigate?.();
            router.push("/?new=1");
          }}
        >
          <Plus className="text-fg-muted" />
          <span className="flex-1 text-left">New task</span>
          <Kbd>N</Kbd>
        </button>
        <button
          type="button"
          className="btn btn-icon h-9 w-9 bg-surface"
          aria-label="Search and commands (⌘K)"
          title="Search and commands (⌘K)"
          onClick={() => {
            onNavigate?.();
            palette.open();
          }}
        >
          <Search className="text-fg-muted" />
        </button>
      </div>

      <nav aria-label="Main" className="px-3">
        <ul className="space-y-px">
          {PRIMARY_NAV.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-13 transition-colors duration-150",
                    active
                      ? "bg-surface font-medium text-fg shadow-[0_0_0_1px_var(--line)]"
                      : "text-fg-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  <Icon className={active ? "text-fg" : "text-fg-faint"} />
                  <span className="flex-1">{item.label}</span>
                  {item.href === "/inbox" && inboxCount > 0 ? (
                    <span className="tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-attention px-1.5 text-[11px] font-semibold text-surface">
                      {inboxCount}
                      <span className="sr-only"> waiting</span>
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-6 flex items-center justify-between px-5 pb-2">
        <h2 className="eyebrow">Tasks</h2>
      </div>
      <div className="px-3 pb-1.5">
        <label htmlFor="rail-task-search" className="sr-only">
          Filter tasks
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-faint" />
          <input
            id="rail-task-search"
            type="search"
            placeholder="Filter tasks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-full rounded-[7px] border border-transparent bg-transparent pr-2 pl-8 text-13 text-fg outline-none transition-colors duration-150 placeholder:text-fg-faint hover:bg-hover focus:border-line-strong focus:bg-surface"
          />
        </div>
      </div>
      <nav aria-label="Tasks" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {filtered === null ? (
          <div className="space-y-3 px-2.5 pt-2">
            {[70, 85, 60, 78].map((w) => (
              <Skeleton key={w} className="h-3.5" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-2.5 py-2 text-12 text-fg-faint">
            {query ? "No tasks match." : "Tasks you start show up here."}
          </p>
        ) : (
          <ul className="space-y-px">
            {filtered.map((t) => {
              const href = `/t/${t.id}`;
              const active = pathname === href;
              const status = t.pendingApprovals > 0 ? "needs" : taskStatus(t.status);
              return (
                <li key={t.id}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "group flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-13 transition-colors duration-150",
                      active
                        ? "bg-surface text-fg shadow-[0_0_0_1px_var(--line)]"
                        : "text-fg-muted hover:bg-hover hover:text-fg",
                    )}
                  >
                    <StatusDot status={status} />
                    <span className="min-w-0 flex-1 truncate">{t.title || "Untitled"}</span>
                    <span
                      className="tabular shrink-0 text-12 text-fg-faint"
                      title={formatDateTime(t.updatedAt)}
                    >
                      {formatRelative(t.updatedAt).replace(" ago", "")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="shrink-0 border-t border-line px-3 py-2">
        <ul className="space-y-px">
          {SECONDARY_NAV.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-13 transition-colors duration-150",
                    active
                      ? "bg-surface font-medium text-fg shadow-[0_0_0_1px_var(--line)]"
                      : "text-fg-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  <Icon className={active ? "text-fg" : "text-fg-faint"} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <AccountMenu />
      </div>
    </div>
  );
}

export function ThemeControl() {
  const [theme, setTheme] = useTheme();
  return (
    <Segmented<ThemePref>
      label="Theme"
      size="sm"
      value={theme}
      onChange={setTheme}
      options={[
        {
          value: "system",
          label: (
            <>
              <Monitor className="size-3.5" />
              <span className="sr-only">System</span>
            </>
          ),
        },
        {
          value: "light",
          label: (
            <>
              <Sun className="size-3.5" />
              <span className="sr-only">Light</span>
            </>
          ),
        },
        {
          value: "dark",
          label: (
            <>
              <Moon className="size-3.5" />
              <span className="sr-only">Dark</span>
            </>
          ),
        },
      ]}
    />
  );
}

function AccountMenu() {
  const { user, todaySpend } = useWorkspace();
  const name = user?.name || user?.email || "Account";
  return (
    <Menu
      side="top"
      align="start"
      className="mt-1"
      header={
        <div className="px-2.5 pt-2 pb-2.5">
          <div className="truncate text-13 font-medium text-fg">{name}</div>
          {user?.email && user.email !== name ? (
            <div className="truncate text-12 text-fg-muted">{user.email}</div>
          ) : null}
          <div className="mt-3 flex items-center justify-between text-12 text-fg-muted">
            <span>Spent today</span>
            <span className="tabular font-medium text-fg">{formatCost(todaySpend)}</span>
          </div>
          <div className="mt-2.5 flex items-center justify-between text-12 text-fg-muted">
            <span>Theme</span>
            <ThemeControl />
          </div>
          <div className="mt-2.5 h-px bg-line" />
        </div>
      }
      items={[{ label: "Sign out", icon: <LogOut />, onSelect: () => void signOut() }]}
      trigger={(p) => (
        <button
          {...p}
          type="button"
          className="flex h-10 w-full items-center gap-2.5 rounded-[7px] px-2 text-left text-13 text-fg hover:bg-hover"
        >
          <Monogram name={name} size={24} round />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span className="tabular text-12 text-fg-faint" title="Spent today">
            {todaySpend == null ? "" : formatCost(todaySpend)}
          </span>
        </button>
      )}
    />
  );
}
