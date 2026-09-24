import * as XLSX from "xlsx";

// Multi-sheet Excel parser. Each sheet in the workbook becomes an
// independent table — same shape as the CSV parser's output, so the
// upstream mapping/validation pipeline handles it identically.

export interface XlsxParseOptions {
  headerRow?: number;
  sheetNames?: string[]; // whitelist; default = all visible sheets
}

export interface XlsxSheetResult {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
  warnings: string[];
}

export interface XlsxParseResult {
  sheets: XlsxSheetResult[];
  warnings: string[];
}

export class XlsxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxParseError";
  }
}

export function parseXlsx(
  input: ArrayBuffer | Uint8Array,
  opts: XlsxParseOptions = {},
): XlsxParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) throw new XlsxParseError("empty file");

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array" });
  } catch (err) {
    throw new XlsxParseError(`could not parse workbook: ${(err as Error).message}`);
  }

  const topWarnings: string[] = [];
  const allSheets = workbook.SheetNames;
  const filter = opts.sheetNames && opts.sheetNames.length > 0 ? new Set(opts.sheetNames) : null;

  const selected = filter ? allSheets.filter((n) => filter.has(n)) : allSheets;
  if (filter) {
    for (const name of filter) {
      if (!allSheets.includes(name)) {
        topWarnings.push(`sheet "${name}" not found in workbook (available: ${allSheets.join(", ")})`);
      }
    }
  }
  if (selected.length === 0) {
    throw new XlsxParseError("workbook contained no sheets to parse");
  }

  const headerRow = opts.headerRow ?? 0;
  const sheets: XlsxSheetResult[] = [];
  const takenNames = new Set<string>();
  for (const rawName of selected) {
    const sheet = workbook.Sheets[rawName];
    if (!sheet) {
      topWarnings.push(`sheet "${rawName}" is empty`);
      continue;
    }
    // sheet_to_json with header:1 gives an array-of-arrays (row-major),
    // matching how the CSV parser hands rows to normalizeHeader below.
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false, // format numbers/dates as strings for parity with CSV cells
    });

    const name = normalizeSheetName(rawName, takenNames);
    takenNames.add(name);

    const warnings: string[] = [];
    if (name !== rawName) {
      warnings.push(`sheet name "${rawName}" normalized to "${name}"`);
    }
    if (matrix.length <= headerRow) {
      warnings.push(`no rows after header row ${headerRow}`);
      sheets.push({ name, headers: [], rows: [], warnings });
      continue;
    }

    const rawHeaders = matrix[headerRow].map(toCell);
    const headers = dedupHeaders(rawHeaders, warnings);
    const dataRows = matrix.slice(headerRow + 1);
    const rows: Record<string, string>[] = [];
    for (const rawRow of dataRows) {
      const row: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        row[headers[i]] = toCell(rawRow[i]);
      }
      rows.push(row);
    }

    sheets.push({ name, headers, rows, warnings });
  }

  return { sheets, warnings: topWarnings };
}

function toCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function normalizeSheetName(raw: string, taken: ReadonlySet<string>): string {
  const base =
    raw
      .trim()
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "sheet";
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

function dedupHeaders(raw: readonly string[], warnings: string[]): string[] {
  const seen = new Set<string>();
  return raw.map((h, i) => {
    const stripped = h.replace(/^﻿/, "").trim();
    if (!stripped) {
      const filler = `column_${i + 1}`;
      warnings.push(`header ${i + 1} is empty; using "${filler}"`);
      seen.add(filler);
      return filler;
    }
    if (seen.has(stripped)) {
      let suffix = 2;
      while (seen.has(`${stripped}_${suffix}`)) suffix++;
      const uniq = `${stripped}_${suffix}`;
      warnings.push(`duplicate header "${stripped}"; renamed to "${uniq}"`);
      seen.add(uniq);
      return uniq;
    }
    seen.add(stripped);
    return stripped;
  });
}
