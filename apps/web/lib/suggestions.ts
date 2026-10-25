"use client";

import type { RuleSuggestion } from "@synapse/core";
import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";

/**
 * Learned-rule suggestions, shared by the inbox strip and the prompt after an approval, so
 * accepting in one place clears the other.
 */
let current: RuleSuggestion[] | null = null;
const listeners = new Set<() => void>();
let generation = 0;

function set(next: RuleSuggestion[]) {
  current = next;
  for (const fn of listeners) fn();
}

export async function refreshSuggestions(): Promise<void> {
  const gen = ++generation;
  try {
    const { suggestions } = await api.suggestions();
    // A later refresh (e.g. right after an approval) wins over an earlier one.
    if (gen === generation) set(suggestions);
  } catch {
    // Suggestions are a nicety; keep the last known list.
  }
}

export async function acceptSuggestion(id: string) {
  const policy = await api.acceptSuggestion(id);
  generation++;
  set((current ?? []).filter((s) => s.id !== id));
  void refreshSuggestions();
  return policy;
}

export async function dismissSuggestion(id: string) {
  await api.dismissSuggestion(id);
  generation++;
  set((current ?? []).filter((s) => s.id !== id));
}

/** The current suggestions; `refreshKey` refetches when it changes (and on mount). */
export function useSuggestions(refreshKey: string | number = ""): RuleSuggestion[] | null {
  const list = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
    () => null,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the trigger
  useEffect(() => {
    void refreshSuggestions();
  }, [refreshKey]);
  return list;
}
