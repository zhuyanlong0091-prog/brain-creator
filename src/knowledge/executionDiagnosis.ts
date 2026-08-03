import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutionDiagnosis,
  ExecutionDiagnosisReview,
  ExecutionDiagnosisVerdict,
  ExecutionFailureType,
  LegacyDiagnosisDecision,
  LegacyDiagnosisSuggestion
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
  suggestedDecision: LegacyDiagnosisSuggestion;
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
    const candidates = this.legacyCandidates(input.systemId);
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

  private legacyCandidates(systemId: string) {
    const diagnosedBugIds = new Set(
      this.repository.executionDiagnoses.flatMap((diagnosis) =>
        diagnosis.systemId === systemId && diagnosis.bugReportId
          ? [diagnosis.bugReportId]
          : []
      )
    );
    for (const bug of this.repository.bugReports) {
      if (bug.systemId === systemId && bug.diagnosisId) {
        diagnosedBugIds.add(bug.id);
      }
    }
    const diagnosedGapIds = new Set(
      this.repository.executionDiagnoses.flatMap((diagnosis) =>
        diagnosis.systemId === systemId ? diagnosis.gapIds : []
      )
    );
    const reviewedAssetKeys = new Set(
      this.repository.executionDiagnosisReviews
        .filter((review) => review.systemId === systemId)
        .map((review) => `${review.assetType}:${review.assetId}`)
    );
    return [
      ...this.repository.bugReports
        .filter(
          (bug) =>
            bug.systemId === systemId &&
            !diagnosedBugIds.has(bug.id) &&
            !reviewedAssetKeys.has(`bug:${bug.id}`)
        )
        .map((bug) => legacyBugCandidate(bug)),
      ...this.repository.gaps
        .filter(
          (gap) =>
            gap.projectId === systemId &&
            isExecutionGapSourceType(gap.sourceType) &&
            !diagnosedGapIds.has(gap.id) &&
            !reviewedAssetKeys.has(`gap:${gap.id}`)
        )
        .map((gap) => legacyGapCandidate(gap))
    ];
  }

  previewLegacyReview(input: {
    systemId: string;
    assetType: "bug" | "gap";
    assetId: string;
    decision: LegacyDiagnosisDecision;
    correctedFailureType?: ExecutionFailureType;
    correctedVerdict?: ExecutionDiagnosisVerdict;
  }) {
    const candidate = this.legacyCandidate(input);
    const conclusion = resolveLegacyReviewConclusion(candidate, input);
    return {
      candidate,
      decision: input.decision,
      conclusion,
      changes: legacyReviewChanges(candidate, conclusion),
      requiresConfirmation: true
    };
  }

  confirmLegacyReview(input: {
    systemId: string;
    assetType: "bug" | "gap";
    assetId: string;
    decision: LegacyDiagnosisDecision;
    correctedFailureType?: ExecutionFailureType;
    correctedVerdict?: ExecutionDiagnosisVerdict;
    note: string;
  }) {
    if (!input.note.trim()) {
      throw new Error("A human review note is required");
    }
    const preview = this.previewLegacyReview(input);
    const now = this.now();
    const review: ExecutionDiagnosisReview = {
      id: id("executionDiagnosisReview"),
      systemId: input.systemId,
      assetType: input.assetType,
      assetId: input.assetId,
      proposedFailureType: preview.candidate.failureType,
      proposedVerdict: preview.candidate.proposedVerdict,
      suggestedDecision: preview.candidate.suggestedDecision,
      decision: input.decision,
      confirmedFailureType: preview.conclusion?.failureType,
      confirmedVerdict: preview.conclusion?.verdict,
      matchesSuggestion: preview.conclusion?.matchesSuggestion,
      note: input.note.trim(),
      status: preview.conclusion ? "migrated" : "recorded",
      priorAssetStatus: preview.candidate.currentStatus,
      resultingAssetStatus: preview.candidate.currentStatus,
      createdAt: now
    };
    if (preview.conclusion) {
      const diagnosis: ExecutionDiagnosis = {
        id: id("executionDiagnosis"),
        systemId: input.systemId,
        bugReportId: input.assetType === "bug" ? input.assetId : undefined,
        gapIds: input.assetType === "gap" ? [input.assetId] : [],
        legacyReviewId: review.id,
        testCaseId: legacyTestCaseId(this.repository, preview.candidate),
        verdict: preview.conclusion.verdict,
        failureType: preview.conclusion.failureType,
        confidence: preview.conclusion.matchesSuggestion
          ? preview.candidate.confidence
          : "high",
        retry: {
          attempted: 0,
          max: 0,
          exhausted: true,
          eligible: false
        },
        reasons: ["Historical execution asset was explicitly reviewed by a user"],
        evidenceRefs: [input.assetId],
        createdAt: now
      };
      if (
        input.assetType === "bug" &&
        preview.conclusion.verdict !== "product_bug"
      ) {
        const bug = this.repository.bugReports.find(
          (item) => item.id === input.assetId && item.systemId === input.systemId
        );
        if (!bug) throw new Error("Historical BugReport not found");
        const gapId = id("gap");
        this.repository.gaps.push({
          id: gapId,
          projectId: input.systemId,
          sourceType: "diagnosis-migration",
          sourceId: bug.id,
          reason: `Historical Bug was explicitly reclassified as ${preview.conclusion.verdict}`,
          severity: "high",
          owner: "qa",
          status: "open",
          createdAt: now,
          updatedAt: now
        });
        bug.status = "closed";
        bug.updatedAt = now;
        bug.gapIds = uniqueStrings([...bug.gapIds, gapId]);
        diagnosis.gapIds = [gapId];
        review.createdGapId = gapId;
        review.resultingAssetStatus = "closed";
      }
      if (input.assetType === "bug") {
        const bug = this.repository.bugReports.find(
          (item) => item.id === input.assetId && item.systemId === input.systemId
        );
        if (!bug) throw new Error("Historical BugReport not found");
        bug.diagnosisId = diagnosis.id;
        bug.updatedAt = now;
      }
      this.repository.executionDiagnoses.push(diagnosis);
      review.diagnosisId = diagnosis.id;
    }
    this.repository.executionDiagnosisReviews.push(review);
    this.repository.persist();
    return {
      review,
      diagnosis: review.diagnosisId
        ? this.repository.executionDiagnoses.find(
            (item) => item.id === review.diagnosisId
          )
        : undefined,
      createdGap: review.createdGapId
        ? this.repository.gaps.find((item) => item.id === review.createdGapId)
        : undefined
    };
  }

  listLegacyReviews(systemId: string) {
    return this.repository.executionDiagnosisReviews.filter(
      (review) => review.systemId === systemId
    );
  }

  legacyReviewSummary(systemId: string) {
    const reviews = this.listLegacyReviews(systemId);
    const adjudicated = reviews.filter(
      (review) => review.confirmedVerdict !== undefined
    );
    const matched = adjudicated.filter(
      (review) => review.matchesSuggestion === true
    );
    return {
      total: reviews.length,
      byDecision: countBy(reviews.map((review) => review.decision)),
      migrated: reviews.filter((review) => review.status === "migrated").length,
      needsEvidence: reviews.filter(
        (review) => review.decision === "needs_evidence"
      ).length,
      quality: {
        adjudicated: adjudicated.length,
        matched: matched.length,
        corrected: adjudicated.length - matched.length,
        accuracy:
          adjudicated.length > 0 ? matched.length / adjudicated.length : null,
        byProposedFailureType: reviewQualityByFailureType(adjudicated)
      }
    };
  }

  private legacyCandidate(input: {
    systemId: string;
    assetType: "bug" | "gap";
    assetId: string;
  }) {
    const candidate = this.legacyCandidates(input.systemId).find(
      (item) =>
        item.assetType === input.assetType && item.assetId === input.assetId
    );
    if (!candidate) {
      throw new Error("Historical diagnosis candidate not found or already reviewed");
    }
    return candidate;
  }
}

function resolveLegacyReviewConclusion(
  candidate: LegacyDiagnosisCandidate,
  input: {
    decision: LegacyDiagnosisDecision;
    correctedFailureType?: ExecutionFailureType;
    correctedVerdict?: ExecutionDiagnosisVerdict;
  }
) {
  if (input.decision !== "override_classification") {
    if (input.correctedFailureType || input.correctedVerdict) {
      throw new Error("Corrected classification is only valid for an override");
    }
  }
  if (input.decision === "needs_evidence") return undefined;
  if (input.decision === "override_classification") {
    const failureType = input.correctedFailureType;
    const verdict = input.correctedVerdict;
    if (!failureType || !verdict) {
      throw new Error("Corrected failure type and verdict are required for an override");
    }
    if (failureType === "unknown_failure" || verdict === "unknown_gap") {
      throw new Error("Use needs_evidence instead of overriding to an unknown classification");
    }
    if (verdict !== confirmedVerdictForFailureType(failureType)) {
      throw new Error("Corrected failure type and verdict are inconsistent");
    }
    if (candidate.assetType === "gap" && verdict === "product_bug") {
      throw new Error("A historical Gap cannot be promoted to a product Bug without case evidence");
    }
    if (
      failureType === candidate.failureType &&
      verdict === candidate.proposedVerdict
    ) {
      throw new Error("Override must differ from the audited classification");
    }
    return { failureType, verdict, matchesSuggestion: false };
  }
  if (candidate.suggestedDecision !== input.decision) {
    throw new Error("Decision does not match the audited candidate recommendation");
  }
  return {
    failureType: candidate.failureType,
    verdict: candidate.proposedVerdict,
    matchesSuggestion: true
  };
}

function legacyReviewChanges(
  candidate: LegacyDiagnosisCandidate,
  conclusion:
    | {
        failureType: ExecutionFailureType;
        verdict: ExecutionDiagnosisVerdict;
        matchesSuggestion: boolean;
      }
    | undefined
) {
  if (!conclusion) {
    return ["record human review only", "leave BugReport and Gap unchanged"];
  }
  if (candidate.assetType === "bug" && conclusion.verdict !== "product_bug") {
    return ["close historical BugReport", "create typed Gap", "record diagnosis and review"];
  }
  return ["record diagnosis and review", "leave source asset status unchanged"];
}

function confirmedVerdictForFailureType(
  failureType: ExecutionFailureType
): ExecutionDiagnosisVerdict {
  if (failureType === "assertion_failure") return "product_bug";
  return verdictForFailureType(failureType);
}

function reviewQualityByFailureType(reviews: ExecutionDiagnosisReview[]) {
  return reviews.reduce<
    Record<string, { total: number; matched: number; corrected: number }>
  >((summary, review) => {
    const current = summary[review.proposedFailureType] ?? {
      total: 0,
      matched: 0,
      corrected: 0
    };
    current.total += 1;
    if (review.matchesSuggestion) current.matched += 1;
    else current.corrected += 1;
    summary[review.proposedFailureType] = current;
    return summary;
  }, {});
}

function legacyTestCaseId(
  repository: InMemoryBrainCreatorRepository,
  candidate: LegacyDiagnosisCandidate
) {
  if (candidate.assetType === "bug") {
    return repository.bugReports.find((item) => item.id === candidate.assetId)
      ?.caseNo ?? candidate.assetId;
  }
  return repository.gaps.find((item) => item.id === candidate.assetId)
    ?.sourceId ?? candidate.assetId;
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
