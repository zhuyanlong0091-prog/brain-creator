// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ExecutionEvidence } from "../domain/types.js";
import type { ScenarioTrustRecord } from "../brain/types.js";
import {
  evaluateScenarioExecutionTrust,
  type ScenarioExecutionTrustInput
} from "./trustPromotion.js";

describe("scenario execution trust promotion", () => {
  it("promotes the first strong observed run to verified", () => {
    const result = evaluateScenarioExecutionTrust(input());

    expect(result).toEqual(expect.objectContaining({
      decision: "promoted",
      assuranceLevel: "strong",
      record: expect.objectContaining({ status: "verified", strongRunCount: 1 })
    }));
  });

  it("does not promote a headless first run before observation evidence exists", () => {
    const result = evaluateScenarioExecutionTrust(input({ observationMode: "headless" }));

    expect(result).toEqual(expect.objectContaining({
      decision: "held",
      record: expect.objectContaining({ status: "bound", strongRunCount: 0 })
    }));
    expect(result.reasons).toContain("A first trust run must be completed in observe mode.");
  });

  it("quarantines a passed result when evidence warnings remain", () => {
    const result = evaluateScenarioExecutionTrust(input({
      evidence: { ...evidence(), evidenceWarnings: ["Missing trace artifact"] }
    }));

    expect(result).toEqual(expect.objectContaining({
      decision: "downgraded",
      record: expect.objectContaining({ status: "quarantined", strongRunCount: 0 })
    }));
  });

  it("ignores a caller-provided strong label without a structured reporter", () => {
    const result = evaluateScenarioExecutionTrust(input({
      evidence: { ...evidence(), reporterResult: undefined }
    }));

    expect(result).toEqual(expect.objectContaining({
      decision: "downgraded",
      assuranceLevel: "none",
      record: expect.objectContaining({ status: "quarantined", strongRunCount: 0 })
    }));
    expect(result.reasons).toContain("Structured Reporter evidence is required for trust promotion.");
  });

  it("downgrades a trusted scenario when a requirement hash changes", () => {
    const result = evaluateScenarioExecutionTrust(input({
      record: {
        ...record(),
        status: "trusted",
        strongRunCount: 3
      },
      requirementHash: "requirement-v2"
    }));

    expect(result).toEqual(expect.objectContaining({
      decision: "downgraded",
      record: expect.objectContaining({ status: "bound", strongRunCount: 0 })
    }));
    expect(result.reasons).toContain("Requirement, System Brain, or test data evidence changed.");
  });
});

function input(overrides: Partial<ScenarioExecutionTrustInput> = {}): ScenarioExecutionTrustInput {
  return {
    record: record(),
    evidence: evidence(),
    observationMode: "observe",
    requirementHash: "requirement-v1",
    systemSnapshotHash: "system-v1",
    dataPlanHash: "data-v1",
    ...overrides
  };
}

function record(): ScenarioTrustRecord {
  return {
    scenarioId: "scenario-1",
    status: "bound",
    strongRunCount: 0,
    lastRequirementHash: "requirement-v1",
    lastSystemSnapshotHash: "system-v1",
    lastDataPlanHash: "data-v1",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
}

function evidence(): Pick<ExecutionEvidence, "status" | "assuranceLevel" | "assertionContracts" | "reporterResult" | "evidenceWarnings" | "coverage" | "steps"> {
  return {
    status: "passed",
    assuranceLevel: "strong",
    assertionContracts: [{
      id: "assert-1",
      type: "workflow",
      strength: "strong",
      expected: "approved",
      requirementRefs: ["requirement:approval"],
      evidenceRequirements: ["actual-value", "screenshot", "trace"]
    }],
    reporterResult: {
      status: "passed",
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      durationMs: 10,
      assertions: [{
        id: "assert-1",
        status: "passed",
        actual: "approved",
        evidenceRefs: ["step-01.png", "trace.zip"]
      }],
      steps: [{
        id: "step-1",
        title: "Verify approval",
        status: "passed",
        evidenceRefs: ["step-01.png", "trace.zip"]
      }],
      attachments: ["trace.zip"],
      consoleErrors: [],
      networkFailures: []
    },
    steps: [{
      stepId: "step-1",
      order: 1,
      action: "assert",
      instruction: "Verify approval",
      expected: "approved",
      actual: "approved",
      assertionStatus: "passed",
      sourceRefs: ["requirement:approval"],
      origin: "source"
    }],
    evidenceWarnings: [],
    coverage: { required: ["workflow"], verified: ["workflow"], missing: [] }
  };
}
