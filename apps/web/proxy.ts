import { type NextRequest, NextResponse } from "next/server";

// Better Auth's session cookie, plain on http and __Secure- prefixed on https.
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

/**
 * Signed-out visitors to `/` see the landing page; signed-in users get their workspace.
 * Only checks that a session cookie exists: the app still verifies it, and an expired
 * cookie just lands on the workspace, which redirects to sign-in as before.
 */
export function proxy(request: NextRequest) {
  const signedIn = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (signedIn) return NextResponse.next();
  return NextResponse.rewrite(new URL("/welcome", request.url));
}

export const config = { matcher: "/" };
