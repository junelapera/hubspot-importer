import { hubdb, log, runSpike } from "./client";

type Row = { id: string; values: Record<string, unknown>; publishedAt: string | null };
type RowList = { results: Row[]; paging?: { next?: { after: string } } };
type Table = { id: string; name: string; published: boolean; publishedAt?: string | null };

async function countRows(tableName: string, view: "draft" | "live") {
  const path = view === "draft" ? `/tables/${tableName}/rows/draft` : `/tables/${tableName}/rows`;
  try {
    const res = await hubdb<RowList>(path, { query: { limit: 1000 } });
    return {
      view,
      count: res.results?.length ?? 0,
      firstId: res.results?.[0]?.id,
      firstSlug: res.results?.[0]?.values?.slug ?? res.results?.[0]?.values?.sku,
    };
  } catch (err) {
    return { view, error: (err as Error).message };
  }
}

async function inspect(tableName: string) {
  const table = await hubdb<Table>(`/tables/${tableName}`);
  const [draft, live] = await Promise.all([countRows(tableName, "draft"), countRows(tableName, "live")]);
  return { table: tableName, id: table.id, published: table.published, publishedAt: table.publishedAt, draft, live };
}

runSpike(async () => {
  for (const name of ["brands", "categories", "products"]) {
    log(name, await inspect(name));
  }
});
