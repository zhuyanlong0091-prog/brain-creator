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

  it("waits for test data preparation before binding the execution plan", () => {
    const fixture = suiteFixture();
    const run = fixture.service.create({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      cases: fixture.plans.map((plan) => ({
        executableCaseId: plan.executableCaseId,
        title: plan.title
      })),
      continueOnBlocked: false,
      allowCreateTestData: true
    });
    const started = fixture.service.beginNext(run.id);

    fixture.service.markWaitingForTestData(
      run.id,
      started.caseRun!.executableCaseId,
      {
        taskId: "test-data-task-1",
        phase: "prepare"
      }
    );
    const resumed = fixture.service.completeTestDataTask(
      run.id,
      started.caseRun!.executableCaseId
    );
    const bound = fixture.service.bindExecutionPlan(
      run.id,
      started.caseRun!.executableCaseId,
      fixture.plans[0].id
    );

    expect(resumed).toEqual(
      expect.objectContaining({
        status: "running",
        currentExecutableCaseId: "executable-case-1"
      })
    );
    expect(bound.caseRuns[0]).toEqual(
      expect.objectContaining({
        status: "running",
        executionPlanId: "execution-plan-1"
      })
    );
    expect(bound.allowCreateTestData).toBe(true);
  });

  it("holds a completed case until cleanup succeeds, then advances", () => {
    const fixture = suiteFixture();
    const run = fixture.service.create({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      executionPlans: fixture.plans.slice(0, 2),
      continueOnBlocked: false,
      allowCreateTestData: true
    });
    const started = fixture.service.beginNext(run.id);

    fixture.service.markWaitingForTestData(
      run.id,
      started.caseRun!.executableCaseId,
      {
        taskId: "cleanup-task-1",
        phase: "cleanup",
        pendingOutcome: {
          status: "passed",
          chainRunId: "chain-1",
          gapIds: []
        }
      }
    );
    const completed = fixture.service.completeTestDataTask(
      run.id,
      started.caseRun!.executableCaseId
    );

    expect(completed).toEqual(
      expect.objectContaining({
        status: "running",
        passed: 1,
        currentExecutableCaseId: undefined
      })
    );
    expect(completed.caseRuns[0]).toEqual(
      expect.objectContaining({
        status: "passed",
        chainRunId: "chain-1",
        testDataPhase: undefined,
        testDataTaskId: undefined
      })
    );
    const next = fixture.service.beginNext(run.id);
    expect(next.caseRun?.executableCaseId).toBe("executable-case-2");
  });

  it("retries a blocked test-data task on the same case", () => {
    const fixture = suiteFixture();
    const run = fixture.service.create({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      executionPlans: fixture.plans.slice(0, 2),
      continueOnBlocked: false,
      allowCreateTestData: true
    });
    const started = fixture.service.beginNext(run.id);
    fixture.service.markWaitingForTestData(
      run.id,
      started.caseRun!.executableCaseId,
      {
        taskId: "cleanup-task-1",
        phase: "cleanup",
        pendingOutcome: {
          status: "failed",
          chainRunId: "chain-1",
          bugReportId: "bug-1",
          gapIds: []
        }
      }
    );
    fixture.service.failTestDataTask(
      run.id,
      started.caseRun!.executableCaseId,
      {
        gapIds: ["gap-cleanup-1"],
        error: "Cleanup API unavailable"
      }
    );

    const resumed = fixture.service.resume(run.id, {
      continueOnBlocked: true
    });

    expect(resumed).toEqual(
      expect.objectContaining({
        status: "running",
        currentExecutableCaseId: "executable-case-1"
      })
    );
    expect(resumed.caseRuns[0]).toEqual(
      expect.objectContaining({
        status: "running",
        testDataPhase: "cleanup",
        testDataTaskId: undefined,
        pendingOutcome: expect.objectContaining({
          status: "failed",
          bugReportId: "bug-1"
        })
      })
    );
  });

  it("allows an explicit one-way upgrade to test-data creation", () => {
    const fixture = suiteFixture();
    const run = fixture.service.create({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      executionPlans: fixture.plans.slice(0, 1),
      continueOnBlocked: false
    });

    const authorized = fixture.service.authorizeTestDataCreation(run.id);
    const repeated = fixture.service.authorizeTestDataCreation(run.id);

    expect(authorized.allowCreateTestData).toBe(true);
    expect(repeated.id).toBe(run.id);
    expect(fixture.repository.requirementSuiteRuns).toHaveLength(1);
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
