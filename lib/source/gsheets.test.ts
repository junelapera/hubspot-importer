import { describe, expect, it } from "vitest";
import { GoogleSheetsUrlError, normalizeGoogleSheetsUrl } from "./gsheets";

describe("normalizeGoogleSheetsUrl", () => {
  it("passes through a canonical published-CSV URL unchanged", () => {
    const url =
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vTabcXYZ/pub?output=csv&gid=0&single=true";
    const { fetchUrl, warnings } = normalizeGoogleSheetsUrl(url);
    expect(fetchUrl).toBe(url);
    expect(warnings).toEqual([]);
  });

  it("rewrites /pubhtml → /pub?output=csv and preserves gid", () => {
    const { fetchUrl, warnings } = normalizeGoogleSheetsUrl(
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vTabcXYZ/pubhtml?gid=123456&single=true",
    );
    const parsed = new URL(fetchUrl);
    expect(parsed.pathname).toBe("/spreadsheets/d/e/2PACX-1vTabcXYZ/pub");
    expect(parsed.searchParams.get("output")).toBe("csv");
    expect(parsed.searchParams.get("gid")).toBe("123456");
    expect(parsed.searchParams.get("single")).toBe("true");
    expect(warnings).toContain("rewrote /pubhtml URL to /pub?output=csv");
  });

  it("rewrites /edit URL to /export?format=csv and lifts #gid= into query", () => {
    const { fetchUrl, warnings } = normalizeGoogleSheetsUrl(
      "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=987",
    );
    const parsed = new URL(fetchUrl);
    expect(parsed.pathname).toBe("/spreadsheets/d/1AbCdEfGhIjKlMnOp/export");
    expect(parsed.searchParams.get("format")).toBe("csv");
    expect(parsed.searchParams.get("gid")).toBe("987");
    expect(parsed.hash).toBe("");
    expect(warnings.join(" ")).toMatch(/must be shared/);
  });

  it("rewrites bare sheet URL (no /edit segment) to /export?format=csv", () => {
    const { fetchUrl, warnings } = normalizeGoogleSheetsUrl(
      "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/",
    );
    const parsed = new URL(fetchUrl);
    expect(parsed.pathname).toBe("/spreadsheets/d/1AbCdEfGhIjKlMnOp/export");
    expect(parsed.searchParams.get("format")).toBe("csv");
    expect(warnings.join(" ")).toMatch(/must be shared/);
  });

  it("passes through gviz CSV export as-is", () => {
    const url =
      "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/gviz/tq?tqx=out:csv&gid=42";
    const { fetchUrl, warnings } = normalizeGoogleSheetsUrl(url);
    expect(fetchUrl).toBe(url);
    expect(warnings).toEqual([]);
  });

  it("warns when host is not docs.google.com but still returns the URL", () => {
    const { fetchUrl, warnings } = normalizeGoogleSheetsUrl(
      "https://example.com/data.csv",
    );
    expect(fetchUrl).toBe("https://example.com/data.csv");
    expect(warnings.join(" ")).toMatch(/not docs\.google\.com/);
  });

  it("rejects empty input", () => {
    expect(() => normalizeGoogleSheetsUrl("   ")).toThrow(GoogleSheetsUrlError);
  });

  it("rejects malformed URLs", () => {
    expect(() => normalizeGoogleSheetsUrl("not-a-url")).toThrow(GoogleSheetsUrlError);
  });

  it("rejects non-http(s) schemes", () => {
    expect(() =>
      normalizeGoogleSheetsUrl("ftp://docs.google.com/spreadsheets/d/x/edit"),
    ).toThrow(/unsupported URL scheme/);
  });

  it("rejects unrecognized docs.google.com paths", () => {
    expect(() =>
      normalizeGoogleSheetsUrl("https://docs.google.com/document/d/1abc/edit"),
    ).toThrow(/unrecognized Google Sheets URL shape/);
  });

  it("ignores non-numeric hash gids", () => {
    const { fetchUrl } = normalizeGoogleSheetsUrl(
      "https://docs.google.com/spreadsheets/d/1AbCd/edit#gid=notanumber",
    );
    const parsed = new URL(fetchUrl);
    expect(parsed.searchParams.has("gid")).toBe(false);
  });
});
