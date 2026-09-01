import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { ExecutionFailureType, StructuredReporterResult } from "../domain/types.js";
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
  nextAction: "resume-after-checkpoint" | "inspect-failure" | "continue-run" | "review-result";
};

export function recoverExecutionState(
  repository: InMemoryBrainCreatorRepository,
  runId: string,
  nowMs = Date.now()
): RecoveredExecutionState {
  const ledger = new RunLedgerService(repository, undefined, () => nowMs);
  const summary = ledger.summary(runId);
  const progress = ledger.progress(runId);
  const current = progress.current;
  const status = summary.currentStatus;
  return {
    runId,
    status,
    currentCaseId: current?.caseId,
    currentCaseTitle: current?.caseTitle,
    currentStepId: current?.stepId,
    currentStepTitle: current?.stepTitle,
    currentPageUrl: current?.pageUrl,
    waitReason: current?.waitReason,
    lastSequence: current?.sequence,
    updatedAt: summary.updatedAt,
    possiblyStalled: progress.possiblyStalled,
    nextAction: status.startsWith("waiting")
      ? "resume-after-checkpoint"
      : status === "failed"
        ? "inspect-failure"
        : status === "running"
          ? "continue-run"
          : "review-result"
  };
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
  return { type: classifyExecutionFailure(reason), reason: reason || "Execution failed without diagnostic output" };
}
