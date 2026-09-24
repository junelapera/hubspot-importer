import { describe, expect, it } from "vitest";
import { inferSchema, toSchema, type InferInput } from "./schema-infer";

function table(name: string, rows: Record<string, string>[]): InferInput {
  return { name, rows, headers: Object.keys(rows[0] ?? {}) };
}

describe("inferSchema — type detection", () => {
  it("infers DATE from YYYY-MM-DD strings", () => {
    const result = inferSchema([
      table("events", [
        { date: "2026-01-01" },
        { date: "2026-01-15" },
        { date: "2026-02-01" },
      ]),
    ]);
    expect(result[0].columns[0].type).toBe("DATE");
  });

  it("infers DATETIME when values include time-of-day", () => {
    const result = inferSchema([
      table("events", [
        { at: "2026-01-01T10:30:00Z" },
        { at: "2026-01-01T14:00:00Z" },
      ]),
    ]);
    expect(result[0].columns[0].type).toBe("DATETIME");
  });

  it("infers BOOLEAN from true/false variants", () => {
    const result = inferSchema([
      table("flags", [
        { active: "true" },
        { active: "no" },
        { active: "1" },
      ]),
    ]);
    expect(result[0].columns[0].type).toBe("BOOLEAN");
  });

  it("infers URL from http(s) values", () => {
    const result = inferSchema([
      table("pages", [
        { url: "https://example.com/a" },
        { url: "http://example.com/b" },
      ]),
    ]);
    expect(result[0].columns[0].type).toBe("URL");
  });

  it("infers IMAGE from URLs ending in image extensions", () => {
    const result = inferSchema([
      table("assets", [
        { url: "https://cdn.example.com/a.png" },
        { url: "https://cdn.example.com/b.jpg?v=2" },
      ]),
    ]);
    expect(result[0].columns[0].type).toBe("IMAGE");
  });

  it("infers NUMBER from numeric strings", () => {
    const result = inferSchema([
      table("stats", [
        { count: "42" },
        { count: "17" },
        { count: "-3.14" },
      ]),
    ]);
    expect(result[0].columns[0].type).toBe("NUMBER");
  });

  it("infers CURRENCY when column name hints at money AND values are numeric", () => {
    const result = inferSchema([
      table("products", [
        { price: "29.99" },
        { price: "19.99" },
      ]),
    ]);
    expect(result[0].columns[0].type).toBe("CURRENCY");
  });

  it("infers RICHTEXT when at least one cell exceeds the threshold", () => {
    const long = "x".repeat(600);
    const result = inferSchema([
      table("posts", [{ body: "short" }, { body: long }]),
    ]);
    expect(result[0].columns[0].type).toBe("RICHTEXT");
  });

  it("falls back to TEXT for mixed content", () => {
    const result = inferSchema([
      table("things", [
        { value: "abc" },
        { value: "42" },
        { value: "https://x.com" },
      ]),
    ]);
    expect(result[0].columns[0].type).toBe("TEXT");
  });

  it("falls back to TEXT for a fully-empty column", () => {
    const result = inferSchema([
      table("things", [{ note: "" }, { note: "" }]),
    ]);
    expect(result[0].columns[0].type).toBe("TEXT");
  });
});

describe("inferSchema — natural key detection", () => {
  it("picks a fully-unique column", () => {
    const result = inferSchema([
      table("brands", [
        { slug: "acme", name: "Acme" },
        { slug: "globex", name: "Globex" },
      ]),
    ]);
    expect(result[0].naturalKey).toBe("slug");
    expect(result[0].columns.find((c) => c.name === "slug")?.isNaturalKey).toBe(true);
  });

  it("prefers 'id' over other unique columns", () => {
    const result = inferSchema([
      table("items", [
        { id: "1", handle: "a" },
        { id: "2", handle: "b" },
      ]),
    ]);
    expect(result[0].naturalKey).toBe("id");
  });

  it("prefers 'sku' over generic unique columns", () => {
    const result = inferSchema([
      table("items", [
        { sku: "A", note: "n1" },
        { sku: "B", note: "n2" },
      ]),
    ]);
    expect(result[0].naturalKey).toBe("sku");
  });

  it("rejects columns with duplicates", () => {
    const result = inferSchema([
      table("items", [
        { name: "Widget" },
        { name: "Widget" },
      ]),
    ]);
    expect(result[0].naturalKey).toBe(null);
  });

  it("rejects columns that are mostly empty even if unique", () => {
    const rows = [
      { sparse: "a" },
      { sparse: "" },
      { sparse: "" },
      { sparse: "" },
    ];
    const result = inferSchema([table("items", rows)]);
    expect(result[0].naturalKey).toBe(null);
  });
});

describe("inferSchema — FK detection", () => {
  it("flags FOREIGN_ID when values are a subset of another table's naturalKey column", () => {
    const brands = table("brands", [
      { slug: "acme", name: "Acme" },
      { slug: "globex", name: "Globex" },
    ]);
    const products = table("products", [
      { sku: "P1", brand: "acme" },
      { sku: "P2", brand: "globex" },
    ]);
    const result = inferSchema([brands, products]);
    const brandCol = result[1].columns.find((c) => c.name === "brand");
    expect(brandCol?.type).toBe("FOREIGN_ID");
    expect(brandCol?.foreignTable).toBe("brands");
    expect(brandCol?.foreignColumn).toBe("slug");
  });

  it("does not flag FK if any value is missing from the target", () => {
    const brands = table("brands", [{ slug: "acme" }]);
    const products = table("products", [
      { sku: "P1", brand: "acme" },
      { sku: "P2", brand: "globex" },
    ]);
    const result = inferSchema([brands, products]);
    const brandCol = result[1].columns.find((c) => c.name === "brand");
    expect(brandCol?.type).not.toBe("FOREIGN_ID");
  });

  it("case-insensitive match — 'Acme' resolves against 'acme'", () => {
    const brands = table("brands", [{ slug: "acme" }, { slug: "globex" }]);
    const products = table("products", [
      { sku: "P1", brand: "Acme" },
      { sku: "P2", brand: "GLOBEX" },
    ]);
    const result = inferSchema([brands, products]);
    expect(result[1].columns.find((c) => c.name === "brand")?.type).toBe("FOREIGN_ID");
  });

  it("does not flag the naturalKey column itself as an FK", () => {
    const brands = table("brands", [{ slug: "acme" }, { slug: "globex" }]);
    const products = table("products", [
      { sku: "acme", brand: "acme" },
      { sku: "globex", brand: "globex" },
    ]);
    const result = inferSchema([brands, products]);
    const skuCol = result[1].columns.find((c) => c.name === "sku");
    expect(skuCol?.isNaturalKey).toBe(true);
    expect(skuCol?.type).not.toBe("FOREIGN_ID");
  });
});

describe("toSchema", () => {
  it("emits a v1 schema stripped of UI-only fields", () => {
    const inferred = inferSchema([
      table("brands", [
        { slug: "acme", name: "Acme" },
        { slug: "globex", name: "Globex" },
      ]),
    ]);
    const schema = toSchema(inferred);
    expect(schema.version).toBe(1);
    expect(schema.tables[0].naturalKey).toBe("slug");
    for (const col of schema.tables[0].columns) {
      expect(col).not.toHaveProperty("isNaturalKey");
      expect(col).not.toHaveProperty("reason");
    }
  });

  it("carries FK metadata onto the schema shape", () => {
    const brands = table("brands", [{ slug: "acme" }, { slug: "globex" }]);
    const products = table("products", [
      { sku: "P1", brand: "acme" },
      { sku: "P2", brand: "globex" },
    ]);
    const schema = toSchema(inferSchema([brands, products]));
    const brandCol = schema.tables[1].columns.find((c) => c.name === "brand");
    expect(brandCol?.type).toBe("FOREIGN_ID");
    expect(brandCol?.foreignTable).toBe("brands");
    expect(brandCol?.foreignColumn).toBe("slug");
  });
});
