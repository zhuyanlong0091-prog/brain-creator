// @vitest-environment node

import { describe, expect, it } from "vitest";
import { assertNoSensitiveValues, scanSensitiveValues } from "./secretScan.js";

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
});
