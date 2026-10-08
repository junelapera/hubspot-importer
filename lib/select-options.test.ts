import { describe, expect, it } from "vitest";
import { invalidOptionValues, matchOption, optionsOf, splitMultiSelect } from "./select-options";

// Shape the HubSpot UI creates: slug `name`, display `label`.
const uiOptions = [
  { id: "1", name: "cfa", label: "CFA®", type: "option" },
  { id: "3", name: "financial_wellness", label: "Financial Wellness", type: "option" },
  { id: "6", name: "planning_retirement", label: "Planning, Retirement", type: "option" },
];
// Shape API-created options often have: name only.
const apiOptions = [
  { id: "1", name: "Red", type: "option" },
  { id: "2", name: "Dark Blue", type: "option" },
];
const ui = optionsOf(uiOptions)!;
const api = optionsOf(apiOptions)!;

describe("optionsOf", () => {
  it("reads name + label (label falls back to name) and returns null for missing/empty lists", () => {
    expect(ui[0]).toEqual({ name: "cfa", label: "CFA®" });
    expect(api[1]).toEqual({ name: "Dark Blue", label: "Dark Blue" });
    expect(optionsOf(undefined)).toBeNull();
    expect(optionsOf([])).toBeNull();
  });
});

describe("matchOption", () => {
  it("matches the display label and returns the option name HubDB expects", () => {
    expect(matchOption("CFA®", ui)).toBe("cfa");
    expect(matchOption("  financial   WELLNESS ", ui)).toBe("financial_wellness");
  });

  it("also accepts the internal name, and name-only options", () => {
    expect(matchOption("financial_wellness", ui)).toBe("financial_wellness");
    expect(matchOption("dark blue", api)).toBe("Dark Blue");
    expect(matchOption("Green", api)).toBeNull();
  });
});

describe("splitMultiSelect", () => {
  it("splits Google Sheets' comma lists and ;-lists, dedupes, and reports unknowns", () => {
    expect(splitMultiSelect("CFA®, financial wellness, cfa®", ui)).toEqual({
      matched: ["cfa", "financial_wellness"],
      unknown: [],
    });
    expect(splitMultiSelect("Red; Green", api)).toEqual({ matched: ["Red"], unknown: ["Green"] });
  });

  it("keeps a single option whose label contains a comma intact", () => {
    expect(splitMultiSelect("planning, retirement", ui)).toEqual({ matched: ["planning_retirement"], unknown: [] });
  });
});

describe("invalidOptionValues", () => {
  it("lists distinct bad values across rows, skipping blanks", () => {
    expect(invalidOptionValues(["CFA®", "", "CFP®", "Purple"], "SELECT", uiOptions)).toEqual(["CFP®", "Purple"]);
    expect(invalidOptionValues(["Red, Teal", "Dark Blue"], "MULTISELECT", apiOptions)).toEqual(["Teal"]);
    expect(invalidOptionValues(["anything"], "SELECT", undefined)).toEqual([]);
  });
});
