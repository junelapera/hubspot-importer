import { NextResponse, type NextRequest } from "next/server";

// HTTP Basic Auth gate so we can safely deploy on Vercel's Hobby tier
// (which serves the app publicly). Requires both env vars to be set —
// unset means "dev mode, no auth" so local development stays friction-
// free. Set both in Vercel's dashboard for the Production + Preview
// environments before deploying.
//
// Runs on Edge; uses `atob` + a constant-time comparison to avoid the
// tiny timing-attack surface a naive `===` would expose.
//
// Renamed from middleware.ts → proxy.ts in Next 16 per the framework's
// naming migration (same runtime, same matcher semantics).

const REALM = "HubDB Importer";

function constantTimeEqual(a: string, b: string): boolean {
  // Length differs → not equal, but still walk the shorter string to
  // keep timing consistent across mismatched lengths (best-effort at
  // the JS layer — the perfect version would use crypto.subtle).
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

export function proxy(req: NextRequest): NextResponse {
  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;

  // Dev mode: neither var set → skip auth entirely.
  if (!user && !password) return NextResponse.next();

  // Partial config is a deploy-time mistake — fail closed so we don't
  // accidentally serve a "protected" app that accepts anything.
  if (!user || !password) return unauthorized();

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

// Match all pages + API routes. Exclude Next's static asset paths and
// the default favicon so the browser's Basic-Auth prompt doesn't fire
// on every image request.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
