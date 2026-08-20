// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { encryptSecrets } from "../shared/crypto.js";
import { RunLedgerService } from "./runLedger.js";

describe("RunLedgerService", () => {
  it("isolates entries by knowledge project, system, and suite run", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const ledger = new RunLedgerService(repository);
    ledger.append({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-orders",
      event: "suite-created",
      scope: "suite",
      stage: "suite",
      toStatus: "running"
    });
    ledger.append({
      knowledgeProjectId: "knowledge-billing",
      systemId: "system-billing",
      requirementSuiteRunId: "suite-billing",
      event: "suite-created",
      scope: "suite",
      stage: "suite",
      toStatus: "running"
    });

    expect(
      ledger.list({
        knowledgeProjectId: "knowledge-orders",
        systemId: "system-orders",
        requirementSuiteRunId: "suite-orders"
      })
    ).toEqual([
      expect.objectContaining({
        knowledgeProjectId: "knowledge-orders",
        systemId: "system-orders",
        operator: "local-agent",
        provider: "unknown",
        traceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        requirementSuiteRunId: "suite-orders"
      })
    ]);
  });

  it("summarizes the current stage, outcomes, and failure classifications", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const times = [
      "2026-07-31T00:00:00.000Z",
      "2026-07-31T00:00:01.000Z",
      "2026-07-31T00:00:03.000Z"
    ];
    const ledger = new RunLedgerService(repository, () => times.shift()!);
    ledger.append({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-orders",
      event: "suite-created",
      scope: "suite",
      stage: "suite",
      toStatus: "running"
    });
    ledger.append({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-orders",
      executableCaseId: "case-1",
      event: "agent-task-requested",
      scope: "case",
      stage: "generator",
      fromStatus: "running",
      toStatus: "waiting-for-agent",
      references: { agentTaskId: "agent-task-1" }
    });
    ledger.append({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-orders",
      executableCaseId: "case-1",
      event: "case-completed",
      scope: "case",
      stage: "execution",
      fromStatus: "waiting-for-agent",
      toStatus: "blocked",
      outcome: "blocked",
      failureType: "locator_failure",
      message: "Target element was not found"
    });

    expect(ledger.summary("suite-orders")).toEqual(
      expect.objectContaining({
        requirementSuiteRunId: "suite-orders",
        currentStage: "execution",
        currentStatus: "blocked",
        currentExecutableCaseId: "case-1",
        eventCount: 3,
        recordedDurationMs: 3000,
        outcomes: { blocked: 1 },
        failures: { locator_failure: 1 }
      })
    );
  });

  it("records and summarizes a document suite without a knowledge project", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const ledger = new RunLedgerService(repository);
    ledger.append({
      runType: "document-suite",
      systemId: "system-orders",
      caseSuiteId: "document-suite-1",
      caseSourceId: "source-1",
      event: "suite-created",
      scope: "suite",
      stage: "suite",
      toStatus: "running"
    });
    ledger.append({
      runType: "document-suite",
      systemId: "system-orders",
      caseSuiteId: "document-suite-1",
      caseSourceId: "source-1",
      caseNo: "TC-001",
      event: "case-completed",
      scope: "case",
      stage: "execution",
      toStatus: "passed",
      outcome: "passed"
    });

    expect(
      ledger.list({
        runType: "document-suite",
        systemId: "system-orders",
        caseSuiteId: "document-suite-1"
      })
    ).toHaveLength(2);
    expect(ledger.summary("document-suite-1")).toEqual(
      expect.objectContaining({
        runType: "document-suite",
        runId: "document-suite-1",
        caseSuiteId: "document-suite-1",
        currentCaseNo: "TC-001",
        outcomes: { passed: 1 }
      })
    );
  });

  it("redacts protected values before writing ledger messages and steps", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.authProfiles.push({
      id: "auth-orders",
      projectId: "system-orders",
      env: "test",
      role: "qa",
      loginMethod: "token",
      encryptedSecrets: encryptSecrets({ token: "ledger-token-123" }),
      status: "succeeded",
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z"
    });
    const ledger = new RunLedgerService(repository);

    const entry = ledger.append({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-orders",
      event: "case-completed",
      scope: "case",
      stage: "execution",
      toStatus: "failed",
      currentStep: "submit token=ledger-token-123",
      message: "Observed ledger-token-123 in response"
    });

    expect(entry.currentStep).not.toContain("ledger-token-123");
    expect(entry.message).not.toContain("ledger-token-123");
    expect(repository.runLedgerEntries[0]).toEqual(entry);
  });

  it("projects ledger entries into ordered, redacted execution progress", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "suite-orders",
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      status: "waiting-for-agent",
      continueOnBlocked: false,
      allowCreateTestData: false,
      automaticTestData: false,
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
        gapIds: [],
        attempts: []
      }],
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:01.000Z"
    });
    const times = [
      "2026-08-19T00:00:00.000Z",
      "2026-08-19T00:00:01.000Z"
    ];
    const ledger = new RunLedgerService(
      repository,
      () => times.shift()!,
      () => Date.parse("2026-08-19T00:00:30.000Z")
    );
    ledger.append({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-orders",
      executableCaseId: "case-1",
      event: "case-started",
      scope: "case",
      stage: "suite",
      toStatus: "running"
    });
    ledger.appendProgress({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-orders",
      executableCaseId: "case-1",
      stage: "execution",
      status: "waiting",
      stepId: "step-1",
      stepTitle: "Wait for approval",
      pageUrl: "https://orders.example.test/approve?token=secret-value",
      waitReason: "Waiting for approver"
    });

    const progress = ledger.progress("suite-orders");
    expect(progress.events).toEqual([
      expect.objectContaining({ sequence: 1, status: "started", caseTitle: "Approve order" }),
      expect.objectContaining({
        sequence: 2,
        status: "waiting",
        stepId: "step-1",
        stepTitle: "Wait for approval",
        pageUrl: "https://orders.example.test/approve?token=%5BREDACTED%5D",
        waitReason: "Waiting for approver"
      })
    ]);
    expect(progress.current).toEqual(expect.objectContaining({ sequence: 2 }));
    expect(progress.possiblyStalled).toBe(false);
  });

  it("marks stale active progress but never terminal progress as stalled", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const ledger = new RunLedgerService(
      repository,
      () => "2026-08-19T00:00:00.000Z",
      () => Date.parse("2026-08-19T00:05:00.000Z")
    );
    ledger.appendProgress({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-running",
      stage: "execution",
      status: "running",
      stepTitle: "Submit order"
    });
    ledger.appendProgress({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      requirementSuiteRunId: "suite-complete",
      stage: "suite",
      status: "passed"
    });

    expect(ledger.progress("suite-running", { stalledAfterMs: 120_000 }).possiblyStalled).toBe(true);
    expect(ledger.progress("suite-complete", { stalledAfterMs: 120_000 }).possiblyStalled).toBe(false);
  });
});
