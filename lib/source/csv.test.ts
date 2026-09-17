import { describe, expect, it } from "vitest";
import { CsvParseError, parseCsv, type CsvParseResult } from "./csv";

function enc(text: string, encoding: "utf-8" | "utf-16le" | "utf-16be" = "utf-8", withBOM = false): Uint8Array {
  if (encoding === "utf-8") {
    const bytes = new TextEncoder().encode(text);
    if (!withBOM) return bytes;
    const out = new Uint8Array(bytes.length + 3);
    out[0] = 0xef; out[1] = 0xbb; out[2] = 0xbf;
    out.set(bytes, 3);
    return out;
  }
  // utf-16 encoding (little/big endian)
  const codeUnits: number[] = [];
  for (let i = 0; i < text.length; i++) codeUnits.push(text.charCodeAt(i));
  const buf = new Uint8Array((codeUnits.length + (withBOM ? 1 : 0)) * 2);
  let offset = 0;
  if (withBOM) {
    if (encoding === "utf-16le") { buf[0] = 0xff; buf[1] = 0xfe; }
    else { buf[0] = 0xfe; buf[1] = 0xff; }
    offset = 2;
  }
  for (const u of codeUnits) {
    if (encoding === "utf-16le") { buf[offset] = u & 0xff; buf[offset + 1] = (u >> 8) & 0xff; }
    else { buf[offset] = (u >> 8) & 0xff; buf[offset + 1] = u & 0xff; }
    offset += 2;
  }
  return buf;
}

describe("parseCsv — happy path", () => {
  it("parses a basic UTF-8 comma CSV with header row", () => {
    const res = parseCsv(enc("name,slug\nAcme,acme\nBeta,beta\n"));
    expect(res.headers).toEqual(["name", "slug"]);
    expect(res.rows).toEqual([
      { name: "Acme", slug: "acme" },
      { name: "Beta", slug: "beta" },
    ]);
    expect(res.detected.delimiter).toBe(",");
    expect(res.detected.encoding).toBe("utf-8");
    expect(res.detected.hadBOM).toBe(false);
    expect(res.warnings).toEqual([]);
  });

  it("auto-detects semicolon delimiter", () => {
    const res = parseCsv(enc("name;slug\nAcme;acme"));
    expect(res.detected.delimiter).toBe(";");
    expect(res.rows).toEqual([{ name: "Acme", slug: "acme" }]);
  });

  it("auto-detects tab delimiter", () => {
    const res = parseCsv(enc("name\tslug\nAcme\tacme"));
    expect(res.detected.delimiter).toBe("\t");
    expect(res.rows).toEqual([{ name: "Acme", slug: "acme" }]);
  });

  it("respects manual delimiter override", () => {
    const res = parseCsv(enc("name|slug\nAcme|acme"), { delimiter: "|" });
    expect(res.detected.delimiter).toBe("|");
    expect(res.rows).toEqual([{ name: "Acme", slug: "acme" }]);
  });
});

describe("parseCsv — encoding", () => {
  it("strips UTF-8 BOM and detects it", () => {
    const res = parseCsv(enc("name,slug\nAcme,acme", "utf-8", true));
    expect(res.detected.hadBOM).toBe(true);
    expect(res.detected.encoding).toBe("utf-8");
    expect(res.headers).toEqual(["name", "slug"]);
    expect(res.rows[0]?.name).toBe("Acme");
  });

  it("decodes UTF-16 LE with BOM", () => {
    const res = parseCsv(enc("name,slug\nAcme,acme", "utf-16le", true));
    expect(res.detected.encoding).toBe("utf-16le");
    expect(res.detected.hadBOM).toBe(true);
    expect(res.rows[0]).toEqual({ name: "Acme", slug: "acme" });
  });

  it("decodes UTF-16 BE with BOM", () => {
    const res = parseCsv(enc("name,slug\nAcme,acme", "utf-16be", true));
    expect(res.detected.encoding).toBe("utf-16be");
    expect(res.rows[0]).toEqual({ name: "Acme", slug: "acme" });
  });

  it("respects explicit encoding override even when no BOM present", () => {
    const res = parseCsv(enc("name,slug\nAcme,acme", "utf-16le", false), { encoding: "utf-16le" });
    expect(res.detected.encoding).toBe("utf-16le");
    expect(res.rows[0]).toEqual({ name: "Acme", slug: "acme" });
  });
});

describe("parseCsv — header handling", () => {
  it("dedupes duplicate headers with a suffix and emits a warning", () => {
    const res = parseCsv(enc("name,name\nA,B"));
    expect(res.headers).toEqual(["name", "name_2"]);
    expect(res.rows[0]).toEqual({ name: "A", name_2: "B" });
    expect(res.warnings.some((w) => w.includes("duplicate header"))).toBe(true);
  });

  it("fills empty header cells with column_N and warns", () => {
    const res = parseCsv(enc("name,,slug\nA,B,C"));
    expect(res.headers).toEqual(["name", "column_2", "slug"]);
    expect(res.rows[0]).toEqual({ name: "A", column_2: "B", slug: "C" });
    expect(res.warnings.some((w) => w.includes("column_2"))).toBe(true);
  });

  it("supports headerRow override to skip preamble rows", () => {
    const csv = "generated 2026-09-17,,\nname,slug\nAcme,acme";
    const res = parseCsv(enc(csv), { headerRow: 1 });
    expect(res.headers).toEqual(["name", "slug"]);
    expect(res.rows).toEqual([{ name: "Acme", slug: "acme" }]);
  });

  it("fills short rows with empty strings so every row has every header key", () => {
    const res = parseCsv(enc("name,slug,label\nAcme,acme"));
    expect(res.rows[0]).toEqual({ name: "Acme", slug: "acme", label: "" });
  });
});

describe("parseCsv — errors", () => {
  it("throws on empty input", () => {
    expect(() => parseCsv(new Uint8Array())).toThrow(CsvParseError);
  });

  it("throws when headerRow puts us past the last row", () => {
    expect(() => parseCsv(enc("name,slug\n"), { headerRow: 2 })).toThrow(CsvParseError);
  });
});

describe("parseCsv — quoted values", () => {
  it("respects RFC 4180 quoted fields with embedded commas and newlines", () => {
    const csv = 'name,note\n"Acme, Inc.","line 1\nline 2"';
    const res: CsvParseResult = parseCsv(enc(csv));
    expect(res.rows[0]).toEqual({ name: "Acme, Inc.", note: "line 1\nline 2" });
  });
});
