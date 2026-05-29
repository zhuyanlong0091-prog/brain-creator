import { describe, expect, it } from "vitest";
import { decryptSecrets, encryptSecrets, redactSecrets } from "./crypto.js";

describe("shared crypto helpers", () => {
  it("encrypts secrets and decrypts them back without exposing plain values", () => {
    const encrypted = encryptSecrets({ token: "private-token" });

    expect(encrypted.token).toMatch(/^enc:v1:/);
    expect(encrypted.token).not.toContain("private-token");
    expect(decryptSecrets(encrypted)).toEqual({ token: "private-token" });
  });

  it("redacts secret values by key", () => {
    expect(redactSecrets({ token: "anything", cookie: "session=abc" })).toEqual({
      token: "[REDACTED]",
      cookie: "[REDACTED]"
    });
  });
});
