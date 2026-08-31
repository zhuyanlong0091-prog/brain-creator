import { describe, expect, it } from "vitest";
import { buildAutonomyBaselineReport } from "./autonomyBaseline.js";

describe("AutonomyBaselineReport", () => {
  it("measures existing deterministic capabilities without claiming future scenario assurance", () => {
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
    expect(report.metrics.scenarioDefectDetection.status).toBe("not-measured");
    expect(report.metrics.scenarioDefectDetection.rate).toBeNull();
    expect(report.openCapabilityGaps).toEqual(expect.arrayContaining([
      expect.stringContaining("BusinessScenario"),
      expect.stringContaining("Mutation")
    ]));
  });
});
