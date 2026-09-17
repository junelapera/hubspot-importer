import { describe, expect, it } from "vitest";
import { synthesizeExecution } from "./execution";
import type { HubdbTable } from "./hubdb";
import { initialForeignKeyConfig, initialMappingState, type MappingState } from "./mapping";

function table(name: string, id: string, columns: { name: string; type: string; foreignTableId?: string }[]): HubdbTable {
  return {
    id,
    name,
    label: name,
    published: false,
    columns: columns.map((c, i) => ({ id: String(i + 1), name: c.name, type: c.type, foreignTableId: c.foreignTableId })),
  };
}

describe("synthesizeExecution — column renaming", () => {
  it("translates source column names to target names in schema + rows", () => {
    const t = table("brands", "T1", [{ name: "slug", type: "TEXT" }, { name: "displayName", type: "TEXT" }]);
    const mapping: MappingState = {
      ...initialMappingState(),
      targetTableName: "brands",
      columnMap: {
        slug: { kind: "mapped", targetColumn: "slug" },
        "Brand Name": { kind: "mapped", targetColumn: "displayName" },
      },
      naturalKey: ["slug"],
    };
    const syn = synthesizeExecution({
      sources: [{ name: "brands", rows: [{ slug: "acme", "Brand Name": "Acme Inc." }] }],
      mappings: { brands: mapping },
      portalTables: [t],
    });
    expect(syn.issues).toEqual([]);
    expect(syn.tableIds).toEqual({ brands: "T1" });
    expect(syn.schema?.tables[0]?.columns.map((c) => c.name).sort()).toEqual(["displayName", "slug"]);
    expect(syn.schema?.tables[0]?.naturalKey).toBe("slug");
    expect(syn.source["brands"][0]).toEqual({ slug: "acme", displayName: "Acme Inc." });
  });
});

describe("synthesizeExecution — FK translation", () => {
  const brands = table("brands", "T1", [{ name: "slug", type: "TEXT" }]);
  const products = table("products", "T2", [
    { name: "sku", type: "TEXT" },
    { name: "brand", type: "FOREIGN_ID", foreignTableId: "T1" },
  ]);
  const brandsMapping: MappingState = {
    ...initialMappingState(),
    targetTableName: "brands",
    columnMap: { slug: { kind: "mapped", targetColumn: "slug" } },
    naturalKey: ["slug"],
  };
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

  it("sets foreignTable to sibling source name and foreignColumn to the sibling's target column", () => {
    const syn = synthesizeExecution({
      sources: [
        { name: "brands", rows: [] },
        { name: "products", rows: [] },
      ],
      mappings: { brands: brandsMapping, products: productsMapping },
      portalTables: [brands, products],
    });
    expect(syn.issues).toEqual([]);
    const brandCol = syn.schema?.tables.find((t) => t.name === "products")?.columns.find((c) => c.name === "brand");
    expect(brandCol?.foreignTable).toBe("brands");
    expect(brandCol?.foreignColumn).toBe("slug");
  });

  it("flags fk-target-column-missing when sibling doesn't map matchKey", () => {
    const badBrands: MappingState = {
      ...brandsMapping,
      columnMap: { slug: { kind: "ignored" } },   // matchKey no longer maps
    };
    const syn = synthesizeExecution({
      sources: [
        { name: "brands", rows: [] },
        { name: "products", rows: [] },
      ],
      mappings: { brands: badBrands, products: productsMapping },
      portalTables: [brands, products],
    });
    expect(syn.issues.some((i) => i.kind === "fk-target-column-missing")).toBe(true);
  });
});

describe("synthesizeExecution — guard rails", () => {
  const t = table("brands", "T1", [{ name: "slug", type: "TEXT" }]);
  const base: MappingState = {
    ...initialMappingState(),
    targetTableName: "brands",
    columnMap: { slug: { kind: "mapped", targetColumn: "slug" } },
    naturalKey: ["slug"],
  };

  it("reports missing-target when the target table isn't on the portal", () => {
    const syn = synthesizeExecution({
      sources: [{ name: "brands", rows: [] }],
      mappings: { brands: { ...base, targetTableName: "unknown" } },
      portalTables: [t],
    });
    expect(syn.issues[0]?.kind).toBe("missing-target");
    expect(syn.schema).toBeNull();
  });

  it("reports composite-natural-key (v1 unsupported)", () => {
    const syn = synthesizeExecution({
      sources: [{ name: "brands", rows: [] }],
      mappings: { brands: { ...base, naturalKey: ["slug", "name"] } },
      portalTables: [t],
    });
    expect(syn.issues[0]?.kind).toBe("composite-natural-key");
  });

  it("reports natural-key-not-mapped when the source NK isn't mapped through", () => {
    const syn = synthesizeExecution({
      sources: [{ name: "brands", rows: [] }],
      mappings: { brands: { ...base, columnMap: { slug: { kind: "ignored" } } } },
      portalTables: [t],
    });
    expect(syn.issues.some((i) => i.kind === "natural-key-not-mapped")).toBe(true);
  });
});
