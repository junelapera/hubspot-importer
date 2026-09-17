import { describe, expect, it } from "vitest";
import { parseJson } from "./json";

describe("parseJson — object form", () => {
  it("parses { table: rows[] } shape", () => {
    const outcome = parseJson(JSON.stringify({
      brands: [{ slug: "acme", name: "Acme" }, { slug: "beta", name: "Beta" }],
    }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.tables).toHaveLength(1);
    expect(outcome.result.tables[0]?.name).toBe("brands");
    expect(outcome.result.tables[0]?.rows).toEqual([
      { slug: "acme", name: "Acme" },
      { slug: "beta", name: "Beta" },
    ]);
    expect(outcome.result.tables[0]?.headers.sort()).toEqual(["name", "slug"]);
  });

  it("stringifies numeric, boolean, and null cells", () => {
    const outcome = parseJson(JSON.stringify({
      products: [{ sku: "A1", price: 12.5, inStock: true, tag: null }],
    }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.tables[0]?.rows[0]).toEqual({
      sku: "A1",
      price: "12.5",
      inStock: "true",
      tag: "",
    });
  });

  it("backfills missing cells with empty strings so every row has every header key", () => {
    const outcome = parseJson(JSON.stringify({
      brands: [{ slug: "acme", name: "Acme" }, { slug: "beta" }],
    }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.tables[0]?.rows[1]).toEqual({ slug: "beta", name: "" });
  });
});

describe("parseJson — array form", () => {
  it("parses [{ table, rows }] shape", () => {
    const outcome = parseJson(JSON.stringify([
      { table: "brands", rows: [{ slug: "acme" }] },
      { table: "categories", rows: [{ name: "tools" }] },
    ]));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.tables.map((t) => t.name)).toEqual(["brands", "categories"]);
  });

  it("rejects array entries missing table or rows fields", () => {
    const outcome = parseJson(JSON.stringify([{ rows: [{ a: 1 }] }]));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("invalid-shape");
  });
});

describe("parseJson — nested-value rejection", () => {
  it("rejects a nested object cell with a path pointer", () => {
    const outcome = parseJson(JSON.stringify({
      products: [{ sku: "A1", meta: { color: "red" } }],
    }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("nested-value");
    if (outcome.error.kind !== "nested-value") return;
    expect(outcome.error.path).toBe("products[0].meta");
  });

  it("rejects an array cell (multi-value is authored as delimited strings)", () => {
    const outcome = parseJson(JSON.stringify({
      products: [{ sku: "A1", tags: ["red", "green"] }],
    }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("nested-value");
    if (outcome.error.kind !== "nested-value") return;
    expect(outcome.error.path).toBe("products[0].tags");
  });

  it("path pointer identifies the exact row + column", () => {
    const outcome = parseJson(JSON.stringify({
      brands: [{ slug: "a" }, { slug: "b" }, { slug: "c", detail: { note: "x" } }],
    }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    if (outcome.error.kind !== "nested-value") return;
    expect(outcome.error.path).toBe("brands[2].detail");
  });
});

describe("parseJson — malformed inputs", () => {
  it("returns invalid-json on parse failure", () => {
    const outcome = parseJson("{ not: valid }");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("invalid-json");
  });

  it("returns empty on whitespace-only input", () => {
    const outcome = parseJson("   \n\n   ");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("empty");
  });

  it("rejects a top-level primitive", () => {
    const outcome = parseJson("42");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("invalid-shape");
  });

  it("rejects a table whose value is not an array of objects", () => {
    const outcome = parseJson(JSON.stringify({ brands: "not-an-array" }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("invalid-shape");
  });

  it("rejects a row that is not an object", () => {
    const outcome = parseJson(JSON.stringify({ brands: ["just-a-string"] }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("invalid-shape");
  });
});
