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

const PUBLIC_PREFIXES = ["/login", "/register", "/api/auth/", "/favicon"];

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

// Match all pages + API routes. Exclude Next's static asset paths and the
// default favicon so image requests don't re-run the gate on every asset.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
