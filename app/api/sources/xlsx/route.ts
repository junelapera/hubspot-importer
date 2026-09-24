import { NextResponse, type NextRequest } from "next/server";
import {
  parseXlsx,
  SOURCE_PREVIEW_ROWS,
  validateSource,
  XlsxParseError,
} from "@/lib/source";

// XLSX uses SheetJS's array-buffer path — Node runtime for parity with
// CSV / JSON endpoints.
export const runtime = "nodejs";

// XLSX files can be denser than CSVs of the same row count (formatting,
// styles, embedded images), so allow slightly more headroom than the
// CSV endpoint's 20MB cap.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function errorResponse(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function coerceHeaderRow(v: FormDataEntryValue | null): number | undefined {
  if (v === null) return undefined;
  const s = typeof v === "string" ? v : "";
  if (!s.trim()) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

function coerceSheetNames(v: FormDataEntryValue | null): string[] | undefined {
  if (v === null) return undefined;
  const s = typeof v === "string" ? v : "";
  if (!s.trim()) return undefined;
  return s
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

function tableNameFromParts(filename: string, sheet: string, workbookHasSingleSheet: boolean): string {
  const filePart = filename.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "file";
  // Single-sheet workbook → drop the sheet name to keep table names short
  // and match the CSV "filename == tablename" convention.
  if (workbookHasSingleSheet) return filePart || sheet;
  const sheetPart = sheet.replace(/[^\w.-]+/g, "_") || "sheet";
  return `${filePart}__${sheetPart}`;
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return errorResponse(400, `invalid multipart body: ${(err as Error).message}`);
  }

  const headerRow = coerceHeaderRow(form.get("headerRow"));
  const sheetNames = coerceSheetNames(form.get("sheetNames"));

  const entries = form.getAll("file");
  const files = entries.filter((e): e is File => e instanceof File);
  if (files.length === 0) return errorResponse(400, "no files uploaded (field name: file)");

  const tables: unknown[] = [];
  const topWarnings: string[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return errorResponse(413, `file "${file.name}" exceeds ${MAX_FILE_BYTES}-byte limit`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const parsed = parseXlsx(bytes, { headerRow, sheetNames });
      const singleSheet = parsed.sheets.length === 1;
      for (const sheet of parsed.sheets) {
        const tableName = tableNameFromParts(file.name, sheet.name, singleSheet);
        const validation = validateSource({ table: tableName, rows: sheet.rows });
        tables.push({
          name: tableName,
          filename: file.name,
          headers: sheet.headers,
          preview: sheet.rows.slice(0, SOURCE_PREVIEW_ROWS),
          rows: sheet.rows,
          totalRows: sheet.rows.length,
          detected: null,
          parseWarnings: sheet.warnings,
          validationWarnings: validation,
        });
      }
      for (const w of parsed.warnings) topWarnings.push(`${file.name}: ${w}`);
    } catch (err) {
      if (err instanceof XlsxParseError) {
        return errorResponse(400, `failed to parse "${file.name}": ${err.message}`);
      }
      throw err;
    }
  }

  return NextResponse.json({ tables, warnings: topWarnings });
}
