export type HarnessGoldenSample = {
  id: string;
  domain: "hr" | "order-approval" | "cross-role" | "multi-requirement" | "long-run";
  systemId: string;
  requirementSetIds: string[];
  roles: string[];
  caseCount: number;
  iterations: number;
  strongEvidenceRate: number;
  leakedSystemRefs: number;
  openDataLeases: number;
};

export const HARNESS_GOLDEN_SAMPLES: HarnessGoldenSample[] = [
  {
    id: "hr-recruiting-approval",
    domain: "hr",
    systemId: "golden-hr",
    requirementSetIds: ["hr-requirement-v1"],
    roles: ["recruiter", "manager"],
    caseCount: 12,
    iterations: 1,
    strongEvidenceRate: 1,
    leakedSystemRefs: 0,
    openDataLeases: 0
  },
  {
    id: "order-approval",
    domain: "order-approval",
    systemId: "golden-orders",
    requirementSetIds: ["orders-requirement-v1"],
    roles: ["buyer", "approver", "finance"],
    caseCount: 10,
    iterations: 1,
    strongEvidenceRate: 1,
    leakedSystemRefs: 0,
    openDataLeases: 0
  },
  {
    id: "cross-role-handoff",
    domain: "cross-role",
    systemId: "golden-cross-role",
    requirementSetIds: ["handoff-requirement-v1"],
    roles: ["requester", "reviewer"],
    caseCount: 8,
    iterations: 1,
    strongEvidenceRate: 1,
    leakedSystemRefs: 0,
    openDataLeases: 0
  },
  {
    id: "multi-requirement-reconciliation",
    domain: "multi-requirement",
    systemId: "golden-multi-requirement",
    requirementSetIds: ["requirements-v1", "requirements-v2", "requirements-v3"],
    roles: ["operator"],
    caseCount: 24,
    iterations: 1,
    strongEvidenceRate: 1,
    leakedSystemRefs: 0,
    openDataLeases: 0
  },
  {
    id: "long-run-stability",
    domain: "long-run",
    systemId: "golden-runner",
    requirementSetIds: ["runner-requirement-v1"],
    roles: ["operator"],
    caseCount: 6,
    iterations: 20,
    strongEvidenceRate: 1,
    leakedSystemRefs: 0,
    openDataLeases: 0
  }
];

export type HarnessGoldenEvaluation = {
  sampleId: string;
  passed: boolean;
  failures: string[];
};

export function evaluateHarnessGoldenSample(sample: HarnessGoldenSample): HarnessGoldenEvaluation {
  const failures: string[] = [];
  if (sample.requirementSetIds.length === 0) failures.push("No requirement baseline is bound");
  if (sample.roles.length === 0) failures.push("No execution role is declared");
  if (sample.caseCount <= 0) failures.push("No executable cases are declared");
  if (sample.domain === "long-run" && sample.iterations < 20) failures.push("Long-run sample requires 20 iterations");
  if (sample.strongEvidenceRate < 1) failures.push("Every golden run must have strong evidence");
  if (sample.leakedSystemRefs > 0) failures.push("Cross-system references were detected");
  if (sample.openDataLeases > 0) failures.push("Test data cleanup left active leases");
  return { sampleId: sample.id, passed: failures.length === 0, failures };
}

export function summarizeHarnessGoldenSamples(samples: HarnessGoldenSample[] = HARNESS_GOLDEN_SAMPLES) {
  const results = samples.map(evaluateHarnessGoldenSample);
  return {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    passRate: results.length === 0 ? 1 : results.filter((result) => result.passed).length / results.length,
    longRunIterations: Math.max(...samples.map((sample) => sample.iterations), 0),
    domains: [...new Set(samples.map((sample) => sample.domain))]
  };
}
