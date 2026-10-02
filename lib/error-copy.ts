// Pure translator from raw server/network error messages to a user-friendly
// {title, detail, hint} triple. Keeps the UI free of inline regex matching.
// The raw message is always preserved as `raw` so the UI can show it under
// a disclosure for debugging.

export interface FriendlyError {
  title: string;
  detail?: string;
  hint?: string;
  raw: string;
}

export function friendlyError(raw: unknown): FriendlyError {
  const msg = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  const lower = msg.toLowerCase();

  // Supabase project paused / Cloudflare 521
  if (lower.includes("521") || lower.includes("web server is down") || lower.includes("supabase.co")) {
    return {
      title: "Supabase is unreachable",
      detail: "The Supabase project behind this app isn't responding.",
      hint: "Free-tier projects auto-pause after a week of inactivity. Open your Supabase dashboard and resume the project, then reload this page.",
      raw: msg,
    };
  }

  // Missing migration — Postgres undefined-relation
  if (lower.includes("relation") && lower.includes("does not exist")) {
    return {
      title: "Database table is missing",
      detail: msg,
      hint: "A migration hasn't been applied yet. Open the Supabase SQL Editor and run the latest migration from supabase/migrations/.",
      raw: msg,
    };
  }

  // Missing column — new migration not applied
  if (lower.includes("column") && lower.includes("does not exist")) {
    return {
      title: "Database column is missing",
      detail: msg,
      hint: "The schema is behind the app code. Apply the newest migration under supabase/migrations/ and reload.",
      raw: msg,
    };
  }

  // Invalid HubSpot token
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid token")) {
    return {
      title: "HubSpot rejected the token",
      detail: "The private-app token was refused.",
      hint: "Rotate the token in HubSpot (Settings → Integrations → Private Apps → your app → Auth), re-add the portal, and try again.",
      raw: msg,
    };
  }

  // Rate limited
  if (lower.includes("429") || lower.includes("rate limit")) {
    return {
      title: "HubSpot rate limit hit",
      detail: "Too many API calls in a short window.",
      hint: "Wait 60 seconds and retry. The runner retries automatically; this message is informational.",
      raw: msg,
    };
  }

  // CSV / parse issues
  if (lower.includes("delimiter") || lower.includes("parse")) {
    return {
      title: "Could not parse the source file",
      detail: msg,
      hint: "Double-check the delimiter (comma vs. semicolon) and that row 1 contains headers. Try the Delimiter / Encoding overrides on the CSV form.",
      raw: msg,
    };
  }

  // Network / fetch failure
  if (lower.includes("fetch failed") || lower.includes("network") || lower.includes("econnrefused")) {
    return {
      title: "Network error",
      detail: msg,
      hint: "Check your connection and retry. If this persists, the upstream service may be down.",
      raw: msg,
    };
  }

  // Portal token missing — our own error
  if (lower.includes("token is missing") || lower.includes("portal token")) {
    return {
      title: "Portal token is missing",
      detail: msg,
      hint: "The portal was created without a valid token. Delete it from the Portals page and re-add it with a fresh private-app token.",
      raw: msg,
    };
  }

  // Fallback — raw message, no hint
  return { title: "Something went wrong", detail: msg, raw: msg };
}
