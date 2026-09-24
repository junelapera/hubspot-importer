import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase for reading + writing the auth session cookie.
// Uses the PUBLIC anon key (never service_role — that would bypass RLS
// and expose everyone's data). Reads cookies via Next's `cookies()` API
// so this only works inside a request scope (server components, route
// handlers, middleware helpers that pass cookies through).
export async function createSupabaseServerAuthClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required for auth. Add them to .env.local.",
    );
  }
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `set` throws in Server Components (read-only). That's fine —
          // Server Components can't mutate the response anyway. Route
          // handlers + middleware use their own set/get pattern.
        }
      },
    },
  });
}

// Convenience: returns the currently logged-in user, or null. Used by
// server components + route handlers.
export async function getCurrentUser() {
  const client = await createSupabaseServerAuthClient();
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}
