import { toposortOrThrow, nodesFromTableInputs, GraphCycleError } from "../graph";
import {
  buildKeyMap,
  DEFAULT_NORMALIZE,
  HUBDB_MAX_ROWS_PER_TABLE,
  normalizeKey,
  resolveForeignValue,
  type NormalizeOptions,
} from "../resolve";
import type { Schema, SchemaColumn, SchemaTable } from "../schema";
import type { HubdbClient } from "./client";
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

export type ImportInput = {
  schema: Schema;
  tableIds: Readonly<Record<string, string>>;
  source: Readonly<Record<string, readonly SourceRow[]>>;
};

export type ImportOptions = {
  normalize?: NormalizeOptions;
  onEvent?: (event: ImportEvent) => void;
};

export type ImportEvent =
  | { kind: "table-start"; table: string; sourceCount: number }
  | { kind: "table-preflight-ok"; table: string; existingRows: number; sourceCount: number }
  | { kind: "batch-create"; table: string; batch: number; sent: number }
  | { kind: "batch-update"; table: string; batch: number; sent: number }
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

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function naturalKeyColumn(t: SchemaTable): string | undefined {
  if (!t.naturalKey) return undefined;
  return Array.isArray(t.naturalKey) ? undefined : t.naturalKey;
}

type PlannedRow =
  | { kind: "insert"; sourceIndex: number; values: Record<string, unknown> }
  | { kind: "update"; sourceIndex: number; rowId: string; values: Record<string, unknown> }
  | { kind: "error"; sourceIndex: number; error: RowError };

function planRow(
  table: SchemaTable,
  source: SourceRow,
  sourceIndex: number,
  existingKeys: ReadonlyMap<string, string>,
  keyMapsByTable: ReadonlyMap<string, ReadonlyMap<string, string>>,
  normOpts: NormalizeOptions,
): PlannedRow {
  const nk = naturalKeyColumn(table);
  if (!nk) {
    return {
      kind: "error",
      sourceIndex,
      error: {
        table: table.name,
        sourceIndex,
        kind: "missing-natural-key",
        detail: `Table "${table.name}" has no single-column naturalKey (composite naturalKey unsupported in v1)`,
      },
    };
  }

  const nkRaw = source[nk];
  const nkKey = normalizeKey(nkRaw, normOpts);
  if (nkKey === "") {
    return {
      kind: "error",
      sourceIndex,
      error: {
        table: table.name,
        sourceIndex,
        kind: "missing-natural-key",
        detail: `Source row is missing natural-key column "${nk}"`,
      },
    };
  }

  const values: Record<string, unknown> = {};
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
          detail: `Column "${col.name}" references table "${col.foreignTable}" which has no key map (not in schema or not processed yet)`,
        },
      };
    }

    const rawValues = Array.isArray(raw) ? raw : [raw];
    const resolved = resolveForeignValue(rawValues, map, { normalize: normOpts });
    if (!resolved.ok) {
      return {
        kind: "error",
        sourceIndex,
        error: {
          table: table.name,
          sourceIndex,
          kind: "unresolved-fk",
          detail: `Column "${col.name}" -> "${col.foreignTable}": missing ${JSON.stringify(resolved.missing)}`,
        },
      };
    }
    values[col.name] = resolved.cell as HubdbForeignRef[];
  }

  const existingId = existingKeys.get(nkKey);
  if (existingId) return { kind: "update", sourceIndex, rowId: existingId, values };
  return { kind: "insert", sourceIndex, values };
}

async function importOneTable(
  ops: ImportOps,
  tableRef: TableRef,
  table: SchemaTable,
  source: readonly SourceRow[],
  keyMapsByTable: Map<string, Map<string, string>>,
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

  emit({ kind: "table-start", table: table.name, sourceCount: source.length });

  const nk = naturalKeyColumn(table);
  const existingRows = await ops.listAllDraftRows(tableRef);

  let existingKeyMap = new Map<string, string>();
  if (nk) {
    const built = buildKeyMap(existingRows, nk, normOpts);
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

  for (let i = 0; i < source.length; i++) {
    const planned = planRow(table, source[i], i, existingKeyMap, readonlyKeyMaps, normOpts);
    if (planned.kind === "error") {
      result.errors.push(planned.error);
      result.skipped++;
      continue;
    }
    if (planned.kind === "insert") inserts.push(planned);
    else updates.push(planned);
  }

  const updateBatches = chunk(updates, HUBDB_MAX_BATCH_SIZE);
  for (let i = 0; i < updateBatches.length; i++) {
    const batch = updateBatches[i];
    emit({ kind: "batch-update", table: table.name, batch: i + 1, sent: batch.length });
    const inputs: HubdbRowUpdate[] = batch.map((p) => {
      if (p.kind !== "update") throw new Error("unreachable");
      return { id: p.rowId, values: p.values };
    });
    const patched = await ops.batchUpdateDraftRows(tableRef, inputs);
    result.updated += patched.length;
  }

  const insertBatches = chunk(inserts, HUBDB_MAX_BATCH_SIZE);
  for (let i = 0; i < insertBatches.length; i++) {
    const batch = insertBatches[i];
    emit({ kind: "batch-create", table: table.name, batch: i + 1, sent: batch.length });
    const inputs: HubdbRowInput[] = batch.map((p) => {
      if (p.kind !== "insert") throw new Error("unreachable");
      return { values: p.values };
    });
    const created = await ops.batchCreateDraftRows(tableRef, inputs);
    result.created += created.length;
    if (nk) {
      for (let j = 0; j < created.length; j++) {
        const src = batch[j];
        if (src.kind !== "insert") continue;
        const key = normalizeKey(source[src.sourceIndex][nk], normOpts);
        if (key) existingKeyMap.set(key, created[j].id);
      }
    }
  }

  if (nk) keyMapsByTable.set(table.name, existingKeyMap);

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
    tables.push(await importOneTable(ops, portalId, table, source, keyMapsByTable, opts));
  }

  const ok = tables.every((t) => t.errors.length === 0);
  return { order, tables, ok };
}
