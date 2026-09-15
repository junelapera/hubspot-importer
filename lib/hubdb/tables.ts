import type { HubdbClient } from "./client";
import type {
  HubdbColumn,
  HubdbPage,
  HubdbTable,
  HubdbTableInput,
  HubdbTablePatch,
} from "./types";

type RawColumn = Omit<HubdbColumn, "id" | "foreignTableId" | "foreignColumnId"> & {
  id?: string | number;
  foreignTableId?: string | number;
  foreignColumnId?: string | number;
};

type RawTable = Omit<HubdbTable, "id" | "columns"> & {
  id: string | number;
  columns?: RawColumn[];
};

function toStringId(v: string | number | undefined): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}

function normalizeColumn(c: RawColumn): HubdbColumn {
  const id = toStringId(c.id);
  if (!id) throw new Error(`HubDB column missing id: ${c.name}`);
  return {
    ...c,
    id,
    foreignTableId: toStringId(c.foreignTableId),
    foreignColumnId: toStringId(c.foreignColumnId),
  };
}

function normalizeTable(t: RawTable): HubdbTable {
  return {
    ...t,
    id: String(t.id),
    columns: (t.columns ?? []).map(normalizeColumn),
  };
}

export type TableRef = string;

export async function listTables(client: HubdbClient): Promise<HubdbTable[]> {
  const all: HubdbTable[] = [];
  let after: string | undefined;
  do {
    const page = await client.request<HubdbPage<RawTable>>("/tables", {
      query: { limit: 100, after },
    });
    all.push(...page.results.map(normalizeTable));
    after = page.paging?.next?.after;
  } while (after);
  return all;
}

export async function getTable(client: HubdbClient, ref: TableRef): Promise<HubdbTable> {
  const raw = await client.request<RawTable>(`/tables/${encodeURIComponent(ref)}`);
  return normalizeTable(raw);
}

export async function getDraftTable(client: HubdbClient, ref: TableRef): Promise<HubdbTable> {
  const raw = await client.request<RawTable>(`/tables/${encodeURIComponent(ref)}/draft`);
  return normalizeTable(raw);
}

export async function createTable(
  client: HubdbClient,
  input: HubdbTableInput,
): Promise<HubdbTable> {
  const raw = await client.request<RawTable>("/tables", {
    method: "POST",
    body: input,
  });
  return normalizeTable(raw);
}

export async function patchTable(
  client: HubdbClient,
  ref: TableRef,
  patch: HubdbTablePatch,
): Promise<HubdbTable> {
  const raw = await client.request<RawTable>(`/tables/${encodeURIComponent(ref)}/draft`, {
    method: "PATCH",
    body: patch,
  });
  return normalizeTable(raw);
}

export async function pushLive(client: HubdbClient, ref: TableRef): Promise<HubdbTable> {
  const raw = await client.request<RawTable>(
    `/tables/${encodeURIComponent(ref)}/draft/push-live`,
    { method: "POST" },
  );
  return normalizeTable(raw);
}
