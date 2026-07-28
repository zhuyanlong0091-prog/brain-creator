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
        totalSamples: 7,
        passedSamples: 7,
        passRate: 1,
        averageCoverageRate: 1,
        unsupportedClaimCount: 0
      })
    );
    expect(summary.domains).toEqual([
      "access-control",
      "commerce",
      "hr",
      "inventory",
      "order"
    ]);
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

  it("turns complex table rows into atomic clauses without treating headers as requirements", () => {
    const result = evaluateRequirementGoldenSample(
      REQUIREMENT_GOLDEN_SAMPLES.find(
        (sample) => sample.id === "commerce-discount-rule-table"
      )!
    );

    expect(result.analysis.clauses).toHaveLength(3);
    expect(result.analysis.clauses[0].text).toContain("Customer tier: Standard");
    expect(result.analysis.clauses.some((clause) => clause.text.includes("---"))).toBe(false);
  });

  it("keeps module ownership for cross-module workflow clauses", () => {
    const result = evaluateRequirementGoldenSample(
      REQUIREMENT_GOLDEN_SAMPLES.find(
        (sample) => sample.id === "recruiting-offer-cross-module-flow"
      )!
    );

    expect(new Set(result.analysis.clauses.map((clause) => clause.module))).toEqual(
      new Set(["Recruiting", "Offer"])
    );
    expect(result.design.testIntents.map((intent) => intent.module)).toEqual([
      "Recruiting",
      "Offer",
      "Recruiting"
    ]);
  });

  it("preserves actor and permission semantics for every permission matrix row", () => {
    const result = evaluateRequirementGoldenSample(
      REQUIREMENT_GOLDEN_SAMPLES.find(
        (sample) => sample.id === "account-permission-matrix"
      )!
    );

    expect(result.analysis.clauses).toHaveLength(3);
    expect(
      result.analysis.clauses.every(
        (clause) =>
          clause.nodeTypes.includes("actor") && clause.nodeTypes.includes("permission")
      )
    ).toBe(true);
  });
});
