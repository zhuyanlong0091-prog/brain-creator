import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecrets, encryptSecrets, migrateEncryptedSecrets, redactSecrets } from "./crypto.js";

describe("shared crypto helpers", () => {
  const originalKey = process.env.BRAIN_CREATOR_SECRET_KEY;

  beforeEach(() => {
    process.env.BRAIN_CREATOR_SECRET_KEY = "crypto-test-key";
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.BRAIN_CREATOR_SECRET_KEY;
    else process.env.BRAIN_CREATOR_SECRET_KEY = originalKey;
  });

  it("encrypts secrets and decrypts them back without exposing plain values", () => {
    const encrypted = encryptSecrets({ token: "private-token" });

    expect(encrypted.token).toMatch(/^enc:v2:/);
    expect(encrypted.token).not.toContain("private-token");
    expect(decryptSecrets(encrypted)).toEqual({ token: "private-token" });
  });

  it("migrates legacy v1 ciphertext to the random-key v2 format", () => {
    const legacy = { token: encryptLegacy("legacy-token") };
    const migrated = migrateEncryptedSecrets(legacy);

    expect(migrated.changed).toBe(true);
    expect(migrated.encryptedSecrets.token).toMatch(/^enc:v2:/);
    expect(decryptSecrets(migrated.encryptedSecrets)).toEqual({ token: "legacy-token" });
  });

  it("redacts secret values by key", () => {
    expect(redactSecrets({ token: "anything", cookie: "session=abc" })).toEqual({
      token: "[REDACTED]",
      cookie: "[REDACTED]"
    });
  });
});

function encryptLegacy(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(process.env.BRAIN_CREATOR_SECRET_KEY!).digest(),
    iv
  );
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "enc",
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}
