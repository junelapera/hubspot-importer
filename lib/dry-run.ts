import type { HubdbColumn, HubdbRow, HubdbTable } from "./hubdb";
import { HUBDB_MAX_BATCH_SIZE } from "./hubdb";
import {
  deriveImportOrder,
  detectTypeMismatch,
  initialMappingState,
  normalizeOptionsFor,
  type ForeignKeyConfig,
  type MappingState,
} from "./mapping";
import { normalizeKey, splitMultiValue, type NormalizeOptions } from "./resolve";

// F7 — dry run. Given mappings, source rows, portal tables, and existing
// draft rows per target, project what an execute would do without writing
// anything. Pure — the caller (route handler) fetches portal rows and
// hands them in.
export interface DryRunSource {
  name: string;
  headers: string[];
  rows: ReadonlyArray<Record<string, string>>;
}

export interface DryRunInput {
  sources: ReadonlyArray<DryRunSource>;
  mappings: Readonly<Record<string, MappingState>>;
  portalTables: ReadonlyArray<HubdbTable>;
  existingRowsByTarget: Readonly<Record<string, ReadonlyArray<HubdbRow>>>;
}

export interface DryRunUnresolvedFk {
  sourceTable: string;
  sourceColumn: string;
  foreignSource: string;
  matchKey: string;
  rowIndex: number;
  value: string;
}

export interface DryRunCoercionWarning {
  sourceTable: string;
  sourceColumn: string;
  targetColumn: string;
  targetType: string;
  badCount: number;
}

export interface DryRunTableReport {
  sourceName: string;
  targetName: string | null;
  targetId: string | null;
  existingRows: number;
  sourceRows: number;
  planned: { create: number; update: number; skipped: number };
  unresolvedFks: DryRunUnresolvedFk[];
  coercionWarnings: DryRunCoercionWarning[];
  errors: string[];
  apiCalls: number;
}

export interface DryRunReport {
  order: string[];
  tables: DryRunTableReport[];
  projectedApiCalls: number;
  ok: boolean;
}

function buildSourceKeySet(
  rows: ReadonlyArray<Record<string, string>>,
  matchKey: string,
  normOpts: NormalizeOptions,
): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    const raw = row[matchKey];
    if (raw === undefined || raw === null) continue;
    const key = normalizeKey(raw, normOpts);
    if (key !== "") set.add(key);
  }
  return set;
}

function buildExistingKeySet(
  rows: ReadonlyArray<HubdbRow>,
  naturalKey: string,
  normOpts: NormalizeOptions,
): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    const raw = row.values[naturalKey];
    if (raw === null || raw === undefined) continue;
    const key = normalizeKey(raw, normOpts);
    if (key !== "") set.add(key);
  }
  return set;
}

function sampleColumn(
  rows: ReadonlyArray<Record<string, string>>,
  column: string,
  limit = 20,
): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const v = row[column];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      out.push(String(v));
      if (out.length >= limit) break;
    }
  }
  return out;
}

function apiCallsFor(existingCount: number, plannedCreate: number, plannedUpdate: number): number {
  // 1 GET (list existing draft rows) per table; batches are 100/POST + 100/PATCH.
  // Existing-row pagination adds 1 extra GET per HUBDB_DEFAULT_READ_PAGE_SIZE
  // (default 1000) but that's a coarser estimate — using ceil(existing/1000).
  const listPages = Math.max(1, Math.ceil(existingCount / 1000));
  const creates = Math.ceil(plannedCreate / HUBDB_MAX_BATCH_SIZE);
  const updates = Math.ceil(plannedUpdate / HUBDB_MAX_BATCH_SIZE);
  return listPages + creates + updates;
}

function findTarget(portalTables: ReadonlyArray<HubdbTable>, name: string): HubdbTable | undefined {
  return portalTables.find((t) => t.name === name);
}

function findColumn(cols: ReadonlyArray<HubdbColumn>, name: string): HubdbColumn | undefined {
  return cols.find((c) => c.name === name);
}

function reportForSource(
  source: DryRunSource,
  mapping: MappingState,
  target: HubdbTable | undefined,
  existingRows: ReadonlyArray<HubdbRow>,
  sourcesByName: ReadonlyMap<string, DryRunSource>,
): DryRunTableReport {
  const errors: string[] = [];
  if (!target) errors.push(`no target table "${mapping.targetTableName}" on the portal`);

  const naturalKeyCol = mapping.naturalKey[0] ?? null;
  const naturalKeyIsComposite = mapping.naturalKey.length > 1;
  if (mapping.naturalKey.length === 0) errors.push("no natural key selected");
  if (naturalKeyIsComposite) errors.push("composite natural keys are unsupported in v1 dry-run");

  const normOpts: NormalizeOptions = { trim: true, collapseWhitespace: true, casefold: true };

  const planned = { create: 0, update: 0, skipped: 0 };
  const unresolvedFks: DryRunUnresolvedFk[] = [];
  const coercionWarnings: DryRunCoercionWarning[] = [];

  if (naturalKeyCol && !naturalKeyIsComposite && target && errors.length === 0) {
    const existingKeys = buildExistingKeySet(existingRows, naturalKeyCol, normOpts);

    for (let i = 0; i < source.rows.length; i++) {
      const row = source.rows[i];
      const rawKey = row[naturalKeyCol];
      if (rawKey === undefined || String(rawKey).trim() === "") {
        planned.skipped++;
        continue;
      }
      const key = normalizeKey(rawKey, normOpts);
      if (existingKeys.has(key)) planned.update++;
      else planned.create++;
    }
  } else {
    planned.skipped = source.rows.length;
  }

  // Coercion warnings on every mapped column
  if (target) {
    for (const [sourceCol, assignment] of Object.entries(mapping.columnMap)) {
      if (assignment.kind !== "mapped") continue;
      const tc = findColumn(target.columns, assignment.targetColumn);
      if (!tc) continue;
      const sample = sampleColumn(source.rows, sourceCol);
      const mismatch = detectTypeMismatch(sample, tc.type);
      if (mismatch) {
        coercionWarnings.push({
          sourceTable: source.name,
          sourceColumn: sourceCol,
          targetColumn: tc.name,
          targetType: String(tc.type),
          badCount: mismatch.badCount,
        });
      }
    }
  }

  // Unresolved FK references: per FK config, look up match-key set on the
  // sibling source, and report each source row whose value(s) don't hit.
  for (const [sourceCol, cfgRaw] of Object.entries(mapping.foreignKeys)) {
    const cfg = cfgRaw as ForeignKeyConfig;
    if (!cfg.sourceTable || !cfg.matchKey) continue;
    const sibling = sourcesByName.get(cfg.sourceTable);
    if (!sibling) continue;
    const fkNormOpts = normalizeOptionsFor(cfg.matching);
    const siblingKeys = buildSourceKeySet(sibling.rows, cfg.matchKey, fkNormOpts);

    for (let i = 0; i < source.rows.length; i++) {
      const raw = source.rows[i][sourceCol];
      if (raw === undefined || String(raw).trim() === "") continue;
      const values = cfg.multi ? splitMultiValue(raw, cfg.delimiter) : [raw];
      for (const v of values) {
        const key = normalizeKey(v, fkNormOpts);
        if (key === "" || siblingKeys.has(key)) continue;
        unresolvedFks.push({
          sourceTable: source.name,
          sourceColumn: sourceCol,
          foreignSource: cfg.sourceTable,
          matchKey: cfg.matchKey,
          rowIndex: i,
          value: String(v),
        });
      }
    }
  }

  return {
    sourceName: source.name,
    targetName: target?.name ?? mapping.targetTableName ?? null,
    targetId: target?.id ?? null,
    existingRows: existingRows.length,
    sourceRows: source.rows.length,
    planned,
    unresolvedFks,
    coercionWarnings,
    errors,
    apiCalls: apiCallsFor(existingRows.length, planned.create, planned.update),
  };
}

export function computeDryRun(input: DryRunInput): DryRunReport {
  const sourcesByName = new Map(input.sources.map((s) => [s.name, s]));
  const orderPlan = deriveImportOrder(input.sources.map((s) => s.name), input.mappings);
  const order = orderPlan.ok ? orderPlan.order : orderPlan.cycleBreakOrder;

  const tables: DryRunTableReport[] = [];
  for (const name of order) {
    const source = sourcesByName.get(name);
    if (!source) continue;
    const mapping = input.mappings[name] ?? initialMappingState();
    const target = mapping.targetTableName ? findTarget(input.portalTables, mapping.targetTableName) : undefined;
    const existingRows = (target && input.existingRowsByTarget[target.name]) ?? [];
    tables.push(reportForSource(source, mapping, target, existingRows, sourcesByName));
  }

  const projectedApiCalls = tables.reduce((n, t) => n + t.apiCalls, 0);
  const ok = orderPlan.ok && tables.every((t) => t.errors.length === 0 && t.unresolvedFks.length === 0);
  return { order, tables, projectedApiCalls, ok };
}
