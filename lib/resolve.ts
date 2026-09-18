import type { HubdbForeignRef, HubdbRow } from "./hubdb";

export type NormalizeOptions = {
  trim?: boolean;
  collapseWhitespace?: boolean;
  casefold?: boolean;
};

export const DEFAULT_NORMALIZE: Required<NormalizeOptions> = {
  trim: true,
  collapseWhitespace: true,
  casefold: true,
};

export const HUBDB_MAX_ROWS_PER_TABLE = 10_000;

export type Delimiter = "," | "|" | ";" | "\n";

export function normalizeKey(value: unknown, opts: NormalizeOptions = DEFAULT_NORMALIZE): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (opts.trim ?? true) s = s.trim();
  if (opts.collapseWhitespace ?? true) s = s.replace(/\s+/g, " ");
  if (opts.casefold ?? true) s = s.toLowerCase();
  return s;
}

export function splitMultiValue(raw: unknown, delimiter: Delimiter): string[] {
  if (raw === null || raw === undefined) return [];
  return String(raw)
    .split(delimiter)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export type DuplicateKey = { key: string; ids: string[]; sample: unknown };

export type BuildKeyMapResult =
  | { ok: true; map: Map<string, string> }
  | { ok: false; duplicates: DuplicateKey[]; map: Map<string, string> };

// U+0001 (SOH) is used as the between-column separator when a naturalKey
// is composite. It cannot appear inside a normalized key (normalizeKey
// trims + collapses whitespace + casefolds — none of which produce a
// control char), so the composite key is unambiguous even if the source
// data contains spaces or delimiters. Building it via fromCharCode avoids
// embedding a raw control byte in the file (which past Write invocations
// have corrupted to NUL).
const COMPOSITE_SEP = String.fromCharCode(1);

/**
 * Build the composite key from a source row and one or more column names.
 * Returns "" when any component normalizes to empty — callers treat an
 * empty return as "row has no NK".
 */
export function composeCompositeKey(
  row: Record<string, unknown>,
  columns: readonly string[],
  opts: NormalizeOptions = DEFAULT_NORMALIZE,
): string {
  if (columns.length === 0) return "";
  const parts: string[] = [];
  for (const col of columns) {
    const part = normalizeKey(row[col], opts);
    if (part === "") return "";
    parts.push(part);
  }
  return parts.join(COMPOSITE_SEP);
}

export function buildKeyMap(
  rows: readonly HubdbRow[],
  naturalKey: string | readonly string[],
  opts: NormalizeOptions = DEFAULT_NORMALIZE,
): BuildKeyMapResult {
  const columns = Array.isArray(naturalKey) ? naturalKey : [naturalKey as string];
  const groups = new Map<string, { ids: string[]; sample: unknown }>();
  for (const row of rows) {
    const key = composeCompositeKey(row.values, columns, opts);
    if (key === "") continue;
    const sample =
      columns.length === 1 ? row.values[columns[0]] : columns.map((c) => row.values[c]);
    const entry = groups.get(key);
    if (entry) {
      entry.ids.push(row.id);
    } else {
      groups.set(key, { ids: [row.id], sample });
    }
  }

  const map = new Map<string, string>();
  const duplicates: DuplicateKey[] = [];
  for (const [key, entry] of groups) {
    if (entry.ids.length > 1) {
      duplicates.push({ key, ids: entry.ids, sample: entry.sample });
      continue;
    }
    map.set(key, entry.ids[0]);
  }

  if (duplicates.length) return { ok: false, duplicates, map };
  return { ok: true, map };
}

export type ResolveOptions = {
  normalize?: NormalizeOptions;
  dedupe?: boolean;
};

export type ResolveResult =
  | { ok: true; cell: HubdbForeignRef[] }
  | { ok: false; missing: string[]; cell: HubdbForeignRef[] };

export function resolveForeignValue(
  rawValues: readonly unknown[],
  keyMap: ReadonlyMap<string, string>,
  opts: ResolveOptions = {},
): ResolveResult {
  const normOpts = opts.normalize ?? DEFAULT_NORMALIZE;
  const dedupe = opts.dedupe ?? true;
  const cell: HubdbForeignRef[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawValues) {
    if (raw === null || raw === undefined) continue;
    const str = String(raw);
    if (str.trim() === "") continue;
    const key = normalizeKey(str, normOpts);
    if (key === "") continue;
    if (dedupe && seen.has(key)) continue;
    seen.add(key);
    const id = keyMap.get(key);
    if (id === undefined) {
      missing.push(str);
      continue;
    }
    cell.push({ id, type: "foreignid" });
  }

  if (missing.length) return { ok: false, missing, cell };
  return { ok: true, cell };
}
