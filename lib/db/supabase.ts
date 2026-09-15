import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL_ENV = "SUPABASE_URL";
const SUPABASE_SERVICE_ROLE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY";

/**
 * Server-side Supabase client. Uses the service role key (bypasses RLS) —
 * only ever import this from server code (API routes, workers, scripts).
 * Never import from a "use client" file or leak the key to the browser.
 *
 * Untyped for now (SupabaseClient). Layered typed repos (lib/db/portals.ts
 * etc.) wrap this and provide the row shapes.
 */
export function createSupabaseServerClient(): SupabaseClient {
  const url = process.env[SUPABASE_URL_ENV];
  const key = process.env[SUPABASE_SERVICE_ROLE_KEY_ENV];
  if (!url || !key) {
    throw new Error(
      `${SUPABASE_URL_ENV} and ${SUPABASE_SERVICE_ROLE_KEY_ENV} are required. Set them in .env.local — get the values from your Supabase project's Settings → API page.`,
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
