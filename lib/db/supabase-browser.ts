"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Client-side Supabase for Auth (login / register / logout / current user).
// Uses the PUBLIC anon key — safe to expose to the browser; RLS is what
// keeps data safe on the DB side. Never import from server code.
export function createSupabaseBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required to sign in. Add them to .env.local — grab from Project Settings → API in your Supabase dashboard (anon public key, not service_role).",
    );
  }
  return createBrowserClient(url, anonKey);
}
