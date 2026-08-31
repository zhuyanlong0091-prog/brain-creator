import {
  REQUIREMENT_GOLDEN_SAMPLES,
  evaluateProcessRequirementGoldenSample,
  evaluateRequirementGoldenSample
} from "../knowledge/goldenSamples.js";
import { requirementHostHarnessArchitecture } from "../knowledge/requirementHarness.js";

export type AutonomyBaselineMetric = {
  status: "measured" | "not-measured";
  passed: number;
  total: number;
  rate: number | null;
  notes: string[];
};

export type AutonomyBaselineReport = {
  schemaVersion: 20;
  generatedAt: string;
  seed: string;
  metrics: {
    requirementGolden: AutonomyBaselineMetric;
    processModel: AutonomyBaselineMetric;
    requirementHostHarness: AutonomyBaselineMetric;
    scenarioDefectDetection: AutonomyBaselineMetric;
  };
  openCapabilityGaps: string[];
};

export function buildAutonomyBaselineReport(input: {
  generatedAt?: string;
  seed?: string;
} = {}): AutonomyBaselineReport {
  const requirementResults = REQUIREMENT_GOLDEN_SAMPLES.map(evaluateRequirementGoldenSample);
  const process = evaluateProcessRequirementGoldenSample();
  const processPassed =
    process.coverageProfile.status === "complete" &&
    process.workflowModels.length > 0 &&
    process.stateMachineModels.length > 0 &&
    process.testIntents.some((intent) => intent.scenarioType === "negative") &&
    process.testIntents.some((intent) => (intent.actorJourney?.length ?? 0) > 1);
  const hostHarness = requirementHostHarnessArchitecture();
  const hostHarnessChecks = [
    hostHarness.stages.join(",") === "document-mapper,clause-analyst,business-modeler,coverage-critic",
    hostHarness.isolatedCritic,
    hostHarness.normalAgentCallBudget === 4,
    hostHarness.structuredRetryBudget === 1,
    hostHarness.contextCharBudget === 50_000
  ];

  return {
    schemaVersion: 20,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    seed: input.seed ?? "brain-creator-l3-baseline",
    metrics: {
      requirementGolden: measuredMetric(
        requirementResults.filter((result) => result.passed).length,
        requirementResults.length,
        ["Deterministic HR and non-HR requirement policy samples"]
      ),
      processModel: measuredMetric(processPassed ? 1 : 0, 1, [
        "Synthetic image-derived workflow and state-machine coverage"
      ]),
      requirementHostHarness: measuredMetric(
        hostHarnessChecks.filter(Boolean).length,
        hostHarnessChecks.length,
        [
          "Structural contract for four isolated Requirement Brain stages, one retry, and bounded context"
        ]
      ),
      scenarioDefectDetection: {
        status: "not-measured",
        passed: 0,
        total: 0,
        rate: null,
        notes: [
          "BusinessScenario, mutation detection, and historical bug replay are scheduled for Phase 5"
        ]
      }
    },
    openCapabilityGaps: [
      "BusinessScenario generation and assurance are not implemented in this baseline",
      "Mutation detection and historical bug replay are not measured in this baseline",
      "Requirement Host Harness structure is measured; semantic Critic quality still needs a larger real defect corpus",
      "Optional cross-provider evaluation is not measured yet"
    ]
  };
}

function measuredMetric(passed: number, total: number, notes: string[]): AutonomyBaselineMetric {
  return {
    status: "measured",
    passed,
    total,
    rate: total === 0 ? 0 : passed / total,
    notes
  };
}
