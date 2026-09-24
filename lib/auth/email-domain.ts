// Allowlist of email domains that may register + log in. Currently a
// single hard-coded domain since the app is internal to Saltedstone. If
// this ever needs to grow to multiple tenants, promote to an env-var
// comma-list (e.g. AUTH_ALLOWED_DOMAINS=saltedstone.com,partner.com).
export const ALLOWED_EMAIL_DOMAIN = "saltedstone.com";

// Case-insensitive suffix check with whitespace tolerance. The email is
// also lightly normalized before comparison — users routinely paste with
// leading/trailing spaces. Returns the normalized form on success so the
// caller can store the clean value, and null on rejection.
export function normalizeAndCheckEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (!email) return null;
  // Minimal shape check — one `@`, non-empty local + domain parts. Full
  // RFC 5321 validation isn't worth it; Supabase Auth will reject anything
  // truly malformed downstream.
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  if (email.indexOf("@", at + 1) !== -1) return null;
  const domain = email.slice(at + 1);
  if (domain !== ALLOWED_EMAIL_DOMAIN) return null;
  return email;
}

export function isAllowedEmail(input: unknown): boolean {
  return normalizeAndCheckEmail(input) !== null;
}
