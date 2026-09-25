import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// Supabase Auth gate for the app. Runs on Edge.
//
// Checks the Supabase session cookie on every request. Missing session
// → redirect to /login (with ?next= preserving the intended URL). Public
// paths (/login, /register, /api/auth/*, static assets) always pass
// through. Requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.
//
// If neither env var is set, auth is skipped entirely (dev-mode fallback)
// so local development on a bare .env.local still works.
//
// Renamed from middleware.ts → proxy.ts in Next 16 per the framework's
// naming migration.

// Public paths: auth routes + Next's built-in icon conventions (favicon.ico,
// icon.png, apple-icon.png, etc.) so the browser tab icon renders on the
// login screen instead of getting redirected to itself.
// /api/inngest is called by Inngest Cloud (and the Inngest CLI dev
// server) with HMAC-signed webhooks — signing key verification is
// handled inside the serve() adapter, not by our auth gate. Redirecting
// those requests to /login would break every step invocation.
const PUBLIC_PREFIXES = ["/login", "/register", "/api/auth/", "/api/inngest", "/favicon", "/icon", "/apple-icon"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Dev-mode fallback: no env vars → no auth. Local `pnpm dev` on a bare
  // .env.local just works.
  if (!url || !anonKey) return NextResponse.next();

  // Build a response we can write refreshed session cookies into (Supabase
  // rotates the access token on read if it's near expiry).
  const res = NextResponse.next({ request: req });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value, options } of cookiesToSet) {
          res.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  if (data.user) return res;

  // No session → redirect to /login and preserve the intended destination
  // so we can bounce them back after auth.
  const nextUrl = req.nextUrl.clone();
  const next = nextUrl.pathname + nextUrl.search;
  const loginUrl = new URL("/login", req.url);
  if (next && next !== "/") loginUrl.searchParams.set("next", next);
  return NextResponse.redirect(loginUrl);
}

// Match all pages + API routes. Exclude Next's static asset paths, the
// default favicon, and any request ending in a common static-file
// extension (public/*.svg, *.png, etc.) so asset fetches don't hit the
// auth gate and get 307'd to /login.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|avif)$).*)",
  ],
};
