// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parsePlaywrightJsonReport } from "./playwrightReporter.js";

describe("Playwright JSON reporter", () => {
  it("normalizes structured test results without parsing stdout", () => {
    const result = parsePlaywrightJsonReport({
      stats: { duration: 123, expected: 1, unexpected: 0, skipped: 0 },
      suites: [
        {
          title: "Orders",
          specs: [
            {
              id: "assert-1",
              title: "Order status is approved",
              tests: [{ results: [{ status: "passed", attachments: [{ name: "step-01.png", path: "evidence/step-01.png" }] }] }]
            }
          ]
        }
      ]
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "passed",
        total: 1,
        passed: 1,
        durationMs: 123,
        assertions: [expect.objectContaining({ id: "assert-1", evidenceRefs: ["evidence/step-01.png"] })]
      })
    );
  });

  it("classifies unexpected and skipped structured results", () => {
    expect(
      parsePlaywrightJsonReport({
        stats: { expected: 1, unexpected: 1, skipped: 0 },
        suites: [{ specs: [{ title: "failed", tests: [{ results: [{ status: "failed" }] }] }] }]
      }).status
    ).toBe("failed");
    expect(
      parsePlaywrightJsonReport({
        stats: { expected: 0, unexpected: 0, skipped: 1 },
        suites: [{ specs: [{ title: "blocked", tests: [{ results: [{ status: "skipped" }] }] }] }]
      }).status
    ).toBe("blocked");
  });
});
