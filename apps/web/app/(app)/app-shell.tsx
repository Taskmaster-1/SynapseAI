"use client";

import { LucideProvider } from "lucide-react";
import type { ReactNode } from "react";
import { CommandPalette, PaletteProvider } from "@/components/shell/command-palette";
import { BottomTabs, MobileTopBar } from "@/components/shell/mobile";
import { Rail } from "@/components/shell/rail";
import { WorkspaceProvider } from "@/lib/workspace";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <LucideProvider size={16} strokeWidth={1.75}>
      <WorkspaceProvider>
        <PaletteProvider>
          <div className="flex h-dvh overflow-hidden bg-canvas">
            <aside
              aria-label="Sidebar"
              className="hidden w-[248px] shrink-0 border-r border-line md:flex md:flex-col"
            >
              <Rail />
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
              <MobileTopBar />
              <main id="main" className="relative min-h-0 flex-1 overflow-hidden">
                {children}
              </main>
              <BottomTabs />
            </div>
          </div>
          <CommandPalette />
        </PaletteProvider>
      </WorkspaceProvider>
    </LucideProvider>
  );
}
