export type HubdbColumnType =
  | "TEXT"
  | "RICHTEXT"
  | "URL"
  | "IMAGE"
  | "SELECT"
  | "MULTISELECT"
  | "BOOLEAN"
  | "NUMBER"
  | "DATE"
  | "DATETIME"
  | "LOCATION"
  | "FOREIGN_ID"
  | "VIDEO"
  | "CTA"
  | "FILE"
  | "CURRENCY";

export type HubdbColumn = {
  id: string;
  name: string;
  label?: string;
  type: HubdbColumnType | string;
  options?: unknown;
  foreignTableId?: string;
  foreignColumnId?: string;
};

export type HubdbTable = {
  id: string;
  name: string;
  label: string;
  published: boolean;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  useForPages?: boolean;
  allowChildTables?: boolean;
  enableChildTablePages?: boolean;
  rowCount?: number;
  columns: HubdbColumn[];
};

export type HubdbForeignRef = { id: string; type: "foreignid" };

export type HubdbRowValues = Record<string, unknown>;

export type HubdbRow = {
  id: string;
  path?: string;
  name?: string;
  values: HubdbRowValues;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
};

export type HubdbPage<T> = {
  results: T[];
  paging?: { next?: { after: string } };
};

export type HubdbColumnInput = {
  name: string;
  label?: string;
  type: HubdbColumnType | string;
  options?: unknown;
  foreignTableId?: string;
  foreignColumnId?: string;
  foreignTableName?: string;
  foreignColumnName?: string;
};

export type HubdbTableInput = {
  name: string;
  label: string;
  useForPages?: boolean;
  allowChildTables?: boolean;
  enableChildTablePages?: boolean;
  columns: HubdbColumnInput[];
};

export type HubdbTablePatch = Partial<Omit<HubdbTableInput, "columns">> & {
  columns?: (HubdbColumnInput & { id?: string })[];
};

export type HubdbRowInput = {
  path?: string;
  name?: string;
  childTableId?: string;
  values: HubdbRowValues;
};

export type HubdbRowUpdate = HubdbRowInput & { id: string };

export const PUBLISHED_AT_EPOCH = "1970-01-01T00:00:00Z";

export function isPublished(t: Pick<HubdbTable, "published" | "publishedAt">): boolean {
  if (!t.published) return false;
  return !!t.publishedAt && t.publishedAt !== PUBLISHED_AT_EPOCH;
}
