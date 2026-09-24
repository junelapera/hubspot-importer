import { NextResponse, type NextRequest } from "next/server";
import {
  CsvParseError,
  GoogleSheetsUrlError,
  normalizeGoogleSheetsUrl,
  parseCsv,
  SOURCE_PREVIEW_ROWS,
  validateSource,
} from "@/lib/source";

// Server-side fetch of published-CSV URLs — the token/CORS story is simpler
// server-side and matches the CSV/XLSX/JSON pattern (parsing runs in Node).
export const runtime = "nodejs";

// Same cap as CSV upload path — the fetched body is a CSV export, so the
// sizing logic carries over.
const MAX_FETCH_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

interface SourceRequest {
  tableName: string;
  url: string;
}

function errorResponse(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function sanitizeTableName(name: string): string {
  const cleaned = name.trim().replace(/[^\w.-]+/g, "_");
  return cleaned || "table";
}

async function fetchCsvBytes(fetchUrl: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(fetchUrl, {
      // Follow the two redirects that Google's /pub CSV export typically issues.
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Google sometimes serves HTML to bot-like UAs; identify ourselves plainly.
        "User-Agent": "hubspot-importer/1.0 (+https://saltedstone.com)",
        Accept: "text/csv, text/plain;q=0.9, */*;q=0.5",
      },
    });
    if (!res.ok) {
      throw new Error(`upstream returned HTTP ${res.status}`);
    }
    const contentType = res.headers.get("content-type");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_FETCH_BYTES) {
      throw new Error(`response exceeds ${MAX_FETCH_BYTES}-byte limit`);
    }
    return { bytes: new Uint8Array(buf), contentType };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  let body: { sources?: unknown };
  try {
    body = (await req.json()) as { sources?: unknown };
  } catch (err) {
    return errorResponse(400, `invalid JSON body: ${(err as Error).message}`);
  }

  if (!Array.isArray(body.sources) || body.sources.length === 0) {
    return errorResponse(400, "expected { sources: [{tableName, url}, ...] } with at least one entry");
  }

  const sources: SourceRequest[] = [];
  const seenNames = new Set<string>();
  for (let i = 0; i < body.sources.length; i++) {
    const raw = body.sources[i];
    if (typeof raw !== "object" || raw === null) {
      return errorResponse(400, `sources[${i}] must be an object`);
    }
    const { tableName, url } = raw as Record<string, unknown>;
    if (typeof tableName !== "string" || !tableName.trim()) {
      return errorResponse(400, `sources[${i}].tableName is required`);
    }
    if (typeof url !== "string" || !url.trim()) {
      return errorResponse(400, `sources[${i}].url is required`);
    }
    const cleaned = sanitizeTableName(tableName);
    if (seenNames.has(cleaned)) {
      return errorResponse(400, `duplicate table name "${cleaned}" — each source must have a unique name`);
    }
    seenNames.add(cleaned);
    sources.push({ tableName: cleaned, url });
  }

  const tables: unknown[] = [];
  const warnings: string[] = [];

  for (const src of sources) {
    let fetchUrl: string;
    try {
      const normalized = normalizeGoogleSheetsUrl(src.url);
      fetchUrl = normalized.fetchUrl;
      for (const w of normalized.warnings) {
        warnings.push(`${src.tableName}: ${w}`);
      }
    } catch (err) {
      if (err instanceof GoogleSheetsUrlError) {
        return errorResponse(400, `${src.tableName}: ${err.message}`);
      }
      throw err;
    }

    let bytes: Uint8Array;
    let contentType: string | null;
    try {
      const fetched = await fetchCsvBytes(fetchUrl);
      bytes = fetched.bytes;
      contentType = fetched.contentType;
    } catch (err) {
      const reason = (err as Error).name === "AbortError"
        ? `timed out after ${FETCH_TIMEOUT_MS}ms`
        : (err as Error).message;
      return errorResponse(502, `${src.tableName}: fetch failed — ${reason}`);
    }

    // Google's `/export` and `/pub` endpoints return `text/csv` on the happy
    // path; if we get HTML back the sheet is almost certainly not published
    // publicly, and papaparse would silently produce garbage rows.
    if (contentType && /text\/html/i.test(contentType)) {
      return errorResponse(
        502,
        `${src.tableName}: upstream returned HTML instead of CSV — the sheet may not be published or shared publicly`,
        { fetchUrl },
      );
    }

    try {
      const parsed = parseCsv(bytes);
      const validation = validateSource({ table: src.tableName, rows: parsed.rows });
      tables.push({
        name: src.tableName,
        filename: null,
        sourceUrl: src.url,
        headers: parsed.headers,
        preview: parsed.rows.slice(0, SOURCE_PREVIEW_ROWS),
        rows: parsed.rows,
        totalRows: parsed.rows.length,
        detected: parsed.detected,
        parseWarnings: parsed.warnings,
        validationWarnings: validation,
      });
    } catch (err) {
      if (err instanceof CsvParseError) {
        return errorResponse(400, `${src.tableName}: failed to parse fetched CSV — ${err.message}`);
      }
      throw err;
    }
  }

  return NextResponse.json({ tables, warnings });
}
