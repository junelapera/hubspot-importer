// Published-to-web Google Sheets URLs come in a few flavors. This module
// normalizes what a user pastes into a fetchable CSV URL, and flags URLs
// that clearly aren't going to work (private-sheet /edit links, non-Google
// hosts, etc.). We don't authenticate — the private-sheet path needs OAuth,
// which is deferred. See phases/phase-2.md.

export class GoogleSheetsUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleSheetsUrlError";
  }
}

export interface NormalizedGoogleSheetsUrl {
  fetchUrl: string;
  // Best-effort explanation of what we did, so the UI can surface it as a
  // notice ("rewrote /edit URL to CSV export form"). Empty when the URL was
  // already usable as-is.
  warnings: string[];
}

const PUBLISHED_HOST = "docs.google.com";

// URL variants we recognize, most-specific first:
//   1. .../spreadsheets/d/e/2PACX-.../pub?output=csv[&gid=...&single=true]
//      — the canonical published-to-web CSV form. Use as-is.
//   2. .../spreadsheets/d/e/2PACX-.../pubhtml[?gid=...]  — published as HTML.
//      Rewrite `/pubhtml` → `/pub?output=csv` and preserve `gid`.
//   3. .../spreadsheets/d/{id}/edit[#gid=...] — regular sheet URL. Only works
//      if the sheet is shared "anyone with the link can view"; we rewrite to
//      the `/export?format=csv` form and warn that the sheet must be public.
//   4. .../spreadsheets/d/{id}/gviz/tq?tqx=out:csv[&gid=...]  — the visualization
//      API form. Use as-is (also requires public sheet).
export function normalizeGoogleSheetsUrl(input: string): NormalizedGoogleSheetsUrl {
  const trimmed = input.trim();
  if (!trimmed) throw new GoogleSheetsUrlError("URL is empty");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new GoogleSheetsUrlError(`invalid URL: ${trimmed}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new GoogleSheetsUrlError(`unsupported URL scheme "${url.protocol}"; use https`);
  }

  const warnings: string[] = [];

  if (url.hostname !== PUBLISHED_HOST) {
    // Non-Google host: we can still fetch it, but call it out so the user
    // notices if they pasted the wrong thing.
    warnings.push(`URL host is "${url.hostname}", not docs.google.com — fetching as a plain CSV endpoint`);
    return { fetchUrl: url.toString(), warnings };
  }

  const path = url.pathname;

  // Form 1: published CSV — already good.
  if (/\/spreadsheets\/d\/e\/[^/]+\/pub$/.test(path) && url.searchParams.get("output") === "csv") {
    return { fetchUrl: url.toString(), warnings };
  }

  // Form 2: published HTML — rewrite path + set output=csv.
  const pubHtmlMatch = path.match(/^(\/spreadsheets\/d\/e\/[^/]+)\/pubhtml$/);
  if (pubHtmlMatch) {
    const rebuilt = new URL(url.toString());
    rebuilt.pathname = `${pubHtmlMatch[1]}/pub`;
    rebuilt.searchParams.set("output", "csv");
    // /pubhtml carries `gid` in the query already; leave any other params alone.
    warnings.push("rewrote /pubhtml URL to /pub?output=csv");
    return { fetchUrl: rebuilt.toString(), warnings };
  }

  // Form 3: regular /edit URL — rewrite to /export?format=csv. The `gid` on
  // /edit URLs typically arrives as a hash fragment (`#gid=123`), not a query
  // param, so we lift it into the query.
  const editMatch = path.match(/^(\/spreadsheets\/d\/[^/]+)\/(edit|view|preview|htmlview)\/?$/);
  if (editMatch) {
    const rebuilt = new URL(url.toString());
    rebuilt.pathname = `${editMatch[1]}/export`;
    rebuilt.searchParams.set("format", "csv");
    const hashGid = parseGidFromHash(url.hash);
    if (hashGid !== null && !rebuilt.searchParams.has("gid")) {
      rebuilt.searchParams.set("gid", hashGid);
    }
    rebuilt.hash = "";
    warnings.push(
      "rewrote /edit URL to /export?format=csv — the sheet must be shared \"anyone with the link can view\" for this to work",
    );
    return { fetchUrl: rebuilt.toString(), warnings };
  }

  // Form 4: gviz CSV export — already good.
  if (
    /\/spreadsheets\/d\/[^/]+\/gviz\/tq$/.test(path) &&
    (url.searchParams.get("tqx") ?? "").includes("out:csv")
  ) {
    return { fetchUrl: url.toString(), warnings };
  }

  // Bare /spreadsheets/d/{id}/ or /spreadsheets/d/{id} — same treatment as /edit.
  const bareMatch = path.match(/^(\/spreadsheets\/d\/[^/]+)\/?$/);
  if (bareMatch) {
    const rebuilt = new URL(url.toString());
    rebuilt.pathname = `${bareMatch[1]}/export`;
    rebuilt.searchParams.set("format", "csv");
    const hashGid = parseGidFromHash(url.hash);
    if (hashGid !== null && !rebuilt.searchParams.has("gid")) {
      rebuilt.searchParams.set("gid", hashGid);
    }
    rebuilt.hash = "";
    warnings.push(
      "rewrote sheet URL to /export?format=csv — the sheet must be shared \"anyone with the link can view\" for this to work",
    );
    return { fetchUrl: rebuilt.toString(), warnings };
  }

  throw new GoogleSheetsUrlError(
    `unrecognized Google Sheets URL shape: ${path}. Publish the sheet via File → Share → Publish to web → CSV, then paste that URL.`,
  );
}

function parseGidFromHash(hash: string): string | null {
  if (!hash) return null;
  // Strip leading '#' then treat remainder as a query string.
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const gid = params.get("gid");
  return gid && /^\d+$/.test(gid) ? gid : null;
}
