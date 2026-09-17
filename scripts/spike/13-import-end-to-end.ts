import { client, log, runSpike } from "./client";
import {
  fetchPortalSchema,
  getDraftTable,
  importRows,
  listAllDraftRows,
  listAllLiveRows,
  opsFromClient,
  opsFromClientForImport,
  provision,
  pushLive,
} from "../../lib/hubdb";
import { diffSchema, parseSchema } from "../../lib/schema";

// End-to-end pipeline against the sandbox:
//   schema → diff → provision → importRows → push-live → verify → cleanup
//
// Uses unique table names per run so we don't collide with the Phase-0
// tables (brands/categories/products, ids 412407343/344/345). Verifies:
//   - provision creates 3 tables in the right order (foreign first)
//   - importRows resolves FK values by looking up the newly-created
//     brand+category row ids from the source's natural key
//   - the FK cell on a product row round-trips through push-live
//   - live vs draft row ids stay stable (F0-8)

const NAMESPACE = `spike_it_${Date.now()}`;
const BRANDS = `${NAMESPACE}_brands`;
const CATEGORIES = `${NAMESPACE}_categories`;
const PRODUCTS = `${NAMESPACE}_products`;

async function deleteIfExists(name: string): Promise<void> {
  const snapshot = await fetchPortalSchema(client);
  const t = snapshot.tables.find((x) => x.name === name);
  if (!t) return;
  await client.request(`/tables/${encodeURIComponent(t.id)}`, { method: "DELETE" });
}

async function cleanup(): Promise<void> {
  // delete products first — FK columns reference brands/categories, and
  // if the target table is missing HubSpot rejects the delete on the
  // referring table with an obscure error
  for (const name of [PRODUCTS, CATEGORIES, BRANDS]) {
    try {
      await deleteIfExists(name);
    } catch (err) {
      log(`cleanup ${name}: failed`, (err as Error).message);
    }
  }
}

runSpike(async () => {
  await cleanup();
  log("using namespace", NAMESPACE);

  const schema = parseSchema({
    version: 1,
    tables: [
      {
        name: BRANDS,
        label: BRANDS,
        naturalKey: "slug",
        columns: [
          { name: "slug", label: "Slug", type: "TEXT" },
          { name: "name", label: "Name", type: "TEXT" },
        ],
      },
      {
        name: CATEGORIES,
        label: CATEGORIES,
        naturalKey: "slug",
        columns: [
          { name: "slug", label: "Slug", type: "TEXT" },
          { name: "name", label: "Name", type: "TEXT" },
        ],
      },
      {
        name: PRODUCTS,
        label: PRODUCTS,
        naturalKey: "sku",
        columns: [
          { name: "sku", label: "SKU", type: "TEXT" },
          { name: "title", label: "Title", type: "TEXT" },
          { name: "brand", label: "Brand", type: "FOREIGN_ID", foreignTable: BRANDS, foreignColumn: "slug" },
          { name: "category", label: "Category", type: "FOREIGN_ID", foreignTable: CATEGORIES, foreignColumn: "slug" },
        ],
      },
    ],
  });

  // ── Step 1: diff (empty portal side, so plan should be 3× create) ──
  const before = await fetchPortalSchema(client);
  const plan = diffSchema(schema, before.tables);
  log("step-1 plan", {
    ok: plan.ok,
    actions: plan.tables.map((t) => ({ name: t.name, action: t.action })),
  });
  if (!plan.ok) throw new Error("plan has conflicts");

  // ── Step 2: provision ──
  const provisionEvents: string[] = [];
  const provisionResult = await provision(opsFromClient(client), plan, {
    onEvent: (e) => provisionEvents.push(`${e.kind}:${e.table}`),
  });
  log("step-2 provision", {
    order: provisionResult.order,
    deferred: provisionResult.deferred.length,
    tableIds: provisionResult.tableIds,
    events: provisionEvents,
  });

  const productsDraft = await getDraftTable(client, provisionResult.tableIds[PRODUCTS]);
  log("step-2 products draft columns", {
    cols: productsDraft.columns.map((c) => ({
      name: c.name,
      type: c.type,
      foreignTableId: c.foreignTableId,
      foreignColumnId: c.foreignColumnId,
    })),
  });

  // ── Step 3: import rows (foreign tables first, then main) ──
  const brands = Array.from({ length: 5 }, (_, i) => ({
    slug: `brand-${i + 1}`,
    name: `Brand ${i + 1}`,
  }));
  const categories = Array.from({ length: 5 }, (_, i) => ({
    slug: `cat-${i + 1}`,
    name: `Category ${i + 1}`,
  }));
  const products = Array.from({ length: 20 }, (_, i) => ({
    sku: `sku-${String(i + 1).padStart(3, "0")}`,
    title: `Product ${i + 1}`,
    brand: `brand-${(i % 5) + 1}`,
    category: `cat-${((i + 2) % 5) + 1}`,
  }));

  const importEvents: string[] = [];
  const importResult = await importRows(
    opsFromClientForImport(client),
    {
      schema,
      tableIds: provisionResult.tableIds,
      source: { [BRANDS]: brands, [CATEGORIES]: categories, [PRODUCTS]: products },
    },
    { onEvent: (e) => importEvents.push(`${e.kind}:${e.table}`) },
  );
  log("step-3 import result", {
    order: importResult.order,
    ok: importResult.ok,
    tables: importResult.tables.map((t) => ({
      name: t.name,
      created: t.created,
      updated: t.updated,
      skipped: t.skipped,
      errors: t.errors.length,
    })),
    events: importEvents,
  });
  if (!importResult.ok) {
    log("step-3 row errors", importResult.tables.flatMap((t) => t.errors));
    throw new Error("import had row errors");
  }

  // ── Step 4: verify FK cell on a product draft row ──
  const draftProductRows = await listAllDraftRows(client, provisionResult.tableIds[PRODUCTS]);
  const sample = draftProductRows.find((r) => r.values["sku"] === "sku-001");
  if (!sample) throw new Error("could not find sku-001 in draft rows");
  log("step-4 sample product draft row", {
    id: sample.id,
    sku: sample.values["sku"],
    brand: sample.values["brand"],
    category: sample.values["category"],
  });
  const brandCell = sample.values["brand"] as { id: string; type: string }[] | undefined;
  if (!Array.isArray(brandCell) || brandCell.length !== 1) {
    throw new Error(`expected brand cell to be a 1-element FK array, got ${JSON.stringify(brandCell)}`);
  }
  const draftBrandRows = await listAllDraftRows(client, provisionResult.tableIds[BRANDS]);
  const brand1 = draftBrandRows.find((r) => r.values["slug"] === "brand-1");
  if (!brand1) throw new Error("brand-1 not found in draft rows");
  if (brandCell[0].id !== brand1.id) {
    throw new Error(`FK mismatch: product.brand[0].id=${brandCell[0].id}, brand-1.id=${brand1.id}`);
  }
  log("step-4 FK verified", { productBrand: brandCell[0].id, brand1: brand1.id });

  // ── Step 5: push-live in dep order (foreign first, so display columns work) ──
  for (const name of importResult.order) {
    const result = await pushLive(client, provisionResult.tableIds[name]);
    log(`step-5 push-live ${name}`, { published: result.published, publishedAt: result.publishedAt });
  }

  // ── Step 6: read back live rows; row ids should be stable ──
  const liveProductRows = await listAllLiveRows(client, provisionResult.tableIds[PRODUCTS]);
  const liveSample = liveProductRows.find((r) => r.values["sku"] === "sku-001");
  if (!liveSample) throw new Error("sku-001 not found after push-live");
  if (liveSample.id !== sample.id) {
    throw new Error(`row id changed on push-live: draft=${sample.id} live=${liveSample.id}`);
  }
  log("step-6 live row stable", { id: liveSample.id, brand: liveSample.values["brand"] });

  // ── Step 7: re-import same source (should be all updates, no changes) ──
  const rerun = await importRows(
    opsFromClientForImport(client),
    {
      schema,
      tableIds: provisionResult.tableIds,
      source: { [BRANDS]: brands, [CATEGORIES]: categories, [PRODUCTS]: products },
    },
  );
  log("step-7 idempotency re-import", {
    ok: rerun.ok,
    tables: rerun.tables.map((t) => ({ name: t.name, created: t.created, updated: t.updated })),
  });

  await cleanup();
  log("cleanup", "namespace deleted");
});
