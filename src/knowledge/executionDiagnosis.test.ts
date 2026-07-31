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
    expect(diagnosis.gapIds).toEqual([]);
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
    service.linkGaps(diagnosis.id, ["gap-a", "gap-a", "gap-b"]);

    expect(service.list({ caseSuiteId: "suite-a", caseNo: "TC-001" })).toEqual([
      expect.objectContaining({
        id: diagnosis.id,
        caseSourceId: "source-a",
        bugReportId: "bug-a",
        gapIds: ["gap-a", "gap-b"]
      })
    ]);
  });

  it("audits only unlinked historical Bugs and Gaps without exposing raw evidence", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new ExecutionDiagnosisService(repository);
    repository.bugReports.push(
      legacyBug("bug-assertion", "Expected approved, actual pending"),
      legacyBug("bug-syntax", "SyntaxError in generated test"),
      { ...legacyBug("bug-linked", "Expected active, actual inactive"), diagnosisId: "diagnosis-linked" }
    );
    repository.gaps.push(
      legacyGap("gap-env", "process definition key is not configured"),
      legacyGap("gap-assertion", "Expected visible, actual hidden"),
      legacyGap("gap-linked", "locator element was not found"),
      {
        ...legacyGap("gap-requirement", "Requirement branch is unclear"),
        sourceType: "requirement-clarification"
      }
    );
    repository.executionDiagnoses.push({
      id: "diagnosis-linked",
      systemId: "system-a",
      testCaseId: "case-linked",
      verdict: "automation_gap",
      failureType: "locator_failure",
      confidence: "high",
      retry: { attempted: 1, max: 1, exhausted: true, eligible: false },
      reasons: ["Generated automation or locator evidence is not reliable"],
      evidenceRefs: [],
      gapIds: ["gap-linked"],
      createdAt: "2026-07-31T00:00:00.000Z"
    });

    const audit = service.auditLegacy({ systemId: "system-a" });

    expect(audit.summary).toEqual({
      totalCandidates: 4,
      bugs: 2,
      gaps: 2,
      reviewBugAsGap: 1,
      confirmBug: 1,
      confirmGap: 1,
      needsEvidence: 1,
      truncated: false
    });
    expect(audit.candidates).toEqual([
      expect.objectContaining({
        assetId: "bug-assertion",
        proposedVerdict: "product_bug",
        confidence: "medium",
        suggestedDecision: "confirm_bug"
      }),
      expect.objectContaining({
        assetId: "bug-syntax",
        proposedVerdict: "automation_gap",
        confidence: "high",
        suggestedDecision: "review_bug_as_gap"
      }),
      expect.objectContaining({
        assetId: "gap-env",
        proposedVerdict: "environment_gap",
        suggestedDecision: "confirm_gap"
      }),
      expect.objectContaining({
        assetId: "gap-assertion",
        proposedVerdict: "unknown_gap",
        suggestedDecision: "needs_evidence"
      })
    ]);
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain("SyntaxError in generated test");
    expect(serialized).not.toContain("process definition key is not configured");
  });

  it("bounds historical audit candidates and reports truncation", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new ExecutionDiagnosisService(repository);
    repository.gaps.push(
      legacyGap("gap-1", "network timeout"),
      legacyGap("gap-2", "network timeout")
    );

    const audit = service.auditLegacy({ systemId: "system-a", limit: 1 });

    expect(audit.summary.totalCandidates).toBe(2);
    expect(audit.summary.truncated).toBe(true);
    expect(audit.candidates).toHaveLength(1);
  });
});

function legacyBug(id: string, actualResult: string) {
  return {
    id,
    systemId: "system-a",
    sourceId: "source-a",
    caseNo: id,
    caseTitle: id,
    module: "module-a",
    priority: "P1",
    expectedResult: "expected",
    actualResult,
    reproductionSteps: [],
    evidencePaths: [],
    gapIds: [],
    status: "open" as const,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z"
  };
}

function legacyGap(id: string, reason: string) {
  return {
    id,
    projectId: "system-a",
    sourceType: "legacy-execution",
    sourceId: id,
    reason,
    severity: "high" as const,
    owner: "qa",
    status: "open" as const,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z"
  };
}
