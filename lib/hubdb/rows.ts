import type { HubdbClient } from "./client";
import type { HubdbPage, HubdbRow, HubdbRowInput, HubdbRowUpdate } from "./types";
import type { TableRef } from "./tables";

export const HUBDB_MAX_BATCH_SIZE = 100;
export const HUBDB_DEFAULT_READ_PAGE_SIZE = 1000;

type RawRow = Omit<HubdbRow, "id"> & { id: string | number };

function normalizeRow(r: RawRow): HubdbRow {
  return { ...r, id: String(r.id) };
}

function assertBatchSize(inputs: readonly unknown[]) {
  if (inputs.length === 0) {
    throw new Error("HubDB batch: inputs cannot be empty");
  }
  if (inputs.length > HUBDB_MAX_BATCH_SIZE) {
    throw new Error(
      `HubDB batch: ${inputs.length} rows exceeds the ${HUBDB_MAX_BATCH_SIZE}-per-call cap`,
    );
  }
}

export type RowReadOptions = {
  limit?: number;
  after?: string;
  properties?: string;
  signal?: AbortSignal;
};

async function readRowsPage(
  client: HubdbClient,
  path: string,
  opts: RowReadOptions,
): Promise<HubdbPage<HubdbRow>> {
  const page = await client.request<HubdbPage<RawRow>>(path, {
    query: {
      limit: opts.limit ?? HUBDB_DEFAULT_READ_PAGE_SIZE,
      after: opts.after,
      properties: opts.properties,
    },
    signal: opts.signal,
  });
  return { results: page.results.map(normalizeRow), paging: page.paging };
}

export function listDraftRowsPage(
  client: HubdbClient,
  ref: TableRef,
  opts: RowReadOptions = {},
): Promise<HubdbPage<HubdbRow>> {
  return readRowsPage(client, `/tables/${encodeURIComponent(ref)}/rows/draft`, opts);
}

export function listLiveRowsPage(
  client: HubdbClient,
  ref: TableRef,
  opts: RowReadOptions = {},
): Promise<HubdbPage<HubdbRow>> {
  return readRowsPage(client, `/tables/${encodeURIComponent(ref)}/rows`, opts);
}

export async function listAllDraftRows(
  client: HubdbClient,
  ref: TableRef,
  opts: Omit<RowReadOptions, "after"> = {},
): Promise<HubdbRow[]> {
  return collectAllRows((after) => listDraftRowsPage(client, ref, { ...opts, after }));
}

export async function listAllLiveRows(
  client: HubdbClient,
  ref: TableRef,
  opts: Omit<RowReadOptions, "after"> = {},
): Promise<HubdbRow[]> {
  return collectAllRows((after) => listLiveRowsPage(client, ref, { ...opts, after }));
}

async function collectAllRows(
  loadPage: (after: string | undefined) => Promise<HubdbPage<HubdbRow>>,
): Promise<HubdbRow[]> {
  const out: HubdbRow[] = [];
  let after: string | undefined;
  do {
    const page = await loadPage(after);
    out.push(...page.results);
    after = page.paging?.next?.after;
  } while (after);
  return out;
}

export async function batchCreateDraftRows(
  client: HubdbClient,
  ref: TableRef,
  rows: HubdbRowInput[],
): Promise<HubdbRow[]> {
  assertBatchSize(rows);
  const res = await client.request<{ results: RawRow[] }>(
    `/tables/${encodeURIComponent(ref)}/rows/draft/batch/create`,
    { method: "POST", body: { inputs: rows } },
  );
  return (res.results ?? []).map(normalizeRow);
}

export async function batchUpdateDraftRows(
  client: HubdbClient,
  ref: TableRef,
  rows: HubdbRowUpdate[],
): Promise<HubdbRow[]> {
  assertBatchSize(rows);
  const res = await client.request<{ results: RawRow[] }>(
    `/tables/${encodeURIComponent(ref)}/rows/draft/batch/update`,
    { method: "POST", body: { inputs: rows } },
  );
  return (res.results ?? []).map(normalizeRow);
}

export async function batchPurgeDraftRows(
  client: HubdbClient,
  ref: TableRef,
  rowIds: readonly string[],
): Promise<void> {
  assertBatchSize(rowIds);
  await client.request(
    `/tables/${encodeURIComponent(ref)}/rows/draft/batch/purge`,
    { method: "POST", body: { inputs: rowIds } },
  );
}
