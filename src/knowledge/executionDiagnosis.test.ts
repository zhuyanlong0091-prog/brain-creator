import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { ExecutionDiagnosisService } from "./executionDiagnosis.js";

describe("ExecutionDiagnosisService", () => {
  it("records a passed execution without a failure classification", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new ExecutionDiagnosisService(repository);

    const diagnosis = service.create({
      systemId: "system-a",
      testCaseId: "case-a",
      status: "passed",
      healAttempts: 0,
      maxHealAttempts: 2,
      evidenceRefs: ["evidence-a"]
    });

    expect(diagnosis.verdict).toBe("passed");
    expect(diagnosis.failureType).toBeUndefined();
    expect(diagnosis.reasons).toEqual(["Execution completed successfully"]);
  });

  it("allows a product bug only for a terminal expectation mismatch", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new ExecutionDiagnosisService(repository);

    const diagnosis = service.create({
      systemId: "system-a",
      testCaseId: "case-a",
      status: "failed",
      failureReason: "Expected status to be approved, actual status was pending",
      healAttempts: 2,
      maxHealAttempts: 2,
      evidenceRefs: ["evidence-a", "chain-a"]
    });

    expect(diagnosis.verdict).toBe("product_bug");
    expect(diagnosis.failureType).toBe("assertion_failure");
    expect(diagnosis.retry).toEqual({
      attempted: 2,
      max: 2,
      exhausted: true,
      eligible: false
    });
    expect(diagnosis.reasons).toEqual([
      "Expected and actual behavior still differ after controlled retries"
    ]);
  });

  it.each([
    ["SyntaxError in generated test", "automation_gap", "automation_failure"],
    ["locator element was not found", "automation_gap", "locator_failure"],
    ["required test data is unavailable", "test_data_gap", "test_data_failure"],
    ["login token is unauthorized", "auth_gap", "auth_failure"],
    ["HTTP 503 network failure", "network_gap", "network_failure"],
    [
      "process definition key is not configured",
      "environment_gap",
      "environment_failure"
    ]
  ] as const)(
    "classifies %s without creating a product bug",
    (failureReason, verdict, failureType) => {
      const repository = new InMemoryBrainCreatorRepository();
      const service = new ExecutionDiagnosisService(repository);

      const diagnosis = service.create({
        systemId: "system-a",
        testCaseId: "case-a",
        status: "blocked",
        failureReason,
        healAttempts: 1,
        maxHealAttempts: 1,
        evidenceRefs: []
      });

      expect(diagnosis.verdict).toBe(verdict);
      expect(diagnosis.failureType).toBe(failureType);
    }
  );

  it("reports remaining retry eligibility without performing another retry", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new ExecutionDiagnosisService(repository);

    const diagnosis = service.create({
      systemId: "system-a",
      testCaseId: "case-a",
      status: "blocked",
      failureReason: "locator element was not found",
      healAttempts: 0,
      maxHealAttempts: 2,
      evidenceRefs: []
    });

    expect(diagnosis.retry).toEqual({
      attempted: 0,
      max: 2,
      exhausted: false,
      eligible: true
    });
    expect(service.list({ systemId: "system-a" })).toEqual([diagnosis]);
    expect(service.summary({ systemId: "system-a" })).toEqual({
      total: 1,
      byVerdict: { automation_gap: 1 },
      byFailureType: { locator_failure: 1 },
      routing: {
        bugEligible: 0,
        gapRouted: 1,
        lowConfidence: 0,
        retriesExhausted: 0
      }
    });
  });

  it("links document provenance and the gated BugReport", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new ExecutionDiagnosisService(repository);
    const diagnosis = service.create({
      systemId: "system-a",
      caseSourceId: "source-a",
      caseSuiteId: "suite-a",
      caseNo: "TC-001",
      testCaseId: "case-a",
      status: "failed",
      failureReason: "Expected approved, actual pending",
      healAttempts: 1,
      maxHealAttempts: 1,
      evidenceRefs: ["chain-a"]
    });

    service.linkBugReport(diagnosis.id, "bug-a");

    expect(service.list({ caseSuiteId: "suite-a", caseNo: "TC-001" })).toEqual([
      expect.objectContaining({
        id: diagnosis.id,
        caseSourceId: "source-a",
        bugReportId: "bug-a"
      })
    ]);
  });
});
