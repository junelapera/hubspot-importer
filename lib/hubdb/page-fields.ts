import type { HubdbColumn, HubdbRow, HubdbRowInput, HubdbTable } from "./types";

// Page tables (`useForPages`) carry each row's page path and page title as
// ROW fields (`row.path`, `row.name` — HubSpot's export calls them hs_path /
// hs_name), not as columns. To keep mapping, natural keys, dry run and
// import uniform, they're surfaced as two pseudo-columns everywhere above
// the wire: reads fold `path`/`name` into `values.hs_path`/`values.hs_name`,
// writes lift them back out. HubDB reserves the `hs_` prefix for column
// names, so these can't collide with a real column.

export const PAGE_PATH = "hs_path";
export const PAGE_NAME = "hs_name";

export function isPageField(columnName: string): boolean {
  return columnName === PAGE_PATH || columnName === PAGE_NAME;
}

/** The pseudo-columns for a page table (none for a non-page table). */
export function pageColumns(table: Pick<HubdbTable, "useForPages">): HubdbColumn[] {
  if (!table.useForPages) return [];
  return [
    { id: PAGE_PATH, name: PAGE_PATH, label: "Page path", type: "TEXT" },
    { id: PAGE_NAME, name: PAGE_NAME, label: "Page title", type: "TEXT" },
  ];
}

/** Real columns plus, for page tables, the hs_path / hs_name pseudo-columns. */
export function columnsWithPageFields(table: Pick<HubdbTable, "useForPages" | "columns">): HubdbColumn[] {
  return [...pageColumns(table), ...table.columns];
}

/** A read row with its page path / title folded into `values`. */
export function withPageValues(row: HubdbRow): HubdbRow {
  const r = row as HubdbRow & { path?: string | null; name?: string | null };
  if (r.path == null && r.name == null) return row;
  return {
    ...row,
    values: {
      ...row.values,
      ...(r.path != null ? { [PAGE_PATH]: r.path } : {}),
      ...(r.name != null ? { [PAGE_NAME]: r.name } : {}),
    },
  };
}

/** A write row with `values.hs_path` / `values.hs_name` lifted to `path` / `name`. */
export function liftPageValues<T extends HubdbRowInput>(row: T): T {
  if (!(PAGE_PATH in row.values) && !(PAGE_NAME in row.values)) return row;
  const { [PAGE_PATH]: path, [PAGE_NAME]: name, ...values } = row.values;
  return {
    ...row,
    ...(typeof path === "string" ? { path } : {}),
    ...(typeof name === "string" ? { name } : {}),
    values,
  };
}
