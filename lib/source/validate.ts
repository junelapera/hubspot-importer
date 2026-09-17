import { HUBDB_MAX_ROWS_PER_TABLE, normalizeKey } from "../resolve";

export const HUBDB_TEXT_MAX = 10_000;
export const HUBDB_RICHTEXT_MAX = 65_000;

export type WarningKind =
  | "row-count-cap"
  | "cell-too-long-text"
  | "cell-too-long-richtext"
  | "duplicate-natural-key"
  | "empty-required-column";

export interface Warning {
  kind: WarningKind;
  table: string;
  message: string;
  detail?: unknown;
}

export interface ValidationInput {
  table: string;
  rows: ReadonlyArray<Record<string, string>>;
  naturalKey?: string[];
  requiredColumns?: string[];
  richTextColumns?: string[];
}

export function validateSource(input: ValidationInput): Warning[] {
  const warnings: Warning[] = [];
  const { table, rows, naturalKey, requiredColumns, richTextColumns } = input;

  if (rows.length > HUBDB_MAX_ROWS_PER_TABLE) {
    warnings.push({
      kind: "row-count-cap",
      table,
      message: `${rows.length} rows exceeds HubDB's ${HUBDB_MAX_ROWS_PER_TABLE}-row per-table cap`,
      detail: { rowCount: rows.length, cap: HUBDB_MAX_ROWS_PER_TABLE },
    });
  }

  const richSet = new Set(richTextColumns ?? []);
  const overText: Array<{ row: number; column: string; length: number }> = [];
  const overRich: Array<{ row: number; column: string; length: number }> = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const [col, val] of Object.entries(row)) {
      const len = val?.length ?? 0;
      if (richSet.has(col)) {
        if (len > HUBDB_RICHTEXT_MAX) overRich.push({ row: i, column: col, length: len });
      } else if (len > HUBDB_TEXT_MAX) {
        overText.push({ row: i, column: col, length: len });
      }
    }
  }
  if (overText.length > 0) {
    warnings.push({
      kind: "cell-too-long-text",
      table,
      message: `${overText.length} cell(s) exceed ${HUBDB_TEXT_MAX}-char TEXT cap`,
      detail: overText.slice(0, 20),
    });
  }
  if (overRich.length > 0) {
    warnings.push({
      kind: "cell-too-long-richtext",
      table,
      message: `${overRich.length} cell(s) exceed ${HUBDB_RICHTEXT_MAX}-char RICHTEXT cap`,
      detail: overRich.slice(0, 20),
    });
  }

  if (requiredColumns?.length) {
    for (const col of requiredColumns) {
      const missing: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const v = rows[i]?.[col];
        if (v === undefined || String(v).trim() === "") missing.push(i);
      }
      if (missing.length > 0) {
        warnings.push({
          kind: "empty-required-column",
          table,
          message: `column "${col}" empty in ${missing.length} row(s)`,
          detail: { column: col, rows: missing.slice(0, 50) },
        });
      }
    }
  }

  if (naturalKey?.length) {
    const seen = new Map<string, number[]>();
    for (let i = 0; i < rows.length; i++) {
      const parts = naturalKey.map((k) => normalizeKey(rows[i]?.[k] ?? ""));
      if (parts.some((p) => p === "")) continue;
      const composite = parts.join("|");
      const bucket = seen.get(composite);
      if (bucket) bucket.push(i);
      else seen.set(composite, [i]);
    }
    const dups: Array<{ key: string; rows: number[] }> = [];
    for (const [key, indices] of seen) {
      if (indices.length > 1) dups.push({ key, rows: indices });
    }
    if (dups.length > 0) {
      warnings.push({
        kind: "duplicate-natural-key",
        table,
        message: `${dups.length} duplicate natural-key value(s) on ${naturalKey.join(" + ")}`,
        detail: dups.slice(0, 20),
      });
    }
  }

  return warnings;
}
