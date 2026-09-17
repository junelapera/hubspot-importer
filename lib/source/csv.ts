import Papa from "papaparse";

export type CsvEncoding = "utf-8" | "utf-16le" | "utf-16be";
export type CsvDelimiter = "," | ";" | "\t" | "|";

export interface CsvParseOptions {
  encoding?: CsvEncoding;
  delimiter?: CsvDelimiter;
  headerRow?: number;
}

export interface CsvDetected {
  encoding: CsvEncoding;
  delimiter: CsvDelimiter;
  hadBOM: boolean;
}

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  detected: CsvDetected;
  warnings: string[];
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

const BOM_UTF8 = [0xef, 0xbb, 0xbf] as const;
const BOM_UTF16_BE = [0xfe, 0xff] as const;
const BOM_UTF16_LE = [0xff, 0xfe] as const;

function detectEncoding(bytes: Uint8Array): { encoding: CsvEncoding; hadBOM: boolean; sliceFrom: number } {
  if (bytes.length >= 3 && bytes[0] === BOM_UTF8[0] && bytes[1] === BOM_UTF8[1] && bytes[2] === BOM_UTF8[2]) {
    return { encoding: "utf-8", hadBOM: true, sliceFrom: 3 };
  }
  if (bytes.length >= 2 && bytes[0] === BOM_UTF16_BE[0] && bytes[1] === BOM_UTF16_BE[1]) {
    return { encoding: "utf-16be", hadBOM: true, sliceFrom: 2 };
  }
  if (bytes.length >= 2 && bytes[0] === BOM_UTF16_LE[0] && bytes[1] === BOM_UTF16_LE[1]) {
    return { encoding: "utf-16le", hadBOM: true, sliceFrom: 2 };
  }
  return { encoding: "utf-8", hadBOM: false, sliceFrom: 0 };
}

function decode(bytes: Uint8Array, encoding: CsvEncoding, sliceFrom: number): string {
  const view = sliceFrom === 0 ? bytes : bytes.subarray(sliceFrom);
  return new TextDecoder(encoding, { fatal: false }).decode(view);
}

function normalizeHeader(raw: string): string {
  return raw.replace(/^﻿/, "").trim();
}

export function parseCsv(input: ArrayBuffer | Uint8Array, opts: CsvParseOptions = {}): CsvParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) throw new CsvParseError("empty file");

  const auto = detectEncoding(bytes);
  const encoding = opts.encoding ?? auto.encoding;
  const sliceFrom = opts.encoding && opts.encoding !== auto.encoding ? 0 : auto.sliceFrom;
  const text = decode(bytes, encoding, sliceFrom);

  const headerRow = opts.headerRow ?? 0;
  const warnings: string[] = [];

  const parsed = Papa.parse<string[]>(text, {
    delimiter: opts.delimiter ?? "",
    header: false,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      if (err.type === "Delimiter" || err.type === "Quotes") {
        warnings.push(`row ${err.row ?? "?"}: ${err.message}`);
      } else if (err.code === "TooFewFields" || err.code === "TooManyFields") {
        warnings.push(`row ${err.row ?? "?"}: ${err.message}`);
      } else {
        warnings.push(err.message);
      }
    }
  }

  const detectedDelimiter = (opts.delimiter ?? (parsed.meta.delimiter as CsvDelimiter | undefined) ?? ",") as CsvDelimiter;
  if (!opts.delimiter && !isKnownDelimiter(detectedDelimiter)) {
    warnings.push(`unrecognized delimiter "${detectedDelimiter}"; falling back to comma`);
  }

  const table = parsed.data.filter((row) => row.length > 0);
  if (table.length <= headerRow) {
    throw new CsvParseError(`no data rows after header row ${headerRow}`);
  }

  const rawHeaders = table[headerRow] ?? [];
  const headers = rawHeaders.map(normalizeHeader);
  const seen = new Set<string>();
  const dedupedHeaders = headers.map((h, i) => {
    if (!h) {
      const filler = `column_${i + 1}`;
      warnings.push(`header ${i + 1} is empty; using "${filler}"`);
      return filler;
    }
    if (seen.has(h)) {
      let suffix = 2;
      while (seen.has(`${h}_${suffix}`)) suffix++;
      const uniq = `${h}_${suffix}`;
      warnings.push(`duplicate header "${h}"; renamed to "${uniq}"`);
      seen.add(uniq);
      return uniq;
    }
    seen.add(h);
    return h;
  });

  const dataRows = table.slice(headerRow + 1);
  const rows: Record<string, string>[] = [];
  for (const raw of dataRows) {
    const row: Record<string, string> = {};
    for (let i = 0; i < dedupedHeaders.length; i++) {
      row[dedupedHeaders[i]] = raw[i] ?? "";
    }
    rows.push(row);
  }

  return {
    headers: dedupedHeaders,
    rows,
    detected: {
      encoding,
      delimiter: isKnownDelimiter(detectedDelimiter) ? detectedDelimiter : ",",
      hadBOM: auto.hadBOM,
    },
    warnings,
  };
}

function isKnownDelimiter(d: string): d is CsvDelimiter {
  return d === "," || d === ";" || d === "\t" || d === "|";
}
