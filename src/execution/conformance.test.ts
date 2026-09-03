// @vitest-environment node

import { describe, expect, it } from "vitest";
import { evaluateConformance } from "./conformance.js";

describe("execution conformance", () => {
  it("reports conform only for a passed run with strong evidence", () => {
    expect(evaluateConformance({
      scenarioId: "scenario-order",
      executionEvidenceId: "evidence-1",
      status: "passed",
      assuranceLevel: "strong",
      expectationRefs: ["requirement:order-status"],
      observationRefs: ["evidence/assertion.png"],
      executionRefs: ["evidence-1"]
    })).toEqual(expect.objectContaining({ verdict: "conform" }));
  });

  it("does not turn a green limited run into a conformance claim", () => {
    expect(evaluateConformance({
      scenarioId: "scenario-order",
      executionEvidenceId: "evidence-2",
      status: "passed",
      assuranceLevel: "limited",
      expectationRefs: ["requirement:order-status"],
      observationRefs: [],
      executionRefs: ["evidence-2"]
    })).toEqual(expect.objectContaining({ verdict: "inconclusive" }));
  });

  it("reports a confirmed product defect as nonconform", () => {
    expect(evaluateConformance({
      scenarioId: "scenario-order",
      executionEvidenceId: "evidence-3",
      status: "failed",
      assuranceLevel: "strong",
      diagnosisVerdict: "product_bug",
      expectationRefs: ["requirement:order-status"],
      observationRefs: ["evidence/assertion.png"],
      executionRefs: ["evidence-3"]
    })).toEqual(expect.objectContaining({ verdict: "nonconform" }));
  });

  it("requires requirement review when the process passed without an oracle", () => {
    expect(evaluateConformance({
      scenarioId: "scenario-order",
      executionEvidenceId: "evidence-4",
      status: "passed",
      assuranceLevel: "none",
      expectationRefs: [],
      observationRefs: [],
      executionRefs: ["evidence-4"]
    })).toEqual(expect.objectContaining({ verdict: "requirement-review" }));
  });
});
