export interface JsonTable {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
}

export interface JsonParseResult {
  tables: JsonTable[];
  warnings: string[];
}

export type JsonParseError =
  | { kind: "invalid-json"; message: string }
  | { kind: "invalid-shape"; message: string }
  | { kind: "nested-value"; path: string; message: string }
  | { kind: "empty" };

export type JsonParseOutcome =
  | { ok: true; result: JsonParseResult }
  | { ok: false; error: JsonParseError };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function scalarToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return String(v);
}

function isScalar(v: unknown): boolean {
  return v === null || v === undefined || ["string", "number", "boolean", "bigint"].includes(typeof v);
}

function parseTableRows(tableName: string, raw: unknown): { ok: true; table: JsonTable } | { ok: false; error: JsonParseError } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: { kind: "invalid-shape", message: `table "${tableName}" must be an array of row objects` } };
  }

  const headerSet = new Set<string>();
  const rows: Record<string, string>[] = [];

  for (let i = 0; i < raw.length; i++) {
    const rowRaw = raw[i];
    if (!isPlainObject(rowRaw)) {
      return {
        ok: false,
        error: {
          kind: "invalid-shape",
          message: `table "${tableName}" row ${i} must be an object; got ${Array.isArray(rowRaw) ? "array" : typeof rowRaw}`,
        },
      };
    }
    const row: Record<string, string> = {};
    for (const [col, val] of Object.entries(rowRaw)) {
      if (!isScalar(val)) {
        return {
          ok: false,
          error: {
            kind: "nested-value",
            path: `${tableName}[${i}].${col}`,
            message: `cells must be scalars or delimited strings; got ${Array.isArray(val) ? "array" : "object"}`,
          },
        };
      }
      headerSet.add(col);
      row[col] = scalarToString(val);
    }
    rows.push(row);
  }

  const headers = Array.from(headerSet);
  for (const row of rows) {
    for (const h of headers) {
      if (!(h in row)) row[h] = "";
    }
  }

  return { ok: true, table: { name: tableName, headers, rows } };
}

export function parseJson(text: string): JsonParseOutcome {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: { kind: "empty" } };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { ok: false, error: { kind: "invalid-json", message: (err as Error).message } };
  }

  const warnings: string[] = [];
  const tables: JsonTable[] = [];

  if (Array.isArray(parsed)) {
    for (let i = 0; i < parsed.length; i++) {
      const entry = parsed[i];
      if (!isPlainObject(entry) || typeof entry.table !== "string" || !("rows" in entry)) {
        return {
          ok: false,
          error: {
            kind: "invalid-shape",
            message: `array form requires objects of shape { "table": string, "rows": [...] }; failed at index ${i}`,
          },
        };
      }
      const outcome = parseTableRows(entry.table, entry.rows);
      if (!outcome.ok) return outcome;
      tables.push(outcome.table);
    }
  } else if (isPlainObject(parsed)) {
    for (const [name, rows] of Object.entries(parsed)) {
      const outcome = parseTableRows(name, rows);
      if (!outcome.ok) return outcome;
      tables.push(outcome.table);
    }
  } else {
    return {
      ok: false,
      error: {
        kind: "invalid-shape",
        message: `top-level JSON must be an object { "table": [...] } or an array [{ "table": "...", "rows": [...] }]; got ${typeof parsed}`,
      },
    };
  }

  if (tables.length === 0) warnings.push("no tables parsed from JSON payload");

  const nameCounts = new Map<string, number>();
  for (const t of tables) {
    nameCounts.set(t.name, (nameCounts.get(t.name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) warnings.push(`table "${name}" appears ${count} times; later entries overwrite earlier ones downstream`);
  }

  return { ok: true, result: { tables, warnings } };
}
