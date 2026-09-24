import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// Auth gate for the app. Two modes, picked automatically:
//
// 1. **HTTP Basic Auth** (legacy) — if BASIC_AUTH_USER + BASIC_AUTH_PASSWORD
//    are set, gate everything with a shared username/password (browser
//    popup). Kept as-is for existing Vercel Hobby deploys so migration to
//    Supabase Auth can happen on your own timeline. Unset both env vars to
//    switch to mode 2.
//
// 2. **Supabase Auth** (default) — checks the Supabase session cookie.
//    Missing session → redirect to /login (with ?next= preserving the
//    intended URL). Public paths (/login, /register, /api/auth/*, static
//    assets) always pass through. Requires NEXT_PUBLIC_SUPABASE_URL +
//    NEXT_PUBLIC_SUPABASE_ANON_KEY.
//
// Runs on Edge; uses `atob` + constant-time compare for the Basic Auth
// path to avoid a timing-attack surface. Renamed from middleware.ts →
// proxy.ts in Next 16 per the framework's naming migration.

const REALM = "HubDB Importer";
const PUBLIC_PREFIXES = ["/login", "/register", "/api/auth/", "/favicon"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function constantTimeEqual(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
    },
  });
}

function basicAuthGate(req: NextRequest, user: string, password: string): NextResponse {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Basic ")) return unauthorized();

  let decoded: string;
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return unauthorized();
  }

  const sep = decoded.indexOf(":");
  if (sep < 0) return unauthorized();
  const presentedUser = decoded.slice(0, sep);
  const presentedPass = decoded.slice(sep + 1);

  const userOk = constantTimeEqual(presentedUser, user);
  const passOk = constantTimeEqual(presentedPass, password);
  if (!userOk || !passOk) return unauthorized();

  return NextResponse.next();
}

async function supabaseAuthGate(req: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase Auth env vars aren't set, skip auth entirely (dev-mode
  // fallback). Local development without any auth env vars just works.
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

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const basicUser = process.env.BASIC_AUTH_USER;
  const basicPass = process.env.BASIC_AUTH_PASSWORD;

  // Basic Auth path: both env vars set → gate. Partial config fails closed.
  if (basicUser || basicPass) {
    if (!basicUser || !basicPass) return unauthorized();
    return basicAuthGate(req, basicUser, basicPass);
  }

  // Supabase Auth path (default).
  return supabaseAuthGate(req);
}

// Match all pages + API routes. Exclude Next's static asset paths and the
// default favicon so image requests don't re-run the gate on every asset.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
