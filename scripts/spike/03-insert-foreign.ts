import { hubdb, log, runSpike } from "./client";

type Row = { id: string; values: Record<string, unknown> };
type BatchResponse = { results: Row[]; status?: string };
type RowList = { results: Row[]; paging?: { next?: { after: string } } };

const COUNT = 200;
const BATCH_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function generateRows(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(3, "0");
    return { name: `${prefix} ${n}`, slug: `${prefix.toLowerCase()}-${n}` };
  });
}

async function fetchDraftRows(tableName: string): Promise<Row[]> {
  const rows: Row[] = [];
  let after: string | undefined;
  do {
    const res = await hubdb<RowList>(`/tables/${tableName}/rows/draft`, {
      query: { limit: 1000, after },
    });
    rows.push(...res.results);
    after = res.paging?.next?.after;
  } while (after);
  return rows;
}

async function batchInsert(tableName: string, rows: Array<Record<string, string>>) {
  const batches = chunk(rows, BATCH_SIZE);
  const timings: Array<{ batch: number; sent: number; returned: number; ms: number }> = [];
  const created: Row[] = [];
  for (let i = 0; i < batches.length; i++) {
    const started = performance.now();
    const res = await hubdb<BatchResponse>(`/tables/${tableName}/rows/draft/batch/create`, {
      method: "POST",
      body: { inputs: batches[i].map((v) => ({ values: v })) },
    });
    const ms = Math.round(performance.now() - started);
    timings.push({
      batch: i + 1,
      sent: batches[i].length,
      returned: res.results?.length ?? 0,
      ms,
    });
    created.push(...(res.results ?? []));
  }
  return { created, timings };
}

async function populate(tableName: string, prefix: string) {
  const existing = await fetchDraftRows(tableName);
  if (existing.length > 0) {
    const keyMap = Object.fromEntries(existing.map((r) => [String(r.values.slug ?? ""), r.id]));
    return {
      table: tableName,
      action: "skip" as const,
      existing: existing.length,
      mapSize: Object.keys(keyMap).length,
      mapSample: Object.entries(keyMap).slice(0, 3),
    };
  }
  const rows = generateRows(prefix, COUNT);
  const { created, timings } = await batchInsert(tableName, rows);
  const keyMap = Object.fromEntries(created.map((r) => [String(r.values.slug ?? ""), r.id]));
  return {
    table: tableName,
    action: "create" as const,
    inserted: created.length,
    batches: timings,
    mapSize: Object.keys(keyMap).length,
    mapSample: Object.entries(keyMap).slice(0, 3),
  };
}

runSpike(async () => {
  const brands = await populate("brands", "Brand");
  log("brands", brands);
  const categories = await populate("categories", "Category");
  log("categories", categories);
});
