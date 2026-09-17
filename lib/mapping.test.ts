import { describe, expect, it } from "vitest";
import {
  autoMap,
  countResolvable,
  deriveImportOrder,
  detectTypeMismatch,
  initialForeignKeyConfig,
  initialMappingState,
  normalizeIdent,
  validatePathColumn,
  type MappingState,
} from "./mapping";
import type { HubdbColumn } from "./hubdb";

function col(name: string, type: string = "TEXT"): HubdbColumn {
  return { id: "1", name, type };
}

describe("normalizeIdent", () => {
  it("lowercases and strips whitespace/underscores/hyphens/dots", () => {
    expect(normalizeIdent("Product Name")).toBe("productname");
    expect(normalizeIdent("product_name")).toBe("productname");
    expect(normalizeIdent("product-name")).toBe("productname");
    expect(normalizeIdent("product.name")).toBe("productname");
    expect(normalizeIdent("Product   Name")).toBe("productname");
  });
});

describe("autoMap", () => {
  it("matches source headers to target columns on normalized name", () => {
    const map = autoMap(["SKU", "Product Name", "note"], [col("sku"), col("productName"), col("misc")]);
    expect(map).toEqual({
      "SKU": { kind: "mapped", targetColumn: "sku" },
      "Product Name": { kind: "mapped", targetColumn: "productName" },
      "note": { kind: "unmapped" },
    });
  });

  it("never claims the same target column twice — later source wins nothing", () => {
    const map = autoMap(["sku", "SKU"], [col("sku")]);
    expect(map["sku"]).toEqual({ kind: "mapped", targetColumn: "sku" });
    expect(map["SKU"]).toEqual({ kind: "unmapped" });
  });

  it("leaves unmatched sources as unmapped", () => {
    const map = autoMap(["nope"], [col("sku")]);
    expect(map["nope"]).toEqual({ kind: "unmapped" });
  });
});

describe("detectTypeMismatch — NUMBER/CURRENCY", () => {
  it("flags non-numeric cells against NUMBER", () => {
    const m = detectTypeMismatch(["12", "abc", "3.14"], "NUMBER");
    expect(m).toEqual({ kind: "number-non-numeric", badCount: 1 });
  });

  it("accepts clean numeric cells", () => {
    expect(detectTypeMismatch(["12", "3.14", "-7"], "CURRENCY")).toBeNull();
  });

  it("ignores empty cells", () => {
    expect(detectTypeMismatch(["", "  ", "42"], "NUMBER")).toBeNull();
  });
});

describe("detectTypeMismatch — BOOLEAN", () => {
  it("accepts true/false/yes/no/0/1 in any case", () => {
    expect(detectTypeMismatch(["true", "FALSE", "Yes", "n", "1", "0"], "BOOLEAN")).toBeNull();
  });
  it("flags anything else", () => {
    expect(detectTypeMismatch(["maybe"], "BOOLEAN")).toEqual({ kind: "boolean-non-boolean", badCount: 1 });
  });
});

describe("detectTypeMismatch — DATE / DATETIME", () => {
  it("requires YYYY-MM-DD for DATE", () => {
    expect(detectTypeMismatch(["2026-09-17"], "DATE")).toBeNull();
    expect(detectTypeMismatch(["09/17/2026"], "DATE")).toEqual({ kind: "date-unparseable", badCount: 1 });
  });
  it("accepts any Date.parse-able value for DATETIME", () => {
    expect(detectTypeMismatch(["2026-09-17T12:00:00Z", "2026-01-01"], "DATETIME")).toBeNull();
    expect(detectTypeMismatch(["not a date"], "DATETIME")).toEqual({ kind: "datetime-unparseable", badCount: 1 });
  });
});

describe("detectTypeMismatch — permissive types", () => {
  it("never flags TEXT or unknown types", () => {
    expect(detectTypeMismatch(["anything at all"], "TEXT")).toBeNull();
    expect(detectTypeMismatch(["anything at all"], "RICHTEXT")).toBeNull();
    expect(detectTypeMismatch(["anything at all"], "URL")).toBeNull();
  });
});

describe("countResolvable — single-value", () => {
  const brands = [{ slug: "Acme" }, { slug: "beta" }, { slug: "gamma" }];
  const cfg = { ...initialForeignKeyConfig(), matching: "default" as const };

  it("counts matched rows using case-insensitive default matching", () => {
    const products = [{ brand: "acme" }, { brand: "BETA" }, { brand: "gamma" }];
    const c = countResolvable(products, "brand", brands, "slug", cfg);
    expect(c).toEqual({ matched: 3, unmatched: 0, empty: 0, totalValues: 3, missingValues: 0 });
  });

  it("counts unmatched rows separately from empty", () => {
    const products = [{ brand: "acme" }, { brand: "" }, { brand: "unknown" }];
    const c = countResolvable(products, "brand", brands, "slug", cfg);
    expect(c).toEqual({ matched: 1, unmatched: 1, empty: 1, totalValues: 2, missingValues: 1 });
  });

  it("strict matching rejects casefold matches", () => {
    const strict = { ...cfg, matching: "strict" as const };
    const products = [{ brand: "acme" }, { brand: "Acme" }];
    const c = countResolvable(products, "brand", brands, "slug", strict);
    expect(c.matched).toBe(1);
    expect(c.unmatched).toBe(1);
  });
});

describe("countResolvable — multi-value", () => {
  const brands = [{ slug: "acme" }, { slug: "beta" }, { slug: "gamma" }];
  const cfg = { ...initialForeignKeyConfig(), matching: "default" as const, multi: true, delimiter: "," as const };

  it("splits on the chosen delimiter and counts per-cell values", () => {
    const products = [
      { brands: "acme,beta" },       // 2 hits
      { brands: "acme,unknown" },    // 1 hit + 1 miss → row unmatched
      { brands: "gamma" },           // 1 hit
    ];
    const c = countResolvable(products, "brands", brands, "slug", cfg);
    expect(c.matched).toBe(2);
    expect(c.unmatched).toBe(1);
    expect(c.totalValues).toBe(5);
    expect(c.missingValues).toBe(1);
  });

  it("honours the pipe delimiter", () => {
    const pipe = { ...cfg, delimiter: "|" as const };
    const products = [{ brands: "acme|beta|gamma" }];
    const c = countResolvable(products, "brands", brands, "slug", pipe);
    expect(c.matched).toBe(1);
    expect(c.totalValues).toBe(3);
  });
});

describe("deriveImportOrder", () => {
  function withFk(source: string, col: string, cfgSource: string): MappingState {
    const m = initialMappingState();
    m.foreignKeys[col] = { ...initialForeignKeyConfig(), sourceTable: cfgSource, matchKey: "slug" };
    m.targetTableName = source;
    return m;
  }

  it("orders foreign sources before the main table", () => {
    const plan = deriveImportOrder(
      ["products", "brands", "categories"],
      {
        products: {
          ...initialMappingState(),
          foreignKeys: {
            brand: { ...initialForeignKeyConfig(), sourceTable: "brands", matchKey: "slug" },
            category: { ...initialForeignKeyConfig(), sourceTable: "categories", matchKey: "slug" },
          },
        },
      },
    );
    expect(plan.ok).toBe(true);
    expect(plan.order.indexOf("brands")).toBeLessThan(plan.order.indexOf("products"));
    expect(plan.order.indexOf("categories")).toBeLessThan(plan.order.indexOf("products"));
  });

  it("returns the identity order when no FK configs point anywhere", () => {
    const plan = deriveImportOrder(["a", "b", "c"], {});
    expect(plan.ok).toBe(true);
    expect(plan.order.length).toBe(3);
    expect(new Set(plan.order)).toEqual(new Set(["a", "b", "c"]));
  });

  it("ignores FK configs that reference tables outside the source set", () => {
    const plan = deriveImportOrder(["products"], {
      products: withFk("products", "brand", "brands"),
    });
    expect(plan.ok).toBe(true);
    expect(plan.order).toEqual(["products"]);
  });

  it("detects and breaks a 2-cycle, emitting deferred edges", () => {
    const plan = deriveImportOrder(["a", "b"], {
      a: withFk("a", "b_ref", "b"),
      b: withFk("b", "a_ref", "a"),
    });
    expect(plan.ok).toBe(false);
    expect(plan.cycles.length).toBeGreaterThan(0);
    expect(plan.deferred.length).toBeGreaterThan(0);
    expect(plan.cycleBreakOrder.length).toBe(2);
  });

  it("ignores self-references (a source can't foreign-key its own rows in v1)", () => {
    const plan = deriveImportOrder(["products"], {
      products: withFk("products", "parent", "products"),
    });
    expect(plan.ok).toBe(true);
    expect(plan.order).toEqual(["products"]);
  });
});

describe("validatePathColumn", () => {
  it("flags non-lowercase values", () => {
    const issues = validatePathColumn([{ path: "Foo" }, { path: "bar" }], "path");
    expect(issues.some((i) => i.kind === "not-lowercase")).toBe(true);
  });

  it("flags invalid characters", () => {
    const issues = validatePathColumn([{ path: "with space" }, { path: "ok/segment" }], "path");
    expect(issues.some((i) => i.kind === "invalid-char")).toBe(true);
  });

  it("flags duplicates with all offending rows", () => {
    const issues = validatePathColumn([{ path: "abc" }, { path: "def" }, { path: "abc" }], "path");
    const dup = issues.find((i) => i.kind === "duplicate");
    expect(dup).toBeDefined();
    if (dup?.kind !== "duplicate") return;
    expect(dup.rows).toEqual([0, 2]);
  });

  it("flags empty rows and does not mark them as duplicates of one another", () => {
    const issues = validatePathColumn([{ path: "" }, { path: "" }, { path: "abc" }], "path");
    const emptyCount = issues.filter((i) => i.kind === "empty").length;
    expect(emptyCount).toBe(2);
    expect(issues.some((i) => i.kind === "duplicate")).toBe(false);
  });
});
