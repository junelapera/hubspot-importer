import { describe, expect, it } from "vitest";
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail, normalizeAndCheckEmail } from "./email-domain";

describe("normalizeAndCheckEmail", () => {
  it("allows lowercase saltedstone.com addresses", () => {
    expect(normalizeAndCheckEmail("june@saltedstone.com")).toBe("june@saltedstone.com");
  });

  it("normalizes case + trims whitespace", () => {
    expect(normalizeAndCheckEmail("  June.Lapera@SALTEDSTONE.com  ")).toBe(
      "june.lapera@saltedstone.com",
    );
  });

  it("rejects other domains", () => {
    expect(normalizeAndCheckEmail("someone@gmail.com")).toBeNull();
    expect(normalizeAndCheckEmail("someone@saltedstone.io")).toBeNull();
    expect(normalizeAndCheckEmail("someone@saltedstone.co")).toBeNull();
  });

  it("rejects subdomains", () => {
    expect(normalizeAndCheckEmail("someone@dev.saltedstone.com")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(normalizeAndCheckEmail("no-at-sign")).toBeNull();
    expect(normalizeAndCheckEmail("@saltedstone.com")).toBeNull();
    expect(normalizeAndCheckEmail("someone@")).toBeNull();
    expect(normalizeAndCheckEmail("two@@saltedstone.com")).toBeNull();
    expect(normalizeAndCheckEmail("")).toBeNull();
    expect(normalizeAndCheckEmail("   ")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizeAndCheckEmail(null)).toBeNull();
    expect(normalizeAndCheckEmail(undefined)).toBeNull();
    expect(normalizeAndCheckEmail(42)).toBeNull();
    expect(normalizeAndCheckEmail({ email: "a@saltedstone.com" })).toBeNull();
  });

  it("isAllowedEmail is a boolean wrapper", () => {
    expect(isAllowedEmail("june@saltedstone.com")).toBe(true);
    expect(isAllowedEmail("someone@gmail.com")).toBe(false);
  });

  it("exports the allowlist constant for direct reference", () => {
    expect(ALLOWED_EMAIL_DOMAIN).toBe("saltedstone.com");
  });
});
