import type { ExecutionEvidence, ExecutionDiagnosis } from "../domain/types.js";
import type { ScenarioTrustRecord } from "../brain/types.js";
import { determineAssuranceLevel } from "./assurance.js";
import {
  updateScenarioTrust,
  type ScenarioTrustUpdate
} from "../brain/scenarioAssurance.js";

export type ScenarioExecutionTrustInput = {
  record: ScenarioTrustRecord;
  evidence: Pick<
    ExecutionEvidence,
    | "status"
    | "assuranceLevel"
    | "assertionContracts"
    | "reporterResult"
    | "evidenceWarnings"
    | "coverage"
    | "steps"
  >;
  observationMode: "observe" | "headless";
  requirementHash: string;
  systemSnapshotHash?: string;
  dataPlanHash?: string;
  diagnosis?: Pick<ExecutionDiagnosis, "verdict" | "failureType">;
  updatedAt?: string;
};

export type ScenarioExecutionTrustResult = {
  decision: "promoted" | "held" | "downgraded";
  assuranceLevel: ExecutionEvidence["assuranceLevel"];
  record: ScenarioTrustRecord;
  reasons: string[];
};

/**
 * Applies the evidence gate before the existing three-run trust counter.
 * A green test is not enough: the run also needs traceable, strong evidence.
 */
export function evaluateScenarioExecutionTrust(
  input: ScenarioExecutionTrustInput
): ScenarioExecutionTrustResult {
  // Never trust a caller-provided assurance label. The structured reporter is
  // the source of truth for whether assertions were actually observed.
  const assuranceLevel = input.evidence.reporterResult
    ? determineAssuranceLevel(
        input.evidence.assertionContracts ?? [],
        input.evidence.reporterResult
      )
    : "none";
  const reasons: string[] = [];
  const changed = input.record.lastRequirementHash !== input.requirementHash ||
    input.record.lastSystemSnapshotHash !== input.systemSnapshotHash ||
    input.record.lastDataPlanHash !== input.dataPlanHash;
  const resetRequired = changed && input.record.strongRunCount > 0;
  if (resetRequired) {
    reasons.push("Requirement, System Brain, or test data evidence changed.");
  }

  if (!["bound", "verified", "trusted"].includes(input.record.status)) {
    reasons.push("Scenario must be bound before execution evidence can promote trust.");
  }
  if (input.evidence.status !== "passed") reasons.push("The execution did not pass.");
  if (!input.evidence.reporterResult) {
    reasons.push("Structured Reporter evidence is required for trust promotion.");
  }
  if (assuranceLevel !== "strong") {
    reasons.push("The execution evidence is not strong enough for trust promotion.");
  }
  if (input.evidence.evidenceWarnings?.length) {
    reasons.push(...input.evidence.evidenceWarnings.map((warning) => `Evidence warning: ${warning}`));
  }
  if (input.evidence.coverage?.missing.length) {
    reasons.push(`Required coverage is missing: ${input.evidence.coverage.missing.join(", ")}.`);
  }
  if (!input.evidence.assertionContracts?.length) {
    reasons.push("No assertion contract was recorded for the run.");
  } else if (input.evidence.assertionContracts.some((contract) => contract.requirementRefs.length === 0)) {
    reasons.push("Every assertion contract must cite a requirement source.");
  }
  if (!input.evidence.steps.length) reasons.push("No step-level evidence was recorded.");
  if (input.evidence.steps.some((step) => step.sourceRefs.length === 0)) {
    reasons.push("Every executed step must retain a source reference.");
  }
  const reporterSteps = input.evidence.reporterResult?.steps;
  if (!reporterSteps?.length) {
    reasons.push("Structured Reporter step evidence is required for trust promotion.");
  } else if (input.evidence.steps.some((step) => !reporterSteps.some((reported) => reported.id === step.stepId))) {
    reasons.push("Structured Reporter evidence must cover every executed step.");
  }
  if (input.diagnosis && input.diagnosis.verdict !== "passed") {
    reasons.push(`Execution diagnosis is ${input.diagnosis.verdict}; it cannot promote trust.`);
  }

  // Headless output can be useful for regression, but it cannot establish the
  // first trust baseline without a visible observation run.
  const firstHeadlessRun = input.record.strongRunCount === 0 && input.observationMode !== "observe";
  if (firstHeadlessRun && reasons.length === 0) {
    return {
      decision: "held",
      assuranceLevel,
      record: input.record,
      reasons: ["A first trust run must be completed in observe mode."]
    };
  }
  if (firstHeadlessRun) {
    reasons.push("A first trust run must be completed in observe mode.");
  }

  const eligible = reasons.length === 0;
  const update: ScenarioTrustUpdate = {
    passed: eligible,
    strongEvidence: eligible,
    requirementHash: input.requirementHash,
    systemSnapshotHash: input.systemSnapshotHash,
    dataPlanHash: input.dataPlanHash,
    reason: reasons[0],
    updatedAt: input.updatedAt
  };
  const record = updateScenarioTrust(input.record, update);
  const decision = eligible && !resetRequired
    ? "promoted"
    : "downgraded";
  return { decision, assuranceLevel, record, reasons };
}
