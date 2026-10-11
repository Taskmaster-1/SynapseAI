"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

import { THEME_KEY as KEY } from "./theme-boot";

function read(): ThemePref {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

const listeners = new Set<(p: ThemePref) => void>();

/** Theme preference shared across components; persisted per browser. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    setPref(read());
    listeners.add(setPref);
    return () => {
      listeners.delete(setPref);
    };
  }, []);
  const set = useCallback((next: ThemePref) => {
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // storage unavailable: still apply for this page
    }
    apply(next);
    for (const l of listeners) l(next);
  }, []);
  return [pref, set] as const;
}
