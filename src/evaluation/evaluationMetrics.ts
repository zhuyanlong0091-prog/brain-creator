import type {
  EvaluationTrial,
  BusinessScenario,
  InterventionRecord,
  ConformanceResult
} from "../brain/types.js";
import type {
  ExecutionEvidence,
  ExecutableCase,
  RequirementSuiteRun
} from "../domain/types.js";
import { evaluateConformance } from "../execution/conformance.js";

export type EvaluationMetricStatus = "measured" | "not-measured" | "not-comparable";

export type EvaluationScenarioMetric = {
  status: EvaluationMetricStatus;
  denominator: number | null;
  measured: number | null;
  passed: number | null;
  failed: number | null;
  blocked: number | null;
  notRun: number | null;
  syntheticOrUnknown: number | null;
  inconclusive: number | null;
  rate: number | null;
};

export type EvaluationTrialMetrics = {
  comparability: "comparable" | "not-comparable";
  comparabilityReasons: string[];
  linkedRunIds: string[];
  linkedRunCount: number;
  scenarioIds: string[];
  businessConformance: EvaluationScenarioMetric;
  autonomy: {
    status: "not-measured";
    interventions: InterventionRecord[];
    codeChanges: InterventionRecord[];
    reason: string;
  };
};

export function calculateEvaluationTrialMetrics(input: {
  trial: EvaluationTrial;
  runs: RequirementSuiteRun[];
  evidence: ExecutionEvidence[];
  conformanceResults: ConformanceResult[];
  scenarios: BusinessScenario[];
  executableCases: ExecutableCase[];
  interventions: InterventionRecord[];
}): EvaluationTrialMetrics {
  const scope = input.trial.executionScope;
  const scenarioIds = [...new Set(scope?.businessScenarioIds ?? [])];
  const comparableReasons: string[] = [];
  if (input.trial.status === "invalidated") comparableReasons.push("Evaluation trial is invalidated");
  if (!scope || scenarioIds.length === 0) comparableReasons.push("Evaluation trial has no frozen business scenario scope");
  if (!input.trial.requirementSetId) comparableReasons.push("Evaluation trial has no frozen source requirement set");
  if (scenarioIds.length > 0 && (!input.trial.runtimeBuildIdentity || input.trial.runtimeBuildIdentity === "unknown")) {
    comparableReasons.push("Evaluation trial has no known pinned runtime build identity");
  }
  if (!input.trial.systemId || !scope?.scopeHash || !scope.baselineHash) comparableReasons.push("Evaluation trial lacks a verifiable execution scope");
  if (scenarioIds.some((scenarioId) => !input.scenarios.some((scenario) => scenario.id === scenarioId))) {
    comparableReasons.push("Frozen business scenario scope contains an unknown scenario");
  }

  const linkedRuns = input.runs.filter((run) => isLinkedRun(run, input.trial));
  const metric = comparableReasons.length > 0
    ? notComparableMetric()
    : scenarioMetric(input.trial, scenarioIds, linkedRuns, input.evidence, input.conformanceResults, input.scenarios, input.executableCases);
  const interventions = input.interventions.filter((item) => item.trialId === input.trial.id);
  return {
    comparability: comparableReasons.length > 0 ? "not-comparable" : "comparable",
    comparabilityReasons: comparableReasons,
    linkedRunIds: linkedRuns.map((run) => run.id),
    linkedRunCount: linkedRuns.length,
    scenarioIds,
    businessConformance: metric,
    autonomy: {
      status: "not-measured",
      interventions,
      codeChanges: interventions.filter((item) => ["code-change", "product-source-change"].includes(item.category)),
      reason: "Autonomy is not measured without complete intervention capture."
    }
  };
}

function scenarioMetric(
  trial: EvaluationTrial,
  scenarioIds: string[],
  runs: RequirementSuiteRun[],
  evidence: ExecutionEvidence[],
  conformanceResults: ConformanceResult[],
  scenarios: BusinessScenario[],
  executableCases: ExecutableCase[]
): EvaluationScenarioMetric {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const conformanceByEvidenceId = new Map(
    conformanceResults.map((item) => [item.executionEvidenceId, item])
  );
  const outcomes = new Map<string, ScenarioOutcome>();
  for (const run of runs) {
    for (const caseRun of run.caseRuns) {
      const caseScenarioIds = scenariosForCase(caseRun.executableCaseId, scenarios, executableCases);
      if (caseScenarioIds.length === 0) continue;
      const mappingIsAmbiguous = caseScenarioIds.length !== 1 || caseScenarioIds.some((scenarioId) =>
        executableCases.filter((candidate) => candidate.systemId === run.systemId &&
          scenariosForCase(candidate.id, scenarios, executableCases).includes(scenarioId)).length !== 1);
      const records = [
        ...caseRun.attempts.map((attempt) => ({
          evidenceId: attempt.executionEvidenceId,
          status: attempt.status,
          at: attempt.completedAt ?? attempt.archivedAt
        })),
        { evidenceId: caseRun.executionEvidenceId, status: caseRun.status, at: caseRun.completedAt ?? run.updatedAt }
      ];
      for (const scenarioId of caseScenarioIds) {
        if (!scenarioIds.includes(scenarioId)) continue;
        for (const record of records) {
          const candidate = mappingIsAmbiguous
            ? { kind: "inconclusive" as const, at: record.at }
            : outcomeFor(trial, run, caseRun.executableCaseId, scenarioId, record, evidenceById, conformanceByEvidenceId, executableCases);
          if (!candidate) continue;
          const prior = outcomes.get(scenarioId);
          if (!prior || candidate.at >= prior.at) outcomes.set(scenarioId, candidate);
        }
        if (!outcomes.has(scenarioId) && caseRun.status === "blocked") {
          outcomes.set(scenarioId, { kind: "blocked", at: run.updatedAt });
        }
      }
    }
  }

  let measured = 0;
  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let notRun = 0;
  let syntheticOrUnknown = 0;
  let inconclusive = 0;
  for (const scenarioId of scenarioIds) {
    const outcome = outcomes.get(scenarioId);
    if (!outcome || outcome.kind === "not-run") {
      notRun += 1;
    } else if (outcome.kind === "blocked") {
      blocked += 1;
    } else if (outcome.kind === "synthetic-or-unknown") {
      syntheticOrUnknown += 1;
    } else if (outcome.kind === "inconclusive") {
      inconclusive += 1;
    } else {
      measured += 1;
      if (outcome.kind === "passed") passed += 1;
      else failed += 1;
    }
  }
  return {
    status: measured > 0 ? "measured" : "not-measured",
    denominator: scenarioIds.length,
    measured,
    passed,
    failed,
    blocked,
    notRun,
    syntheticOrUnknown,
    inconclusive,
    rate: measured > 0 ? passed / scenarioIds.length : null
  };
}

type ScenarioOutcome = {
  kind: "passed" | "failed" | "blocked" | "not-run" | "synthetic-or-unknown" | "inconclusive";
  at: string;
};

function outcomeFor(
  trial: EvaluationTrial,
  run: RequirementSuiteRun,
  executableCaseId: string,
  scenarioId: string,
  record: { evidenceId?: string; status: string; at: string },
  evidenceById: Map<string, ExecutionEvidence>,
  conformanceByEvidenceId: Map<string, ConformanceResult>,
  executableCases: ExecutableCase[]
): ScenarioOutcome | undefined {
  if (!record.evidenceId) {
    return record.status === "blocked"
      ? { kind: "blocked", at: record.at }
      : { kind: "not-run", at: record.at };
  }
  const evidence = evidenceById.get(record.evidenceId);
  const conformance = conformanceByEvidenceId.get(record.evidenceId);
  if (!evidence || !validEvidenceContext(evidence, trial, run, executableCaseId, executableCases)) {
    return { kind: "inconclusive", at: record.at };
  }
  if (["queued", "running", "waiting-for-test-data", "waiting-for-agent", "cancelled", "blocked"].includes(record.status) &&
      (!evidence.completedAt || evidence.completedAt < record.at)) {
    return { kind: record.status === "blocked" ? "blocked" : "not-run", at: record.at };
  }
  if (evidence.provenance !== "real-system") return { kind: "synthetic-or-unknown", at: record.at };
  if (evidence.status === "blocked") return { kind: "blocked", at: record.at };
  if (evidence.artifactValidation?.status !== "valid" || !conformance || conformance.scenarioId !== scenarioId) {
    return { kind: "inconclusive", at: record.at };
  }
  if (!evidence.completedAt || !evidence.reporterResult || !evidence.artifactValidation.files.length ||
      evidence.artifactValidation.files.some((file) => !/^[a-f0-9]{64}$/i.test(file.sha256)) ||
      !conformance.expectationRefs.length || !conformance.observationRefs.length || !conformance.executionRefs.length) {
    return { kind: "inconclusive", at: record.at };
  }
  const checked = evaluateConformance({
    scenarioId, executionEvidenceId: evidence.id,
    status: evidence.status === "running" ? "blocked" : evidence.status,
    assuranceLevel: evidence.assuranceLevel, contracts: evidence.assertionContracts,
    reporter: evidence.reporterResult, artifactValidation: evidence.artifactValidation,
    provenance: evidence.provenance, expectationRefs: conformance.expectationRefs,
    observationRefs: conformance.observationRefs, executionRefs: conformance.executionRefs
  });
  if (checked.verdict !== conformance.verdict) return { kind: "inconclusive", at: record.at };
  if (conformance.verdict === "conform" && evidence.status === "passed" && record.status === "passed") return { kind: "passed", at: record.at };
  if (conformance.verdict === "nonconform") return { kind: "failed", at: record.at };
  return { kind: "inconclusive", at: record.at };
}

function isLinkedRun(run: RequirementSuiteRun, trial: EvaluationTrial) {
  return run.evaluationTrialId === trial.id &&
    run.knowledgeProjectId === trial.knowledgeProjectId &&
    (!trial.systemId || run.systemId === trial.systemId) &&
    (!trial.requirementSetId || (run.requirementSetIds?.length === 1 && run.requirementSetIds[0] === trial.requirementSetId)) &&
    run.createdAt >= trial.createdAt &&
    (!trial.runtimeBuildIdentity || run.evaluationRuntimeBuildIdentity === trial.runtimeBuildIdentity) &&
    (!trial.requirementSetId || (run.evaluationSourceRevision === trial.sourceRevision && run.evaluationSourceHash === trial.sourceHash));
}

function validEvidenceContext(
  evidence: ExecutionEvidence,
  trial: EvaluationTrial,
  run: RequirementSuiteRun,
  executableCaseId: string,
  executableCases: ExecutableCase[]
) {
  const executableCase = executableCases.find((item) => item.id === executableCaseId);
  return evidence.knowledgeProjectId === trial.knowledgeProjectId &&
    evidence.systemId === run.systemId &&
    evidence.executableCaseId === executableCaseId &&
    Boolean(executableCase) &&
    executableCase!.knowledgeProjectId === trial.knowledgeProjectId &&
    (!trial.requirementSetId || executableCase!.requirementSetId === trial.requirementSetId) &&
    (!executableCase!.systemId || executableCase!.systemId === run.systemId) &&
    evidence.createdAt >= trial.createdAt &&
    evidence.createdAt >= run.createdAt &&
    (!run.completedAt || evidence.createdAt <= run.completedAt) &&
    (!evidence.completedAt || evidence.completedAt >= evidence.createdAt) &&
    (!run.completedAt || !evidence.completedAt || evidence.completedAt <= run.completedAt);
}

function scenariosForCase(
  executableCaseId: string,
  scenarios: BusinessScenario[],
  executableCases: ExecutableCase[]
) {
  const executableCase = executableCases.find((item) => item.id === executableCaseId);
  if (!executableCase) return [];
  return scenarios
    .filter((scenario) => scenario.knowledgeProjectId === executableCase.knowledgeProjectId &&
      scenario.requirementSetId === executableCase.requirementSetId &&
      (scenario.testIntentIds ?? []).includes(executableCase.testIntentId))
    .map((scenario) => scenario.id);
}

function notComparableMetric(): EvaluationScenarioMetric {
  return {
    status: "not-comparable",
    denominator: null,
    measured: null,
    passed: null,
    failed: null,
    blocked: null,
    notRun: null,
    syntheticOrUnknown: null,
    inconclusive: null,
    rate: null
  };
}
