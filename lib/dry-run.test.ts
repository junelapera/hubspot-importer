import { describe, expect, it } from "vitest";
import { computeDryRun } from "./dry-run";
import type { HubdbRow, HubdbTable } from "./hubdb";
import { initialForeignKeyConfig, initialMappingState, type MappingState } from "./mapping";

function table(name: string, id: string, columns: { name: string; type: string; id?: string; foreignTableId?: string }[]): HubdbTable {
  return {
    id,
    name,
    label: name,
    published: false,
    columns: columns.map((c, i) => ({ id: c.id ?? String(i + 1), name: c.name, type: c.type, foreignTableId: c.foreignTableId })),
  };
}

function existingRow(id: string, values: Record<string, unknown>): HubdbRow {
  return { id, values };
}

describe("computeDryRun — create/update planning", () => {
  it("classifies rows as create when their natural-key value is not on the portal, update otherwise", () => {
    const brands = table("brands", "T1", [{ name: "slug", type: "TEXT" }, { name: "name", type: "TEXT" }]);
    const mapping: MappingState = {
      ...initialMappingState(),
      targetTableName: "brands",
      columnMap: { slug: { kind: "mapped", targetColumn: "slug" }, name: { kind: "mapped", targetColumn: "name" } },
      naturalKey: ["slug"],
    };
    const report = computeDryRun({
      sources: [{ name: "brands", headers: ["slug", "name"], rows: [
        { slug: "acme", name: "Acme" },     // existing (update)
        { slug: "beta", name: "Beta" },     // existing (update)
        { slug: "gamma", name: "Gamma" },   // new (create)
        { slug: "", name: "no-key" },       // skipped
      ] }],
      mappings: { brands: mapping },
      portalTables: [brands],
      existingRowsByTarget: {
        brands: [existingRow("r1", { slug: "acme" }), existingRow("r2", { slug: "BETA" })],
      },
    });
    expect(report.tables[0]?.planned).toEqual({ create: 1, update: 2, skipped: 1 });
    expect(report.tables[0]?.existingRows).toBe(2);
  });

  it("normalizes natural keys (BETA matches beta)", () => {
    const brands = table("brands", "T1", [{ name: "slug", type: "TEXT" }]);
    const mapping: MappingState = {
      ...initialMappingState(),
      targetTableName: "brands",
      columnMap: { slug: { kind: "mapped", targetColumn: "slug" } },
      naturalKey: ["slug"],
    };
    const report = computeDryRun({
      sources: [{ name: "brands", headers: ["slug"], rows: [{ slug: "BETA" }] }],
      mappings: { brands: mapping },
      portalTables: [brands],
      existingRowsByTarget: { brands: [existingRow("r1", { slug: "beta" })] },
    });
    expect(report.tables[0]?.planned).toEqual({ create: 0, update: 1, skipped: 0 });
  });
});

describe("computeDryRun — unresolved FKs", () => {
  it("flags source rows whose FK value has no match on the sibling source", () => {
    const brands = table("brands", "T1", [{ name: "slug", type: "TEXT" }]);
    const products = table("products", "T2", [
      { name: "sku", type: "TEXT" },
      { name: "brand", type: "FOREIGN_ID", foreignTableId: "T1" },
    ]);
    const productsMapping: MappingState = {
      ...initialMappingState(),
      targetTableName: "products",
      columnMap: {
        sku: { kind: "mapped", targetColumn: "sku" },
        brand: { kind: "mapped", targetColumn: "brand" },
      },
      naturalKey: ["sku"],
      foreignKeys: {
        brand: { ...initialForeignKeyConfig(), sourceTable: "brands", matchKey: "slug" },
      },
    };
    const brandsMapping: MappingState = {
      ...initialMappingState(),
      targetTableName: "brands",
      columnMap: { slug: { kind: "mapped", targetColumn: "slug" } },
      naturalKey: ["slug"],
    };
    const report = computeDryRun({
      sources: [
        { name: "brands", headers: ["slug"], rows: [{ slug: "acme" }, { slug: "beta" }] },
        { name: "products", headers: ["sku", "brand"], rows: [
          { sku: "p1", brand: "acme" },
          { sku: "p2", brand: "unknown" },   // unresolved
        ] },
      ],
      mappings: { brands: brandsMapping, products: productsMapping },
      portalTables: [brands, products],
      existingRowsByTarget: {},
    });
    const products_ = report.tables.find((t) => t.sourceName === "products")!;
    expect(products_.unresolvedFks.length).toBe(1);
    expect(products_.unresolvedFks[0]).toMatchObject({
      sourceColumn: "brand",
      foreignSource: "brands",
      matchKey: "slug",
      rowIndex: 1,
      value: "unknown",
    });
    expect(report.ok).toBe(false);
  });

  it("splits multi-value cells on the configured delimiter and reports each miss", () => {
    const brands = table("brands", "T1", [{ name: "slug", type: "TEXT" }]);
    const products = table("products", "T2", [
      { name: "sku", type: "TEXT" },
      { name: "brands", type: "FOREIGN_ID", foreignTableId: "T1" },
    ]);
    const productsMapping: MappingState = {
      ...initialMappingState(),
      targetTableName: "products",
      columnMap: {
        sku: { kind: "mapped", targetColumn: "sku" },
        brands: { kind: "mapped", targetColumn: "brands" },
      },
      naturalKey: ["sku"],
      foreignKeys: {
        brands: { ...initialForeignKeyConfig(), sourceTable: "brands", matchKey: "slug", multi: true, delimiter: "," },
      },
    };
    const brandsMapping: MappingState = {
      ...initialMappingState(),
      targetTableName: "brands",
      columnMap: { slug: { kind: "mapped", targetColumn: "slug" } },
      naturalKey: ["slug"],
    };
    const report = computeDryRun({
      sources: [
        { name: "brands", headers: ["slug"], rows: [{ slug: "acme" }] },
        { name: "products", headers: ["sku", "brands"], rows: [
          { sku: "p1", brands: "acme,gamma,delta" },
        ] },
      ],
      mappings: { brands: brandsMapping, products: productsMapping },
      portalTables: [brands, products],
      existingRowsByTarget: {},
    });
    const products_ = report.tables.find((t) => t.sourceName === "products")!;
    expect(products_.unresolvedFks.map((u) => u.value)).toEqual(["gamma", "delta"]);
  });
});

describe("computeDryRun — coercion + API count + ordering", () => {
  it("flags a non-numeric source column mapped to a NUMBER target", () => {
    const t = table("t", "T1", [{ name: "n", type: "NUMBER" }]);
    const mapping: MappingState = {
      ...initialMappingState(),
      targetTableName: "t",
      columnMap: { n: { kind: "mapped", targetColumn: "n" } },
      naturalKey: ["n"],
    };
    const report = computeDryRun({
      sources: [{ name: "t", headers: ["n"], rows: [{ n: "abc" }, { n: "42" }] }],
      mappings: { t: mapping },
      portalTables: [t],
      existingRowsByTarget: {},
    });
    expect(report.tables[0]?.coercionWarnings.length).toBe(1);
  });

  it("emits tables in dependency order (foreign first)", () => {
    const brands = table("brands", "T1", [{ name: "slug", type: "TEXT" }]);
    const products = table("products", "T2", [{ name: "sku", type: "TEXT" }, { name: "brand", type: "FOREIGN_ID" }]);
    const report = computeDryRun({
      sources: [
        { name: "products", headers: ["sku", "brand"], rows: [] },
        { name: "brands", headers: ["slug"], rows: [] },
      ],
      mappings: {
        brands: { ...initialMappingState(), targetTableName: "brands", naturalKey: ["slug"], columnMap: { slug: { kind: "mapped", targetColumn: "slug" } } },
        products: {
          ...initialMappingState(),
          targetTableName: "products",
          naturalKey: ["sku"],
          columnMap: { sku: { kind: "mapped", targetColumn: "sku" }, brand: { kind: "mapped", targetColumn: "brand" } },
          foreignKeys: { brand: { ...initialForeignKeyConfig(), sourceTable: "brands", matchKey: "slug" } },
        },
      },
      portalTables: [brands, products],
      existingRowsByTarget: {},
    });
    expect(report.order).toEqual(["brands", "products"]);
    expect(report.tables.map((t) => t.sourceName)).toEqual(["brands", "products"]);
  });

  it("estimates API calls: 1 GET per table + ceil(create/100) + ceil(update/100)", () => {
    const t = table("t", "T1", [{ name: "sku", type: "TEXT" }]);
    const rows = Array.from({ length: 250 }, (_, i) => ({ sku: `p${i}` }));
    const report = computeDryRun({
      sources: [{ name: "t", headers: ["sku"], rows }],
      mappings: {
        t: { ...initialMappingState(), targetTableName: "t", naturalKey: ["sku"], columnMap: { sku: { kind: "mapped", targetColumn: "sku" } } },
      },
      portalTables: [t],
      existingRowsByTarget: { t: [] },
    });
    // 1 list-page GET + ceil(250/100)=3 batches + 0 updates
    expect(report.tables[0]?.apiCalls).toBe(1 + 3 + 0);
    expect(report.projectedApiCalls).toBe(4);
  });
});
