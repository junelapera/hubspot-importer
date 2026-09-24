import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseXlsx, XlsxParseError } from "./xlsx";

// Round-trip: build a workbook in memory with xlsx.write(), then parse
// the bytes back through parseXlsx. Keeps tests self-contained (no
// fixture files) and mirrors how a real upload arrives (as a Buffer).
function makeXlsx(sheets: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("parseXlsx", () => {
  it("parses a single-sheet workbook", () => {
    const bytes = makeXlsx({
      brands: [
        ["slug", "name"],
        ["acme", "Acme"],
        ["globex", "Globex"],
      ],
    });
    const result = parseXlsx(bytes);
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].name).toBe("brands");
    expect(result.sheets[0].headers).toEqual(["slug", "name"]);
    expect(result.sheets[0].rows).toEqual([
      { slug: "acme", name: "Acme" },
      { slug: "globex", name: "Globex" },
    ]);
  });

  it("parses multiple sheets in order", () => {
    const bytes = makeXlsx({
      brands: [["slug"], ["acme"]],
      products: [["sku", "brand"], ["P1", "acme"]],
    });
    const result = parseXlsx(bytes);
    expect(result.sheets.map((s) => s.name)).toEqual(["brands", "products"]);
    expect(result.sheets[1].rows).toEqual([{ sku: "P1", brand: "acme" }]);
  });

  it("coerces numeric + boolean cells to strings so they match CSV output", () => {
    const bytes = makeXlsx({
      data: [
        ["sku", "price", "active"],
        ["P1", 29.99, true],
        ["P2", 15, false],
      ],
    });
    const result = parseXlsx(bytes);
    expect(result.sheets[0].rows[0]).toEqual({ sku: "P1", price: "29.99", active: "TRUE" });
    expect(result.sheets[0].rows[1]).toEqual({ sku: "P2", price: "15", active: "FALSE" });
  });

  it("honors headerRow to skip preamble rows", () => {
    const bytes = makeXlsx({
      data: [
        ["exported: 2026-01-01"],
        ["source: pim"],
        ["sku", "name"],
        ["P1", "Widget"],
      ],
    });
    const result = parseXlsx(bytes, { headerRow: 2 });
    expect(result.sheets[0].headers).toEqual(["sku", "name"]);
    expect(result.sheets[0].rows).toEqual([{ sku: "P1", name: "Widget" }]);
  });

  it("dedupes duplicate headers and fills empty ones", () => {
    const bytes = makeXlsx({
      data: [
        ["name", "name", "", "name"],
        ["a", "b", "c", "d"],
      ],
    });
    const result = parseXlsx(bytes);
    expect(result.sheets[0].headers).toEqual(["name", "name_2", "column_3", "name_3"]);
    expect(result.sheets[0].warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('duplicate header "name"'),
        expect.stringContaining("header 3 is empty"),
      ]),
    );
  });

  it("filters to a sheetNames whitelist and warns on missing names", () => {
    const bytes = makeXlsx({
      brands: [["slug"], ["acme"]],
      products: [["sku"], ["P1"]],
      internal: [["debug"], ["x"]],
    });
    const result = parseXlsx(bytes, { sheetNames: ["brands", "products", "missing"] });
    expect(result.sheets.map((s) => s.name)).toEqual(["brands", "products"]);
    expect(result.warnings.some((w) => w.includes('sheet "missing" not found'))).toBe(true);
  });

  it("normalizes sheet names with unsafe characters and dedupes clashes", () => {
    const bytes = makeXlsx({
      "Sales Q1 2026": [["a"], ["1"]],
      "Sales Q1_2026": [["a"], ["2"]],
    });
    const result = parseXlsx(bytes);
    expect(result.sheets.map((s) => s.name)).toEqual(["Sales_Q1_2026", "Sales_Q1_2026_2"]);
  });

  it("returns an empty sheet result (with warning) when a sheet has no data rows", () => {
    const bytes = makeXlsx({
      data: [["col"]],
    });
    const result = parseXlsx(bytes, { headerRow: 5 });
    expect(result.sheets[0].rows).toEqual([]);
    expect(result.sheets[0].warnings.some((w) => w.includes("no rows after header row 5"))).toBe(true);
  });

  it("throws XlsxParseError on empty input", () => {
    expect(() => parseXlsx(new Uint8Array(0))).toThrow(XlsxParseError);
  });

});
