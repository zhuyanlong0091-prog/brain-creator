// @vitest-environment node

import { describe, expect, it } from "vitest";
import { evaluateConformance, type ConformanceEvaluationInput } from "./conformance.js";

function boundResult(): ConformanceEvaluationInput {
  return {
    scenarioId: "scenario-order", executionEvidenceId: "evidence-order", status: "passed", assuranceLevel: "strong",
    expectationRefs: ["requirement:approval"], observationRefs: ["actual.json"], executionRefs: ["evidence-order"],
    artifactValidation: { status: "valid", files: [{ path: "actual.json", sha256: "a".repeat(64) }], reasons: [] },
    contracts: [{ id: "approval", stepId: "verify", type: "state", strength: "strong", expected: "approved",
      requirementRefs: ["requirement:approval"], evidenceRequirements: ["actual-value"],
      oracle: { operator: "transition", previous: "pending", expected: "approved", applicable: true, applicabilityRefs: ["requirement:approval"] } }],
    reporter: { status: "passed", total: 1, passed: 1, failed: 0, skipped: 0, durationMs: 1,
      assertions: [{ id: "approval", stepId: "verify", status: "passed", actual: "approved", previousActual: "pending", evidenceRefs: ["actual.json"] }],
      attachments: [], consoleErrors: [], networkFailures: [] }
  };
}

describe("execution conformance", () => {
  it("evaluates the actual transition against the approved oracle", () => {
    const input = boundResult();
    expect(evaluateConformance(input).verdict).toBe("conform");
    input.reporter!.assertions[0].actual = "rejected";
    expect(evaluateConformance(input).verdict).toBe("nonconform");
    input.reporter!.assertions[0].previousActual = "draft";
    expect(evaluateConformance(input).verdict).toBe("context-mismatch");
  });

  it("rejects missing, duplicate or wrong-step assertion bindings", () => {
    const input = boundResult();
    input.reporter!.assertions[0].stepId = "unrelated";
    expect(evaluateConformance(input).verdict).toBe("inconclusive");
    input.reporter!.assertions[0].stepId = "verify";
    input.reporter!.assertions.push({ ...input.reporter!.assertions[0] });
    expect(evaluateConformance(input).verdict).toBe("inconclusive");
  });

  it("does not use missing artifacts or synthetic runs to establish conformance", () => {
    const input = boundResult();
    input.artifactValidation!.files = [];
    expect(evaluateConformance(input).verdict).toBe("inconclusive");
    const synthetic = boundResult();
    synthetic.provenance = "synthetic";
    expect(evaluateConformance(synthetic).verdict).toBe("inconclusive");
  });

  it("detects changed expectations independently of reporter pass status", () => {
    const input = boundResult();
    input.reporter!.assertions[0].expected = "rejected";
    expect(evaluateConformance(input).verdict).toBe("context-mismatch");
    input.reporter!.assertions[0].expected = "approved";
    input.contracts![0].expected = "rejected";
    expect(evaluateConformance(input).verdict).toBe("requirement-review");
  });
  it("requires a business oracle even when the caller says passed and strong", () => {
    expect(evaluateConformance({
      scenarioId: "scenario-order",
      executionEvidenceId: "evidence-1",
      status: "passed",
      assuranceLevel: "strong",
      expectationRefs: ["requirement:order-status"],
      observationRefs: ["evidence/assertion.png"],
      executionRefs: ["evidence-1"]
    })).toEqual(expect.objectContaining({ verdict: "requirement-review" }));
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

  it("does not turn a product bug label alone into a business conclusion", () => {
    expect(evaluateConformance({
      scenarioId: "scenario-order",
      executionEvidenceId: "evidence-3",
      status: "failed",
      assuranceLevel: "strong",
      diagnosisVerdict: "product_bug",
      expectationRefs: ["requirement:order-status"],
      observationRefs: ["evidence/assertion.png"],
      executionRefs: ["evidence-3"]
    })).toEqual(expect.objectContaining({ verdict: "inconclusive" }));
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
