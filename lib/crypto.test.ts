import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt, ENCRYPTION_KEY_ENV, generateEncryptionKey } from "./crypto";

let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENCRYPTION_KEY_ENV];
  process.env[ENCRYPTION_KEY_ENV] = generateEncryptionKey();
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENCRYPTION_KEY_ENV];
  else process.env[ENCRYPTION_KEY_ENV] = saved;
});

describe("encrypt/decrypt roundtrip", () => {
  it("decrypts what it encrypts", () => {
    const secret = "pat-na1-abcdef-0000-1111-2222-3333-abcdef";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("handles unicode plaintext", () => {
    const secret = "héllo wörld — 🔐 token";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("uses a fresh IV each call (identical plaintext produces different ciphertext)", () => {
    const a = encrypt("same-input");
    const b = encrypt("same-input");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same-input");
    expect(decrypt(b)).toBe("same-input");
  });
});

describe("tampering rejection", () => {
  it("rejects ciphertext with a flipped bit (GCM auth tag catches it)", () => {
    const enc = encrypt("secret");
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 0x01;
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });

  it("rejects a truncated payload", () => {
    const enc = encrypt("secret");
    const truncated = enc.slice(0, 4);
    expect(() => decrypt(truncated)).toThrow();
  });

  it("rejects decryption with a different key", () => {
    const enc = encrypt("secret");
    process.env[ENCRYPTION_KEY_ENV] = generateEncryptionKey();
    expect(() => decrypt(enc)).toThrow();
  });
});

describe("configuration errors", () => {
  it("throws with a clear message when the key env var is missing", () => {
    delete process.env[ENCRYPTION_KEY_ENV];
    expect(() => encrypt("x")).toThrow(new RegExp(ENCRYPTION_KEY_ENV));
  });

  it("throws when the key decodes to the wrong length", () => {
    process.env[ENCRYPTION_KEY_ENV] = Buffer.from("too-short").toString("base64");
    expect(() => encrypt("x")).toThrow(/32 bytes/);
  });
});

describe("generateEncryptionKey", () => {
  it("produces a base64 string that decodes to exactly 32 bytes", () => {
    const b64 = generateEncryptionKey();
    expect(Buffer.from(b64, "base64").length).toBe(32);
  });

  it("produces different keys each call", () => {
    expect(generateEncryptionKey()).not.toBe(generateEncryptionKey());
  });
});
