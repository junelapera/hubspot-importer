import { describe, expect, it } from "vitest";
import { HUBDB_RICHTEXT_MAX, HUBDB_TEXT_MAX, validateSource, type Warning } from "./validate";
import { HUBDB_MAX_ROWS_PER_TABLE } from "../resolve";

function makeRows(count: number, cell: (i: number) => Record<string, string>): Record<string, string>[] {
  return Array.from({ length: count }, (_, i) => cell(i));
}

function kinds(ws: Warning[]) {
  return ws.map((w) => w.kind);
}

describe("validateSource — row count cap", () => {
  it("flags when rows exceed the 10k per-table cap", () => {
    const rows = makeRows(HUBDB_MAX_ROWS_PER_TABLE + 5, () => ({ x: "y" }));
    const warnings = validateSource({ table: "big", rows });
    expect(warnings.some((w) => w.kind === "row-count-cap")).toBe(true);
  });

  it("does not flag when rows are at or below the cap", () => {
    const rows = makeRows(HUBDB_MAX_ROWS_PER_TABLE, () => ({ x: "y" }));
    const warnings = validateSource({ table: "big", rows });
    expect(warnings.some((w) => w.kind === "row-count-cap")).toBe(false);
  });
});

describe("validateSource — text length caps", () => {
  it("flags cells over the 10k TEXT cap for non-richtext columns", () => {
    const rows = [{ blurb: "x".repeat(HUBDB_TEXT_MAX + 1) }];
    const warnings = validateSource({ table: "t", rows });
    expect(kinds(warnings)).toContain("cell-too-long-text");
  });

  it("uses the 65k RICHTEXT cap for columns marked as rich-text", () => {
    const rows = [{ body: "x".repeat(HUBDB_TEXT_MAX + 1) }];
    const okAsRich = validateSource({ table: "t", rows, richTextColumns: ["body"] });
    expect(kinds(okAsRich)).not.toContain("cell-too-long-text");
    expect(kinds(okAsRich)).not.toContain("cell-too-long-richtext");
  });

  it("flags rich-text cells past 65k", () => {
    const rows = [{ body: "x".repeat(HUBDB_RICHTEXT_MAX + 1) }];
    const warnings = validateSource({ table: "t", rows, richTextColumns: ["body"] });
    expect(kinds(warnings)).toContain("cell-too-long-richtext");
  });
});

describe("validateSource — required columns", () => {
  it("flags empty and whitespace-only cells for a required column", () => {
    const rows = [{ sku: "A" }, { sku: "" }, { sku: "  " }, { sku: "B" }];
    const warnings = validateSource({ table: "t", rows, requiredColumns: ["sku"] });
    const w = warnings.find((x) => x.kind === "empty-required-column");
    expect(w).toBeDefined();
    expect((w!.detail as { rows: number[] }).rows).toEqual([1, 2]);
  });

  it("stays silent when required columns are populated", () => {
    const rows = [{ sku: "A" }, { sku: "B" }];
    const warnings = validateSource({ table: "t", rows, requiredColumns: ["sku"] });
    expect(kinds(warnings)).not.toContain("empty-required-column");
  });
});

describe("validateSource — duplicate natural keys", () => {
  it("flags duplicate single-column keys after normalization", () => {
    const rows = [{ slug: "Acme" }, { slug: "acme" }, { slug: "beta" }];
    const warnings = validateSource({ table: "t", rows, naturalKey: ["slug"] });
    const w = warnings.find((x) => x.kind === "duplicate-natural-key");
    expect(w).toBeDefined();
  });

  it("flags duplicate composite keys", () => {
    const rows = [
      { region: "us", slug: "acme" },
      { region: "US", slug: "acme" },
      { region: "eu", slug: "acme" },
    ];
    const warnings = validateSource({ table: "t", rows, naturalKey: ["region", "slug"] });
    expect(kinds(warnings)).toContain("duplicate-natural-key");
  });

  it("skips rows with an empty key part instead of colliding them", () => {
    const rows = [{ slug: "" }, { slug: "" }, { slug: "acme" }];
    const warnings = validateSource({ table: "t", rows, naturalKey: ["slug"] });
    expect(kinds(warnings)).not.toContain("duplicate-natural-key");
  });
});

describe("validateSource — clean input", () => {
  it("returns no warnings for a small, well-formed table", () => {
    const rows = [{ sku: "A", name: "Acme" }, { sku: "B", name: "Beta" }];
    const warnings = validateSource({
      table: "t",
      rows,
      naturalKey: ["sku"],
      requiredColumns: ["sku", "name"],
    });
    expect(warnings).toEqual([]);
  });
});
