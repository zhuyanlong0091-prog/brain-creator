// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  REQUIREMENT_GOLDEN_SAMPLES,
  evaluateRequirementGoldenSample,
  summarizeRequirementGoldenSamples
} from "./goldenSamples.js";

describe("Requirement Brain golden samples", () => {
  it("meets the quality contract across HR and non-HR domains", () => {
    const results = REQUIREMENT_GOLDEN_SAMPLES.map(evaluateRequirementGoldenSample);

    expect(results.map((result) => ({
      id: result.sample.id,
      passed: result.passed,
      failures: result.failures
    }))).toEqual(
      REQUIREMENT_GOLDEN_SAMPLES.map((sample) => ({
        id: sample.id,
        passed: true,
        failures: []
      }))
    );
  });

  it("reports a stable aggregate quality baseline", () => {
    const summary = summarizeRequirementGoldenSamples(
      REQUIREMENT_GOLDEN_SAMPLES.map(evaluateRequirementGoldenSample)
    );

    expect(summary).toEqual(
      expect.objectContaining({
        totalSamples: 4,
        passedSamples: 4,
        passRate: 1,
        averageCoverageRate: 1,
        unsupportedClaimCount: 0
      })
    );
    expect(summary.domains).toEqual(["hr", "inventory", "order"]);
  });

  it("keeps every generated intent bound to exactly one golden requirement clause", () => {
    for (const sample of REQUIREMENT_GOLDEN_SAMPLES) {
      const result = evaluateRequirementGoldenSample(sample);

      expect(result.design.testIntents).toHaveLength(result.analysis.clauses.length);
      expect(
        result.design.testIntents.every(
          (intent) =>
            intent.requirementRefs.length === 1 &&
            result.analysis.clauses.some(
              (clause) =>
                clause.sourceRef === intent.requirementRefs[0] &&
                clause.text === intent.objective
            )
        )
      ).toBe(true);
    }
  });
});
