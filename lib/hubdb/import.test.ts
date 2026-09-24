import { describe, expect, it } from "vitest";
import { parseSchema } from "../schema";
import { HubdbError } from "./client";
import {
  ImportCancelledError,
  ImportFailFastError,
  ImportPreflightError,
  importRows,
  type ImportEvent,
  type ImportOps,
} from "./import";
import { HUBDB_MAX_BATCH_SIZE } from "./rows";
import type { HubdbRow, HubdbRowInput, HubdbRowUpdate } from "./types";
import type { TableRef } from "./tables";

type Call =
  | { op: "list"; ref: string }
  | { op: "create"; ref: string; rows: HubdbRowInput[] }
  | { op: "update"; ref: string; rows: HubdbRowUpdate[] };

type FakeOps = ImportOps & {
  calls: Call[];
  store: Map<string, HubdbRow[]>;
};

function fakeOps(preExisting: Record<string, HubdbRow[]> = {}): FakeOps {
  const store = new Map<string, HubdbRow[]>();
  for (const [ref, rows] of Object.entries(preExisting)) store.set(ref, [...rows]);
  const calls: Call[] = [];
  let nextId = 1000;
  const genId = () => String(nextId++);
  return {
    store,
    calls,
    async listAllDraftRows(ref: TableRef) {
      const key = String(ref);
      calls.push({ op: "list", ref: key });
      return [...(store.get(key) ?? [])];
    },
    async batchCreateDraftRows(ref, rows) {
      const key = String(ref);
      calls.push({ op: "create", ref: key, rows: [...rows] });
      const existing = store.get(key) ?? [];
      const created: HubdbRow[] = rows.map((r) => ({ id: genId(), values: r.values }));
      store.set(key, [...existing, ...created]);
      return created;
    },
    async batchUpdateDraftRows(ref, rows) {
      const key = String(ref);
      calls.push({ op: "update", ref: key, rows: [...rows] });
      const existing = store.get(key) ?? [];
      const byId = new Map(existing.map((r) => [r.id, r]));
      const updated: HubdbRow[] = [];
      for (const r of rows) {
        const before = byId.get(r.id);
        const after: HubdbRow = { id: r.id, values: { ...(before?.values ?? {}), ...r.values } };
        byId.set(r.id, after);
        updated.push(after);
      }
      store.set(key, [...byId.values()]);
      return updated;
    },
  };
}

const brandsProducts = parseSchema({
  version: 1,
  tables: [
    {
      name: "brands",
      label: "Brands",
      naturalKey: "slug",
      columns: [
        { name: "name", type: "TEXT" },
        { name: "slug", type: "TEXT" },
      ],
    },
    {
      name: "products",
      label: "Products",
      naturalKey: "sku",
      columns: [
        { name: "sku", type: "TEXT" },
        { name: "title", type: "TEXT" },
        { name: "brand", type: "FOREIGN_ID", foreignTable: "brands" },
      ],
    },
  ],
});

const tableIds = { brands: "10", products: "20" };

describe("importRows", () => {
  it("inserts all-new rows in topological order and resolves FKs against just-inserted foreign rows", async () => {
    const ops = fakeOps();
    const result = await importRows(ops, {
      schema: brandsProducts,
      tableIds,
      source: {
        brands: [
          { name: "Alpha", slug: "brand-a" },
          { name: "Beta", slug: "brand-b" },
        ],
        products: [
          { sku: "P-1", title: "Widget", brand: "brand-a" },
          { sku: "P-2", title: "Sprocket", brand: "brand-b" },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.order).toEqual(["brands", "products"]);
    expect(result.tables.map((t) => ({ name: t.name, created: t.created, updated: t.updated }))).toEqual([
      { name: "brands", created: 2, updated: 0 },
      { name: "products", created: 2, updated: 0 },
    ]);

    const productsCreate = ops.calls.find((c) => c.op === "create" && c.ref === "20");
    if (!productsCreate || productsCreate.op !== "create") throw new Error("expected products create");
    const brandCells = productsCreate.rows.map((r) => r.values.brand);
    expect(brandCells).toEqual([
      [{ id: "1000", type: "foreignid" }],
      [{ id: "1001", type: "foreignid" }],
    ]);
  });

  it("PATCH-updates rows whose natural key matches an existing row", async () => {
    const ops = fakeOps({
      "10": [
        { id: "500", values: { name: "Alpha", slug: "brand-a" } },
      ],
    });
    const result = await importRows(ops, {
      schema: brandsProducts,
      tableIds,
      source: {
        brands: [
          { name: "Alpha Updated", slug: "brand-a" },
          { name: "Beta", slug: "brand-b" },
        ],
        products: [],
      },
    });
    expect(result.ok).toBe(true);
    const brands = result.tables.find((t) => t.name === "brands");
    expect(brands).toMatchObject({ created: 1, updated: 1 });
    const update = ops.calls.find((c) => c.op === "update");
    if (!update || update.op !== "update") throw new Error("expected update call");
    expect(update.rows).toEqual([{ id: "500", values: { name: "Alpha Updated", slug: "brand-a" } }]);
  });

  it("normalizes casing when matching naturalKey (brand-a matches Brand-A)", async () => {
    const ops = fakeOps({
      "10": [
        { id: "500", values: { name: "Alpha", slug: "Brand-A" } },
      ],
    });
    const result = await importRows(ops, {
      schema: brandsProducts,
      tableIds,
      source: {
        brands: [{ name: "Alpha", slug: "brand-a" }],
        products: [],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.tables.find((t) => t.name === "brands")).toMatchObject({ created: 0, updated: 1 });
  });

  it("throws ImportPreflightError when existing rows have duplicate natural keys", async () => {
    const ops = fakeOps({
      "10": [
        { id: "500", values: { slug: "brand-a" } },
        { id: "501", values: { slug: "Brand-A" } },
      ],
    });
    await expect(
      importRows(ops, {
        schema: brandsProducts,
        tableIds,
        source: { brands: [], products: [] },
      }),
    ).rejects.toBeInstanceOf(ImportPreflightError);
  });

  it("throws ImportPreflightError when existing + source would exceed the 10k cap", async () => {
    const many: HubdbRow[] = Array.from({ length: 9_999 }, (_, i) => ({
      id: String(i + 1),
      values: { slug: `brand-${i}` },
    }));
    const ops = fakeOps({ "10": many });
    await expect(
      importRows(ops, {
        schema: brandsProducts,
        tableIds,
        source: {
          brands: [
            { name: "N-1", slug: "brand-new-1" },
            { name: "N-2", slug: "brand-new-2" },
          ],
          products: [],
        },
      }),
    ).rejects.toBeInstanceOf(ImportPreflightError);
  });

  it("reports unresolved-fk errors per row and does not send those rows to create", async () => {
    const ops = fakeOps();
    const result = await importRows(ops, {
      schema: brandsProducts,
      tableIds,
      source: {
        brands: [{ name: "Alpha", slug: "brand-a" }],
        products: [
          { sku: "P-1", title: "Widget", brand: "brand-a" },
          { sku: "P-2", title: "Sprocket", brand: "does-not-exist" },
        ],
      },
    });
    expect(result.ok).toBe(false);
    const products = result.tables.find((t) => t.name === "products");
    expect(products).toMatchObject({ created: 1, skipped: 1 });
    expect(products?.errors[0]).toMatchObject({
      kind: "unresolved-fk",
      sourceIndex: 1,
      column: "brand",
    });
    const productsCreate = ops.calls.find((c) => c.op === "create" && c.ref === "20");
    if (!productsCreate || productsCreate.op !== "create") throw new Error("expected create call");
    expect(productsCreate.rows).toHaveLength(1);
    expect(productsCreate.rows[0].values.sku).toBe("P-1");
  });

  it("reports missing-natural-key when the source row lacks the naturalKey column", async () => {
    const ops = fakeOps();
    const result = await importRows(ops, {
      schema: brandsProducts,
      tableIds,
      source: {
        brands: [{ name: "Alpha" }],
        products: [],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.tables[0].errors[0]).toMatchObject({
      kind: "missing-natural-key",
      column: "slug",
    });
    expect(ops.calls.filter((c) => c.op === "create")).toHaveLength(0);
  });

  it("chunks inserts at 100 rows per batch", async () => {
    const ops = fakeOps();
    const rows = Array.from({ length: 250 }, (_, i) => ({
      name: `Brand ${i}`,
      slug: `brand-${String(i).padStart(3, "0")}`,
    }));
    const result = await importRows(ops, {
      schema: brandsProducts,
      tableIds,
      source: { brands: rows, products: [] },
    });
    expect(result.ok).toBe(true);
    const creates = ops.calls.filter((c) => c.op === "create" && c.ref === "10");
    expect(creates.map((c) => c.op === "create" && c.rows.length)).toEqual([
      HUBDB_MAX_BATCH_SIZE,
      HUBDB_MAX_BATCH_SIZE,
      50,
    ]);
  });

  it("empty source per table performs the list preflight but no writes", async () => {
    const ops = fakeOps();
    const result = await importRows(ops, {
      schema: brandsProducts,
      tableIds,
      source: { brands: [], products: [] },
    });
    expect(result.ok).toBe(true);
    expect(ops.calls.filter((c) => c.op === "list")).toHaveLength(2);
    expect(ops.calls.filter((c) => c.op === "create" || c.op === "update")).toHaveLength(0);
  });

  it("skips rows for a table missing from tableIds and records unmapped-table errors", async () => {
    const ops = fakeOps();
    const result = await importRows(
      ops,
      {
        schema: brandsProducts,
        tableIds: { brands: "10" },
        source: {
          brands: [{ name: "A", slug: "brand-a" }],
          products: [{ sku: "P-1", title: "T", brand: "brand-a" }],
        },
      },
    );
    expect(result.ok).toBe(false);
    const products = result.tables.find((t) => t.name === "products");
    expect(products).toMatchObject({ created: 0, skipped: 1 });
    expect(products?.errors[0].kind).toBe("unmapped-table");
    expect(ops.calls.filter((c) => c.ref === "20")).toHaveLength(0);
  });

  it("emits lifecycle events for each table", async () => {
    const ops = fakeOps();
    const events: ImportEvent[] = [];
    await importRows(
      ops,
      {
        schema: brandsProducts,
        tableIds,
        source: {
          brands: [{ name: "A", slug: "brand-a" }],
          products: [{ sku: "P-1", title: "T", brand: "brand-a" }],
        },
      },
      { onEvent: (e) => events.push(e) },
    );
    const kinds = events.map((e) => `${e.kind}:${e.table}`);
    expect(kinds).toEqual([
      "table-start:brands",
      "table-preflight-ok:brands",
      "batch-create:brands",
      "table-done:brands",
      "table-start:products",
      "table-preflight-ok:products",
      "batch-create:products",
      "table-done:products",
    ]);
  });

  it("supports composite naturalKey — dedupes existing rows by both parts and upserts", async () => {
    const composite = parseSchema({
      version: 1,
      tables: [
        {
          name: "variants",
          label: "Variants",
          naturalKey: ["sku", "color"],
          columns: [
            { name: "sku", type: "TEXT" },
            { name: "color", type: "TEXT" },
            { name: "price", type: "NUMBER" },
          ],
        },
      ],
    });
    const ops = fakeOps({
      "30": [
        { id: "500", values: { sku: "SKU-1", color: "red", price: 10 } },
      ],
    });
    const result = await importRows(ops, {
      schema: composite,
      tableIds: { variants: "30" },
      source: {
        variants: [
          { sku: "SKU-1", color: "red", price: "12" }, // update by composite match
          { sku: "SKU-1", color: "blue", price: "13" }, // new (different variant of same sku)
          { sku: "SKU-2", color: "red", price: "14" }, // new (different sku)
        ],
      },
    });
    expect(result.ok).toBe(true);
    const table = result.tables[0];
    expect(table).toMatchObject({ name: "variants", created: 2, updated: 1, skipped: 0 });
    expect(table.errors).toEqual([]);
  });

  it("onMissing='fail' aborts the whole run and throws ImportFailFastError with partial totals", async () => {
    const ops = fakeOps();
    let caught: ImportFailFastError | null = null;
    try {
      await importRows(ops, {
        schema: brandsProducts,
        tableIds,
        source: {
          brands: [{ name: "A", slug: "brand-a" }, { name: "B", slug: "brand-b" }],
          products: [
            { sku: "P-1", title: "Ok", brand: "brand-a" },
            { sku: "P-2", title: "Orphan", brand: "brand-nope" }, // triggers fail
            { sku: "P-3", title: "NeverRuns", brand: "brand-b" },
          ],
        },
        fkOptions: {
          products: { brand: { onMissing: "fail" } },
        },
      });
    } catch (err) {
      if (err instanceof ImportFailFastError) caught = err;
      else throw err;
    }
    expect(caught).not.toBeNull();
    expect(caught!.row).toMatchObject({
      table: "products",
      sourceIndex: 1,
      kind: "unresolved-fk",
      column: "brand",
    });
    expect(caught!.partial.ok).toBe(false);
    // brands ran to completion; products aborted at row 1 with 2 rows skipped
    // (the failing row + the row after it).
    const brands = caught!.partial.tables.find((t) => t.name === "brands");
    const products = caught!.partial.tables.find((t) => t.name === "products");
    expect(brands).toMatchObject({ created: 2, updated: 0, skipped: 0 });
    expect(products).toMatchObject({ skipped: 2, errors: [expect.objectContaining({ sourceIndex: 1 })] });
    // No batch-create was issued for products (the abort happens at plan
    // time, before batches fire).
    const productsCreate = ops.calls.find((c) => c.op === "create" && c.ref === "20");
    expect(productsCreate).toBeUndefined();
  });

  it("onMissing='create-stub' inserts stub rows into the foreign table and resolves the FK", async () => {
    const ops = fakeOps();
    const result = await importRows(ops, {
      schema: brandsProducts,
      tableIds,
      source: {
        brands: [{ name: "A", slug: "brand-a" }],
        products: [
          { sku: "P-1", title: "Ok", brand: "brand-a" },
          { sku: "P-2", title: "Needs stub", brand: "brand-nope" },
          { sku: "P-3", title: "Same stub", brand: "BRAND-NOPE" }, // dedupe target
        ],
      },
      fkOptions: {
        products: { brand: { onMissing: "create-stub" } },
      },
    });
    expect(result.ok).toBe(true);
    const brands = result.tables.find((t) => t.name === "brands")!;
    const products = result.tables.find((t) => t.name === "products")!;
    expect(brands).toMatchObject({ created: 1 });
    expect(products).toMatchObject({ created: 3, skipped: 0, errors: [] });

    // Two batch-create calls against brands: the initial pass (1 row) +
    // the stub pass (1 row, deduped from "brand-nope" and "BRAND-NOPE").
    const brandCreates = ops.calls.filter((c) => c.op === "create" && c.ref === "10");
    expect(brandCreates).toHaveLength(2);
    const stubBatch = brandCreates[1];
    if (stubBatch.op !== "create") throw new Error("expected create");
    expect(stubBatch.rows).toHaveLength(1);
    expect(stubBatch.rows[0].values).toEqual({ slug: "brand-nope" });

    // All 3 products got FK refs pointing at real ids.
    const productsCreate = ops.calls.find((c) => c.op === "create" && c.ref === "20");
    if (!productsCreate || productsCreate.op !== "create") throw new Error("expected products create");
    for (const row of productsCreate.rows) {
      const brand = row.values.brand as { id: string }[];
      expect(Array.isArray(brand)).toBe(true);
      expect(brand[0].id).toMatch(/^\d+$/);
    }
    // P-2 and P-3 both point at the same stub id.
    const p2 = productsCreate.rows.find((r) => r.values.sku === "P-2")!;
    const p3 = productsCreate.rows.find((r) => r.values.sku === "P-3")!;
    expect((p2.values.brand as { id: string }[])[0].id).toBe(
      (p3.values.brand as { id: string }[])[0].id,
    );
  });

  it("onMissing='create-stub' handles multi-value cells with mixed hits and misses", async () => {
    const productsTags = parseSchema({
      version: 1,
      tables: [
        {
          name: "tags",
          label: "Tags",
          naturalKey: "slug",
          columns: [{ name: "slug", type: "TEXT" }],
        },
        {
          name: "posts",
          label: "Posts",
          naturalKey: "id",
          columns: [
            { name: "id", type: "TEXT" },
            { name: "tags", type: "FOREIGN_ID", foreignTable: "tags" },
          ],
        },
      ],
    });
    const ops = fakeOps();
    const result = await importRows(ops, {
      schema: productsTags,
      tableIds: { tags: "10", posts: "20" },
      source: {
        tags: [{ slug: "featured" }],
        posts: [
          // "featured" hits, "new" and "sale" miss → 2 stubs inserted, cell has 3 refs
          { id: "post-1", tags: "featured, new, sale" },
        ],
      },
      fkOptions: {
        posts: { tags: { multi: true, delimiter: ",", onMissing: "create-stub" } },
      },
    });
    expect(result.ok).toBe(true);
    const tagCreates = ops.calls.filter((c) => c.op === "create" && c.ref === "10");
    expect(tagCreates).toHaveLength(2); // initial pass + stub pass
    const stubBatch = tagCreates[1];
    if (stubBatch.op !== "create") throw new Error("expected create");
    // The stub batch should contain new + sale, in insertion order.
    expect(stubBatch.rows.map((r) => r.values.slug).sort()).toEqual(["new", "sale"]);
    const postsCreate = ops.calls.find((c) => c.op === "create" && c.ref === "20");
    if (!postsCreate || postsCreate.op !== "create") throw new Error("expected posts create");
    const cell = postsCreate.rows[0].values.tags as { id: string }[];
    expect(cell).toHaveLength(3);
  });

  it("onMissing='null' drops the FK column and lets the row insert", async () => {
    const ops = fakeOps();
    const result = await importRows(ops, {
      schema: brandsProducts,
      tableIds,
      source: {
        brands: [{ name: "A", slug: "brand-a" }],
        products: [
          { sku: "P-1", title: "Ok", brand: "brand-a" }, // resolves
          { sku: "P-2", title: "Orphan", brand: "brand-nope" }, // unresolved → drop cell
        ],
      },
      fkOptions: {
        products: { brand: { onMissing: "null" } },
      },
    });
    expect(result.ok).toBe(true);
    const products = result.tables.find((t) => t.name === "products")!;
    expect(products).toMatchObject({ created: 2, skipped: 0 });
    expect(products.errors).toEqual([]);
    // Verify the orphan row's brand column was dropped from the payload.
    const productsCreate = ops.calls.find((c) => c.op === "create" && c.ref === "20");
    if (!productsCreate || productsCreate.op !== "create") throw new Error("expected create call");
    const orphan = productsCreate.rows.find((r) => r.values.sku === "P-2");
    expect(orphan?.values.brand).toBeUndefined();
  });

  it("onMissing='skip-row' matches default behavior — the row errors and other rows continue", async () => {
    const ops = fakeOps();
    const result = await importRows(ops, {
      schema: brandsProducts,
      tableIds,
      source: {
        brands: [{ name: "A", slug: "brand-a" }],
        products: [
          { sku: "P-1", title: "Ok", brand: "brand-a" },
          { sku: "P-2", title: "Orphan", brand: "brand-nope" },
        ],
      },
      fkOptions: {
        products: { brand: { onMissing: "skip-row" } },
      },
    });
    expect(result.ok).toBe(false);
    const products = result.tables.find((t) => t.name === "products")!;
    expect(products).toMatchObject({ created: 1, skipped: 1 });
    expect(products.errors[0]).toMatchObject({ kind: "unresolved-fk", sourceIndex: 1 });
  });

  it("splits multi-value FK cells per fkOptions and resolves each token", async () => {
    const productsTags = parseSchema({
      version: 1,
      tables: [
        {
          name: "tags",
          label: "Tags",
          naturalKey: "slug",
          columns: [
            { name: "slug", type: "TEXT" },
          ],
        },
        {
          name: "posts",
          label: "Posts",
          naturalKey: "id",
          columns: [
            { name: "id", type: "TEXT" },
            { name: "tags", type: "FOREIGN_ID", foreignTable: "tags" },
          ],
        },
      ],
    });
    const ops = fakeOps();
    const result = await importRows(ops, {
      schema: productsTags,
      tableIds: { tags: "10", posts: "20" },
      source: {
        tags: [{ slug: "featured" }, { slug: "new" }, { slug: "sale" }],
        posts: [
          { id: "post-1", tags: "featured, new" },
          { id: "post-2", tags: "sale" },
          { id: "post-3", tags: "featured|new|sale" }, // wrong delimiter → treated as one token, unresolved
        ],
      },
      fkOptions: {
        posts: { tags: { multi: true, delimiter: "," } },
      },
    });
    expect(result.tables.find((t) => t.name === "tags")).toMatchObject({ created: 3 });
    const posts = result.tables.find((t) => t.name === "posts")!;
    expect(posts.created).toBe(2);
    expect(posts.errors).toHaveLength(1);
    expect(posts.errors[0]).toMatchObject({
      sourceIndex: 2,
      kind: "unresolved-fk",
      column: "tags",
    });
    // Verify the created posts got array-of-refs FK cells.
    const postsCreate = ops.calls.find((c) => c.op === "create" && c.ref === "20");
    if (!postsCreate || postsCreate.op !== "create") throw new Error("expected create call");
    const firstCell = postsCreate.rows[0].values.tags as unknown[];
    expect(Array.isArray(firstCell)).toBe(true);
    expect(firstCell).toHaveLength(2);
  });

  it("refreshes foreign key maps and retries once when a batch fails with a stale-FK-shaped error", async () => {
    // Products table has 1 brand ("brand-a" → id 500). Source has a
    // product referencing brand-a. The first batch-create call for
    // products throws a stale-FK-shaped HubdbError; on retry, we
    // re-list brands (now with a fresh id 999) and the row goes
    // through with the refreshed id.
    const base = fakeOps({
      "10": [{ id: "500", values: { slug: "brand-a", name: "Alpha" } }],
    });
    let createFailedOnce = false;
    let brandsListCount = 0;
    const ops: ImportOps = {
      ...base,
      async listAllDraftRows(ref) {
        if (String(ref) === "10") {
          brandsListCount++;
          // First list: id 500. Second list (the retry-refresh): the
          // "old" row has been deleted and a fresh one with id 999
          // exists.
          if (brandsListCount === 2) {
            return [{ id: "999", values: { slug: "brand-a", name: "Alpha" } }];
          }
        }
        return base.listAllDraftRows(ref);
      },
      async batchCreateDraftRows(ref, rows) {
        if (String(ref) === "20" && !createFailedOnce) {
          createFailedOnce = true;
          throw new HubdbError({
            status: 400,
            method: "POST",
            path: "/tables/20/rows/draft/batch/create",
            responseBody: { message: "Foreign row does not exist for column brand" },
            rateLimit: { remaining: null, retryAfterSeconds: null },
            attempts: 1,
          });
        }
        return base.batchCreateDraftRows(ref, rows);
      },
    };
    const events: ImportEvent[] = [];
    const result = await importRows(
      ops,
      {
        schema: brandsProducts,
        tableIds,
        source: {
          brands: [],
          products: [{ sku: "P-1", title: "Widget", brand: "brand-a" }],
        },
      },
      { onEvent: (e) => events.push(e) },
    );
    expect(result.ok).toBe(true);
    expect(result.tables.find((t) => t.name === "products")).toMatchObject({
      created: 1,
      errors: [],
    });
    // The retry emitted a stale-fk-retry event naming the brands table
    expect(events.some((e) => e.kind === "stale-fk-retry" && e.batchKind === "create")).toBe(true);
    // The second batch-create call used the refreshed brand id (999)
    const productsCreates = base.calls.filter((c) => c.op === "create" && c.ref === "20");
    // The intercepted first call threw, so only the retry recorded on base.calls
    expect(productsCreates).toHaveLength(1);
    if (productsCreates[0].op !== "create") throw new Error("expected create");
    expect((productsCreates[0].rows[0].values.brand as { id: string }[])[0].id).toBe("999");
  });

  it("throws ImportCancelledError with a partial result when the AbortSignal fires between batches", async () => {
    // 250 brand rows across 3 batches. Cancel after the first batch
    // completes so we get a partial result with 100 created + the rest
    // marked untouched.
    const base = fakeOps();
    const controller = new AbortController();
    let batchesSeen = 0;
    const ops: ImportOps = {
      ...base,
      async batchCreateDraftRows(ref, rows) {
        batchesSeen++;
        // Cancel after the first batch lands
        if (batchesSeen === 1) {
          const created = await base.batchCreateDraftRows(ref, rows);
          controller.abort();
          return created;
        }
        return base.batchCreateDraftRows(ref, rows);
      },
    };
    const rows = Array.from({ length: 250 }, (_, i) => ({
      name: `Brand ${i}`,
      slug: `brand-${String(i).padStart(3, "0")}`,
    }));
    let caught: ImportCancelledError | null = null;
    try {
      await importRows(
        ops,
        {
          schema: brandsProducts,
          tableIds,
          source: { brands: rows, products: [] },
        },
        { signal: controller.signal },
      );
    } catch (err) {
      if (err instanceof ImportCancelledError) caught = err;
      else throw err;
    }
    expect(caught).not.toBeNull();
    expect(caught?.partial.ok).toBe(false);
    const brands = caught?.partial.tables.find((t) => t.name === "brands");
    // Cancel checked between batches — we saw exactly one batch land.
    expect(brands?.created).toBe(100);
    // Products table never started
    const products = caught?.partial.tables.find((t) => t.name === "products");
    expect(products).toMatchObject({ created: 0, updated: 0, skipped: 0 });
    // Only one batchCreate reached the ops layer.
    expect(base.calls.filter((c) => c.op === "create")).toHaveLength(1);
  });

  it("invokes persistence hooks in order — onBatchStart, onBatchComplete, onKeyMapReady", async () => {
    const ops = fakeOps();
    type HookCall =
      | { kind: "start"; table: string; batchIndex: number; op: "create" | "update"; size: number }
      | { kind: "complete"; table: string; batchIndex: number; op: "create" | "update"; status: "succeeded" | "failed" }
      | { kind: "keymap"; table: string; entryCount: number };
    const hookCalls: HookCall[] = [];
    await importRows(ops, {
      schema: brandsProducts,
      tableIds,
      source: {
        brands: [{ name: "Alpha", slug: "brand-a" }],
        products: [{ sku: "P-1", title: "Widget", brand: "brand-a" }],
      },
    }, {
      hooks: {
        onBatchStart: async (info) => {
          hookCalls.push({ kind: "start", table: info.table, batchIndex: info.batchIndex, op: info.kind, size: info.size });
        },
        onBatchComplete: async (info) => {
          hookCalls.push({ kind: "complete", table: info.table, batchIndex: info.batchIndex, op: info.kind, status: info.status });
        },
        onKeyMapReady: async (table, entries) => {
          hookCalls.push({ kind: "keymap", table, entryCount: Object.keys(entries).length });
        },
      },
    });
    // For each table: start → complete → keymap. Two tables total.
    expect(hookCalls).toEqual([
      { kind: "start", table: "brands", batchIndex: 1, op: "create", size: 1 },
      { kind: "complete", table: "brands", batchIndex: 1, op: "create", status: "succeeded" },
      { kind: "keymap", table: "brands", entryCount: 1 },
      { kind: "start", table: "products", batchIndex: 1, op: "create", size: 1 },
      { kind: "complete", table: "products", batchIndex: 1, op: "create", status: "succeeded" },
      { kind: "keymap", table: "products", entryCount: 1 },
    ]);
  });

  it("emits onBatchComplete(status='failed') and rethrows when a create batch fails hard", async () => {
    const base = fakeOps();
    const ops: ImportOps = {
      ...base,
      async batchCreateDraftRows(ref) {
        throw new HubdbError({
          status: 500,
          method: "POST",
          path: `/tables/${String(ref)}/rows/draft/batch/create`,
          responseBody: { message: "boom" },
          rateLimit: { remaining: null, retryAfterSeconds: null },
          attempts: 1,
        });
      },
    };
    const completed: { status: string; op: string }[] = [];
    await expect(
      importRows(ops, {
        schema: brandsProducts,
        tableIds,
        source: {
          brands: [{ name: "Alpha", slug: "brand-a" }],
          products: [],
        },
      }, {
        hooks: {
          onBatchComplete: async (info) => {
            completed.push({ status: info.status, op: info.kind });
          },
        },
      }),
    ).rejects.toBeInstanceOf(HubdbError);
    expect(completed).toEqual([{ status: "failed", op: "create" }]);
  });

  it("swallows hook errors — an onBatchStart throw does not abort the run", async () => {
    const ops = fakeOps();
    const result = await importRows(ops, {
      schema: brandsProducts,
      tableIds,
      source: {
        brands: [{ name: "Alpha", slug: "brand-a" }],
        products: [],
      },
    }, {
      hooks: {
        onBatchStart: async () => {
          throw new Error("simulated hook failure");
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.tables[0].created).toBe(1);
  });

  it("propagates the original error when no foreign tables are refreshable", async () => {
    // Brands has no naturalKey → nothing to refresh. Simulate an
    // FK-shaped error and confirm we don't swallow it.
    const base = fakeOps();
    const ops: ImportOps = {
      ...base,
      async batchCreateDraftRows(ref, rows) {
        if (String(ref) === "10") {
          throw new HubdbError({
            status: 400,
            method: "POST",
            path: "/tables/10/rows/draft/batch/create",
            responseBody: { message: "Something about foreign keys" },
            rateLimit: { remaining: null, retryAfterSeconds: null },
            attempts: 1,
          });
        }
        return base.batchCreateDraftRows(ref, rows);
      },
    };
    await expect(
      importRows(ops, {
        schema: brandsProducts,
        tableIds,
        source: {
          brands: [{ name: "Alpha", slug: "brand-a" }],
          products: [],
        },
      }),
    ).rejects.toBeInstanceOf(HubdbError);
  });
});
