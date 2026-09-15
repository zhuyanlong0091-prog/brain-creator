import type { ConformanceResult } from "../brain/types.js";
import type { ExecutionDiagnosisVerdict, AssuranceLevel, AssertionContract, StructuredReporterResult, ExecutionEvidence } from "../domain/types.js";

export type ConformanceEvaluationInput = {
  scenarioId: string;
  executionEvidenceId: string;
  status: "passed" | "failed" | "blocked";
  assuranceLevel?: AssuranceLevel;
  diagnosisVerdict?: ExecutionDiagnosisVerdict;
  expectationRefs: string[];
  observationRefs: string[];
  executionRefs: string[];
  contracts?: AssertionContract[];
  reporter?: StructuredReporterResult;
  artifactValidation?: ExecutionEvidence["artifactValidation"];
  provenance?: ExecutionEvidence["provenance"];
};

export function evaluateConformance(input: ConformanceEvaluationInput): ConformanceResult {
  const reasons: string[] = [];
  let verdict: ConformanceResult["verdict"];
  if (input.provenance === "synthetic") {
    verdict = "inconclusive";
    reasons.push("Synthetic results do not establish real business conformance.");
  } else if (!input.contracts?.length || input.contracts.some((contract) => !contract.oracle || !contract.requirementRefs.length || !contract.oracle.applicabilityRefs.length)) {
    verdict = input.status === "passed" && input.assuranceLevel !== "limited" ? "requirement-review" : "inconclusive";
    reasons.push("A source-backed business oracle and applicability evidence are required.");
  } else if (input.status === "blocked" || input.artifactValidation?.status !== "valid" || !input.reporter) {
    verdict = "inconclusive";
    reasons.push("Validated execution artifacts and a structured reporter are required.");
  } else {
    const results = input.contracts.map((contract) => {
      const oracle = contract.oracle!;
      const assertions = input.reporter!.assertions.filter((item) => item.id === contract.id && item.stepId === contract.stepId);
      const actual = assertions[0];
      if (!contract.stepId || assertions.length !== 1 || !actual || actual.actual === undefined || !["passed", "failed"].includes(actual.status)) return "inconclusive";
      const files = new Set(input.artifactValidation!.files.map((file) => file.path));
      if (!actual.evidenceRefs.length || actual.evidenceRefs.some((ref) => !files.has(ref))) return "inconclusive";
      if (contract.expected !== undefined && contract.expected !== oracle.expected) return "requirement-review";
      if (actual.expected !== undefined && actual.expected !== oracle.expected) return "context-mismatch";
      if (!oracle.applicable) return "not-applicable";
      if ((oracle.operator === "transition" || oracle.operator === "changed") && (actual.previousActual === undefined || oracle.previous === undefined)) return "inconclusive";
      if (oracle.previous !== undefined && actual.previousActual !== oracle.previous) return "context-mismatch";
      if (oracle.operator === "visibility" && !["visible", "hidden"].includes(oracle.expected)) return "requirement-review";
      const matches = actual.actual === oracle.expected && (oracle.operator !== "changed" || actual.previousActual !== actual.actual);
      reasons.push(`${contract.id}: ${oracle.operator}; expected=${oracle.expected}; actual=${actual.actual}; sources=${contract.requirementRefs.join(",")}`);
      return matches ? "conform" : "nonconform";
    });
    verdict = results.includes("context-mismatch") ? "context-mismatch"
      : results.includes("requirement-review") ? "requirement-review"
      : results.includes("inconclusive") ? "inconclusive"
      : results.every((result) => result === "not-applicable") ? "not-applicable"
      : results.includes("nonconform") ? "nonconform"
      : input.status === "passed" && input.assuranceLevel === "strong" ? "conform" : "inconclusive";
    if (!reasons.length) reasons.push("The business oracle could not be evaluated against applicable, bound evidence.");
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
