import { breakCycles, toposort, type GraphEdge, type GraphNode } from "./graph";
import type { HubdbColumn, HubdbColumnType } from "./hubdb";
import { DEFAULT_NORMALIZE, normalizeKey, splitMultiValue, type Delimiter, type NormalizeOptions } from "./resolve";

// Identifier normalization for auto-match (source header ↔ target column
// name). Distinct from `normalizeKey` in resolve.ts (which is for cell
// values). Strips separators entirely rather than collapsing to spaces.
export function normalizeIdent(raw: string): string {
  return raw.toLowerCase().replace(/[\s_\-.]+/g, "");
}

export type ColumnAssignment =
  | { kind: "mapped"; targetColumn: string }
  | { kind: "ignored" }
  | { kind: "unmapped" };

export type ColumnMap = Record<string, ColumnAssignment>;

export function autoMap(sourceHeaders: readonly string[], targetColumns: readonly HubdbColumn[]): ColumnMap {
  const byNorm = new Map<string, string>();
  for (const c of targetColumns) byNorm.set(normalizeIdent(c.name), c.name);

  const claimed = new Set<string>();
  const map: ColumnMap = {};
  for (const src of sourceHeaders) {
    const norm = normalizeIdent(src);
    const target = byNorm.get(norm);
    if (target && !claimed.has(target)) {
      claimed.add(target);
      map[src] = { kind: "mapped", targetColumn: target };
    } else {
      map[src] = { kind: "unmapped" };
    }
  }
  return map;
}

// Coarse type-mismatch detection driven by a small sample of source cells.
// Only fires on high-confidence mismatches so authors aren't spammed —
// TEXT/RICHTEXT accept anything, so we skip those entirely.
export type TypeMismatch =
  | { kind: "number-non-numeric"; badCount: number }
  | { kind: "boolean-non-boolean"; badCount: number }
  | { kind: "date-unparseable"; badCount: number }
  | { kind: "datetime-unparseable"; badCount: number };

const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/;
const BOOL_TRUE = new Set(["true", "1", "yes", "y", "t"]);
const BOOL_FALSE = new Set(["false", "0", "no", "n", "f"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nonEmpty(sample: readonly string[]): string[] {
  return sample.map((v) => v.trim()).filter((v) => v !== "");
}

export function detectTypeMismatch(sample: readonly string[], targetType: HubdbColumnType | string): TypeMismatch | null {
  const vals = nonEmpty(sample);
  if (vals.length === 0) return null;

  if (targetType === "NUMBER" || targetType === "CURRENCY") {
    const bad = vals.filter((v) => !NUMERIC_RE.test(v)).length;
    return bad > 0 ? { kind: "number-non-numeric", badCount: bad } : null;
  }
  if (targetType === "BOOLEAN") {
    const bad = vals.filter((v) => {
      const lc = v.toLowerCase();
      return !BOOL_TRUE.has(lc) && !BOOL_FALSE.has(lc);
    }).length;
    return bad > 0 ? { kind: "boolean-non-boolean", badCount: bad } : null;
  }
  if (targetType === "DATE") {
    const bad = vals.filter((v) => !DATE_RE.test(v) || Number.isNaN(Date.parse(v))).length;
    return bad > 0 ? { kind: "date-unparseable", badCount: bad } : null;
  }
  if (targetType === "DATETIME") {
    const bad = vals.filter((v) => Number.isNaN(Date.parse(v))).length;
    return bad > 0 ? { kind: "datetime-unparseable", badCount: bad } : null;
  }
  return null;
}

// hs_path validation: HubDB dynamic pages require lowercase URL-safe
// segments; also enforce uniqueness within the source rows.
export type PathValidationIssue =
  | { kind: "not-lowercase"; row: number; value: string }
  | { kind: "invalid-char"; row: number; value: string }
  | { kind: "duplicate"; value: string; rows: number[] }
  | { kind: "empty"; row: number };

const PATH_CHAR_RE = /^[a-z0-9\-_./]+$/;

// F5 config: per FK column, how do we resolve source cell values against
// a sibling source table's rows to produce HubSpot row ids?
export type FkMatching = "default" | "strict";
export type FkOnMissing = "fail" | "skip-row" | "null" | "create-stub";

export interface ForeignKeyConfig {
  sourceTable: string | null;
  matchKey: string | null;
  multi: boolean;
  delimiter: Delimiter;
  onMissing: FkOnMissing;
  matching: FkMatching;
}

export interface MappingState {
  targetTableName: string | null;
  columnMap: ColumnMap;
  naturalKey: string[];
  hsName: string | null;
  hsPath: string | null;
  foreignKeys: Record<string, ForeignKeyConfig>;
}

export function initialMappingState(): MappingState {
  return {
    targetTableName: null,
    columnMap: {},
    naturalKey: [],
    hsName: null,
    hsPath: null,
    foreignKeys: {},
  };
}

export function initialForeignKeyConfig(): ForeignKeyConfig {
  return {
    sourceTable: null,
    matchKey: null,
    multi: false,
    delimiter: ",",
    onMissing: "skip-row",
    matching: "default",
  };
}

export function normalizeOptionsFor(matching: FkMatching): NormalizeOptions {
  return matching === "strict"
    ? { trim: false, collapseWhitespace: false, casefold: false }
    : DEFAULT_NORMALIZE;
}

// Coarse client-side resolver for the "resolves X of Y" summary on the
// FK config panel. Empty cells are counted separately so users can see
// whether unresolved rows are actual mismatches or just gaps.
export interface ResolvabilityCounts {
  matched: number;
  unmatched: number;
  empty: number;
  totalValues: number;
  missingValues: number;
}

export function countResolvable(
  mainRows: ReadonlyArray<Record<string, string>>,
  mainColumn: string,
  foreignRows: ReadonlyArray<Record<string, string>>,
  matchKey: string,
  cfg: Pick<ForeignKeyConfig, "multi" | "delimiter" | "matching">,
): ResolvabilityCounts {
  const normOpts = normalizeOptionsFor(cfg.matching);
  const keys = new Set<string>();
  for (const row of foreignRows) {
    const raw = row[matchKey];
    if (raw === undefined || raw === null) continue;
    const key = normalizeKey(raw, normOpts);
    if (key !== "") keys.add(key);
  }

  let matched = 0;
  let unmatched = 0;
  let empty = 0;
  let totalValues = 0;
  let missingValues = 0;
  for (const row of mainRows) {
    const raw = row[mainColumn];
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      empty++;
      continue;
    }
    const values = cfg.multi ? splitMultiValue(raw, cfg.delimiter) : [raw];
    if (values.length === 0) {
      empty++;
      continue;
    }
    let rowMiss = 0;
    for (const v of values) {
      totalValues++;
      const key = normalizeKey(v, normOpts);
      if (key === "" || !keys.has(key)) {
        missingValues++;
        rowMiss++;
      }
    }
    if (rowMiss === 0) matched++;
    else unmatched++;
  }
  return { matched, unmatched, empty, totalValues, missingValues };
}

export function validatePathColumn(rows: ReadonlyArray<Record<string, string>>, column: string): PathValidationIssue[] {
  const issues: PathValidationIssue[] = [];
  const seen = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]?.[column];
    const value = raw === undefined ? "" : String(raw);
    const trimmed = value.trim();
    if (trimmed === "") {
      issues.push({ kind: "empty", row: i });
      continue;
    }
    if (trimmed !== trimmed.toLowerCase()) {
      issues.push({ kind: "not-lowercase", row: i, value: trimmed });
    } else if (!PATH_CHAR_RE.test(trimmed)) {
      issues.push({ kind: "invalid-char", row: i, value: trimmed });
    }
    const bucket = seen.get(trimmed);
    if (bucket) bucket.push(i);
    else seen.set(trimmed, [i]);
  }
  for (const [value, rowIndices] of seen) {
    if (rowIndices.length > 1) issues.push({ kind: "duplicate", value, rows: rowIndices });
  }
  return issues;
}

// F6 — derive an import order from source names + their mappings. A source
// depends on a sibling source when any of its FK configs picks that
// sibling as `sourceTable` — the sibling has to be imported first so its
// row ids exist for FK resolution.
export interface ImportOrderPlan {
  nodes: GraphNode[];
  order: string[];
  cycles: string[][];
  deferred: GraphEdge[];
  cycleBreakOrder: string[];
  ok: boolean;
}

export function deriveImportOrder(
  sourceNames: readonly string[],
  mappings: Readonly<Record<string, MappingState>>,
): ImportOrderPlan {
  const nameSet = new Set(sourceNames);
  const nodes: GraphNode[] = sourceNames.map((name) => {
    const mapping = mappings[name];
    const deps = new Set<string>();
    if (mapping) {
      for (const cfg of Object.values(mapping.foreignKeys)) {
        if (cfg.sourceTable && cfg.sourceTable !== name && nameSet.has(cfg.sourceTable)) {
          deps.add(cfg.sourceTable);
        }
      }
    }
    return { name, dependencies: Array.from(deps) };
  });

  const topo = toposort(nodes);
  if (topo.cycles.length === 0) {
    return { nodes, order: topo.order, cycles: [], deferred: [], cycleBreakOrder: topo.order, ok: true };
  }
  const broken = breakCycles(nodes);
  return {
    nodes,
    order: topo.order,
    cycles: topo.cycles,
    deferred: broken.deferred,
    cycleBreakOrder: broken.order,
    ok: false,
  };
}
