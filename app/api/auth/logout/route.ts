import { NextResponse } from "next/server";
import { createSupabaseServerAuthClient } from "@/lib/db/supabase-server-auth";

// POST /api/auth/logout → clears the Supabase session cookie + redirects
// to /login. Kept as POST (not GET) so a stray link/pre-fetch can't sign
// users out unintentionally.

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createSupabaseServerAuthClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
