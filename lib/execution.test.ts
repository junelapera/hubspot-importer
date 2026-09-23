import { describe, expect, it } from "vitest";
import { computeExecutionSignature, synthesizeExecution } from "./execution";
import type { HubdbTable } from "./hubdb";
import { initialForeignKeyConfig, initialMappingState, type MappingState } from "./mapping";
import { HUBDB_RICHTEXT_MAX, HUBDB_TEXT_MAX } from "./source/validate";

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

  it("emits fkOptions.onMissing when the user picks 'null' and omits it for 'skip-row'", () => {
    const productsNull: MappingState = {
      ...productsMapping,
      foreignKeys: {
        brand: {
          ...initialForeignKeyConfig(),
          sourceTable: "brands",
          matchKey: "slug",
          onMissing: "null",
        },
      },
    };
    const syn = synthesizeExecution({
      sources: [
        { name: "brands", rows: [] },
        { name: "products", rows: [] },
      ],
      mappings: { brands: brandsMapping, products: productsNull },
      portalTables: [brands, products],
    });
    expect(syn.issues).toEqual([]);
    expect(syn.fkOptions.products?.brand).toEqual({ onMissing: "null" });

    // `skip-row` is the executor default and is omitted from fkOptions to keep the object small.
    const productsSkip: MappingState = {
      ...productsMapping,
      foreignKeys: {
        brand: {
          ...initialForeignKeyConfig(),
          sourceTable: "brands",
          matchKey: "slug",
          onMissing: "skip-row",
        },
      },
    };
    const synSkip = synthesizeExecution({
      sources: [
        { name: "brands", rows: [] },
        { name: "products", rows: [] },
      ],
      mappings: { brands: brandsMapping, products: productsSkip },
      portalTables: [brands, products],
    });
    expect(synSkip.fkOptions.products).toBeUndefined();
  });

  it("passes onMissing='create-stub' through to fkOptions and no longer rejects at synth", () => {
    const productsStub: MappingState = {
      ...productsMapping,
      foreignKeys: {
        brand: {
          ...initialForeignKeyConfig(),
          sourceTable: "brands",
          matchKey: "slug",
          onMissing: "create-stub",
        },
      },
    };
    const syn = synthesizeExecution({
      sources: [
        { name: "brands", rows: [] },
        { name: "products", rows: [] },
      ],
      mappings: { brands: brandsMapping, products: productsStub },
      portalTables: [brands, products],
    });
    expect(syn.issues).toEqual([]);
    expect(syn.fkOptions.products?.brand).toEqual({ onMissing: "create-stub" });
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

  it("passes composite natural keys through as an array of target columns", () => {
    const t2 = table("brands", "T1", [
      { name: "slug", type: "TEXT" },
      { name: "name", type: "TEXT" },
    ]);
    const composite: MappingState = {
      ...base,
      columnMap: {
        slug: { kind: "mapped", targetColumn: "slug" },
        name: { kind: "mapped", targetColumn: "name" },
      },
      naturalKey: ["slug", "name"],
    };
    const syn = synthesizeExecution({
      sources: [{ name: "brands", rows: [] }],
      mappings: { brands: composite },
      portalTables: [t2],
    });
    expect(syn.issues).toEqual([]);
    expect(syn.schema?.tables[0]?.naturalKey).toEqual(["slug", "name"]);
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

describe("synthesizeExecution — cell-length caps", () => {
  const t = table("posts", "T1", [
    { name: "slug", type: "TEXT" },
    { name: "body", type: "RICHTEXT" },
  ]);
  const mapping: MappingState = {
    ...initialMappingState(),
    targetTableName: "posts",
    columnMap: {
      slug: { kind: "mapped", targetColumn: "slug" },
      body: { kind: "mapped", targetColumn: "body" },
    },
    naturalKey: ["slug"],
  };

  it("rejects TEXT cells over 10k chars with a single per-column issue", () => {
    const oversized = "x".repeat(HUBDB_TEXT_MAX + 1);
    const syn = synthesizeExecution({
      sources: [
        {
          name: "posts",
          rows: [
            { slug: "ok", body: "short" },
            { slug: oversized, body: "short" },
          ],
        },
      ],
      mappings: { posts: mapping },
      portalTables: [t],
    });
    expect(syn.schema).toBeNull();
    const issue = syn.issues.find((i) => i.kind === "cell-too-long");
    expect(issue).toMatchObject({
      kind: "cell-too-long",
      source: "posts",
      sourceColumn: "slug",
      targetColumn: "slug",
      targetType: "TEXT",
      maxLength: HUBDB_TEXT_MAX,
      count: 1,
      sampleRowIndex: 1,
      sampleLength: HUBDB_TEXT_MAX + 1,
    });
  });

  it("uses the 65k richtext cap for RICHTEXT targets and accepts values within it", () => {
    const richOk = "x".repeat(HUBDB_TEXT_MAX + 100); // over TEXT cap, under RICHTEXT cap
    const richBad = "x".repeat(HUBDB_RICHTEXT_MAX + 1);
    const syn = synthesizeExecution({
      sources: [{ name: "posts", rows: [{ slug: "ok", body: richOk }, { slug: "ok2", body: richBad }] }],
      mappings: { posts: mapping },
      portalTables: [t],
    });
    const cellTooLongIssues = syn.issues.filter((i) => i.kind === "cell-too-long");
    expect(cellTooLongIssues).toHaveLength(1);
    expect(cellTooLongIssues[0]).toMatchObject({
      sourceColumn: "body",
      targetType: "RICHTEXT",
      maxLength: HUBDB_RICHTEXT_MAX,
    });
  });
});

describe("synthesizeExecution — hs_path", () => {
  const t = table("pages", "T1", [{ name: "slug", type: "TEXT" }]);
  const base: MappingState = {
    ...initialMappingState(),
    targetTableName: "pages",
    columnMap: { slug: { kind: "mapped", targetColumn: "slug" } },
    naturalKey: ["slug"],
    hsPath: "slug",
  };

  it("rejects uppercase / invalid-char / duplicate page paths", () => {
    const syn = synthesizeExecution({
      sources: [
        {
          name: "pages",
          rows: [
            { slug: "About-Us" }, // uppercase
            { slug: "contact us" }, // space -> invalid-char
            { slug: "home" },
            { slug: "home" }, // duplicate
          ],
        },
      ],
      mappings: { pages: base },
      portalTables: [t],
    });
    expect(syn.schema).toBeNull();
    const issue = syn.issues.find((i) => i.kind === "page-path-invalid");
    expect(issue?.column).toBe("slug");
    expect(issue && "issues" in issue ? issue.issues.map((i) => i.kind).sort() : []).toEqual(
      ["duplicate", "invalid-char", "not-lowercase"],
    );
  });

  it("passes when every row is lowercase, URL-safe, and unique", () => {
    const syn = synthesizeExecution({
      sources: [{ name: "pages", rows: [{ slug: "about-us" }, { slug: "contact" }] }],
      mappings: { pages: base },
      portalTables: [t],
    });
    expect(syn.issues).toEqual([]);
    expect(syn.schema?.tables[0]?.name).toBe("pages");
  });
});

describe("computeExecutionSignature", () => {
  const sources = [
    { name: "brands", rows: [{ slug: "acme" }, { slug: "beta" }] },
  ] as const;
  const mapping: MappingState = {
    ...initialMappingState(),
    targetTableName: "brands",
    columnMap: { slug: { kind: "mapped", targetColumn: "slug" } },
    naturalKey: ["slug"],
  };

  it("returns the same hash regardless of key insertion order in mappings", () => {
    const a = computeExecutionSignature(sources, { brands: mapping });
    // Re-create the mapping object with a different property order — same
    // logical value, different in-memory shape.
    const reordered: MappingState = {
      foreignKeys: mapping.foreignKeys,
      hsPath: mapping.hsPath,
      hsName: mapping.hsName,
      naturalKey: mapping.naturalKey,
      columnMap: mapping.columnMap,
      targetTableName: mapping.targetTableName,
      targetTableId: mapping.targetTableId,
    };
    const b = computeExecutionSignature(sources, { brands: reordered });
    expect(a).toBe(b);
  });

  it("changes when a source row is edited", () => {
    const a = computeExecutionSignature(sources, { brands: mapping });
    const b = computeExecutionSignature(
      [{ name: "brands", rows: [{ slug: "acme" }, { slug: "BETA" }] }],
      { brands: mapping },
    );
    expect(a).not.toBe(b);
  });
});
