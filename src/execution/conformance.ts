import type { ConformanceResult } from "../brain/types.js";
import type { ExecutionDiagnosisVerdict, AssuranceLevel } from "../domain/types.js";

export type ConformanceEvaluationInput = {
  scenarioId: string;
  executionEvidenceId: string;
  status: "passed" | "failed" | "blocked";
  assuranceLevel?: AssuranceLevel;
  diagnosisVerdict?: ExecutionDiagnosisVerdict;
  expectationRefs: string[];
  observationRefs: string[];
  executionRefs: string[];
};

export function evaluateConformance(input: ConformanceEvaluationInput): ConformanceResult {
  const reasons: string[] = [];
  let verdict: ConformanceResult["verdict"];
  if (input.diagnosisVerdict === "product_bug") {
    verdict = "nonconform";
    reasons.push("The execution diagnosis confirmed a product defect.");
  } else if (input.status !== "passed") {
    verdict = "inconclusive";
    reasons.push("The execution did not complete successfully, so requirement conformance cannot be concluded.");
  } else if (input.assuranceLevel === "strong") {
    verdict = "conform";
    reasons.push("The execution passed with strong, traceable assertion evidence.");
  } else if (input.assuranceLevel === "limited") {
    verdict = "inconclusive";
    reasons.push("The execution passed, but its assertion evidence is limited.");
  } else {
    verdict = "requirement-review";
    reasons.push("The execution passed without an evidence-backed assertion oracle.");
  }
  return {
    id: `conformance:${input.executionEvidenceId}`,
    scenarioId: input.scenarioId,
    executionEvidenceId: input.executionEvidenceId,
    verdict,
    expectationRefs: unique(input.expectationRefs),
    observationRefs: unique(input.observationRefs),
    executionRefs: unique(input.executionRefs),
    reasons,
    createdAt: new Date().toISOString()
  };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
