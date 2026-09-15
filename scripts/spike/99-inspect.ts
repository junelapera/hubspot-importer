import { client, log, runSpike } from "./client";
import { getTable, listDraftRowsPage, listLiveRowsPage } from "../../lib/hubdb";

async function countRows(tableName: string, view: "draft" | "live") {
  const load = view === "draft" ? listDraftRowsPage : listLiveRowsPage;
  try {
    const page = await load(client, tableName, { limit: 1000 });
    const first = page.results[0];
    return {
      view,
      count: page.results.length,
      firstId: first?.id,
      firstSlug: first?.values?.slug ?? first?.values?.sku,
    };
  } catch (err) {
    return { view, error: (err as Error).message };
  }
}

async function inspect(tableName: string) {
  const table = await getTable(client, tableName);
  const [draft, live] = await Promise.all([countRows(tableName, "draft"), countRows(tableName, "live")]);
  return { table: tableName, id: table.id, published: table.published, publishedAt: table.publishedAt, draft, live };
}

runSpike(async () => {
  for (const name of ["brands", "categories", "products"]) {
    log(name, await inspect(name));
  }
});
