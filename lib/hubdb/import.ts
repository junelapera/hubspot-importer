import { toposortOrThrow, nodesFromTableInputs, GraphCycleError } from "../graph";
import {
  buildKeyMap,
  composeCompositeKey,
  DEFAULT_NORMALIZE,
  HUBDB_MAX_ROWS_PER_TABLE,
  normalizeKey,
  resolveForeignValue,
  splitMultiValue,
  type Delimiter,
  type NormalizeOptions,
} from "../resolve";
import type { Schema, SchemaTable } from "../schema";
import { HubdbError, type HubdbClient } from "./client";
import {
  batchCreateDraftRows,
  batchUpdateDraftRows,
  HUBDB_MAX_BATCH_SIZE,
  listAllDraftRows,
} from "./rows";
import type { TableRef } from "./tables";
import type { HubdbForeignRef, HubdbRow, HubdbRowInput, HubdbRowUpdate } from "./types";

export type ImportOps = {
  listAllDraftRows: (ref: TableRef) => Promise<HubdbRow[]>;
  batchCreateDraftRows: (ref: TableRef, rows: HubdbRowInput[]) => Promise<HubdbRow[]>;
  batchUpdateDraftRows: (ref: TableRef, rows: HubdbRowUpdate[]) => Promise<HubdbRow[]>;
};

export function opsFromClientForImport(client: HubdbClient): ImportOps {
  return {
    listAllDraftRows: (ref) => listAllDraftRows(client, ref),
    batchCreateDraftRows: (ref, rows) => batchCreateDraftRows(client, ref, rows),
    batchUpdateDraftRows: (ref, rows) => batchUpdateDraftRows(client, ref, rows),
  };
}

export type SourceRow = Record<string, unknown>;

/**
 * Per-column FK behavior. Populated by `synthesizeExecution` from the
 * wizard's `ForeignKeyConfig`. Keys are `[tableName][columnName]`.
 *
 * `onMissing` (default `skip-row`) controls what happens when a source
 * cell's token doesn't resolve against the foreign key map:
 *   - `skip-row`: the row becomes a `RowError` (`unresolved-fk`) and is
 *     skipped. Other rows continue.
 *   - `null`: the FK column is dropped from the row entirely; the row
 *     still inserts/updates. Multi-value cells with a mix of hits and
 *     misses drop the whole cell — v1 does not support "keep hits, drop
 *     misses" because `resolveForeignValue` is all-or-nothing.
 *   - `fail`: on unresolved token, throw `ImportFailFastError` — the
 *     whole run aborts. The wrapper catches this in `importRows` and
 *     rethrows a public `ImportFailFastError` with a full partial result.
 *   - `create-stub`: on unresolved token, insert a stub row into the
 *     foreign table with `{[foreignColumn]: rawToken}` (deduped by
 *     normalized key across the batch), splice the new id into the
 *     shared key map, and re-plan the row. All-or-nothing at cell level
 *     — a multi-value cell with hits + misses stubs the misses then
 *     resolves the whole cell.
 */
export type FkOnMissing = "fail" | "skip-row" | "null" | "create-stub";

export type FkColumnOption = {
  multi?: boolean;
  delimiter?: Delimiter;
  onMissing?: FkOnMissing;
};

export type ImportInput = {
  schema: Schema;
  tableIds: Readonly<Record<string, string>>;
  source: Readonly<Record<string, readonly SourceRow[]>>;
  fkOptions?: Readonly<Record<string, Readonly<Record<string, FkColumnOption>>>>;
};

export type ImportOptions = {
  normalize?: NormalizeOptions;
  onEvent?: (event: ImportEvent) => void;
  /** Aborted between batches — the current in-flight batch always completes. */
  signal?: AbortSignal;
  /**
   * Best-effort persistence hooks. Called before + after each HubSpot
   * batch call and once per table when its natural-key → row-id map is
   * finalized. Errors thrown from hooks are logged (via `console.warn`)
   * but never abort the run — durability is a secondary concern to
   * getting rows into HubDB.
   */
  hooks?: ImportHooks;
};

export type BatchKind = "create" | "update";

export type ImportHooks = {
  onBatchStart?: (info: {
    table: string;
    batchIndex: number;
    kind: BatchKind;
    size: number;
  }) => Promise<void>;
  onBatchComplete?: (info: {
    table: string;
    batchIndex: number;
    kind: BatchKind;
    status: "succeeded" | "failed";
  }) => Promise<void>;
  /**
   * Fired when a table finishes its pass-1 (all inserts + updates done)
   * and its full natural-key → row-id map is available. Consumers use
   * this to persist the key map so a future resume can skip the
   * `listAllDraftRows` call for this foreign table.
   */
  onKeyMapReady?: (table: string, entries: Record<string, string>) => Promise<void>;
};

async function fireHook(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn(`[importRows] hook ${name} threw:`, (err as Error).message);
  }
}

export type ImportEvent =
  | { kind: "table-start"; table: string; sourceCount: number }
  | { kind: "table-preflight-ok"; table: string; existingRows: number; sourceCount: number }
  | { kind: "batch-create"; table: string; batch: number; sent: number }
  | { kind: "batch-update"; table: string; batch: number; sent: number }
  | { kind: "stale-fk-retry"; table: string; batchKind: "create" | "update"; refreshed: string[] }
  | { kind: "table-done"; table: string; created: number; updated: number; skipped: number };

export type RowErrorKind =
  | "missing-natural-key"
  | "unresolved-fk"
  | "unmapped-table"
  | "missing-target-key-map";

export type RowError = {
  table: string;
  sourceIndex: number;
  kind: RowErrorKind;
  column?: string;
  detail: string;
};

export type TableImportResult = {
  name: string;
  created: number;
  updated: number;
  skipped: number;
  errors: RowError[];
};

export type ImportResult = {
  order: string[];
  tables: TableImportResult[];
  ok: boolean;
};

export class ImportPreflightError extends Error {
  readonly table: string;
  constructor(table: string, message: string) {
    super(`Import preflight for "${table}": ${message}`);
    this.name = "ImportPreflightError";
    this.table = table;
  }
}

/**
 * Raised when a row fails to resolve and the column's `onMissing` policy
 * is `"fail"` — bounces the whole run per PRD intent. Captures partial
 * results (already-imported tables + rows imported up to the failing
 * row) so the caller can still surface progress in the response.
 */
export class ImportFailFastError extends Error {
  readonly row: RowError;
  readonly partial: ImportResult;
  constructor(row: RowError, partial: ImportResult) {
    super(
      `Import aborted: onMissing="fail" triggered by ${row.table} row ${row.sourceIndex} — ${row.detail}`,
    );
    this.name = "ImportFailFastError";
    this.row = row;
    this.partial = partial;
  }
}

/**
 * Module-internal sentinel thrown by importOneTable when it hits a
 * fail-fast row. importRows catches and re-throws as ImportFailFastError
 * with the full partial ImportResult (all prior tables + the fail-fast
 * table).
 */
class _FailFastSignal extends Error {
  readonly row: RowError;
  readonly tableResult: TableImportResult;
  constructor(row: RowError, tableResult: TableImportResult) {
    super(row.detail);
    this.name = "_FailFastSignal";
    this.row = row;
    this.tableResult = tableResult;
  }
}

/**
 * Raised when the caller aborted the AbortSignal on ImportOptions.
 * Carries a `partial` ImportResult so the UI/job log can render whatever
 * completed before the cancel took effect.
 */
export class ImportCancelledError extends Error {
  readonly partial: ImportResult;
  constructor(partial: ImportResult) {
    super("Import cancelled by caller");
    this.name = "ImportCancelledError";
    this.partial = partial;
  }
}

class _CancelSignal extends Error {
  readonly tableResult: TableImportResult;
  constructor(tableResult: TableImportResult) {
    super("cancelled");
    this.name = "_CancelSignal";
    this.tableResult = tableResult;
  }
}

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Heuristic for "this batch failed because an FK id we resolved earlier
 * was already stale by the time HubDB saw the write." We don't have a
 * definitive HubSpot error code for this; we match on 4xx + a body hint.
 * False positives just cost one extra list-per-foreign-table refetch, so
 * a broad matcher is fine.
 */
function isPossiblyStaleFkError(err: unknown): boolean {
  if (!(err instanceof HubdbError)) return false;
  if (err.status !== 400 && err.status !== 404) return false;
  const s =
    typeof err.responseBody === "string"
      ? err.responseBody
      : JSON.stringify(err.responseBody ?? "");
  const lc = s.toLowerCase();
  return (
    lc.includes("foreign") ||
    lc.includes("no such row") ||
    lc.includes("does not exist") ||
    lc.includes("not found")
  );
}

function naturalKeyColumns(t: SchemaTable): string[] {
  if (!t.naturalKey) return [];
  return Array.isArray(t.naturalKey) ? [...t.naturalKey] : [t.naturalKey];
}

type PlannedRow =
  | { kind: "insert"; sourceIndex: number; values: Record<string, unknown> }
  | { kind: "update"; sourceIndex: number; rowId: string; values: Record<string, unknown> }
  | { kind: "error"; sourceIndex: number; error: RowError }
  | { kind: "fail-fast"; sourceIndex: number; error: RowError }
  | { kind: "pending-stub"; sourceIndex: number };

/**
 * When `stubBucket` is non-null and a create-stub policy fires,
 * planRow records the missing tokens (deduped by normalized key) into
 * the bucket and returns `"pending-stub"`. importOneTable drains the
 * bucket into batch-inserts on the foreign tables, then re-plans the
 * pending rows in a second pass with `stubBucket=null` so any leftover
 * misses surface as normal errors.
 *
 * Bucket shape: foreignTable → foreignColumn → normalizedKey → rawToken.
 */
type StubBucket = Map<string, Map<string, Map<string, string>>>;

function recordStub(
  bucket: StubBucket,
  foreignTable: string,
  foreignColumn: string,
  rawToken: unknown,
  normOpts: NormalizeOptions,
): void {
  const raw = rawToken == null ? "" : String(rawToken);
  if (raw.trim() === "") return;
  const nk = normalizeKey(raw, normOpts);
  if (nk === "") return;
  let byCol = bucket.get(foreignTable);
  if (!byCol) {
    byCol = new Map();
    bucket.set(foreignTable, byCol);
  }
  let byKey = byCol.get(foreignColumn);
  if (!byKey) {
    byKey = new Map();
    byCol.set(foreignColumn, byKey);
  }
  if (!byKey.has(nk)) byKey.set(nk, raw);
}

function planRow(
  table: SchemaTable,
  source: SourceRow,
  sourceIndex: number,
  existingKeys: ReadonlyMap<string, string>,
  keyMapsByTable: ReadonlyMap<string, ReadonlyMap<string, string>>,
  fkOptionsForTable: Readonly<Record<string, FkColumnOption>> | undefined,
  normOpts: NormalizeOptions,
  stubBucket: StubBucket | null,
): PlannedRow {
  const nkCols = naturalKeyColumns(table);
  if (nkCols.length === 0) {
    return {
      kind: "error",
      sourceIndex,
      error: {
        table: table.name,
        sourceIndex,
        kind: "missing-natural-key",
        detail: `Table "${table.name}" has no naturalKey declared`,
      },
    };
  }

  const nkKey = composeCompositeKey(source, nkCols, normOpts);
  if (nkKey === "") {
    const missingCol = nkCols.find((c) => normalizeKey(source[c] as unknown, normOpts) === "");
    return {
      kind: "error",
      sourceIndex,
      error: {
        table: table.name,
        sourceIndex,
        kind: "missing-natural-key",
        column: missingCol,
        detail:
          nkCols.length === 1
            ? `Source row is missing natural-key column "${nkCols[0]}"`
            : `Source row is missing part of composite natural key [${nkCols.join(", ")}]${missingCol ? ` (empty at "${missingCol}")` : ""}`,
      },
    };
  }

  const values: Record<string, unknown> = {};
  let hasPending = false;
  for (const col of table.columns) {
    const raw = source[col.name];
    if (raw === undefined) continue;

    if (col.type !== "FOREIGN_ID") {
      values[col.name] = raw;
      continue;
    }

    if (!col.foreignTable) continue;
    const map = keyMapsByTable.get(col.foreignTable);
    if (!map) {
      return {
        kind: "error",
        sourceIndex,
        error: {
          table: table.name,
          sourceIndex,
          kind: "missing-target-key-map",
          column: col.name,
          detail: `Column "${col.name}" references table "${col.foreignTable}" which has no key map (not in schema or not processed yet)`,
        },
      };
    }

    const fkOpt = fkOptionsForTable?.[col.name];
    const rawValues = expandFkCell(raw, fkOpt);
    const resolved = resolveForeignValue(rawValues, map, { normalize: normOpts });
    if (!resolved.ok) {
      const policy: FkOnMissing = fkOpt?.onMissing ?? "skip-row";
      if (policy === "null") {
        // Drop the FK column from the row entirely. Row still inserts /
        // updates. Note: v1 is all-or-nothing at the cell level — a
        // multi-value cell with a mix of hits and misses drops the whole
        // cell, not just the misses.
        continue;
      }
      if (policy === "create-stub" && stubBucket && col.foreignColumn) {
        for (const token of resolved.missing) {
          recordStub(stubBucket, col.foreignTable, col.foreignColumn, token, normOpts);
        }
        hasPending = true;
        continue;
      }
      const err: RowError = {
        table: table.name,
        sourceIndex,
        kind: "unresolved-fk",
        column: col.name,
        detail: `Column "${col.name}" -> "${col.foreignTable}": missing ${JSON.stringify(resolved.missing)}`,
      };
      if (policy === "fail") {
        return { kind: "fail-fast", sourceIndex, error: err };
      }
      return { kind: "error", sourceIndex, error: err };
    }
    values[col.name] = resolved.cell as HubdbForeignRef[];
  }

  if (hasPending) return { kind: "pending-stub", sourceIndex };

  const existingId = existingKeys.get(nkKey);
  if (existingId) return { kind: "update", sourceIndex, rowId: existingId, values };
  return { kind: "insert", sourceIndex, values };
}

/**
 * Turn a raw source cell into the list of individual values to resolve.
 * When `multi=true`, splits a string on the configured delimiter; when
 * `false` (or unset), treats the value as a single token (existing
 * behavior). Arrays pass through untouched — HubDB round-trips FK cells
 * as arrays, so we might get an already-expanded value.
 */
function expandFkCell(raw: unknown, opt: FkColumnOption | undefined): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!opt?.multi || opt.delimiter === undefined) return [raw];
  return splitMultiValue(raw, opt.delimiter);
}

async function importOneTable(
  ops: ImportOps,
  tableRef: TableRef,
  table: SchemaTable,
  source: readonly SourceRow[],
  keyMapsByTable: Map<string, Map<string, string>>,
  fkOptionsForTable: Readonly<Record<string, FkColumnOption>> | undefined,
  tableIdsMap: Readonly<Record<string, string>>,
  schemaByName: ReadonlyMap<string, SchemaTable>,
  opts: ImportOptions,
): Promise<TableImportResult> {
  const normOpts = opts.normalize ?? DEFAULT_NORMALIZE;
  const emit = (e: ImportEvent) => opts.onEvent?.(e);
  const result: TableImportResult = {
    name: table.name,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  const checkCancel = () => {
    if (opts.signal?.aborted) throw new _CancelSignal(result);
  };

  emit({ kind: "table-start", table: table.name, sourceCount: source.length });
  checkCancel();

  const nkCols = naturalKeyColumns(table);
  const hasNk = nkCols.length > 0;
  const existingRows = await ops.listAllDraftRows(tableRef);

  let existingKeyMap = new Map<string, string>();
  if (hasNk) {
    const built = buildKeyMap(existingRows, nkCols, normOpts);
    if (!built.ok) {
      const sample = built.duplicates
        .slice(0, 3)
        .map((d) => `${d.key} (${d.ids.length} rows)`)
        .join(", ");
      throw new ImportPreflightError(
        table.name,
        `duplicate natural-key values in existing rows: ${sample}${built.duplicates.length > 3 ? " …" : ""}`,
      );
    }
    existingKeyMap = built.map;
  }

  if (existingRows.length + source.length > HUBDB_MAX_ROWS_PER_TABLE) {
    throw new ImportPreflightError(
      table.name,
      `existing ${existingRows.length} + source ${source.length} would exceed HubDB cap of ${HUBDB_MAX_ROWS_PER_TABLE}`,
    );
  }

  emit({
    kind: "table-preflight-ok",
    table: table.name,
    existingRows: existingRows.length,
    sourceCount: source.length,
  });

  const readonlyKeyMaps: ReadonlyMap<string, ReadonlyMap<string, string>> = keyMapsByTable;
  const inserts: PlannedRow[] = [];
  const updates: PlannedRow[] = [];
  const stubBucket: StubBucket = new Map();
  const pendingIdxs: number[] = [];

  const consume = (i: number, planned: PlannedRow): void => {
    if (planned.kind === "error") {
      result.errors.push(planned.error);
      result.skipped++;
      return;
    }
    if (planned.kind === "fail-fast") {
      // Record the failing row + all subsequent source rows as skipped so
      // the totals are honest about what didn't run. Skip the batch calls
      // and bubble up.
      result.errors.push(planned.error);
      result.skipped += source.length - i;
      emit({
        kind: "table-done",
        table: table.name,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
      });
      throw new _FailFastSignal(planned.error, result);
    }
    if (planned.kind === "pending-stub") {
      pendingIdxs.push(i);
      return;
    }
    if (planned.kind === "insert") inserts.push(planned);
    else updates.push(planned);
  };

  // Pass 1: plan rows. FK cells whose policy is create-stub record their
  // missing tokens into stubBucket instead of erroring.
  for (let i = 0; i < source.length; i++) {
    const planned = planRow(
      table,
      source[i],
      i,
      existingKeyMap,
      readonlyKeyMaps,
      fkOptionsForTable,
      normOpts,
      stubBucket,
    );
    consume(i, planned);
  }

  // Interlude: drain stubBucket. For each foreign table + foreign
  // column, batch-insert the missing tokens into HubDB (each stub is a
  // one-column row `{[foreignColumn]: rawToken}`), then splice the new
  // ids into keyMapsByTable so the re-plan resolves them.
  if (stubBucket.size > 0) {
    for (const [foreignTable, byCol] of stubBucket) {
      const foreignRef = tableIdsMap[foreignTable];
      if (!foreignRef) {
        // Can't insert stubs without a table id for the foreign target.
        // Emit an error against each pending row so they don't silently
        // disappear.
        for (const i of pendingIdxs) {
          result.errors.push({
            table: table.name,
            sourceIndex: i,
            kind: "missing-target-key-map",
            detail: `create-stub: no portal id for foreign table "${foreignTable}"`,
          });
          result.skipped++;
        }
        pendingIdxs.length = 0;
        continue;
      }
      const foreignKeyMap = keyMapsByTable.get(foreignTable) ?? new Map<string, string>();
      for (const [foreignColumn, byKey] of byCol) {
        const rawPairs = [...byKey.entries()]; // [normalizedKey, rawToken]
        const inputs = rawPairs.map(([, raw]) => ({ values: { [foreignColumn]: raw } }));
        const batches = chunk(inputs, HUBDB_MAX_BATCH_SIZE);
        let batchIndex = 0;
        for (const batch of batches) {
          batchIndex++;
          emit({
            kind: "batch-create",
            table: foreignTable,
            batch: batchIndex,
            sent: batch.length,
          });
          const created = await ops.batchCreateDraftRows(foreignRef, batch);
          for (let j = 0; j < created.length; j++) {
            const globalIdx = (batchIndex - 1) * HUBDB_MAX_BATCH_SIZE + j;
            const [normalizedKey] = rawPairs[globalIdx];
            foreignKeyMap.set(normalizedKey, created[j].id);
          }
        }
      }
      keyMapsByTable.set(foreignTable, foreignKeyMap);
    }

    // Pass 2: re-plan any pending rows. stubBucket is now null so any
    // still-unresolved tokens surface as normal `skip-row` errors (or
    // fail-fast if the policy dictates).
    const stragglers = [...pendingIdxs];
    pendingIdxs.length = 0;
    for (const i of stragglers) {
      const planned = planRow(
        table,
        source[i],
        i,
        existingKeyMap,
        readonlyKeyMaps,
        fkOptionsForTable,
        normOpts,
        null,
      );
      consume(i, planned);
    }
  }

  // Refresh every foreign table's key map by re-listing draft rows and
  // rebuilding the natural-key → id maps in place. Returns the list of
  // foreign table names that were actually refreshed (skips columns whose
  // foreign target has no naturalKey or no portal id).
  async function refreshForeignKeyMaps(): Promise<string[]> {
    const refreshed: string[] = [];
    const seen = new Set<string>();
    for (const c of table.columns) {
      if (c.type !== "FOREIGN_ID" || !c.foreignTable || seen.has(c.foreignTable)) continue;
      seen.add(c.foreignTable);
      const foreignId = tableIdsMap[c.foreignTable];
      const foreignTable = schemaByName.get(c.foreignTable);
      if (!foreignId || !foreignTable) continue;
      const fnk = naturalKeyColumns(foreignTable);
      if (fnk.length === 0) continue;
      const rows = await ops.listAllDraftRows(foreignId);
      const built = buildKeyMap(rows, fnk, normOpts);
      if (built.ok) {
        keyMapsByTable.set(c.foreignTable, built.map);
        refreshed.push(c.foreignTable);
      }
    }
    return refreshed;
  }

  const hooks = opts.hooks;
  const updateBatches = chunk(updates, HUBDB_MAX_BATCH_SIZE);
  for (let i = 0; i < updateBatches.length; i++) {
    checkCancel();
    const batch = updateBatches[i];
    const batchIndex = i + 1;
    emit({ kind: "batch-update", table: table.name, batch: batchIndex, sent: batch.length });
    if (hooks?.onBatchStart) {
      await fireHook("onBatchStart", () =>
        hooks.onBatchStart!({ table: table.name, batchIndex, kind: "update", size: batch.length }),
      );
    }
    const inputs: HubdbRowUpdate[] = batch.map((p) => {
      if (p.kind !== "update") throw new Error("unreachable");
      return { id: p.rowId, values: p.values };
    });
    try {
      const patched = await ops.batchUpdateDraftRows(tableRef, inputs);
      result.updated += patched.length;
      if (hooks?.onBatchComplete) {
        await fireHook("onBatchComplete", () =>
          hooks.onBatchComplete!({ table: table.name, batchIndex, kind: "update", status: "succeeded" }),
        );
      }
    } catch (err) {
      if (!isPossiblyStaleFkError(err)) {
        if (hooks?.onBatchComplete) {
          await fireHook("onBatchComplete", () =>
            hooks.onBatchComplete!({ table: table.name, batchIndex, kind: "update", status: "failed" }),
          );
        }
        throw err;
      }
      const refreshed = await refreshForeignKeyMaps();
      if (refreshed.length === 0) {
        if (hooks?.onBatchComplete) {
          await fireHook("onBatchComplete", () =>
            hooks.onBatchComplete!({ table: table.name, batchIndex, kind: "update", status: "failed" }),
          );
        }
        throw err;
      }
      emit({ kind: "stale-fk-retry", table: table.name, batchKind: "update", refreshed });
      // Re-plan surviving rows; drop new errors into the result.
      const retryInputs: HubdbRowUpdate[] = [];
      for (const p of batch) {
        if (p.kind !== "update") continue;
        const planned = planRow(
          table,
          source[p.sourceIndex],
          p.sourceIndex,
          existingKeyMap,
          readonlyKeyMaps,
          fkOptionsForTable,
          normOpts,
          null,
        );
        if (planned.kind === "update") retryInputs.push({ id: planned.rowId, values: planned.values });
        else if (planned.kind === "insert") retryInputs.push({ id: p.rowId, values: planned.values });
        else if (planned.kind === "error") {
          result.errors.push(planned.error);
          result.skipped++;
        }
      }
      if (retryInputs.length > 0) {
        const patched = await ops.batchUpdateDraftRows(tableRef, retryInputs);
        result.updated += patched.length;
      }
      if (hooks?.onBatchComplete) {
        await fireHook("onBatchComplete", () =>
          hooks.onBatchComplete!({ table: table.name, batchIndex, kind: "update", status: "succeeded" }),
        );
      }
    }
  }

  const insertBatches = chunk(inserts, HUBDB_MAX_BATCH_SIZE);
  for (let i = 0; i < insertBatches.length; i++) {
    checkCancel();
    const batch = insertBatches[i];
    const batchIndex = i + 1 + updateBatches.length;
    emit({ kind: "batch-create", table: table.name, batch: i + 1, sent: batch.length });
    if (hooks?.onBatchStart) {
      await fireHook("onBatchStart", () =>
        hooks.onBatchStart!({ table: table.name, batchIndex, kind: "create", size: batch.length }),
      );
    }
    const inputs: HubdbRowInput[] = batch.map((p) => {
      if (p.kind !== "insert") throw new Error("unreachable");
      return { values: p.values };
    });
    // Parallel arrays: retryInputs[j] came from source row retrySourceIdxs[j].
    // Used for both the initial call (identity mapping) and the retry.
    let effectiveSourceIdxs = batch.map((p) => p.sourceIndex);
    let created: HubdbRow[];
    try {
      created = await ops.batchCreateDraftRows(tableRef, inputs);
    } catch (err) {
      if (!isPossiblyStaleFkError(err)) {
        if (hooks?.onBatchComplete) {
          await fireHook("onBatchComplete", () =>
            hooks.onBatchComplete!({ table: table.name, batchIndex, kind: "create", status: "failed" }),
          );
        }
        throw err;
      }
      const refreshed = await refreshForeignKeyMaps();
      if (refreshed.length === 0) {
        if (hooks?.onBatchComplete) {
          await fireHook("onBatchComplete", () =>
            hooks.onBatchComplete!({ table: table.name, batchIndex, kind: "create", status: "failed" }),
          );
        }
        throw err;
      }
      emit({ kind: "stale-fk-retry", table: table.name, batchKind: "create", refreshed });
      const retryInputs: HubdbRowInput[] = [];
      const retrySourceIdxs: number[] = [];
      for (const p of batch) {
        if (p.kind !== "insert") continue;
        const planned = planRow(
          table,
          source[p.sourceIndex],
          p.sourceIndex,
          existingKeyMap,
          readonlyKeyMaps,
          fkOptionsForTable,
          normOpts,
          null,
        );
        if (planned.kind === "insert") {
          retryInputs.push({ values: planned.values });
          retrySourceIdxs.push(p.sourceIndex);
        } else if (planned.kind === "error") {
          result.errors.push(planned.error);
          result.skipped++;
        }
      }
      if (retryInputs.length === 0) {
        created = [];
      } else {
        created = await ops.batchCreateDraftRows(tableRef, retryInputs);
        effectiveSourceIdxs = retrySourceIdxs;
      }
    }
    result.created += created.length;
    if (hasNk) {
      for (let j = 0; j < created.length; j++) {
        const srcIdx = effectiveSourceIdxs[j];
        if (srcIdx === undefined) continue;
        const key = composeCompositeKey(source[srcIdx], nkCols, normOpts);
        if (key) existingKeyMap.set(key, created[j].id);
      }
    }
    if (hooks?.onBatchComplete) {
      await fireHook("onBatchComplete", () =>
        hooks.onBatchComplete!({ table: table.name, batchIndex, kind: "create", status: "succeeded" }),
      );
    }
  }

  if (hasNk) keyMapsByTable.set(table.name, existingKeyMap);

  if (hasNk && hooks?.onKeyMapReady) {
    const entries: Record<string, string> = {};
    for (const [k, v] of existingKeyMap) entries[k] = v;
    await fireHook("onKeyMapReady", () => hooks.onKeyMapReady!(table.name, entries));
  }

  emit({
    kind: "table-done",
    table: table.name,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
  });

  return result;
}

export async function importRows(
  ops: ImportOps,
  input: ImportInput,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  let order: string[];
  try {
    order = toposortOrThrow(nodesFromTableInputs(input.schema.tables));
  } catch (err) {
    if (err instanceof GraphCycleError) {
      throw err;
    }
    throw err;
  }

  const schemaByName = new Map(input.schema.tables.map((t) => [t.name, t]));
  const keyMapsByTable = new Map<string, Map<string, string>>();
  const tables: TableImportResult[] = [];

  for (const name of order) {
    const table = schemaByName.get(name);
    if (!table) continue;
    const source = input.source[name] ?? [];
    const portalId = input.tableIds[name];
    if (!portalId) {
      tables.push({
        name,
        created: 0,
        updated: 0,
        skipped: source.length,
        errors: source.map((_, i) => ({
          table: name,
          sourceIndex: i,
          kind: "unmapped-table",
          detail: `Table "${name}" has no portal id in tableIds`,
        })),
      });
      continue;
    }
    const fkOptionsForTable = input.fkOptions?.[name];
    try {
      tables.push(
        await importOneTable(
          ops,
          portalId,
          table,
          source,
          keyMapsByTable,
          fkOptionsForTable,
          input.tableIds,
          schemaByName,
          opts,
        ),
      );
    } catch (err) {
      if (err instanceof _FailFastSignal) {
        tables.push(err.tableResult);
        // Everything after the failing table never ran — mark them
        // untouched so the partial totals are readable.
        const remaining = order.slice(order.indexOf(name) + 1);
        for (const r of remaining) {
          const rSource = input.source[r] ?? [];
          tables.push({
            name: r,
            created: 0,
            updated: 0,
            skipped: rSource.length,
            errors: [],
          });
        }
        throw new ImportFailFastError(err.row, { order, tables, ok: false });
      }
      if (err instanceof _CancelSignal) {
        tables.push(err.tableResult);
        const remaining = order.slice(order.indexOf(name) + 1);
        for (const r of remaining) {
          const rSource = input.source[r] ?? [];
          tables.push({
            name: r,
            created: 0,
            updated: 0,
            skipped: rSource.length,
            errors: [],
          });
        }
        throw new ImportCancelledError({ order, tables, ok: false });
      }
      throw err;
    }
  }

  const ok = tables.every((t) => t.errors.length === 0);
  return { order, tables, ok };
}
