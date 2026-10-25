"use client";

import { Ellipsis, House, Inbox, ListTodo, LogOut, Menu as MenuIcon, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/components/overlay";
import { Brand } from "@/components/ui";
import { cx } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace";
import { usePalette } from "./command-palette";
import { isActivePath, PRIMARY_NAV, SECONDARY_NAV } from "./nav";
import { Rail, signOut, ThemeControl } from "./rail";

function Drawer({
  open,
  onClose,
  side,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  side: "left" | "bottom";
  children: React.ReactNode;
  label: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(open, panel, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className="anim-fade-in absolute inset-0 bg-scrim"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cx(
          "absolute bg-canvas shadow-pop outline-none",
          side === "left"
            ? "anim-sheet-left inset-y-0 left-0 w-[min(300px,86vw)] border-r border-line"
            : "anim-sheet-bottom inset-x-0 bottom-0 rounded-t-[16px] pb-[env(safe-area-inset-bottom)]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  const palette = usePalette();
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on navigation
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("synapse:open-drawer", onOpen);
    return () => window.removeEventListener("synapse:open-drawer", onOpen);
  }, []);
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-2 md:hidden">
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <MenuIcon />
        </button>
        <Link href="/" className="flex-1 px-1" aria-label="Synapse home">
          <Brand />
        </Link>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Search and commands"
          onClick={palette.open}
        >
          <Search />
        </button>
      </div>
      <Drawer open={open} onClose={() => setOpen(false)} side="left" label="Menu">
        <Rail onNavigate={() => setOpen(false)} />
      </Drawer>
    </>
  );
}

export function BottomTabs() {
  const pathname = usePathname();
  const { approvals, teamApprovals } = useWorkspace();
  const [more, setMore] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on navigation
  useEffect(() => setMore(false), [pathname]);
  const count = (approvals?.length ?? 0) + teamApprovals.length;
  const tab = "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";
  const moreLinks = [...PRIMARY_NAV.slice(2), ...SECONDARY_NAV];
  const moreActive = moreLinks.some((l) => isActivePath(pathname, l.href));
  return (
    <>
      <nav
        aria-label="Primary"
        className="flex h-14 shrink-0 items-stretch border-t border-line bg-canvas pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <Link
          href="/"
          aria-current={pathname === "/" ? "page" : undefined}
          className={cx(tab, pathname === "/" ? "text-fg" : "text-fg-faint")}
        >
          <House className="size-5" />
          Home
        </Link>
        <Link
          href="/inbox"
          aria-current={pathname === "/inbox" ? "page" : undefined}
          className={cx(tab, "relative", pathname === "/inbox" ? "text-fg" : "text-fg-faint")}
        >
          <span className="relative">
            <Inbox className="size-5" />
            {count > 0 ? (
              <span className="tabular absolute -top-1.5 -right-2.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-attention px-1 text-[10px] font-semibold text-surface">
                {count}
              </span>
            ) : null}
          </span>
          Inbox
        </Link>
        <button
          type="button"
          className={cx(tab, pathname.startsWith("/t/") ? "text-fg" : "text-fg-faint")}
          onClick={() => window.dispatchEvent(new Event("synapse:open-drawer"))}
        >
          <ListTodo className="size-5" />
          Tasks
        </button>
        <button
          type="button"
          className={cx(tab, moreActive ? "text-fg" : "text-fg-faint")}
          onClick={() => setMore(true)}
          aria-expanded={more}
        >
          <Ellipsis className="size-5" />
          More
        </button>
      </nav>
      <Drawer open={more} onClose={() => setMore(false)} side="bottom" label="More">
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line-strong" />
        <ul className="p-3">
          {moreLinks.map((l) => {
            const Icon = l.icon;
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="flex h-11 items-center gap-3 rounded-[8px] px-3 text-14 text-fg hover:bg-hover"
                >
                  <Icon className="text-fg-muted" />
                  {l.label}
                </Link>
              </li>
            );
          })}
          <li className="mt-2 flex h-11 items-center justify-between border-t border-line px-3 pt-2 text-14 text-fg-muted">
            Theme
            <ThemeControl />
          </li>
          <li>
            <button
              type="button"
              className="flex h-11 w-full items-center gap-3 rounded-[8px] px-3 text-14 text-fg hover:bg-hover"
              onClick={() => void signOut()}
            >
              <LogOut className="text-fg-muted" />
              Sign out
            </button>
          </li>
        </ul>
      </Drawer>
    </>
  );
}
