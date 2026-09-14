import { hubdb, log, runSpike } from "./client";

type Row = { id: string; values: Record<string, unknown> };
type BatchResponse = { results: Row[] };
type RowList = { results: Row[]; paging?: { next?: { after: string } } };

const COUNT = 200;
const BATCH_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

function buildSlugMap(rows: Row[]): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [String(r.values.slug ?? ""), r.id]));
}

type ProductValues = {
  sku: string;
  title: string;
  brand: Array<{ id: string; type: "foreignid" }>;
  category: Array<{ id: string; type: "foreignid" }>;
};

function generateProducts(
  brandMap: Record<string, string>,
  categoryMap: Record<string, string>
): ProductValues[] {
  return Array.from({ length: COUNT }, (_, i) => {
    const n = String(i + 1).padStart(3, "0");
    const brandId = brandMap[`brand-${n}`];
    const categoryId = categoryMap[`category-${n}`];
    if (!brandId || !categoryId) {
      throw new Error(`missing FK for product-${n}: brand=${brandId} category=${categoryId}`);
    }
    return {
      sku: `PROD-${n}`,
      title: `Product ${n}`,
      brand: [{ id: brandId, type: "foreignid" }],
      category: [{ id: categoryId, type: "foreignid" }],
    };
  });
}

async function batchInsert(tableName: string, rows: ProductValues[]) {
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

runSpike(async () => {
  const [brandsRows, categoriesRows] = await Promise.all([
    fetchDraftRows("brands"),
    fetchDraftRows("categories"),
  ]);
  const brandMap = buildSlugMap(brandsRows);
  const categoryMap = buildSlugMap(categoriesRows);
  log("key maps", {
    brands: { size: Object.keys(brandMap).length, sample: Object.entries(brandMap).slice(0, 3) },
    categories: { size: Object.keys(categoryMap).length, sample: Object.entries(categoryMap).slice(0, 3) },
  });

  if (Object.keys(brandMap).length === 0 || Object.keys(categoryMap).length === 0) {
    throw new Error("brands and/or categories have no rows — run 03-insert-foreign.ts first");
  }

  const existing = await fetchDraftRows("products");
  if (existing.length > 0) {
    log("products already populated — skipping insert", {
      count: existing.length,
      firstRow: existing[0],
    });
    return;
  }

  const products = generateProducts(brandMap, categoryMap);
  const { created, timings } = await batchInsert("products", products);
  log("products inserted", {
    inserted: created.length,
    batches: timings,
    sampleRow: created[0],
  });
});
