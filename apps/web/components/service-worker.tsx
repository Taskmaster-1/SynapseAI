"use client";

import { useEffect } from "react";
import { registerServiceWorker, SW_ENABLED } from "@/lib/push";

/**
 * Registers public/sw.js, which shows approval notifications and handles their
 * Approve/Deny buttons. Production builds only (or NEXT_PUBLIC_ENABLE_SW=true), so
 * development never serves stale code from a worker. It caches nothing.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!SW_ENABLED || !("serviceWorker" in navigator)) return;
    registerServiceWorker().catch(() => {
      // Unsupported context (e.g. plain http on a LAN address): push just stays off.
    });
  }, []);
  return null;
}
