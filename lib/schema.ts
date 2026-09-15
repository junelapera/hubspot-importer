import { z } from "zod";
import type { HubdbColumn, HubdbTable } from "./hubdb";

const SchemaColumnZ = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  type: z.string().min(1),
  foreignTable: z.string().optional(),
  foreignColumn: z.string().optional(),
  options: z.unknown().optional(),
});

const SchemaTableZ = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  columns: z.array(SchemaColumnZ).min(1),
  naturalKey: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
  useForPages: z.boolean().optional(),
  allowChildTables: z.boolean().optional(),
  enableChildTablePages: z.boolean().optional(),
});

const SchemaZ = z.object({
  version: z.literal(1),
  tables: z.array(SchemaTableZ).min(1),
});

export type SchemaColumn = z.infer<typeof SchemaColumnZ>;
export type SchemaTable = z.infer<typeof SchemaTableZ>;
export type Schema = z.infer<typeof SchemaZ>;

export class SchemaValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Schema validation failed:\n  - ${issues.join("\n  - ")}`);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

function naturalKeyColumns(t: SchemaTable): string[] {
  if (!t.naturalKey) return [];
  return Array.isArray(t.naturalKey) ? t.naturalKey : [t.naturalKey];
}

function validateCrossRefs(schema: Schema): string[] {
  const issues: string[] = [];
  const tableByName = new Map<string, SchemaTable>();

  for (const t of schema.tables) {
    if (tableByName.has(t.name)) {
      issues.push(`Duplicate table name: "${t.name}"`);
      continue;
    }
    tableByName.set(t.name, t);
  }

  for (const t of schema.tables) {
    const colNames = new Set<string>();
    for (const col of t.columns) {
      if (colNames.has(col.name)) {
        issues.push(`Table "${t.name}": duplicate column "${col.name}"`);
      }
      colNames.add(col.name);

      if (col.type === "FOREIGN_ID") {
        if (!col.foreignTable) {
          issues.push(
            `Table "${t.name}", column "${col.name}": FOREIGN_ID requires "foreignTable"`,
          );
          continue;
        }
        const target = tableByName.get(col.foreignTable);
        if (!target) {
          issues.push(
            `Table "${t.name}", column "${col.name}": foreignTable "${col.foreignTable}" is not defined in this schema`,
          );
          continue;
        }
        if (col.foreignColumn) {
          const targetHasColumn = target.columns.some((c) => c.name === col.foreignColumn);
          if (!targetHasColumn) {
            issues.push(
              `Table "${t.name}", column "${col.name}": foreignColumn "${col.foreignColumn}" not found on target "${target.name}"`,
            );
          }
        }
      }
    }

    for (const keyCol of naturalKeyColumns(t)) {
      if (!colNames.has(keyCol)) {
        issues.push(`Table "${t.name}": naturalKey column "${keyCol}" is not defined`);
      }
    }
  }

  return issues;
}

export type ParseOptions = {
  resolveDefaults?: boolean;
};

export function parseSchema(input: unknown, opts: ParseOptions = {}): Schema {
  const parsed = SchemaZ.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const path = i.path.length ? i.path.join(".") : "<root>";
      return `${path}: ${i.message}`;
    });
    throw new SchemaValidationError(issues);
  }
  const crossRefIssues = validateCrossRefs(parsed.data);
  if (crossRefIssues.length) throw new SchemaValidationError(crossRefIssues);

  return opts.resolveDefaults === false ? parsed.data : resolveDefaults(parsed.data);
}

export function resolveDefaults(schema: Schema): Schema {
  const tableByName = new Map(schema.tables.map((t) => [t.name, t]));
  return {
    ...schema,
    tables: schema.tables.map((t) => ({
      ...t,
      columns: t.columns.map((col) => {
        if (col.type !== "FOREIGN_ID" || !col.foreignTable || col.foreignColumn) {
          return col;
        }
        const target = tableByName.get(col.foreignTable);
        if (!target) return col;
        const keys = naturalKeyColumns(target);
        if (keys.length === 1) return { ...col, foreignColumn: keys[0] };
        return col;
      }),
    })),
  };
}

export type Conflict =
  | {
      kind: "column-type-mismatch";
      table: string;
      column: string;
      expected: string;
      actual: string;
    }
  | {
      kind: "fk-target-mismatch";
      table: string;
      column: string;
      expectedTable: string;
      actualTableId: string;
    }
  | {
      kind: "fk-column-mismatch";
      table: string;
      column: string;
      expectedColumn: string;
      actualColumnId: string;
    };

export type TableDiff =
  | { name: string; action: "create"; schema: SchemaTable }
  | { name: string; action: "match"; schema: SchemaTable; portal: HubdbTable }
  | {
      name: string;
      action: "update";
      schema: SchemaTable;
      portal: HubdbTable;
      addColumns: SchemaColumn[];
    }
  | {
      name: string;
      action: "conflict";
      schema: SchemaTable;
      portal: HubdbTable;
      conflicts: Conflict[];
    };

export type DiffPlan = {
  tables: TableDiff[];
  ok: boolean;
};

function findFkTargetTable(
  portal: readonly HubdbTable[],
  schemaTargetName: string,
): HubdbTable | undefined {
  return portal.find((t) => t.name === schemaTargetName);
}

function findColumn(cols: readonly HubdbColumn[], name: string): HubdbColumn | undefined {
  return cols.find((c) => c.name === name);
}

function diffTable(
  schemaTable: SchemaTable,
  portalTable: HubdbTable,
  portal: readonly HubdbTable[],
): TableDiff {
  const conflicts: Conflict[] = [];
  const addColumns: SchemaColumn[] = [];

  for (const col of schemaTable.columns) {
    const existing = findColumn(portalTable.columns, col.name);
    if (!existing) {
      addColumns.push(col);
      continue;
    }
    if (existing.type !== col.type) {
      conflicts.push({
        kind: "column-type-mismatch",
        table: schemaTable.name,
        column: col.name,
        expected: col.type,
        actual: existing.type,
      });
      continue;
    }
    if (col.type === "FOREIGN_ID" && col.foreignTable) {
      const targetTable = findFkTargetTable(portal, col.foreignTable);
      if (targetTable && existing.foreignTableId && existing.foreignTableId !== targetTable.id) {
        conflicts.push({
          kind: "fk-target-mismatch",
          table: schemaTable.name,
          column: col.name,
          expectedTable: col.foreignTable,
          actualTableId: existing.foreignTableId,
        });
        continue;
      }
      if (col.foreignColumn && targetTable && existing.foreignColumnId) {
        const targetCol = findColumn(targetTable.columns, col.foreignColumn);
        if (targetCol && existing.foreignColumnId !== targetCol.id) {
          conflicts.push({
            kind: "fk-column-mismatch",
            table: schemaTable.name,
            column: col.name,
            expectedColumn: col.foreignColumn,
            actualColumnId: existing.foreignColumnId,
          });
        }
      }
    }
  }

  if (conflicts.length) {
    return { name: schemaTable.name, action: "conflict", schema: schemaTable, portal: portalTable, conflicts };
  }
  if (addColumns.length) {
    return { name: schemaTable.name, action: "update", schema: schemaTable, portal: portalTable, addColumns };
  }
  return { name: schemaTable.name, action: "match", schema: schemaTable, portal: portalTable };
}

export function diffSchema(schema: Schema, portal: readonly HubdbTable[]): DiffPlan {
  const portalByName = new Map(portal.map((t) => [t.name, t]));
  const tables: TableDiff[] = schema.tables.map((t) => {
    const existing = portalByName.get(t.name);
    if (!existing) return { name: t.name, action: "create", schema: t };
    return diffTable(t, existing, portal);
  });
  return {
    tables,
    ok: tables.every((t) => t.action !== "conflict"),
  };
}

export const _internals = { validateCrossRefs, naturalKeyColumns };
