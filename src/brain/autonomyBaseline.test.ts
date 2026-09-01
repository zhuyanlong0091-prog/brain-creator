import { describe, expect, it } from "vitest";
import { buildAutonomyBaselineReport } from "./autonomyBaseline.js";

describe("AutonomyBaselineReport", () => {
  it("measures deterministic scenario assurance foundations without claiming full autonomy", () => {
    const report = buildAutonomyBaselineReport({
      generatedAt: "2026-08-30T00:00:00.000Z",
      seed: "brain-creator-l3-baseline"
    });

    expect(report.schemaVersion).toBe(20);
    expect(report.generatedAt).toBe("2026-08-30T00:00:00.000Z");
    expect(report.seed).toBe("brain-creator-l3-baseline");
    expect(report.metrics.requirementGolden.total).toBeGreaterThan(1);
    expect(report.metrics.requirementGolden.rate).toBeGreaterThanOrEqual(0);
    expect(report.metrics.processModel.total).toBe(1);
    expect(report.metrics.requirementHostHarness).toEqual(expect.objectContaining({
      status: "measured",
      passed: 5,
      total: 5,
      rate: 1
    }));
    expect(report.metrics.scenarioDefectDetection).toEqual(expect.objectContaining({
      status: "measured",
      total: expect.any(Number),
      rate: expect.any(Number),
      threshold: 0.85
    }));
    expect(report.metrics.scenarioDefectDetection.rate).toBeGreaterThanOrEqual(0.85);
    expect(report.openCapabilityGaps).toEqual(expect.arrayContaining([
      expect.stringContaining("Historical Bug replay")
    ]));
  });
});
