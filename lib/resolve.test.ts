import { describe, expect, it } from "vitest";
import {
  buildKeyMap,
  DEFAULT_NORMALIZE,
  normalizeKey,
  resolveForeignValue,
  splitMultiValue,
} from "./resolve";
import type { HubdbRow } from "./hubdb";

const row = (id: string, values: Record<string, unknown>): HubdbRow => ({ id, values });

describe("normalizeKey", () => {
  it("trims, collapses whitespace, and casefolds by default", () => {
    expect(normalizeKey("  Foo   Bar\t")).toBe("foo bar");
  });

  it("returns empty string for null and undefined", () => {
    expect(normalizeKey(null)).toBe("");
    expect(normalizeKey(undefined)).toBe("");
  });

  it("coerces non-strings via String()", () => {
    expect(normalizeKey(42)).toBe("42");
    expect(normalizeKey(true)).toBe("true");
  });

  it("respects opt-outs", () => {
    expect(normalizeKey("  Foo  ", { trim: false, collapseWhitespace: false, casefold: false })).toBe(
      "  Foo  ",
    );
  });

  it("collapses multiple whitespace chars into a single space", () => {
    expect(normalizeKey("a  \n  b")).toBe("a b");
  });

  it("DEFAULT_NORMALIZE is the same as omitting opts", () => {
    expect(normalizeKey("Foo Bar", DEFAULT_NORMALIZE)).toBe(normalizeKey("Foo Bar"));
  });
});

describe("splitMultiValue", () => {
  it("splits on commas, trims, and drops empties", () => {
    expect(splitMultiValue(" a , b ,, c ", ",")).toEqual(["a", "b", "c"]);
  });

  it("splits on pipes", () => {
    expect(splitMultiValue("a|b|c", "|")).toEqual(["a", "b", "c"]);
  });

  it("splits on semicolons", () => {
    expect(splitMultiValue("a;b;c", ";")).toEqual(["a", "b", "c"]);
  });

  it("splits on newlines", () => {
    expect(splitMultiValue("a\nb\n\nc", "\n")).toEqual(["a", "b", "c"]);
  });

  it("returns [] for null/undefined/empty", () => {
    expect(splitMultiValue(null, ",")).toEqual([]);
    expect(splitMultiValue(undefined, ",")).toEqual([]);
    expect(splitMultiValue("", ",")).toEqual([]);
    expect(splitMultiValue("  ", ",")).toEqual([]);
  });
});

describe("buildKeyMap", () => {
  it("builds a normalized natural-key → id map", () => {
    const rows: HubdbRow[] = [
      row("100", { slug: "Brand-A", name: "A" }),
      row("101", { slug: " brand-b ", name: "B" }),
    ];
    const res = buildKeyMap(rows, "slug");
    if (!res.ok) throw new Error("expected ok");
    expect(res.map.get("brand-a")).toBe("100");
    expect(res.map.get("brand-b")).toBe("101");
    expect(res.map.size).toBe(2);
  });

  it("reports duplicates and omits them from the map", () => {
    const rows: HubdbRow[] = [
      row("100", { slug: "brand-a" }),
      row("200", { slug: "Brand-A" }),
      row("101", { slug: "brand-b" }),
    ];
    const res = buildKeyMap(rows, "slug");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.duplicates).toEqual([{ key: "brand-a", ids: ["100", "200"], sample: "brand-a" }]);
    expect(res.map.has("brand-a")).toBe(false);
    expect(res.map.get("brand-b")).toBe("101");
  });

  it("skips rows with null / undefined / empty natural-key values", () => {
    const rows: HubdbRow[] = [
      row("100", { slug: "brand-a" }),
      row("101", { slug: null }),
      row("102", { slug: undefined }),
      row("103", { slug: "" }),
      row("104", { slug: "   " }),
    ];
    const res = buildKeyMap(rows, "slug");
    if (!res.ok) throw new Error("expected ok");
    expect(res.map.size).toBe(1);
    expect(res.map.get("brand-a")).toBe("100");
  });

  it("coerces non-string natural-key values", () => {
    const rows: HubdbRow[] = [
      row("100", { code: 42 }),
      row("101", { code: 7 }),
    ];
    const res = buildKeyMap(rows, "code");
    if (!res.ok) throw new Error("expected ok");
    expect(res.map.get("42")).toBe("100");
    expect(res.map.get("7")).toBe("101");
  });
});

const brandsMap = new Map<string, string>([
  ["brand-a", "100"],
  ["brand-b", "101"],
  ["brand-c", "102"],
]);

describe("resolveForeignValue", () => {
  it("resolves a single value to one FK ref", () => {
    const res = resolveForeignValue(["Brand-A"], brandsMap);
    expect(res).toEqual({ ok: true, cell: [{ id: "100", type: "foreignid" }] });
  });

  it("returns an empty cell (not null) for empty input", () => {
    expect(resolveForeignValue([], brandsMap)).toEqual({ ok: true, cell: [] });
  });

  it("skips whitespace-only and null values (empty cell, still ok)", () => {
    expect(resolveForeignValue(["", "  ", null, undefined], brandsMap)).toEqual({
      ok: true,
      cell: [],
    });
  });

  it("dedupes repeated values within a single cell by default", () => {
    const res = resolveForeignValue(["brand-a", "Brand-A", " BRAND-A "], brandsMap);
    if (!res.ok) throw new Error("expected ok");
    expect(res.cell).toEqual([{ id: "100", type: "foreignid" }]);
  });

  it("preserves duplicates when dedupe:false", () => {
    const res = resolveForeignValue(["brand-a", "brand-a"], brandsMap, { dedupe: false });
    if (!res.ok) throw new Error("expected ok");
    expect(res.cell).toEqual([
      { id: "100", type: "foreignid" },
      { id: "100", type: "foreignid" },
    ]);
  });

  it("resolves a multi-value cell where every value is present", () => {
    const res = resolveForeignValue(["brand-a", "brand-b"], brandsMap);
    if (!res.ok) throw new Error("expected ok");
    expect(res.cell).toEqual([
      { id: "100", type: "foreignid" },
      { id: "101", type: "foreignid" },
    ]);
  });

  it("fails the whole cell when any value is missing (all-or-nothing)", () => {
    const res = resolveForeignValue(["brand-a", "does-not-exist"], brandsMap);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missing).toEqual(["does-not-exist"]);
    expect(res.cell).toEqual([{ id: "100", type: "foreignid" }]);
  });

  it("reports every distinct missing value at once", () => {
    const res = resolveForeignValue(["gone-1", "gone-2", "brand-a"], brandsMap);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missing).toEqual(["gone-1", "gone-2"]);
  });

  it("composes with splitMultiValue on a delimited raw cell", () => {
    const raw = "brand-a, brand-b";
    const res = resolveForeignValue(splitMultiValue(raw, ","), brandsMap);
    if (!res.ok) throw new Error("expected ok");
    expect(res.cell).toEqual([
      { id: "100", type: "foreignid" },
      { id: "101", type: "foreignid" },
    ]);
  });
});
