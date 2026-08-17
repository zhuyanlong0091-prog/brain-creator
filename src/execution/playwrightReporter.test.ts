// @vitest-environment node

import { describe, expect, it } from "vitest";
import { normalizeReporterExitCode, parsePlaywrightJsonReport } from "./playwrightReporter.js";

describe("Playwright JSON reporter", () => {
  it("does not treat a failed structured report as a successful process", () => {
    const reporter = parsePlaywrightJsonReport({
      stats: { expected: 1, unexpected: 1, skipped: 0 },
      suites: [{ specs: [{ title: "failed", tests: [{ results: [{ status: "failed" }] }] }] }]
    });

    expect(normalizeReporterExitCode(0, reporter)).toBe(1);
    expect(normalizeReporterExitCode(1, reporter)).toBe(1);
    expect(normalizeReporterExitCode(0, undefined)).toBe(0);
  });

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

  it("extracts Brain Creator step evidence from nested Playwright steps", () => {
    const result = parsePlaywrightJsonReport({
      stats: { expected: 1, unexpected: 0, skipped: 0 },
      suites: [{
        specs: [{
          title: "case",
          tests: [{ results: [{
            status: "passed",
            steps: [{
              title: "bc:step-create",
              duration: 18,
              attachments: [{ path: "evidence/step-create.png" }]
            }]
          }] }]
        }]
      }]
    });

    expect(result.steps).toEqual([
      expect.objectContaining({
        id: "step-create",
        title: "bc:step-create",
        status: "passed",
        durationMs: 18,
        evidenceRefs: ["evidence/step-create.png"]
      })
    ]);
  });

  it("joins step runtime attachments into console and network evidence", () => {
    const result = parsePlaywrightJsonReport({
      stats: { expected: 1, unexpected: 0, skipped: 0 },
      suites: [{
        specs: [{
          title: "case",
          tests: [{ results: [{
            status: "passed",
            attachments: [{
              name: "brain-creator-runtime-step-save",
              body: JSON.stringify({
                consoleErrors: ["TypeError: redacted"],
                networkFailures: ["GET https://example.test/api/records"]
              })
            }],
            steps: [{
              title: "bc:step-save",
              attachments: [{
                name: "brain-creator-runtime-step-save",
                body: JSON.stringify({
                  consoleErrors: ["TypeError: redacted"],
                  networkFailures: ["GET https://example.test/api/records"]
                })
              }]
            }]
          }] }]
        }]
      }]
    });

    expect(result.consoleErrors).toEqual(["TypeError: redacted"]);
    expect(result.networkFailures).toEqual(["GET https://example.test/api/records"]);
    expect(result.attachments).toContain("brain-creator-runtime-step-save");
    expect(result.steps?.[0]).toEqual(expect.objectContaining({
      consoleErrors: ["TypeError: redacted"],
      networkFailures: ["GET https://example.test/api/records"]
    }));
  });

  it("associates a trace attachment with the structured step that produced it", () => {
    const result = parsePlaywrightJsonReport({
      stats: { expected: 1, unexpected: 0, skipped: 0 },
      suites: [{
        specs: [{
          tests: [{ results: [{
            status: "passed",
            attachments: [{ name: "trace.zip", path: "artifacts/trace.zip" }],
            steps: [{ title: "bc:step-submit", attachments: [] }]
          }] }]
        }]
      }]
    });

    expect(result.steps?.[0]?.traceRefs).toEqual(["artifacts/trace.zip"]);
  });

  it("does not attribute one top-level trace to multiple semantic steps", () => {
    const result = parsePlaywrightJsonReport({
      stats: { expected: 1, unexpected: 0, skipped: 0 },
      suites: [{
        specs: [{
          tests: [{ results: [{
            status: "passed",
            attachments: [{ name: "trace.zip", path: "artifacts/trace.zip" }],
            steps: [
              { title: "bc:step-open", attachments: [] },
              { title: "bc:step-save", attachments: [] }
            ]
          }] }]
        }]
      }]
    });

    expect(result.steps?.map((step) => step.traceRefs)).toEqual([undefined, undefined]);
  });
});
