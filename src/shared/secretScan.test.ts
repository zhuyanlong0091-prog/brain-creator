// @vitest-environment node

import { describe, expect, it } from "vitest";
import { assertNoSensitiveValues, scanSensitivePatterns, scanSensitiveValues } from "./secretScan.js";

describe("secret scan", () => {
  it("finds known credential values without returning their content", () => {
    expect(scanSensitiveValues("token=long-lived-token-123", { token: "long-lived-token-123" })).toEqual([
      { secretKey: "token", matchedLength: 20 }
    ]);
  });

  it("ignores short values to avoid treating ordinary labels as secrets", () => {
    expect(scanSensitiveValues("status=active", { status: "active" })).toEqual([]);
  });

  it("blocks an artifact while keeping the secret value out of the error", () => {
    expect(() =>
      assertNoSensitiveValues("cookie=session-secret-123", { cookie: "session-secret-123" }, "report.html")
    ).toThrow("Sensitive values detected in report.html: cookie");
    expect(() =>
      assertNoSensitiveValues("cookie=session-secret-123", { cookie: "session-secret-123" }, "report.html")
    ).not.toThrow("session-secret-123");
  });

  it("detects high-confidence credential patterns without exposing values", () => {
    expect(scanSensitivePatterns('Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234')).toEqual([
      { rule: "bearer-token", matchedLength: expect.any(Number) }
    ]);
    expect(scanSensitivePatterns('password: "do-not-export-this"')).toEqual([
      { rule: "sensitive-field-literal", matchedLength: expect.any(Number) }
    ]);
    expect(scanSensitivePatterns('token: "REDACTED"')).toEqual([]);
    expect(scanSensitivePatterns('const token = process.env.BRAIN_CREATOR_AUTH_TOKEN;')).toEqual([]);
  });
});
