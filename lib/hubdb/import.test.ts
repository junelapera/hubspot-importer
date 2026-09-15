import { describe, expect, it } from "vitest";
import { parseSchema } from "../schema";
import {
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
    expect(result.tables[0].errors[0]).toMatchObject({ kind: "missing-natural-key" });
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
});
