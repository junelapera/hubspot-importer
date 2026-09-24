import { NextResponse, type NextRequest } from "next/server";
import { normalizeAndCheckEmail, ALLOWED_EMAIL_DOMAIN } from "@/lib/auth/email-domain";
import { createSupabaseServerAuthClient } from "@/lib/db/supabase-server-auth";

// POST /api/auth/register
// { email, password } → creates a Supabase Auth user + sets session cookies.
// Enforces the @saltedstone.com email domain server-side (client-side check
// is UX only; never trust the client).
//
// Runs on Node runtime because supabase-ssr's cookie helpers read Next's
// `cookies()` API, and we want the response cookies written back.

export const runtime = "nodejs";

const MIN_PASSWORD_LENGTH = 8;

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await req.json()) as { email?: unknown; password?: unknown };
  } catch (err) {
    return errorResponse(400, `invalid JSON body: ${(err as Error).message}`);
  }

  const email = normalizeAndCheckEmail(body.email);
  if (!email) {
    return errorResponse(
      400,
      `Only @${ALLOWED_EMAIL_DOMAIN} email addresses are allowed to register.`,
    );
  }

  if (typeof body.password !== "string" || body.password.length < MIN_PASSWORD_LENGTH) {
    return errorResponse(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const supabase = await createSupabaseServerAuthClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: body.password,
  });

  if (error) {
    // Common cases we want to surface cleanly:
    // - "User already registered" → 409
    // - other → 400 with Supabase's message
    const status = /already registered/i.test(error.message) ? 409 : 400;
    return errorResponse(status, error.message);
  }

  // If Supabase's "Confirm email" is enabled, data.session will be null
  // and the user must click a verification link before they can log in.
  // Surface that state so the client knows to prompt.
  if (!data.session) {
    return NextResponse.json(
      {
        pendingConfirmation: true,
        message:
          "Check your email for a confirmation link. If you don't see one, ask an admin to disable 'Confirm email' in Supabase Auth settings.",
      },
      { status: 202 },
    );
  }

  return NextResponse.json({ userId: data.user?.id ?? null, email });
}
