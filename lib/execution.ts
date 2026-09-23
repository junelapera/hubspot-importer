import { createHash } from "node:crypto";
import type { HubdbTable, FkColumnOption } from "./hubdb";
import { type ForeignKeyConfig, type MappingState, validatePathColumn, type PathValidationIssue } from "./mapping";
import type { Schema, SchemaColumn, SchemaTable } from "./schema";
import { HUBDB_RICHTEXT_MAX, HUBDB_TEXT_MAX } from "./source/validate";

// F8 — translate the /import wizard state (sources + mappings) into an
// `importRows` input triple: a synthesized schema, a tableIds map, source
// rows re-keyed to target column names, and per-column FK options for the
// executor.
//
// Rationale: `lib/hubdb/import.ts` uses each schema column's `name` as
// BOTH the source-row lookup key and the HubDB values key. When the
// mapping renames columns (source `Product Name` → target `productName`)
// we transform the source row so its keys match the schema column names.
// Everything downstream then operates in "target space".
//
// Composite naturalKeys pass through: the synthesized schema's
// `naturalKey` becomes an array of target column names.
//
// Multi-value FKs pass through via `fkOptions`: the importer inspects the
// per-column `{multi, delimiter}` config to split the raw string cell
// before resolving.

export interface ExecutionSourceInput {
  name: string;
  rows: ReadonlyArray<Record<string, string>>;
}

export interface ExecutionSynthesisInput {
  sources: ReadonlyArray<ExecutionSourceInput>;
  mappings: Readonly<Record<string, MappingState>>;
  portalTables: ReadonlyArray<HubdbTable>;
}

export type ExecutionSynthesisIssue =
  | { kind: "missing-target"; source: string; targetName: string | null }
  | { kind: "missing-natural-key"; source: string }
  | { kind: "natural-key-not-mapped"; source: string; column: string }
  | { kind: "fk-target-column-missing"; source: string; column: string; foreignSource: string; matchKey: string }
  | {
      kind: "cell-too-long";
      source: string;
      sourceColumn: string;
      targetColumn: string;
      targetType: string;
      maxLength: number;
      count: number;
      sampleRowIndex: number;
      sampleLength: number;
    }
  | {
      kind: "page-path-invalid";
      source: string;
      column: string;
      issues: PathValidationIssue[];
    };

export interface ExecutionSynthesis {
  schema: Schema | null;
  tableIds: Record<string, string>;
  source: Record<string, Record<string, unknown>[]>;
  fkOptions: Record<string, Record<string, FkColumnOption>>;
  issues: ExecutionSynthesisIssue[];
}

function targetForSource(source: string, mapping: MappingState): string | null {
  return mapping.targetTableName;
}

// Given a source column name, find the target column name via the map.
// Returns null when the source column isn't mapped (or is ignored).
function mapTargetName(mapping: MappingState, sourceCol: string): string | null {
  const a = mapping.columnMap[sourceCol];
  return a?.kind === "mapped" ? a.targetColumn : null;
}

export function synthesizeExecution(input: ExecutionSynthesisInput): ExecutionSynthesis {
  const issues: ExecutionSynthesisIssue[] = [];
  const tableIds: Record<string, string> = {};
  const source: Record<string, Record<string, unknown>[]> = {};
  const fkOptions: Record<string, Record<string, FkColumnOption>> = {};
  const schemaTables: SchemaTable[] = [];

  for (const s of input.sources) {
    const mapping = input.mappings[s.name];
    if (!mapping) continue;

    const targetName = targetForSource(s.name, mapping);
    if (!targetName) {
      issues.push({ kind: "missing-target", source: s.name, targetName: null });
      continue;
    }
    const target = input.portalTables.find((t) => t.name === targetName);
    if (!target) {
      issues.push({ kind: "missing-target", source: s.name, targetName });
      continue;
    }

    if (mapping.naturalKey.length === 0) {
      issues.push({ kind: "missing-natural-key", source: s.name });
      continue;
    }

    // Translate each source natural-key column to its target column name.
    // Any single column failing translation is a hard issue for the whole
    // source-table (natural key is used for identity, not just data).
    const targetNkCols: string[] = [];
    let nkFailed = false;
    for (const sourceNkCol of mapping.naturalKey) {
      const targetNkCol = mapTargetName(mapping, sourceNkCol);
      if (!targetNkCol) {
        issues.push({ kind: "natural-key-not-mapped", source: s.name, column: sourceNkCol });
        nkFailed = true;
        break;
      }
      targetNkCols.push(targetNkCol);
    }
    if (nkFailed) continue;

    // Build the schema columns from mapped source columns. Each column's
    // `name` is the TARGET column name; the type comes from the portal.
    const columns: SchemaColumn[] = [];
    const tableFkOptions: Record<string, FkColumnOption> = {};
    let synthFailed = false;
    for (const [sourceCol, assignment] of Object.entries(mapping.columnMap)) {
      if (assignment.kind !== "mapped") continue;
      const tc = target.columns.find((c) => c.name === assignment.targetColumn);
      if (!tc) continue;
      const col: SchemaColumn = { name: tc.name, type: tc.type };
      if (tc.label) col.label = tc.label;

      // FK column: the sibling reference must be translated too. In our
      // synthesized schema each table is named after the SOURCE, so the
      // schema `foreignTable` is the sibling source's name. The
      // `foreignColumn` on the schema needs to be the sibling's TARGET
      // column name for the sibling's matchKey (importRows uses schema
      // column names for its key-map lookup).
      const fk = mapping.foreignKeys[sourceCol] as ForeignKeyConfig | undefined;
      if (fk?.sourceTable && fk?.matchKey) {
        col.foreignTable = fk.sourceTable;
        const siblingMapping = input.mappings[fk.sourceTable];
        const siblingTarget = siblingMapping?.targetTableName
          ? input.portalTables.find((t) => t.name === siblingMapping.targetTableName)
          : undefined;
        const siblingTargetCol = siblingMapping ? mapTargetName(siblingMapping, fk.matchKey) : null;
        if (!siblingTarget || !siblingTargetCol || !siblingTarget.columns.some((c) => c.name === siblingTargetCol)) {
          issues.push({
            kind: "fk-target-column-missing",
            source: s.name,
            column: sourceCol,
            foreignSource: fk.sourceTable,
            matchKey: fk.matchKey,
          });
          synthFailed = true;
          break;
        }
        col.foreignColumn = siblingTargetCol;

        const opt: FkColumnOption = {};
        if (fk.multi) {
          opt.multi = true;
          opt.delimiter = fk.delimiter;
        }
        // Only emit `onMissing` when the user picked something other than
        // the default `skip-row`. Keeps synthesized `fkOptions` small and
        // matches the executor default.
        if (fk.onMissing && fk.onMissing !== "skip-row") {
          opt.onMissing = fk.onMissing;
        }
        if (opt.multi || opt.onMissing) tableFkOptions[tc.name] = opt;
      }
      columns.push(col);
    }
    if (synthFailed) continue;

    for (const nkCol of targetNkCols) {
      if (!columns.some((c) => c.name === nkCol)) {
        issues.push({
          kind: "natural-key-not-mapped",
          source: s.name,
          column: nkCol,
        });
        nkFailed = true;
        break;
      }
    }
    if (nkFailed) continue;

    // Cell-length caps: RICHTEXT columns get the 65k ceiling, everything
    // else the 10k TEXT ceiling. Matches lib/source/validate.ts warning
    // behavior but hard-fails synth so a doomed batch never leaves the
    // process. One issue per (source, column) with a count + sample.
    const lengthIssues: ExecutionSynthesisIssue[] = [];
    for (const [sourceCol, assignment] of Object.entries(mapping.columnMap)) {
      if (assignment.kind !== "mapped") continue;
      const tc = target.columns.find((c) => c.name === assignment.targetColumn);
      if (!tc) continue;
      const max = tc.type === "RICHTEXT" ? HUBDB_RICHTEXT_MAX : HUBDB_TEXT_MAX;
      let count = 0;
      let sampleRowIndex = -1;
      let sampleLength = 0;
      for (let i = 0; i < s.rows.length; i++) {
        const v = s.rows[i]?.[sourceCol];
        const len = typeof v === "string" ? v.length : 0;
        if (len > max) {
          count++;
          if (sampleRowIndex < 0) {
            sampleRowIndex = i;
            sampleLength = len;
          }
        }
      }
      if (count > 0) {
        lengthIssues.push({
          kind: "cell-too-long",
          source: s.name,
          sourceColumn: sourceCol,
          targetColumn: tc.name,
          targetType: String(tc.type),
          maxLength: max,
          count,
          sampleRowIndex,
          sampleLength,
        });
      }
    }
    if (lengthIssues.length > 0) {
      issues.push(...lengthIssues);
      continue;
    }

    // hs_path lowercase + URL-safe + uniqueness check. mapping.hsPath
    // holds the source column name mapped to the page-path role. The
    // MappingEditor already runs this client-side; we run it again
    // server-side so a stale client can't slip through.
    if (mapping.hsPath) {
      const pathIssues = validatePathColumn(s.rows, mapping.hsPath);
      if (pathIssues.length > 0) {
        issues.push({
          kind: "page-path-invalid",
          source: s.name,
          column: mapping.hsPath,
          issues: pathIssues,
        });
        continue;
      }
    }

    schemaTables.push({
      name: s.name,
      label: s.name,
      naturalKey: targetNkCols.length === 1 ? targetNkCols[0] : targetNkCols,
      columns,
    });
    tableIds[s.name] = target.id;
    if (Object.keys(tableFkOptions).length > 0) fkOptions[s.name] = tableFkOptions;

    // Transform source rows: {targetCol: source[sourceCol]} for every
    // mapped column. FK cells stay as raw strings — the importer splits
    // multi-value cells at plan time using fkOptions.
    const transformed: Record<string, unknown>[] = [];
    for (const row of s.rows) {
      const out: Record<string, unknown> = {};
      for (const [sourceCol, assignment] of Object.entries(mapping.columnMap)) {
        if (assignment.kind !== "mapped") continue;
        const v = row[sourceCol];
        if (v !== undefined) out[assignment.targetColumn] = v;
      }
      transformed.push(out);
    }
    source[s.name] = transformed;
  }

  const schema: Schema | null =
    schemaTables.length > 0 ? { version: 1, tables: schemaTables } : null;

  return { schema, tableIds, source, fkOptions, issues };
}

// Recursively sort object keys so JSON.stringify produces a canonical byte
// sequence regardless of the order the client sent keys in. Arrays keep
// their order (row order is significant); primitives pass through.
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = canonicalize(src[k]);
    return out;
  }
  return v;
}

/**
 * Deterministic fingerprint of the (sources, mappings) that a dry-run was
 * computed against. The execute endpoint requires the client to pass this
 * signature back so that a run cannot be launched against a state that
 * hasn't been previewed. Any change to source rows or mapping config
 * invalidates it.
 */
export function computeExecutionSignature(
  sources: ExecutionSynthesisInput["sources"],
  mappings: ExecutionSynthesisInput["mappings"],
): string {
  const canon = canonicalize({ sources, mappings });
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}
