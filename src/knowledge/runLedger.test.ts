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
});
