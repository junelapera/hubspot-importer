import { client, log, runSpike } from "./client";
import {
  batchCreateDraftRows,
  HUBDB_MAX_BATCH_SIZE,
  listAllDraftRows,
  type HubdbForeignRef,
  type HubdbRow,
} from "../../lib/hubdb";

const COUNT = 200;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildSlugMap(rows: HubdbRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [String(r.values.slug ?? ""), r.id]));
}

type ProductValues = {
  sku: string;
  title: string;
  brand: HubdbForeignRef[];
  category: HubdbForeignRef[];
};

function generateProducts(
  brandMap: Record<string, string>,
  categoryMap: Record<string, string>,
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
  const batches = chunk(rows, HUBDB_MAX_BATCH_SIZE);
  const timings: Array<{ batch: number; sent: number; returned: number; ms: number }> = [];
  const created: HubdbRow[] = [];
  for (let i = 0; i < batches.length; i++) {
    const started = performance.now();
    const inserted = await batchCreateDraftRows(
      client,
      tableName,
      batches[i].map((v) => ({ values: v })),
    );
    const ms = Math.round(performance.now() - started);
    timings.push({ batch: i + 1, sent: batches[i].length, returned: inserted.length, ms });
    created.push(...inserted);
  }
  return { created, timings };
}

runSpike(async () => {
  const [brandsRows, categoriesRows] = await Promise.all([
    listAllDraftRows(client, "brands"),
    listAllDraftRows(client, "categories"),
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

  const existing = await listAllDraftRows(client, "products");
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
