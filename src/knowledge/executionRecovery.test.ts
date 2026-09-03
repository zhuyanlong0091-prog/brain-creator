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
