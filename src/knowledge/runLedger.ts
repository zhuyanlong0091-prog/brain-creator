import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutionProgressEvent,
  ExecutionProgressStatus,
  RunLedgerActionPhase,
  RunLedgerEntry
} from "../domain/types.js";
import { randomUUID } from "node:crypto";
import { id } from "../shared/id.js";
import { decryptSecrets } from "../shared/crypto.js";
import { redactSensitiveText } from "../shared/secretScan.js";

type AppendRunLedgerEntryInput = Omit<RunLedgerEntry, "id" | "createdAt">;

type AppendExecutionProgressInput = {
  runType?: "requirement-suite" | "document-suite";
  knowledgeProjectId?: string;
  systemId: string;
  requirementSuiteRunId?: string;
  caseSuiteId?: string;
  caseSourceId?: string;
  executableCaseId?: string;
  caseNo?: string;
  caseTitle?: string;
  stage: RunLedgerEntry["stage"];
  status: ExecutionProgressStatus;
  stepId?: string;
  stepTitle?: string;
  pageUrl?: string;
  screenshotPath?: string;
  assertionSummary?: string;
  waitReason?: string;
  operator?: string;
  provider?: string;
  sessionId?: string;
  traceId?: string;
};

export type RecordExecutionActionInput = {
  runType?: "requirement-suite" | "document-suite";
  knowledgeProjectId?: string;
  systemId: string;
  requirementSuiteRunId?: string;
  caseSuiteId?: string;
  caseSourceId?: string;
  executableCaseId?: string;
  caseNo?: string;
  caseTitle?: string;
  stepId?: string;
  stepTitle?: string;
  actionKey: string;
  phase: RunLedgerActionPhase;
  actionSemantic: string;
  entityReference?: string;
  postcondition?: string;
  evidenceRefs?: string[];
  operator?: string;
  provider?: string;
  sessionId?: string;
  traceId?: string;
};

type RunLedgerFilter = {
  runType?: "requirement-suite" | "document-suite";
  knowledgeProjectId?: string;
  systemId?: string;
  requirementSuiteRunId?: string;
  caseSuiteId?: string;
  executableCaseId?: string;
  caseNo?: string;
};

export class RunLedgerService {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly nowMs: () => number = () => Date.now()
  ) {}

  append(input: AppendRunLedgerEntryInput): RunLedgerEntry {
    assertRunIdentity(input);
    const secrets = protectedSecrets(this.repository, input.systemId);
    const redact = (value?: string) =>
      value === undefined ? undefined : redactSensitiveText(value, secrets);
    const message = redact(input.message);
    const currentStep = redact(input.currentStep);
    const caseTitle = redact(input.caseTitle ?? caseTitleFor(this.repository, input));
    const stepTitle = redact(input.stepTitle);
    const assertionSummary = redact(input.assertionSummary);
    const waitReason = redact(input.waitReason);
    const screenshotPath = redact(input.screenshotPath);
    const actionSemantic = redact(input.actionSemantic);
    const entityReference = redact(input.entityReference);
    const actionPostcondition = redact(input.actionPostcondition);
    const actionEvidenceRefs = input.actionEvidenceRefs?.map((reference) => redact(reference)!);
    const pageUrl = input.pageUrl
      ? sanitizePageUrl(redact(input.pageUrl)!)
      : undefined;
    const runEntries = this.repository.runLedgerEntries.filter(
      (entry) => sameRun(entry, input)
    );
    const createdAt = this.now();
    const startedAt = runEntries[0]?.createdAt ?? createdAt;
    const entry: RunLedgerEntry = {
      id: id("runLedger"),
      ...input,
      runType:
        input.runType ??
        (input.caseSuiteId ? "document-suite" : "requirement-suite"),
      operator: input.operator ?? process.env.BRAIN_CREATOR_OPERATOR ?? "local-agent",
      provider:
        input.provider ??
        process.env.BRAIN_CREATOR_AGENT_PROVIDER ??
        "unknown",
      sessionId: input.sessionId ?? process.env.BRAIN_CREATOR_SESSION_ID,
      traceId: input.traceId ?? randomUUID(),
      sequence:
        input.sequence ??
        Math.max(0, ...runEntries.map((item, index) => item.sequence ?? index + 1)) + 1,
      elapsedMs:
        input.elapsedMs ??
        Math.max(0, Date.parse(createdAt) - Date.parse(startedAt)),
      ...(message === undefined ? {} : { message }),
      ...(currentStep === undefined ? {} : { currentStep }),
      ...(caseTitle === undefined ? {} : { caseTitle }),
      ...(stepTitle === undefined ? {} : { stepTitle }),
      ...(assertionSummary === undefined ? {} : { assertionSummary }),
      ...(waitReason === undefined ? {} : { waitReason }),
      ...(screenshotPath === undefined ? {} : { screenshotPath }),
      ...(actionSemantic === undefined ? {} : { actionSemantic }),
      ...(entityReference === undefined ? {} : { entityReference }),
      ...(actionPostcondition === undefined ? {} : { actionPostcondition }),
      ...(actionEvidenceRefs === undefined ? {} : { actionEvidenceRefs }),
      ...(pageUrl === undefined ? {} : { pageUrl }),
      createdAt
    };
    this.repository.runLedgerEntries.push(entry);
    this.repository.persist();
    return entry;
  }

  appendProgress(input: AppendExecutionProgressInput): ExecutionProgressEvent {
    return toProgressEvent(this.append({
      ...input,
      event: "progress",
      scope: input.executableCaseId || input.caseNo ? "case" : "suite",
      toStatus: input.status,
      progressStatus: input.status,
      currentStep: input.stepTitle
    }));
  }

  recordAction(input: RecordExecutionActionInput): RunLedgerEntry {
    const actionKey = input.actionKey.trim();
    const actionSemantic = input.actionSemantic.trim();
    if (!actionKey) throw new Error("Execution action requires actionKey");
    if (!actionSemantic) throw new Error("Execution action requires actionSemantic");
    if (input.evidenceRefs?.some((reference) => !reference.trim())) {
      throw new Error("Execution action evidence references cannot be empty");
    }
    if (
      (input.phase === "confirmed" || input.phase === "reconciled") &&
      (!input.postcondition?.trim() || !input.evidenceRefs?.length)
    ) {
      throw new Error(`${input.phase} execution action requires postcondition and evidenceRefs`);
    }

    const previous = this.latestActionForRun(runIdFromInput(input), actionKey);
    validateActionTransition(previous?.actionPhase, input.phase);

    const event = actionEvent(input.phase);
    const waiting = input.phase === "sent" || input.phase === "reconciliation-required";
    return this.append({
      runType: input.runType,
      knowledgeProjectId: input.knowledgeProjectId,
      systemId: input.systemId,
      requirementSuiteRunId: input.requirementSuiteRunId,
      caseSuiteId: input.caseSuiteId,
      caseSourceId: input.caseSourceId,
      executableCaseId: input.executableCaseId,
      caseNo: input.caseNo,
      caseTitle: input.caseTitle,
      stepId: input.stepId,
      stepTitle: input.stepTitle,
      actionKey,
      actionPhase: input.phase,
      actionSemantic,
      entityReference: input.entityReference,
      actionPostcondition: input.postcondition,
      actionEvidenceRefs: input.evidenceRefs,
      event,
      scope: input.executableCaseId || input.caseNo ? "case" : "suite",
      stage: "execution",
      toStatus: waiting ? "waiting-for-action-reconciliation" : "running",
      progressStatus: waiting ? "waiting" : "running",
      waitReason: waiting
        ? "A write action was sent but its result was not confirmed. Query the postcondition before retrying."
        : undefined,
      message: waiting
        ? `Action ${actionKey} was sent; reconcile its postcondition before retrying.`
        : `Action ${actionKey} is ${input.phase}.`
    });
  }

  list(filter: RunLedgerFilter = {}): RunLedgerEntry[] {
    return this.repository.runLedgerEntries.filter(
      (entry) =>
        (!filter.runType || runTypeOf(entry) === filter.runType) &&
        (!filter.knowledgeProjectId ||
          entry.knowledgeProjectId === filter.knowledgeProjectId) &&
        (!filter.systemId || entry.systemId === filter.systemId) &&
        (!filter.requirementSuiteRunId ||
          entry.requirementSuiteRunId === filter.requirementSuiteRunId) &&
        (!filter.caseSuiteId || entry.caseSuiteId === filter.caseSuiteId) &&
        (!filter.executableCaseId ||
          entry.executableCaseId === filter.executableCaseId) &&
        (!filter.caseNo || entry.caseNo === filter.caseNo)
    );
  }

  latestAction(runId: string, actionKey: string) {
    return this.latestActionForRun(runId, actionKey);
  }

  latestUnresolvedAction(runId: string) {
    const latestByKey = new Map<string, RunLedgerEntry>();
    for (const entry of this.repository.runLedgerEntries) {
      if (runIdOf(entry) !== runId || !entry.actionKey || !entry.actionPhase) continue;
      latestByKey.set(entry.actionKey, entry);
    }
    return [...latestByKey.values()]
      .filter((entry) =>
        entry.actionPhase === "sent" || entry.actionPhase === "reconciliation-required"
      )
      .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
      .at(-1);
  }

  private latestActionForRun(runId: string, actionKey: string) {
    return this.repository.runLedgerEntries
      .filter((entry) =>
        runIdOf(entry) === runId &&
        entry.actionKey === actionKey &&
        entry.actionPhase !== undefined
      )
      .at(-1);
  }

  summary(runId: string) {
    const entries = this.repository.runLedgerEntries.filter(
      (entry) => runIdOf(entry) === runId
    );
    if (entries.length === 0) {
      throw new Error("Run ledger not found");
    }
    const first = entries[0];
    const latest = entries.at(-1)!;
    const progress = this.progress(runId);
    return {
      runType: runTypeOf(first),
      runId,
      requirementSuiteRunId: first.requirementSuiteRunId,
      caseSuiteId: first.caseSuiteId,
      caseSourceId: first.caseSourceId,
      knowledgeProjectId: first.knowledgeProjectId,
      systemId: first.systemId,
      currentStage: latest.stage,
      currentStatus: latest.toStatus,
      currentExecutableCaseId: latest.executableCaseId,
      currentCaseNo: latest.caseNo,
      operator: latest.operator,
      provider: latest.provider,
      sessionId: latest.sessionId,
      traceId: latest.traceId,
      currentStep: latest.currentStep,
      latestEvent: latest.event,
      eventCount: entries.length,
      startedAt: first.createdAt,
      updatedAt: latest.createdAt,
      currentProgress: progress.current,
      currentCaseTitle: progress.current?.caseTitle,
      currentPageUrl: progress.current?.pageUrl,
      elapsedMs: progress.current?.elapsedMs ?? 0,
      waitReason: progress.current?.waitReason,
      possiblyStalled: progress.possiblyStalled,
      stalledAfterMs: progress.stalledAfterMs,
      recordedDurationMs: Math.max(
        0,
        Date.parse(latest.createdAt) - Date.parse(first.createdAt)
      ),
      events: countBy(entries.map((entry) => entry.event)),
      outcomes: countBy(
        entries.flatMap((entry) =>
          entry.scope === "case" && entry.outcome ? [entry.outcome] : []
        )
      ),
      failures: countBy(
        entries.flatMap((entry) =>
          entry.failureType ? [entry.failureType] : []
        )
      )
    };
  }

  progress(runId: string, input: { stalledAfterMs?: number } = {}) {
    const entries = this.repository.runLedgerEntries.filter(
      (entry) => runIdOf(entry) === runId
    );
    if (entries.length === 0) throw new Error("Run ledger not found");
    const events = entries.map((entry, index) =>
      toProgressEvent(entry, index + 1, entries[0].createdAt)
    );
    const current = events.at(-1);
    const stalledAfterMs = input.stalledAfterMs ?? 120_000;
    const active = current
      ? current.status === "started" || current.status === "running" || current.status === "waiting"
      : false;
    return {
      events,
      current,
      possiblyStalled:
        Boolean(active && current) &&
        this.nowMs() - Date.parse(current!.createdAt) >= stalledAfterMs,
      stalledAfterMs
    };
  }
}

function protectedSecrets(
  repository: InMemoryBrainCreatorRepository,
  systemId: string
) {
  return Object.fromEntries(
    repository.authProfiles
      .filter((profile) => profile.projectId === systemId)
      .flatMap((profile) => {
        try {
          return Object.entries(decryptSecrets(profile.encryptedSecrets));
        } catch {
          return [];
        }
      })
  );
}

function assertRunIdentity(input: AppendRunLedgerEntryInput) {
  const requirementRun = Boolean(input.requirementSuiteRunId);
  const documentRun = Boolean(input.caseSuiteId);
  if (requirementRun === documentRun) {
    throw new Error("Run ledger entry requires exactly one suite run identity");
  }
  if (input.runType === "requirement-suite" && !requirementRun) {
    throw new Error("Requirement suite ledger entry requires requirementSuiteRunId");
  }
  if (input.runType === "document-suite" && !documentRun) {
    throw new Error("Document suite ledger entry requires caseSuiteId");
  }
}

function runTypeOf(entry: RunLedgerEntry) {
  return entry.runType ??
    (entry.caseSuiteId ? "document-suite" : "requirement-suite");
}

function runIdOf(entry: RunLedgerEntry) {
  return entry.caseSuiteId ?? entry.requirementSuiteRunId;
}

function runIdFromInput(input: Pick<RunLedgerEntry, "requirementSuiteRunId" | "caseSuiteId">) {
  const runId = input.caseSuiteId ?? input.requirementSuiteRunId;
  if (!runId) throw new Error("Execution action requires a suite run identity");
  return runId;
}

function actionEvent(phase: RunLedgerActionPhase): RunLedgerEntry["event"] {
  if (phase === "planned") return "action-planned";
  if (phase === "sent") return "action-sent";
  if (phase === "confirmed") return "action-confirmed";
  if (phase === "reconciliation-required") return "action-reconciliation-required";
  return "action-reconciled";
}

function validateActionTransition(
  previous: RunLedgerActionPhase | undefined,
  next: RunLedgerActionPhase
) {
  if (!previous) {
    if (next === "planned" || next === "sent") return;
    throw new Error(`Execution action cannot start in phase ${next}`);
  }
  if (previous === "planned") {
    if (next === "planned" || next === "sent") return;
    throw new Error(`Execution action cannot transition from planned to ${next}`);
  }
  if (previous === "sent" || previous === "reconciliation-required") {
    if (next === "confirmed" || next === "reconciliation-required" || next === "reconciled") return;
  }
  throw new Error(`Execution action ${previous} is terminal or cannot transition to ${next}`);
}

function sameRun(
  entry: RunLedgerEntry,
  input: Pick<RunLedgerEntry, "requirementSuiteRunId" | "caseSuiteId">
) {
  return Boolean(
    (input.requirementSuiteRunId && entry.requirementSuiteRunId === input.requirementSuiteRunId) ||
    (input.caseSuiteId && entry.caseSuiteId === input.caseSuiteId)
  );
}

function caseTitleFor(
  repository: InMemoryBrainCreatorRepository,
  input: Pick<RunLedgerEntry, "requirementSuiteRunId" | "caseSuiteId" | "executableCaseId" | "caseNo">
) {
  if (input.requirementSuiteRunId && input.executableCaseId) {
    return repository.requirementSuiteRuns
      .find((run) => run.id === input.requirementSuiteRunId)
      ?.caseRuns.find((item) => item.executableCaseId === input.executableCaseId)
      ?.title;
  }
  if (input.caseSuiteId && input.caseNo) {
    return repository.agentTasks
      .find((task) =>
        task.suiteContext?.suiteId === input.caseSuiteId &&
        task.suiteContext?.caseNo === input.caseNo
      )
      ?.suiteContext?.title;
  }
  return undefined;
}

function toProgressEvent(
  entry: RunLedgerEntry,
  fallbackSequence = entry.sequence ?? 1,
  startedAt = entry.createdAt
): ExecutionProgressEvent {
  return {
    sequence: entry.sequence ?? fallbackSequence,
    runId: runIdOf(entry)!,
    caseId: entry.executableCaseId ?? entry.caseNo,
    caseTitle: entry.caseTitle,
    stage: entry.stage,
    stepId: entry.stepId,
    stepTitle: entry.stepTitle ?? entry.currentStep,
    status: entry.progressStatus ?? progressStatus(entry),
    pageUrl: entry.pageUrl,
    elapsedMs:
      entry.elapsedMs ??
      Math.max(0, Date.parse(entry.createdAt) - Date.parse(startedAt)),
    screenshotPath: entry.screenshotPath,
    assertionSummary: entry.assertionSummary,
    waitReason: entry.waitReason ?? (entry.toStatus.startsWith("waiting") ? entry.message : undefined),
    traceId: entry.traceId ?? entry.id,
    createdAt: entry.createdAt
  };
}

function progressStatus(entry: RunLedgerEntry): ExecutionProgressStatus {
  if (entry.outcome === "passed" || entry.toStatus === "passed" || entry.toStatus === "completed") return "passed";
  if (entry.outcome === "failed" || entry.toStatus === "failed") return "failed";
  if (entry.outcome === "blocked" || entry.toStatus === "blocked") return "blocked";
  if (entry.outcome === "cancelled" || entry.outcome === "skipped" || entry.toStatus === "cancelled") return "blocked";
  if (entry.toStatus.startsWith("waiting")) return "waiting";
  if (entry.event === "case-started" || entry.event === "suite-created") return "started";
  return "running";
}

function sanitizePageUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      url.searchParams.set(key, "[REDACTED]");
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value;
  }
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
