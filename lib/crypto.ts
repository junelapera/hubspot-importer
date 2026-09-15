import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

export const ENCRYPTION_KEY_ENV = "PORTAL_TOKEN_ENCRYPTION_KEY";

function readKey(): Buffer {
  const b64 = process.env[ENCRYPTION_KEY_ENV];
  if (!b64) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} is not set. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== KEY_LEN) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} must decode to ${KEY_LEN} bytes (AES-256); got ${buf.length}`,
    );
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const key = readKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(payload: string): string {
  const key = readKey();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("encrypted payload too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function generateEncryptionKey(): string {
  return randomBytes(KEY_LEN).toString("base64");
}
