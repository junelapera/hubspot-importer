import type { GraphEdge, GraphNode } from "../graph";
import { breakCycles } from "../graph";
import type { DiffPlan, SchemaColumn, SchemaTable, TableDiff } from "../schema";
import type { HubdbClient } from "./client";
import { createTable, patchTable, type TableRef } from "./tables";
import type {
  HubdbColumn,
  HubdbColumnInput,
  HubdbTable,
  HubdbTableInput,
  HubdbTablePatch,
} from "./types";

export type ProvisionOps = {
  createTable: (input: HubdbTableInput) => Promise<HubdbTable>;
  patchTable: (ref: TableRef, patch: HubdbTablePatch) => Promise<HubdbTable>;
};

export function opsFromClient(client: HubdbClient): ProvisionOps {
  return {
    createTable: (input) => createTable(client, input),
    patchTable: (ref, patch) => patchTable(client, ref, patch),
  };
}

export type ProvisionEvent =
  | { kind: "create-start"; table: string; columns: string[] }
  | { kind: "create-done"; table: string; portalId: string }
  | { kind: "update-start"; table: string; addColumns: string[] }
  | { kind: "update-done"; table: string }
  | { kind: "defer-patch-start"; table: string; addColumns: string[] }
  | { kind: "defer-patch-done"; table: string };

export type ProvisionOptions = {
  onEvent?: (event: ProvisionEvent) => void;
};

export type ProvisionResult = {
  order: string[];
  deferred: GraphEdge[];
  tableIds: Record<string, string>;
};

export class ProvisionConflictError extends Error {
  readonly conflictTables: string[];
  constructor(tables: string[]) {
    super(`Provision blocked by ${tables.length} conflict(s): ${tables.join(", ")}`);
    this.name = "ProvisionConflictError";
    this.conflictTables = tables;
  }
}

function schemaColumnToInput(col: SchemaColumn): HubdbColumnInput {
  const out: HubdbColumnInput = { name: col.name, type: col.type };
  if (col.label !== undefined) out.label = col.label;
  if (col.foreignTable !== undefined) out.foreignTableName = col.foreignTable;
  if (col.foreignColumn !== undefined) out.foreignColumnName = col.foreignColumn;
  if (col.options !== undefined) out.options = col.options;
  return out;
}

function schemaToTableInput(t: SchemaTable, columns: SchemaColumn[]): HubdbTableInput {
  const out: HubdbTableInput = {
    name: t.name,
    label: t.label,
    columns: columns.map(schemaColumnToInput),
  };
  if (t.useForPages !== undefined) out.useForPages = t.useForPages;
  if (t.allowChildTables !== undefined) out.allowChildTables = t.allowChildTables;
  if (t.enableChildTablePages !== undefined) out.enableChildTablePages = t.enableChildTablePages;
  return out;
}

function portalColumnToInput(c: HubdbColumn): HubdbColumnInput & { id: string } {
  const out: HubdbColumnInput & { id: string } = {
    id: c.id,
    name: c.name,
    type: c.type,
  };
  if (c.label !== undefined) out.label = c.label;
  if (c.options !== undefined) out.options = c.options;
  if (c.foreignTableId !== undefined) out.foreignTableId = c.foreignTableId;
  if (c.foreignColumnId !== undefined) out.foreignColumnId = c.foreignColumnId;
  return out;
}

function partitionColumns(
  candidates: readonly SchemaColumn[],
  table: string,
  deferred: readonly GraphEdge[],
): { immediate: SchemaColumn[]; deferred: SchemaColumn[] } {
  const deferredTargets = new Set<string>();
  for (const e of deferred) {
    if (e.from === table && e.to) deferredTargets.add(e.to);
  }
  const immediate: SchemaColumn[] = [];
  const later: SchemaColumn[] = [];
  for (const col of candidates) {
    const isDeferredFk =
      col.type === "FOREIGN_ID" && col.foreignTable && deferredTargets.has(col.foreignTable);
    if (isDeferredFk) later.push(col);
    else immediate.push(col);
  }
  return { immediate, deferred: later };
}

type WorkDiff = Extract<TableDiff, { action: "create" } | { action: "update" }>;

function candidateColumns(diff: WorkDiff): SchemaColumn[] {
  return diff.action === "create" ? diff.schema.columns : diff.addColumns;
}

function buildNodes(work: Map<string, WorkDiff>, createNames: ReadonlySet<string>): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (const [name, diff] of work) {
    const deps = new Set<string>();
    for (const col of candidateColumns(diff)) {
      if (
        col.type === "FOREIGN_ID" &&
        col.foreignTable &&
        (col.foreignTable === name || createNames.has(col.foreignTable))
      ) {
        deps.add(col.foreignTable);
      }
    }
    nodes.push({ name, dependencies: [...deps] });
  }
  return nodes;
}

function groupEdgesBySource(edges: readonly GraphEdge[]): Map<string, GraphEdge[]> {
  const out = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const list = out.get(e.from) ?? [];
    list.push(e);
    out.set(e.from, list);
  }
  return out;
}

export async function provision(
  ops: ProvisionOps,
  plan: DiffPlan,
  options: ProvisionOptions = {},
): Promise<ProvisionResult> {
  const conflictNames = plan.tables
    .filter((t) => t.action === "conflict")
    .map((t) => t.name);
  if (conflictNames.length) throw new ProvisionConflictError(conflictNames);

  const emit = (event: ProvisionEvent) => options.onEvent?.(event);
  const tableIds: Record<string, string> = {};
  const state = new Map<string, HubdbTable>();
  const work = new Map<string, WorkDiff>();
  const createNames = new Set<string>();

  for (const t of plan.tables) {
    if (t.action === "match") {
      tableIds[t.name] = t.portal.id;
      state.set(t.name, t.portal);
      continue;
    }
    if (t.action === "update") {
      tableIds[t.name] = t.portal.id;
      state.set(t.name, t.portal);
      work.set(t.name, t);
      continue;
    }
    if (t.action === "create") {
      createNames.add(t.name);
      work.set(t.name, t);
    }
  }

  const nodes = buildNodes(work, createNames);
  const { order, deferred } = breakCycles(nodes);

  for (const name of order) {
    const diff = work.get(name);
    if (!diff) continue;

    if (diff.action === "create") {
      const { immediate } = partitionColumns(diff.schema.columns, name, deferred);
      emit({ kind: "create-start", table: name, columns: immediate.map((c) => c.name) });
      const created = await ops.createTable(schemaToTableInput(diff.schema, immediate));
      tableIds[name] = created.id;
      state.set(name, created);
      emit({ kind: "create-done", table: name, portalId: created.id });
      continue;
    }

    const { immediate } = partitionColumns(diff.addColumns, name, deferred);
    if (immediate.length === 0) continue;
    emit({ kind: "update-start", table: name, addColumns: immediate.map((c) => c.name) });
    const merged: (HubdbColumnInput & { id?: string })[] = [
      ...diff.portal.columns.map(portalColumnToInput),
      ...immediate.map(schemaColumnToInput),
    ];
    const patched = await ops.patchTable(diff.portal.id, { columns: merged });
    state.set(name, patched);
    emit({ kind: "update-done", table: name });
  }

  const bySource = groupEdgesBySource(deferred);
  for (const [source, edges] of bySource) {
    const diff = work.get(source);
    if (!diff) continue;
    const current = state.get(source);
    if (!current) continue;
    const targets = new Set(edges.map((e) => e.to));
    const deferredCols = candidateColumns(diff).filter(
      (c) => c.type === "FOREIGN_ID" && c.foreignTable && targets.has(c.foreignTable),
    );
    if (deferredCols.length === 0) continue;
    emit({ kind: "defer-patch-start", table: source, addColumns: deferredCols.map((c) => c.name) });
    const merged: (HubdbColumnInput & { id?: string })[] = [
      ...current.columns.map(portalColumnToInput),
      ...deferredCols.map(schemaColumnToInput),
    ];
    const patched = await ops.patchTable(current.id, { columns: merged });
    state.set(source, patched);
    emit({ kind: "defer-patch-done", table: source });
  }

  return { order, deferred, tableIds };
}
