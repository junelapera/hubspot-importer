import { NextResponse, type NextRequest } from "next/server";
import {
  CsvParseError,
  parseCsv,
  SOURCE_PREVIEW_ROWS,
  validateSource,
  type CsvDelimiter,
  type CsvEncoding,
} from "@/lib/source";

// CSV parsing runs Node buffers + TextDecoder; force node runtime for parity
// with the rest of the app layer.
export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function errorResponse(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function coerceDelimiter(v: FormDataEntryValue | null): CsvDelimiter | undefined {
  if (v === null) return undefined;
  const s = typeof v === "string" ? v : "";
  if (s === "," || s === ";" || s === "|") return s;
  if (s === "\\t" || s === "\t") return "\t";
  return undefined;
}

function coerceEncoding(v: FormDataEntryValue | null): CsvEncoding | undefined {
  if (v === null) return undefined;
  const s = typeof v === "string" ? v : "";
  return s === "utf-8" || s === "utf-16le" || s === "utf-16be" ? s : undefined;
}

function coerceHeaderRow(v: FormDataEntryValue | null): number | undefined {
  if (v === null) return undefined;
  const s = typeof v === "string" ? v : "";
  if (!s.trim()) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

function tableNameFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "table";
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return errorResponse(400, `invalid multipart body: ${(err as Error).message}`);
  }

  const delimiter = coerceDelimiter(form.get("delimiter"));
  const encoding = coerceEncoding(form.get("encoding"));
  const headerRow = coerceHeaderRow(form.get("headerRow"));

  const entries = form.getAll("file");
  const files = entries.filter((e): e is File => e instanceof File);
  if (files.length === 0) return errorResponse(400, "no files uploaded (field name: file)");

  const tables: unknown[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return errorResponse(413, `file "${file.name}" exceeds ${MAX_FILE_BYTES}-byte limit`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const tableName = tableNameFromFilename(file.name);
    try {
      const parsed = parseCsv(bytes, { delimiter, encoding, headerRow });
      const validation = validateSource({ table: tableName, rows: parsed.rows });
      tables.push({
        name: tableName,
        filename: file.name,
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
        return errorResponse(400, `failed to parse "${file.name}": ${err.message}`);
      }
      throw err;
    }
  }

  return NextResponse.json({ tables });
}
