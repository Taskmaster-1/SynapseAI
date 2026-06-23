import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function proxy(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() { return req.cookies.getAll(); },
      setAll(toSet) {
        toSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: { session } } = await supabase.auth.getSession();

  const { pathname } = req.nextUrl;
  const isProtected = pathname.startsWith("/dashboard");
  const isAuthPage  = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");

  if (isProtected && !session) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  if (isAuthPage && session) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/sign-in", "/sign-up"],
};
