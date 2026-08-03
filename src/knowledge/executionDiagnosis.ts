import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutionDiagnosis,
  ExecutionDiagnosisVerdict,
  ExecutionFailureType
} from "../domain/types.js";
import { id } from "../shared/id.js";
import { classifyExecutionFailure } from "./failureClassifier.js";

type CreateExecutionDiagnosisInput = {
  knowledgeProjectId?: string;
  systemId: string;
  requirementSuiteRunId?: string;
  executableCaseId?: string;
  caseSourceId?: string;
  caseSuiteId?: string;
  caseNo?: string;
  executionEvidenceId?: string;
  chainRunId?: string;
  testCaseId: string;
  status: "passed" | "failed" | "blocked";
  failureReason?: string;
  sourceType?: string;
  consoleErrors?: string[];
  networkFailures?: string[];
  healAttempts: number;
  maxHealAttempts: number;
  evidenceRefs: string[];
  gapIds?: string[];
};

type ExecutionDiagnosisFilter = {
  knowledgeProjectId?: string;
  systemId?: string;
  requirementSuiteRunId?: string;
  executableCaseId?: string;
  caseSourceId?: string;
  caseSuiteId?: string;
  caseNo?: string;
  testCaseId?: string;
  verdict?: ExecutionDiagnosisVerdict;
};

export type LegacyDiagnosisCandidate = {
  assetType: "bug" | "gap";
  assetId: string;
  systemId: string;
  sourceType: string;
  currentStatus: string;
  failureType: ExecutionFailureType;
  proposedVerdict: ExecutionDiagnosisVerdict;
  confidence: "high" | "medium" | "low";
  suggestedDecision:
    | "confirm_bug"
    | "review_bug_as_gap"
    | "confirm_gap"
    | "needs_evidence";
  reason: string;
};

export class ExecutionDiagnosisService {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  create(input: CreateExecutionDiagnosisInput): ExecutionDiagnosis {
    const attempted = Math.max(0, input.healAttempts);
    const max = Math.max(0, input.maxHealAttempts);
    const failureText = [
      input.failureReason,
      ...(input.consoleErrors ?? []),
      ...(input.networkFailures ?? [])
    ]
      .filter(Boolean)
      .join("\n");
    const failureType =
      input.status === "passed"
        ? undefined
        : classifyExecutionFailure(failureText, input.sourceType);
    const exhausted = attempted >= max;
    const verdict = resolveVerdict(input.status, failureType, exhausted);
    const diagnosis: ExecutionDiagnosis = {
      id: id("executionDiagnosis"),
      knowledgeProjectId: input.knowledgeProjectId,
      systemId: input.systemId,
      requirementSuiteRunId: input.requirementSuiteRunId,
      executableCaseId: input.executableCaseId,
      caseSourceId: input.caseSourceId,
      caseSuiteId: input.caseSuiteId,
      caseNo: input.caseNo,
      executionEvidenceId: input.executionEvidenceId,
      chainRunId: input.chainRunId,
      gapIds: uniqueStrings(input.gapIds ?? []),
      testCaseId: input.testCaseId,
      verdict,
      failureType,
      confidence: confidenceFor(verdict),
      retry: {
        attempted,
        max,
        exhausted,
        eligible: isRetryEligible(failureType) && !exhausted
      },
      reasons: [reasonFor(verdict)],
      evidenceRefs: [...new Set(input.evidenceRefs.filter(Boolean))],
      createdAt: this.now()
    };
    this.repository.executionDiagnoses.push(diagnosis);
    this.repository.persist();
    return diagnosis;
  }

  list(filter: ExecutionDiagnosisFilter = {}): ExecutionDiagnosis[] {
    return this.repository.executionDiagnoses.filter(
      (diagnosis) =>
        (!filter.knowledgeProjectId ||
          diagnosis.knowledgeProjectId === filter.knowledgeProjectId) &&
        (!filter.systemId || diagnosis.systemId === filter.systemId) &&
        (!filter.requirementSuiteRunId ||
          diagnosis.requirementSuiteRunId === filter.requirementSuiteRunId) &&
        (!filter.executableCaseId ||
          diagnosis.executableCaseId === filter.executableCaseId) &&
        (!filter.caseSourceId ||
          diagnosis.caseSourceId === filter.caseSourceId) &&
        (!filter.caseSuiteId ||
          diagnosis.caseSuiteId === filter.caseSuiteId) &&
        (!filter.caseNo || diagnosis.caseNo === filter.caseNo) &&
        (!filter.testCaseId || diagnosis.testCaseId === filter.testCaseId) &&
        (!filter.verdict || diagnosis.verdict === filter.verdict)
    );
  }

  summary(filter: ExecutionDiagnosisFilter = {}) {
    const diagnoses = this.list(filter);
    return {
      total: diagnoses.length,
      byVerdict: countBy(diagnoses.map((item) => item.verdict)),
      byFailureType: countBy(
        diagnoses.flatMap((item) =>
          item.failureType ? [item.failureType] : []
        )
      ),
      routing: {
        bugEligible: diagnoses.filter(
          (item) => item.verdict === "product_bug"
        ).length,
        gapRouted: diagnoses.filter(
          (item) =>
            item.verdict !== "passed" && item.verdict !== "product_bug"
        ).length,
        lowConfidence: diagnoses.filter(
          (item) => item.confidence === "low"
        ).length,
        retriesExhausted: diagnoses.filter(
          (item) => item.retry.exhausted
        ).length
      }
    };
  }

  linkBugReport(diagnosisId: string, bugReportId: string) {
    const diagnosis = this.repository.executionDiagnoses.find(
      (item) => item.id === diagnosisId
    );
    if (!diagnosis) throw new Error("Execution diagnosis not found");
    diagnosis.bugReportId = bugReportId;
    this.repository.persist();
    return diagnosis;
  }

  linkGaps(diagnosisId: string, gapIds: string[]) {
    const diagnosis = this.repository.executionDiagnoses.find(
      (item) => item.id === diagnosisId
    );
    if (!diagnosis) throw new Error("Execution diagnosis not found");
    diagnosis.gapIds = uniqueStrings([...diagnosis.gapIds, ...gapIds]);
    this.repository.persist();
    return diagnosis;
  }

  auditLegacy(input: { systemId: string; limit?: number }) {
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const diagnosedBugIds = new Set(
      this.repository.executionDiagnoses.flatMap((diagnosis) =>
        diagnosis.systemId === input.systemId && diagnosis.bugReportId
          ? [diagnosis.bugReportId]
          : []
      )
    );
    for (const bug of this.repository.bugReports) {
      if (bug.systemId === input.systemId && bug.diagnosisId) {
        diagnosedBugIds.add(bug.id);
      }
    }
    const diagnosedGapIds = new Set(
      this.repository.executionDiagnoses.flatMap((diagnosis) =>
        diagnosis.systemId === input.systemId ? diagnosis.gapIds : []
      )
    );
    const candidates: LegacyDiagnosisCandidate[] = [
      ...this.repository.bugReports
        .filter(
          (bug) =>
            bug.systemId === input.systemId && !diagnosedBugIds.has(bug.id)
        )
        .map((bug) => legacyBugCandidate(bug)),
      ...this.repository.gaps
        .filter(
          (gap) =>
            gap.projectId === input.systemId &&
            isExecutionGapSourceType(gap.sourceType) &&
            !diagnosedGapIds.has(gap.id)
        )
        .map((gap) => legacyGapCandidate(gap))
    ];
    const selected = candidates.slice(0, limit);
    return {
      summary: {
        totalCandidates: candidates.length,
        bugs: candidates.filter((item) => item.assetType === "bug").length,
        gaps: candidates.filter((item) => item.assetType === "gap").length,
        reviewBugAsGap: candidates.filter(
          (item) => item.suggestedDecision === "review_bug_as_gap"
        ).length,
        confirmBug: candidates.filter(
          (item) => item.suggestedDecision === "confirm_bug"
        ).length,
        confirmGap: candidates.filter(
          (item) => item.suggestedDecision === "confirm_gap"
        ).length,
        needsEvidence: candidates.filter(
          (item) => item.suggestedDecision === "needs_evidence"
        ).length,
        truncated: selected.length < candidates.length
      },
      candidates: selected
    };
  }
}

function legacyBugCandidate(
  bug: InMemoryBrainCreatorRepository["bugReports"][number]
): LegacyDiagnosisCandidate {
  const failureType = classifyExecutionFailure(bug.actualResult, "bug-report");
  if (failureType === "assertion_failure") {
    return {
      assetType: "bug",
      assetId: bug.id,
      systemId: bug.systemId,
      sourceType: "bug-report",
      currentStatus: bug.status,
      failureType,
      proposedVerdict: "product_bug",
      confidence: "medium",
      suggestedDecision: "confirm_bug",
      reason: "Historical Bug contains assertion-like evidence but lacks controlled retry diagnosis"
    };
  }
  const proposedVerdict = verdictForFailureType(failureType);
  if (proposedVerdict !== "unknown_gap") {
    return {
      assetType: "bug",
      assetId: bug.id,
      systemId: bug.systemId,
      sourceType: "bug-report",
      currentStatus: bug.status,
      failureType,
      proposedVerdict,
      confidence: failureType === "execution_failure" ? "medium" : "high",
      suggestedDecision: "review_bug_as_gap",
      reason: "Historical Bug contains technical failure evidence and requires human routing review"
    };
  }
  return {
    assetType: "bug",
    assetId: bug.id,
    systemId: bug.systemId,
    sourceType: "bug-report",
    currentStatus: bug.status,
    failureType,
    proposedVerdict,
    confidence: "low",
    suggestedDecision: "needs_evidence",
    reason: "Historical Bug does not contain enough evidence for reliable routing"
  };
}

function legacyGapCandidate(
  gap: InMemoryBrainCreatorRepository["gaps"][number]
): LegacyDiagnosisCandidate {
  const failureType = classifyExecutionFailure(gap.reason, gap.sourceType);
  const proposedVerdict = verdictForFailureType(failureType);
  if (
    failureType !== "assertion_failure" &&
    proposedVerdict !== "unknown_gap"
  ) {
    return {
      assetType: "gap",
      assetId: gap.id,
      systemId: gap.projectId,
      sourceType: gap.sourceType,
      currentStatus: gap.status,
      failureType,
      proposedVerdict,
      confidence: failureType === "execution_failure" ? "medium" : "high",
      suggestedDecision: "confirm_gap",
      reason: "Historical Gap contains technical failure evidence consistent with Gap routing"
    };
  }
  return {
    assetType: "gap",
    assetId: gap.id,
    systemId: gap.projectId,
    sourceType: gap.sourceType,
    currentStatus: gap.status,
    failureType,
    proposedVerdict: "unknown_gap",
    confidence: "low",
    suggestedDecision: "needs_evidence",
    reason:
      failureType === "assertion_failure"
        ? "Historical Gap contains assertion-like evidence but cannot be promoted without controlled retry diagnosis"
        : "Historical Gap does not contain enough evidence for more specific routing"
  };
}

function isExecutionGapSourceType(sourceType: string) {
  return /(?:agent|auth|case-source|chain|execution|generator|healer|preflight|regression|suite|test-data|xlsx)/i.test(
    sourceType
  );
}

function verdictForFailureType(
  failureType: ExecutionFailureType
): ExecutionDiagnosisVerdict {
  if (
    failureType === "automation_failure" ||
    failureType === "locator_failure"
  ) {
    return "automation_gap";
  }
  if (failureType === "test_data_failure") return "test_data_gap";
  if (failureType === "auth_failure") return "auth_gap";
  if (failureType === "environment_failure") return "environment_gap";
  if (failureType === "network_failure") return "network_gap";
  if (failureType === "execution_failure") return "execution_gap";
  return "unknown_gap";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function resolveVerdict(
  status: CreateExecutionDiagnosisInput["status"],
  failureType: ExecutionFailureType | undefined,
  retriesExhausted: boolean
): ExecutionDiagnosisVerdict {
  if (status === "passed") return "passed";
  if (failureType === "assertion_failure" && retriesExhausted) {
    return "product_bug";
  }
  if (
    failureType === "automation_failure" ||
    failureType === "locator_failure"
  ) {
    return "automation_gap";
  }
  if (failureType === "test_data_failure") return "test_data_gap";
  if (failureType === "auth_failure") return "auth_gap";
  if (failureType === "environment_failure") return "environment_gap";
  if (failureType === "network_failure") return "network_gap";
  if (failureType === "execution_failure") return "execution_gap";
  return "unknown_gap";
}

function isRetryEligible(failureType: ExecutionFailureType | undefined) {
  return (
    failureType === "automation_failure" ||
    failureType === "locator_failure" ||
    failureType === "execution_failure"
  );
}

function confidenceFor(
  verdict: ExecutionDiagnosisVerdict
): ExecutionDiagnosis["confidence"] {
  if (verdict === "unknown_gap") return "low";
  if (verdict === "execution_gap") return "medium";
  return "high";
}

function reasonFor(verdict: ExecutionDiagnosisVerdict) {
  const reasons: Record<ExecutionDiagnosisVerdict, string> = {
    passed: "Execution completed successfully",
    product_bug:
      "Expected and actual behavior still differ after controlled retries",
    automation_gap: "Generated automation or locator evidence is not reliable",
    test_data_gap: "Required test data is missing or invalid",
    auth_gap: "Authentication evidence prevents reliable execution",
    environment_gap: "Target environment configuration prevents execution",
    network_gap: "Network evidence prevents reliable execution",
    execution_gap: "Execution infrastructure did not complete reliably",
    unknown_gap: "Failure evidence is insufficient for a reliable conclusion"
  };
  return reasons[verdict];
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
