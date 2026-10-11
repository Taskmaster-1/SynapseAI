"use client";

import { Brain, CornerDownLeft, Plus, Search, ShieldCheck } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Modal } from "@/components/overlay";
import { Kbd, StatusDot, taskStatus } from "@/components/ui";
import { cx, formatRelative } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace";
import { PRIMARY_NAV, SECONDARY_NAV } from "./nav";

interface PaletteValue {
  open: () => void;
}
const PaletteContext = createContext<PaletteValue>({ open: () => {} });
export const usePalette = () => useContext(PaletteContext);

const OpenState = createContext<[boolean, (v: boolean) => void]>([false, () => {}]);

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

/** Owns ⌘K / Ctrl+K and the global "N" (new task) shortcut. */
export function PaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e) || e.defaultPrevented) return;
      if (e.key === "n" || e.key === "N") {
        if (document.querySelector("[aria-modal=true]")) return;
        e.preventDefault();
        if (pathname === "/") document.getElementById("home-composer")?.focus();
        else router.push("/?new=1");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, pathname]);

  const value = useMemo(() => ({ open: () => setOpen(true) }), []);
  return (
    <PaletteContext.Provider value={value}>
      <OpenState.Provider value={[open, setOpen]}>{children}</OpenState.Provider>
    </PaletteContext.Provider>
  );
}

interface Item {
  id: string;
  group: "Actions" | "Go to" | "Tasks";
  label: string;
  icon: ReactNode;
  meta?: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useContext(OpenState);
  const close = useCallback(() => setOpen(false), [setOpen]);
  return (
    <Modal open={open} onClose={close} label="Command palette" className="max-w-[560px]">
      <PaletteBody onClose={close} />
    </Modal>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { tasks, approvals } = useWorkspace();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => {
      onClose();
      router.push(href);
    };
    const all: Item[] = [
      {
        id: "new",
        group: "Actions",
        label: "New task",
        icon: <Plus />,
        meta: <Kbd>N</Kbd>,
        run: go("/?new=1"),
      },
      ...[...PRIMARY_NAV, ...SECONDARY_NAV].map((n) => {
        const Icon = n.icon;
        return {
          id: `nav-${n.href}`,
          group: "Go to" as const,
          label: n.label,
          icon: <Icon />,
          meta:
            n.href === "/inbox" && approvals?.length ? (
              <span className="text-12 text-attention">{approvals.length} waiting</span>
            ) : undefined,
          run: go(n.href),
        };
      }),
      {
        id: "nav-memory",
        group: "Go to",
        label: "Memory",
        icon: <Brain />,
        run: go("/knowledge?tab=memory"),
      },
      {
        id: "nav-rules",
        group: "Go to",
        label: "Approval rules",
        icon: <ShieldCheck />,
        run: go("/settings?section=rules"),
      },
      ...(tasks ?? []).map((t) => ({
        id: `task-${t.id}`,
        group: "Tasks" as const,
        label: t.title || "Untitled",
        icon: (
          <StatusDot
            status={t.pendingApprovals > 0 ? "needs" : taskStatus(t.status)}
            className="mx-1"
          />
        ),
        meta: <span className="text-12 text-fg-faint">{formatRelative(t.updatedAt)}</span>,
        run: go(`/t/${t.id}`),
      })),
    ];
    const query = q.trim().toLowerCase();
    if (!query) return all.filter((i) => i.group !== "Tasks" || all.indexOf(i) < 30);
    return all.filter((i) => i.label.toLowerCase().includes(query));
  }, [q, tasks, approvals, router, onClose]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on query change
  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const groups = ["Actions", "Go to", "Tasks"] as const;
  let index = -1;

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="text-fg-faint" />
        <input
          data-autofocus
          aria-label="Search tasks and pages"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[active] ? `pal-${items[active].id}` : undefined}
          placeholder="Search tasks, jump to a page…"
          className="h-13 min-w-0 flex-1 bg-transparent text-16 text-fg outline-none placeholder:text-fg-faint"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              items[active]?.run();
            }
          }}
        />
        <Kbd>esc</Kbd>
      </div>
      <div
        ref={listRef}
        id="palette-list"
        role="listbox"
        className="scroll-thin max-h-[min(420px,60dvh)] overflow-y-auto p-1.5"
      >
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-13 text-fg-muted">Nothing matches “{q}”.</p>
        ) : (
          groups.map((g) => {
            const inGroup = items.filter((i) => i.group === g);
            if (inGroup.length === 0) return null;
            return (
              <div key={g} className="pb-1">
                <div className="eyebrow px-2.5 pt-2 pb-1">{g}</div>
                {inGroup.map((it) => {
                  index++;
                  const i = index;
                  const on = i === active;
                  return (
                    <div
                      key={it.id}
                      id={`pal-${it.id}`}
                      role="option"
                      aria-selected={on}
                      data-index={i}
                      tabIndex={-1}
                      onMouseMove={() => setActive(i)}
                      onClick={it.run}
                      onKeyDown={() => {}}
                      className={cx(
                        "flex h-9 cursor-pointer items-center gap-3 rounded-[8px] px-2.5 text-14",
                        on ? "bg-accent-soft text-fg" : "text-fg-muted",
                      )}
                    >
                      <span className={on ? "text-accent" : "text-fg-faint"}>{it.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.meta}
                      {on ? <CornerDownLeft className="size-3.5 text-fg-faint" /> : null}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
