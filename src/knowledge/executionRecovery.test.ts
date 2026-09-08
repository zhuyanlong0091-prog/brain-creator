import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { RunLedgerService } from "./runLedger.js";
import {
  classifyEvidenceFailure,
  recoverExecutionState
} from "./executionRecovery.js";

describe("execution recovery and failure classification", () => {
  it("recovers the current step and a human-readable next action from the ledger", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const ledger = new RunLedgerService(repository, () => "2026-08-27T00:00:01.000Z");
    ledger.append({
      runType: "requirement-suite",
      requirementSuiteRunId: "run-recovery",
      systemId: "system-orders",
      event: "suite-created",
      scope: "suite",
      stage: "suite",
      toStatus: "running"
    });
    ledger.appendProgress({
      runType: "requirement-suite",
      requirementSuiteRunId: "run-recovery",
      systemId: "system-orders",
      executableCaseId: "case-1",
      caseTitle: "Submit order",
      stage: "execution",
      status: "waiting",
      stepId: "step-approval",
      stepTitle: "Wait for approval",
      pageUrl: "https://orders.example.test/orders?id=secret",
      waitReason: "Waiting for approval role"
    });

    const recovered = recoverExecutionState(repository, "run-recovery");
    expect(recovered).toEqual(expect.objectContaining({
      runId: "run-recovery",
      currentCaseId: "case-1",
      currentStepId: "step-approval",
      status: "waiting",
      nextAction: "resume-after-checkpoint"
    }));
    expect(recovered.currentPageUrl).toBe("https://orders.example.test/orders?id=%5BREDACTED%5D");
  });

  it("prefers the persisted suite state when the ledger is behind it", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "run-completed",
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      status: "completed",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 1,
      passed: 1,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [{
        executableCaseId: "case-1",
        title: "Submit order",
        order: 1,
        status: "passed",
        gapIds: [],
        attempts: []
      }],
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:03.000Z",
      completedAt: "2026-08-27T00:00:03.000Z"
    });
    const ledger = new RunLedgerService(repository, () => "2026-08-27T00:00:01.000Z");
    ledger.append({
      runType: "requirement-suite",
      requirementSuiteRunId: "run-completed",
      systemId: "system-orders",
      event: "suite-created",
      scope: "suite",
      stage: "suite",
      toStatus: "running"
    });
    ledger.appendProgress({
      runType: "requirement-suite",
      requirementSuiteRunId: "run-completed",
      systemId: "system-orders",
      executableCaseId: "case-1",
      caseTitle: "Submit order",
      stage: "execution",
      status: "running",
      stepId: "step-submit",
      stepTitle: "Submit order"
    });

    const recovered = recoverExecutionState(repository, "run-completed");

    expect(recovered).toEqual(expect.objectContaining({
      status: "completed",
      nextAction: "review-result",
      recoverySource: "reconciled",
      consistency: "run-state-ahead"
    }));
    expect(recovered.currentCaseId).toBeUndefined();
    expect(recovered.currentStepId).toBeUndefined();
  });

  it("recovers an active requirement suite from persisted state even without a ledger", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "run-state-only",
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      status: "waiting-for-agent",
      currentExecutableCaseId: "case-1",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [{
        executableCaseId: "case-1",
        title: "Approve order",
        order: 1,
        status: "waiting-for-agent",
        agentTaskId: "task-1",
        gapIds: [],
        attempts: []
      }],
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:03.000Z"
    });

    const recovered = recoverExecutionState(repository, "run-state-only");

    expect(recovered).toEqual(expect.objectContaining({
      runId: "run-state-only",
      status: "waiting-for-agent",
      currentCaseId: "case-1",
      currentCaseTitle: "Approve order",
      recoverySource: "run-state-only",
      consistency: "run-state-only",
      nextAction: "resume-after-checkpoint"
    }));
  });

  it("resolves a document suite from its suite identity when no ledger exists", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.caseSuites.push({
      id: "document-suite",
      systemId: "system-orders",
      sourceId: "source-orders",
      status: "waiting-for-agent",
      totalCases: 1,
      selectedCaseNos: ["TC-001"],
      updatedAt: "2026-08-27T00:00:03.000Z",
      createdAt: "2026-08-27T00:00:00.000Z"
    });
    repository.caseSuiteRuns.push({
      id: "document-run-1",
      systemId: "system-orders",
      suiteId: "document-suite",
      sourceId: "source-orders",
      status: "running",
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      caseResults: [{
        caseNo: "TC-001",
        title: "Approve order",
        status: "waiting-for-agent",
        gapIds: []
      }],
      artifactPaths: [],
      bugReportIds: [],
      gapIds: [],
      createdAt: "2026-08-27T00:00:01.000Z"
    });

    const recovered = recoverExecutionState(repository, "document-suite");

    expect(recovered).toEqual(expect.objectContaining({
      status: "running",
      currentCaseId: "TC-001",
      currentCaseTitle: "Approve order",
      recoverySource: "run-state-only",
      consistency: "run-state-only",
      nextAction: "continue-run"
    }));
  });

  it("does not expose a stale ledger step when the persisted active case changed", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "run-reconciled",
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      status: "running",
      currentExecutableCaseId: "case-2",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 2,
      passed: 1,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [
        {
          executableCaseId: "case-1",
          title: "Create order",
          order: 1,
          status: "passed",
          gapIds: [],
          attempts: []
        },
        {
          executableCaseId: "case-2",
          title: "Approve order",
          order: 2,
          status: "running",
          gapIds: [],
          attempts: []
        }
      ],
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:03.000Z"
    });
    const ledger = new RunLedgerService(repository, () => "2026-08-27T00:00:01.000Z");
    ledger.append({
      runType: "requirement-suite",
      requirementSuiteRunId: "run-reconciled",
      systemId: "system-orders",
      event: "suite-created",
      scope: "suite",
      stage: "suite",
      toStatus: "running"
    });
    ledger.appendProgress({
      runType: "requirement-suite",
      requirementSuiteRunId: "run-reconciled",
      systemId: "system-orders",
      executableCaseId: "case-1",
      caseTitle: "Create order",
      stage: "execution",
      status: "running",
      stepId: "step-create",
      stepTitle: "Create order"
    });

    const recovered = recoverExecutionState(repository, "run-reconciled");

    expect(recovered).toEqual(expect.objectContaining({
      status: "running",
      currentCaseId: "case-2",
      currentCaseTitle: "Approve order",
      recoverySource: "reconciled",
      consistency: "reconciled",
      nextAction: "continue-run"
    }));
    expect(recovered.currentStepId).toBeUndefined();
  });

  it("classifies missing reporter, assertion, network, and automation failures", () => {
    expect(classifyEvidenceFailure({ stderr: "Structured Playwright Reporter output was missing" }).type)
      .toBe("execution_failure");
    expect(classifyEvidenceFailure({ reporter: {
      status: "failed", total: 1, passed: 0, failed: 1, skipped: 0, durationMs: 1,
      assertions: [{ id: "assert-1", status: "failed", evidenceRefs: [] }], attachments: [], consoleErrors: [], networkFailures: []
    }}).type).toBe("assertion_failure");
    expect(classifyEvidenceFailure({ reporter: {
      status: "failed", total: 1, passed: 0, failed: 1, skipped: 0, durationMs: 1,
      assertions: [], attachments: [], consoleErrors: [], networkFailures: ["ECONNRESET"]
    }}).type).toBe("network_failure");
    expect(classifyEvidenceFailure({ stderr: "TypeError: cannot read property from undefined" }).type)
      .toBe("automation_failure");
  });

  it("prefers explicit environment and automation diagnostics over a generic reporter assertion", () => {
    const reporter = {
      status: "failed" as const,
      total: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      durationMs: 1,
      assertions: [{ id: "assert-1", status: "failed" as const, evidenceRefs: [] }],
      attachments: [],
      consoleErrors: [],
      networkFailures: []
    };

    expect(classifyEvidenceFailure({
      stderr: "process definition key is not configured",
      reporter
    }).type).toBe("environment_failure");
    expect(classifyEvidenceFailure({
      stderr: "SyntaxError in generated test",
      reporter
    }).type).toBe("automation_failure");
  });

  it("prefers structured network evidence when text also contains a generic assertion", () => {
    expect(classifyEvidenceFailure({
      stderr: "Expected approval status, but actual value was unavailable",
      reporter: {
        status: "failed",
        total: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        durationMs: 1,
        assertions: [{ id: "assert-1", status: "failed", evidenceRefs: [] }],
        attachments: [],
        consoleErrors: [],
        networkFailures: ["GET /api/approval: ECONNRESET"]
      }
    })).toEqual(expect.objectContaining({ type: "network_failure" }));
  });

  it("classifies structured console errors as automation failures", () => {
    expect(classifyEvidenceFailure({
      reporter: {
        status: "failed",
        total: 1,
        passed: 0,
        failed: 0,
        skipped: 0,
        durationMs: 1,
        assertions: [],
        attachments: [],
        consoleErrors: ["TypeError: render failed"],
        networkFailures: []
      }
    })).toEqual(expect.objectContaining({ type: "automation_failure" }));
  });
});
