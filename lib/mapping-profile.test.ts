import { describe, expect, it } from "vitest";
import { initialMappingState } from "./mapping";
import {
  nextCopyName,
  parseProfileExport,
  PROFILE_EXPORT_KIND,
  PROFILE_EXPORT_VERSION,
  serializeProfileExport,
} from "./mapping-profile";

describe("serializeProfileExport", () => {
  it("wraps name+state in the envelope with kind/version/exportedAt", () => {
    const state = { products: initialMappingState() };
    const out = serializeProfileExport("My mapping", state, "2026-09-24T12:00:00Z");
    expect(out).toEqual({
      kind: PROFILE_EXPORT_KIND,
      version: PROFILE_EXPORT_VERSION,
      name: "My mapping",
      exportedAt: "2026-09-24T12:00:00Z",
      state,
    });
  });
});

describe("parseProfileExport", () => {
  it("round-trips a serialized profile", () => {
    const state = { products: initialMappingState(), brands: initialMappingState() };
    const wire = serializeProfileExport("m", state, "2026-01-01T00:00:00Z");
    const parsed = parseProfileExport(wire);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.profile.state.products).toBeDefined();
  });

  it("rejects wrong kind", () => {
    const bad = { ...serializeProfileExport("m", { p: initialMappingState() }, "t"), kind: "other" };
    const parsed = parseProfileExport(bad);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/kind/);
  });

  it("rejects wrong version", () => {
    const bad = { ...serializeProfileExport("m", { p: initialMappingState() }, "t"), version: 99 };
    const parsed = parseProfileExport(bad);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/version/);
  });

  it("rejects empty name", () => {
    const bad = { ...serializeProfileExport("m", { p: initialMappingState() }, "t"), name: "   " };
    const parsed = parseProfileExport(bad);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/name/);
  });

  it("rejects empty state", () => {
    const bad = serializeProfileExport("m", {} as Record<string, ReturnType<typeof initialMappingState>>, "t");
    const parsed = parseProfileExport(bad);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/state/);
  });

  it("rejects garbage", () => {
    expect(parseProfileExport(null).ok).toBe(false);
    expect(parseProfileExport("nope").ok).toBe(false);
    expect(parseProfileExport({}).ok).toBe(false);
  });

  it("accepts an omitted exportedAt (backward compat)", () => {
    const wire = {
      kind: PROFILE_EXPORT_KIND,
      version: PROFILE_EXPORT_VERSION,
      name: "m",
      state: { p: initialMappingState() },
    };
    const parsed = parseProfileExport(wire);
    expect(parsed.ok).toBe(true);
  });
});

describe("nextCopyName", () => {
  it("prefixes 'Copy of' when no collision", () => {
    expect(nextCopyName("Products", [])).toBe("Copy of Products");
    expect(nextCopyName("Products", ["Something else"])).toBe("Copy of Products");
  });

  it("appends (2) when the base copy exists", () => {
    expect(nextCopyName("Products", ["Copy of Products"])).toBe("Copy of Products (2)");
  });

  it("finds the next free slot when several copies exist", () => {
    expect(
      nextCopyName("Products", ["Copy of Products", "Copy of Products (2)", "Copy of Products (3)"]),
    ).toBe("Copy of Products (4)");
  });
});
