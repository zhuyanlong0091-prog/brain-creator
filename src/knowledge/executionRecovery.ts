import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutionFailureType,
  ExecutionProgressEvent,
  StructuredReporterResult
} from "../domain/types.js";
import { classifyExecutionFailure } from "./failureClassifier.js";
import { RunLedgerService } from "./runLedger.js";

export type RecoveredExecutionState = {
  runId: string;
  status: string;
  currentCaseId?: string;
  currentCaseTitle?: string;
  currentStepId?: string;
  currentStepTitle?: string;
  currentPageUrl?: string;
  waitReason?: string;
  lastSequence?: number;
  updatedAt: string;
  possiblyStalled: boolean;
  recoverySource: "run-state" | "ledger" | "reconciled" | "run-state-only" | "ledger-only";
  consistency:
    | "consistent"
    | "run-state-ahead"
    | "ledger-ahead"
    | "reconciled"
    | "run-state-only"
    | "ledger-only";
  nextAction: "resume-after-checkpoint" | "inspect-failure" | "continue-run" | "review-result";
};

export function recoverExecutionState(
  repository: InMemoryBrainCreatorRepository,
  runId: string,
  nowMs = Date.now()
): RecoveredExecutionState {
  const ledger = new RunLedgerService(repository, undefined, () => nowMs);
  const ledgerEntries = repository.runLedgerEntries.filter(
    (entry) => entry.requirementSuiteRunId === runId || entry.caseSuiteId === runId
  );
  const summary = ledgerEntries.length > 0 ? ledger.summary(runId) : undefined;
  const progress = ledgerEntries.length > 0 ? ledger.progress(runId) : undefined;
  const ledgerCurrent = progress?.current;
  const requirementRun = repository.requirementSuiteRuns.find((run) => run.id === runId);
  const documentSuite = repository.caseSuites.find((suite) => suite.id === runId);
  const documentRun = repository.caseSuiteRuns.find((run) => run.id === runId) ??
    repository.caseSuiteRuns
      .filter((run) => run.suiteId === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .at(-1);
  const persistedRun = requirementRun ?? documentRun ?? documentSuite;
  const persistedStatus = requirementRun?.status ?? documentRun?.status ?? documentSuite?.status;
  const status = recoveryStatus(persistedStatus, summary?.currentStatus, ledgerCurrent?.status);
  const persistedRequirementCase = requirementRun
    ? requirementRun.caseRuns.find(
        (caseRun) => caseRun.executableCaseId === requirementRun.currentExecutableCaseId
      )
    : undefined;
  const persistedDocumentCase = documentRun?.caseResults.find(
    (caseResult) => caseResult.status === "waiting-for-agent"
  );
  const persistedCase = persistedRequirementCase ?? persistedDocumentCase;
  const persistedCaseId = requirementRun
    ? requirementRun.currentExecutableCaseId
    : persistedDocumentCase?.caseNo;
  const terminalLedgerCase =
    !persistedCaseId &&
    (status === "blocked" || status === "failed") &&
    (ledgerCurrent?.status === "blocked" || ledgerCurrent?.status === "failed")
      ? ledgerCurrent.caseId
      : undefined;
  const canUseLedgerCurrent =
    !persistedRun ||
    Boolean(persistedCaseId) ||
    isActiveRunStatus(status);
  const currentCaseId = persistedCaseId ?? terminalLedgerCase ??
    (canUseLedgerCurrent ? ledgerCurrent?.caseId : undefined);
  const matchingLedgerProgress = ledgerCurrent && ledgerCurrent.caseId === currentCaseId
    ? ledgerCurrent
    : undefined;
  const statusMismatch = Boolean(
    persistedStatus && summary && persistedStatus !== summary.currentStatus
  );
  const caseMismatch = Boolean(
    persistedCaseId && ledgerCurrent?.caseId && persistedCaseId !== ledgerCurrent.caseId
  );
  const consistency = !persistedRun
    ? "ledger-only"
    : !summary
      ? "run-state-only"
      : statusMismatch
        ? statusAhead(persistedStatus!, summary.currentStatus)
        : caseMismatch
          ? "reconciled"
          : "consistent";
  const recoverySource = !persistedRun
    ? "ledger"
    : !summary
      ? "run-state-only"
      : statusMismatch || caseMismatch
        ? "reconciled"
        : "run-state";
  const persistedUpdatedAt = requirementRun?.updatedAt ??
    documentRun?.completedAt ??
    documentRun?.createdAt ??
    documentSuite?.updatedAt;
  const updatedAt = persistedUpdatedAt ?? summary?.updatedAt ?? ledgerCurrent?.createdAt;
  if (!updatedAt) throw new Error("Run recovery has no persisted timestamp");
  return {
    runId,
    status,
    currentCaseId,
    currentCaseTitle: persistedCase?.title ?? matchingLedgerProgress?.caseTitle,
    currentStepId: matchingLedgerProgress?.stepId,
    currentStepTitle: matchingLedgerProgress?.stepTitle,
    currentPageUrl: matchingLedgerProgress?.pageUrl,
    waitReason: matchingLedgerProgress?.waitReason,
    lastSequence: matchingLedgerProgress?.sequence ?? ledgerEntries.at(-1)?.sequence,
    updatedAt,
    possiblyStalled: Boolean(
      progress?.possiblyStalled &&
      isActiveRunStatus(status)
    ),
    recoverySource,
    consistency,
    nextAction: status.startsWith("waiting")
      ? "resume-after-checkpoint"
      : status === "failed"
        ? "inspect-failure"
        : status === "running"
          ? "continue-run"
          : "review-result"
  };
}

function isActiveRunStatus(status: string) {
  return status === "running" || status.startsWith("waiting");
}

function recoveryStatus(
  persistedStatus: string | undefined,
  ledgerStatus: string | undefined,
  progressStatus: ExecutionProgressEvent["status"] | undefined
) {
  if (!persistedStatus) return ledgerStatus ?? progressStatus ?? "unknown";
  // A persisted terminal status wins over an older progress event. During an
  // active run, a durable waiting event is useful detail when the Suite row
  // has not yet advanced its aggregate status.
  if (isTerminalRunStatus(persistedStatus)) return persistedStatus;
  if (persistedStatus === "running" && progressStatus === "waiting") return "waiting";
  return persistedStatus;
}

function statusAhead(runStatus: string, ledgerStatus: string): RecoveredExecutionState["consistency"] {
  if (isTerminalRunStatus(runStatus) && !isTerminalRunStatus(ledgerStatus)) {
    return "run-state-ahead";
  }
  if (!isTerminalRunStatus(runStatus) && isTerminalRunStatus(ledgerStatus)) {
    return "ledger-ahead";
  }
  return "reconciled";
}

function isTerminalRunStatus(status: string) {
  return status === "completed" || status === "failed" || status === "blocked" || status === "cancelled";
}

export function classifyEvidenceFailure(input: {
  stderr?: string;
  stdout?: string;
  reporter?: StructuredReporterResult;
}): { type: ExecutionFailureType; reason: string } {
  const reporter = input.reporter;
  const reason = [input.stderr, input.stdout].filter(Boolean).join("\n");
  const textType = reason ? classifyExecutionFailure(reason) : "unknown_failure";
  if (reporter?.networkFailures.length) {
    if (
      textType === "unknown_failure" ||
      textType === "execution_failure" ||
      textType === "assertion_failure"
    ) {
      return { type: "network_failure", reason: "Structured reporter contains network failures" };
    }
  }
  if (textType !== "unknown_failure") return { type: textType, reason };
  if (reporter?.assertions.some((assertion) => assertion.status === "failed")) {
    return { type: "assertion_failure", reason: "Structured reporter contains a failed assertion" };
  }
  if (reporter?.consoleErrors.length) {
    return { type: "automation_failure", reason: "Structured reporter contains console errors" };
  }
  return { type: classifyExecutionFailure(reason), reason: reason || "Execution failed without diagnostic output" };
}
