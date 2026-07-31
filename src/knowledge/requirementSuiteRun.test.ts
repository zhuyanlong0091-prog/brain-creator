// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { ExecutionPlan } from "../domain/types.js";
import { RequirementSuiteRunService } from "./requirementSuiteRun.js";

describe("RequirementSuiteRunService", () => {
  it("creates one idempotent run for the same unfinished plan set", () => {
    const fixture = suiteFixture();

    const first = fixture.service.create({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      executionPlans: fixture.plans,
      continueOnBlocked: false
    });
    const second = fixture.service.create({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      executionPlans: fixture.plans,
      continueOnBlocked: false
    });

    expect(second.id).toBe(first.id);
    expect(fixture.repository.requirementSuiteRuns).toHaveLength(1);
    expect(first.caseRuns.map((item) => item.executionPlanId)).toEqual([
      "execution-plan-1",
      "execution-plan-2",
      "execution-plan-3"
    ]);
  });

  it("runs one case at a time and continues after a business failure", () => {
    const fixture = suiteFixture();
    const run = fixture.service.create({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      executionPlans: fixture.plans,
      continueOnBlocked: false
    });

    const first = fixture.service.beginNext(run.id);
    const same = fixture.service.beginNext(run.id);
    fixture.service.markWaiting(run.id, first.caseRun!.executableCaseId, {
      testCaseId: "test-case-1",
      agentTaskId: "agent-task-1",
      executionEvidenceId: "evidence-1"
    });
    const afterFailure = fixture.service.completeCase(
      run.id,
      first.caseRun!.executableCaseId,
      {
        status: "failed",
        chainRunId: "chain-1",
        bugReportId: "bug-1",
        gapIds: []
      }
    );
    const second = fixture.service.beginNext(run.id);

    expect(same.caseRun?.executableCaseId).toBe(
      first.caseRun?.executableCaseId
    );
    expect(afterFailure.status).toBe("running");
    expect(second.caseRun?.executableCaseId).toBe("executable-case-2");
    expect(second.run.failed).toBe(1);
  });

  it("stops on a blocked case and resumes only with explicit continuation", () => {
    const fixture = suiteFixture();
    const run = fixture.service.create({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      executionPlans: fixture.plans,
      continueOnBlocked: false
    });
    const first = fixture.service.beginNext(run.id);
    const blocked = fixture.service.completeCase(
      run.id,
      first.caseRun!.executableCaseId,
      {
        status: "blocked",
        gapIds: ["gap-1"],
        error: "Authentication checkpoint is required."
      }
    );

    expect(blocked).toEqual(
      expect.objectContaining({
        status: "blocked",
        blocked: 1,
        currentExecutableCaseId: undefined
      })
    );
    expect(fixture.service.beginNext(run.id).caseRun).toBeUndefined();

    fixture.service.resume(run.id, { continueOnBlocked: true });
    const resumed = fixture.service.beginNext(run.id);
    expect(resumed.caseRun?.executableCaseId).toBe("executable-case-2");
  });

  it("finishes without repeating completed cases", () => {
    const fixture = suiteFixture();
    const run = fixture.service.create({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      executionPlans: fixture.plans.slice(0, 2),
      continueOnBlocked: false
    });

    for (const expectedId of ["executable-case-1", "executable-case-2"]) {
      const current = fixture.service.beginNext(run.id);
      expect(current.caseRun?.executableCaseId).toBe(expectedId);
      fixture.service.completeCase(run.id, expectedId, {
        status: "passed",
        chainRunId: `chain-${expectedId}`,
        gapIds: []
      });
    }
    const complete = fixture.service.beginNext(run.id);

    expect(complete.caseRun).toBeUndefined();
    expect(complete.run).toEqual(
      expect.objectContaining({
        status: "completed",
        total: 2,
        passed: 2,
        failed: 0,
        blocked: 0
      })
    );
  });
});

function suiteFixture() {
  const repository = new InMemoryBrainCreatorRepository();
  const service = new RequirementSuiteRunService(repository);
  return {
    repository,
    service,
    plans: [1, 2, 3].map(executionPlan)
  };
}

function executionPlan(index: number): ExecutionPlan {
  return {
    id: `execution-plan-${index}`,
    knowledgeProjectId: "knowledge-orders",
    requirementSetId: "requirement-orders",
    systemId: "system-orders",
    executableCaseId: `executable-case-${index}`,
    title: `Order scenario ${index}`,
    preconditions: [],
    steps: [],
    dataBindings: [],
    contextPack: {
      knowledgeProjectId: "knowledge-orders",
      purpose: "generator",
      query: `Order scenario ${index}`,
      content: "",
      references: [],
      truncated: false
    },
    checks: [],
    verdict: "ready",
    blockers: [],
    sourceRefs: [`requirement:orders-${index}`],
    snapshotHash: String(index).repeat(64),
    generatedAt: "2026-07-30T00:00:00.000Z",
    confirmedAt: "2026-07-30T00:00:00.000Z"
  };
}
