import { Activity, BookOpen, House, Inbox, Plug, Repeat, Settings } from "lucide-react";

export const PRIMARY_NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/automations", label: "Automations", icon: Repeat },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/connections", label: "Connections", icon: Plug },
] as const;

export const SECONDARY_NAV = [
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
