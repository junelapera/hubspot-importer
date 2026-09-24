// Pure schema inference from parsed source tables. Feeds the /import
// "Suggest schema" panel so users don't have to hand-author schema.json.
//
// Rules are deliberately conservative — every ambiguous column falls back
// to TEXT rather than guessing a stricter type that a later row might
// invalidate. FK detection is a value-membership check (not a name
// heuristic) so it's harder to false-positive.

import type { Schema, SchemaColumn, SchemaTable } from "./schema";

export type InferredColumnType =
  | "TEXT"
  | "RICHTEXT"
  | "NUMBER"
  | "CURRENCY"
  | "BOOLEAN"
  | "DATE"
  | "DATETIME"
  | "URL"
  | "IMAGE"
  | "FOREIGN_ID";

export type InferredColumn = {
  name: string;
  label: string;
  type: InferredColumnType;
  foreignTable?: string;
  foreignColumn?: string;
  isNaturalKey?: boolean;
  reason?: string;
};

export type InferredTable = {
  name: string;
  label: string;
  naturalKey: string | null;
  columns: InferredColumn[];
};

export type InferInput = {
  name: string;
  rows: readonly Record<string, string>[];
  headers: readonly string[];
};

export type InferOptions = {
  sampleSize?: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_RE = /^-?\d+(?:\.\d+)?$/;
const URL_RE = /^https?:\/\//i;
const IMG_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:\?.*)?$/i;
const BOOL_TRUE = new Set(["true", "1", "yes", "y", "t"]);
const BOOL_FALSE = new Set(["false", "0", "no", "n", "f"]);
const CURRENCY_HINT = /(?:price|cost|amount|total|revenue|salary|fee|rate)/i;
const RICHTEXT_THRESHOLD = 500;
const NK_MIN_FILL_RATIO = 0.5;
// Prefer columns with these names for the naturalKey pick when several
// columns are unique. Earlier entries win. Match is case-insensitive on
// normalized column name (lowercased, separators stripped).
const NK_NAME_PRIORITY = [
  "id",
  "uuid",
  "sku",
  "slug",
  "handle",
  "code",
  "key",
  "identifier",
];

export function inferSchema(
  inputs: readonly InferInput[],
  opts: InferOptions = {},
): InferredTable[] {
  const sampleSize = opts.sampleSize ?? 200;

  // Pass 1: infer per-column type + pick naturalKey. FK detection needs
  // every table's chosen naturalKey column, so it runs as a second pass.
  const firstPass = inputs.map((t) => inferOneTable(t, sampleSize));

  // Pass 2: FK — for each column, check if its non-empty values are a
  // subset of another table's naturalKey column values. All-or-nothing;
  // any unmatched value disqualifies the FK guess.
  const tablesByName = new Map<string, InferredTable>();
  for (const t of firstPass) tablesByName.set(t.name, t);
  const nkValuesByTable = new Map<string, { column: string; set: Set<string> }>();
  for (const t of firstPass) {
    if (!t.naturalKey) continue;
    const src = inputs.find((s) => s.name === t.name)!;
    const values = new Set<string>();
    for (const row of src.rows) {
      const v = row[t.naturalKey]?.trim() ?? "";
      if (v) values.add(v.toLowerCase());
    }
    nkValuesByTable.set(t.name, { column: t.naturalKey, set: values });
  }

  for (const table of firstPass) {
    const src = inputs.find((s) => s.name === table.name)!;
    for (const col of table.columns) {
      if (col.isNaturalKey) continue;
      const values: string[] = [];
      for (const row of src.rows) {
        const v = row[col.name]?.trim() ?? "";
        if (v) values.push(v.toLowerCase());
      }
      if (values.length === 0) continue;
      for (const [otherName, otherNk] of nkValuesByTable) {
        if (otherName === table.name) continue;
        const allMatch = values.every((v) => otherNk.set.has(v));
        if (!allMatch) continue;
        col.type = "FOREIGN_ID";
        col.foreignTable = otherName;
        col.foreignColumn = otherNk.column;
        col.reason = `every value found in ${otherName}.${otherNk.column}`;
        break;
      }
    }
  }

  return firstPass;
}

// One table's column types + naturalKey pick — no FK detection here (that
// needs every table's naturalKey to be resolved first).
function inferOneTable(input: InferInput, sampleSize: number): InferredTable {
  const columns: InferredColumn[] = input.headers.map((h) => {
    const raw = collectSample(input.rows, h, sampleSize);
    const nonEmpty = raw.filter((v) => v !== "");
    const { type, reason } = inferType(h, nonEmpty);
    return { name: h, label: humanizeLabel(h), type, reason };
  });

  const naturalKey = pickNaturalKey(input.headers, input.rows);
  if (naturalKey) {
    const col = columns.find((c) => c.name === naturalKey);
    if (col) col.isNaturalKey = true;
  }

  return {
    name: input.name,
    label: humanizeLabel(input.name),
    naturalKey,
    columns,
  };
}

function collectSample(
  rows: readonly Record<string, string>[],
  column: string,
  cap: number,
): string[] {
  const step = Math.max(1, Math.floor(rows.length / cap));
  const out: string[] = [];
  for (let i = 0; i < rows.length && out.length < cap; i += step) {
    out.push((rows[i][column] ?? "").trim());
  }
  return out;
}

function inferType(
  columnName: string,
  values: readonly string[],
): { type: InferredColumnType; reason?: string } {
  if (values.length === 0) return { type: "TEXT", reason: "no non-empty samples" };

  if (values.every((v) => DATE_RE.test(v) && !Number.isNaN(Date.parse(v)))) {
    return { type: "DATE", reason: "all values match YYYY-MM-DD" };
  }
  if (values.every((v) => !Number.isNaN(Date.parse(v))) && values.some((v) => /[T\s]\d{2}:\d{2}/.test(v))) {
    return { type: "DATETIME", reason: "all values parse as timestamps" };
  }
  if (
    values.every((v) => {
      const lc = v.toLowerCase();
      return BOOL_TRUE.has(lc) || BOOL_FALSE.has(lc);
    })
  ) {
    return { type: "BOOLEAN", reason: "all values are true/false-like" };
  }
  if (values.every((v) => URL_RE.test(v))) {
    if (values.every((v) => IMG_EXT_RE.test(v))) {
      return { type: "IMAGE", reason: "all values are URLs to image files" };
    }
    return { type: "URL", reason: "all values are http(s) URLs" };
  }
  if (values.every((v) => NUM_RE.test(v))) {
    if (CURRENCY_HINT.test(columnName)) {
      return { type: "CURRENCY", reason: `column name suggests currency + all numeric` };
    }
    return { type: "NUMBER", reason: "all values are numeric" };
  }
  if (values.some((v) => v.length > RICHTEXT_THRESHOLD)) {
    return { type: "RICHTEXT", reason: `at least one value > ${RICHTEXT_THRESHOLD} chars` };
  }
  return { type: "TEXT" };
}

function pickNaturalKey(
  headers: readonly string[],
  rows: readonly Record<string, string>[],
): string | null {
  const candidates: { name: string; nonEmpty: number }[] = [];
  const total = rows.length;
  if (total === 0) return null;

  for (const h of headers) {
    const seen = new Set<string>();
    let nonEmpty = 0;
    let duplicate = false;
    for (const row of rows) {
      const raw = (row[h] ?? "").trim();
      if (raw === "") continue;
      nonEmpty++;
      const key = raw.toLowerCase();
      if (seen.has(key)) {
        duplicate = true;
        break;
      }
      seen.add(key);
    }
    if (duplicate) continue;
    if (nonEmpty === 0) continue;
    if (nonEmpty / total < NK_MIN_FILL_RATIO) continue;
    candidates.push({ name: h, nonEmpty });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const pa = nkPriority(a.name);
    const pb = nkPriority(b.name);
    if (pa !== pb) return pa - pb;
    if (a.nonEmpty !== b.nonEmpty) return b.nonEmpty - a.nonEmpty;
    return a.name.length - b.name.length;
  });
  return candidates[0].name;
}

function nkPriority(name: string): number {
  const norm = name.toLowerCase().replace(/[\s_\-.]+/g, "");
  const exact = NK_NAME_PRIORITY.indexOf(norm);
  if (exact !== -1) return exact;
  if (norm.endsWith("id")) return NK_NAME_PRIORITY.length;
  return NK_NAME_PRIORITY.length + 1;
}

function humanizeLabel(raw: string): string {
  return raw
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

// Turn inferred tables into the v1 schema shape the F3 provisioner
// accepts. `isNaturalKey` + `reason` are UI-only annotations and get
// stripped here.
export function toSchema(tables: readonly InferredTable[]): Schema {
  return {
    version: 1,
    tables: tables.map((t) => {
      const schemaTable: SchemaTable = {
        name: t.name,
        label: t.label,
        columns: t.columns.map(toSchemaColumn),
      };
      if (t.naturalKey) schemaTable.naturalKey = t.naturalKey;
      return schemaTable;
    }),
  };
}

function toSchemaColumn(c: InferredColumn): SchemaColumn {
  const out: SchemaColumn = { name: c.name, label: c.label, type: c.type };
  if (c.foreignTable) out.foreignTable = c.foreignTable;
  if (c.foreignColumn) out.foreignColumn = c.foreignColumn;
  return out;
}
