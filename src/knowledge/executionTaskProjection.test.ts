import { describe, expect, it } from "vitest";
import type { CaseSuite, ExecutableCase, RequirementSuiteRun, TestDataTask } from "../domain/types.js";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { RunLedgerService } from "./runLedger.js";
import { projectExecutionTasks } from "./executionTaskProjection.js";

function suite(): RequirementSuiteRun {
  return {
    id: "suite-running",
    knowledgeProjectId: "project-orders",
    systemId: "system-orders",
    status: "waiting-for-test-data",
    continueOnBlocked: false,
    allowCreateTestData: true,
    total: 1,
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    currentExecutableCaseId: "case-create-order",
    caseRuns: [{
      executableCaseId: "case-create-order",
      title: "Create an order",
      order: 1,
      status: "waiting-for-test-data",
      testDataTaskId: "data-task-order",
      testDataPhase: "prepare",
      gapIds: [],
      attempts: []
    }],
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:02.000Z"
  };
}

function dataTask(): TestDataTask {
  return {
    id: "data-task-order",
    knowledgeProjectId: "project-orders",
    systemId: "system-orders",
    executableCaseId: "case-create-order",
    profileId: "profile-order",
    field: "order number",
    entityReference: "order:order-001",
    action: "lookup-or-create",
    status: "pending",
    idempotencyKey: "data-task-order-key",
    allowCreate: true,
    cleanup: "delete-created",
    contextPath: "context.json",
    promptPath: "prompt.md",
    sourceRefs: ["requirement:order"],
    outputSourceRefs: [],
    createdAt: "2026-09-14T00:00:01.000Z",
    updatedAt: "2026-09-14T00:00:02.000Z"
  };
}

describe("execution task projection", () => {
  it("projects a waiting suite and its data dependency as one recoverable task", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push(suite());
    repository.testDataTasks.push(dataTask());
    repository.executableCases.push({
      id: "case-create-order",
      knowledgeProjectId: "project-orders",
      requirementSetId: "requirement-orders",
      testIntentId: "intent-create-order",
      systemId: "system-orders",
      title: "Create an order",
      status: "ready",
      preconditions: [],
      steps: [],
      entityReferenceRequirements: ["order:order-001"],
      dataProfileIds: [],
      gapIds: [],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z"
    } satisfies ExecutableCase);

    const result = projectExecutionTasks(repository, {
      systemId: "system-orders",
      knowledgeProjectId: "project-orders"
    });

    expect(result.active).toEqual(expect.objectContaining({
      kind: "requirement-suite",
      sourceId: "suite-running",
      status: "waiting-for-test-data",
      currentCaseId: "case-create-order",
      currentCaseTitle: "Create an order",
      entityReferences: ["order:order-001"],
      waitReason: "Waiting for test data preparation",
      nextAction: "complete-test-data"
    }));
    expect(result.active?.relatedTaskIds).toContain("data-task-order");
    expect(result.tasks.map((task) => task.id)).toContain("suite-running");
  });

  it("surfaces a pending AgentTask as the actionable child without duplicating the suite", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const current = suite();
    current.status = "waiting-for-agent";
    current.caseRuns[0].status = "waiting-for-agent";
    current.caseRuns[0].testDataTaskId = undefined;
    current.caseRuns[0].testDataPhase = undefined;
    current.caseRuns[0].agentTaskId = "agent-task-order";
    repository.requirementSuiteRuns.push(current);
    repository.agentTasks.push({
      id: "agent-task-order",
      systemId: "system-orders",
      agent: "generator",
      status: "pending",
      inputSummary: "Generate the order test",
      args: [],
      outputPaths: [],
      promptPath: "prompt.md",
      contextPath: "context.json",
      chainContext: {
        testCaseId: "test-case-order",
        specPath: "spec.md",
        testPath: "order.spec.ts",
        requirementSuiteRunId: current.id,
        executableCaseId: "case-create-order",
        actorJourneyRoles: ["order operator"]
      },
      submitTool: "bc_submit_agent_output",
      createdAt: "2026-09-14T00:00:01.000Z",
      updatedAt: "2026-09-14T00:00:02.000Z"
    });

    const result = projectExecutionTasks(repository, { systemId: "system-orders" });

    expect(result.active).toEqual(expect.objectContaining({
      kind: "requirement-suite",
      status: "waiting-for-agent",
      nextAction: "submit-agent-output",
      roles: ["order operator"]
    }));
    expect(result.tasks.filter((task) => task.kind === "requirement-suite")).toHaveLength(1);
    expect(result.active?.relatedTaskIds).toContain("agent-task-order");
  });

  it("keeps a document suite visible in a knowledge-project scoped status", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.knowledgeProjects.push({
      id: "project-orders",
      key: "orders",
      name: "Orders",
      defaultLocale: "en-US",
      status: "active",
      systemIds: ["system-orders"],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z"
    });
    const documentSuite: CaseSuite = {
      id: "document-suite-orders",
      systemId: "system-orders",
      sourceId: "source-orders",
      status: "running",
      totalCases: 1,
      selectedCaseNos: ["TC-001"],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    };
    repository.caseSuites.push(documentSuite);

    const result = projectExecutionTasks(repository, {
      knowledgeProjectId: "project-orders"
    });

    expect(result.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: documentSuite.id,
        kind: "document-suite"
      })
    ]));
  });

  it("recovers a document suite from an active run even before the suite row is updated", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.caseSuites.push({
      id: "document-suite-recovery",
      systemId: "system-orders",
      sourceId: "source-orders",
      status: "approved",
      totalCases: 1,
      selectedCaseNos: ["TC-001"],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    });
    repository.caseSuiteRuns.push({
      id: "document-run-recovery",
      systemId: "system-orders",
      suiteId: "document-suite-recovery",
      sourceId: "source-orders",
      status: "running",
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      caseResults: [{
        caseNo: "TC-001",
        title: "Create an order",
        status: "waiting-for-agent",
        gapIds: []
      }],
      artifactPaths: [],
      bugReportIds: [],
      gapIds: [],
      createdAt: "2026-09-14T00:00:01.000Z"
    });

    const result = projectExecutionTasks(repository, { systemId: "system-orders" });

    expect(result.active).toEqual(expect.objectContaining({
      id: "document-suite-recovery",
      kind: "document-suite",
      currentCaseTitle: "Create an order"
    }));
  });

  it("does not attach a child from another project to the current requirement suite", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const current = suite();
    repository.requirementSuiteRuns.push(current);
    repository.agentTasks.push({
      id: "agent-task-other-project",
      systemId: current.systemId,
      agent: "generator",
      status: "pending",
      inputSummary: "Other project task",
      args: [],
      outputPaths: [],
      promptPath: "prompt.md",
      contextPath: "context.json",
      chainContext: {
        testCaseId: "test-case-other",
        specPath: "spec.md",
        testPath: "other.spec.ts",
        requirementSuiteRunId: current.id,
        knowledgeProjectId: "project-other"
      },
      submitTool: "bc_submit_agent_output",
      createdAt: "2026-09-14T00:00:01.000Z",
      updatedAt: "2026-09-14T00:00:02.000Z"
    });

    const result = projectExecutionTasks(repository, {
      systemId: current.systemId,
      knowledgeProjectId: current.knowledgeProjectId
    });

    expect(result.active?.relatedTaskIds).not.toContain("agent-task-other-project");
  });

  it("keeps a blocked suite on review instead of making a stale child actionable", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const current = suite();
    current.status = "blocked";
    repository.requirementSuiteRuns.push(current);
    repository.testDataTasks.push(dataTask());

    const result = projectExecutionTasks(repository, { systemId: current.systemId });

    expect(result.active).toEqual(expect.objectContaining({
      status: "blocked",
      nextAction: "review-and-resume"
    }));
  });

  it("uses a distinct action for an awaiting auth checkpoint", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const current = suite();
    current.status = "running";
    current.authProfileId = "auth-orders";
    repository.requirementSuiteRuns.push(current);
    repository.authCheckpoints.push({
      id: "checkpoint-orders",
      systemId: current.systemId,
      authProfileId: "auth-orders",
      reason: "Complete MFA",
      resumeInstruction: "Finish MFA in the visible browser",
      status: "awaiting-user",
      createdAt: "2026-09-14T00:00:01.000Z",
      updatedAt: "2026-09-14T00:00:02.000Z"
    });

    const result = projectExecutionTasks(repository, { systemId: current.systemId });

    expect(result.active).toEqual(expect.objectContaining({
      nextAction: "complete-auth-checkpoint",
      waitReason: "Complete MFA"
    }));
  });

  it("surfaces an uncertain write before any data or agent continuation", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const current = suite();
    current.status = "running";
    current.caseRuns[0].status = "running";
    current.caseRuns[0].testDataTaskId = undefined;
    current.caseRuns[0].testDataPhase = undefined;
    repository.requirementSuiteRuns.push(current);
    const ledger = new RunLedgerService(repository);
    ledger.recordAction({
      requirementSuiteRunId: current.id,
      systemId: current.systemId,
      executableCaseId: current.currentExecutableCaseId,
      stepId: "step-submit",
      actionKey: "plan-submit:step-submit",
      phase: "sent",
      actionSemantic: "Submit order",
      entityReference: "order:order-001",
      postcondition: "Order status is submitted"
    });

    const result = projectExecutionTasks(repository, { systemId: current.systemId });
    expect(result.active).toEqual(expect.objectContaining({
      status: "waiting",
      nextAction: "reconcile-action",
      waitReason: expect.stringContaining("postcondition"),
      pendingAction: expect.objectContaining({
        actionKey: "plan-submit:step-submit",
        phase: "sent"
      })
    }));
  });
});
