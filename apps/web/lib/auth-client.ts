"use client";

import { createAuthClient } from "better-auth/react";

// Auth endpoints are proxied under /api/auth on the web origin.
export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? "http://localhost:3000" : window.location.origin,
});
