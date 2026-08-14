import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  RunLedgerEntry
} from "../domain/types.js";
import { randomUUID } from "node:crypto";
import { id } from "../shared/id.js";
import { decryptSecrets } from "../shared/crypto.js";
import { redactSensitiveText } from "../shared/secretScan.js";

type AppendRunLedgerEntryInput = Omit<RunLedgerEntry, "id" | "createdAt">;

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
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  append(input: AppendRunLedgerEntryInput): RunLedgerEntry {
    assertRunIdentity(input);
    const secrets = protectedSecrets(this.repository, input.systemId);
    const redact = (value?: string) =>
      value === undefined ? undefined : redactSensitiveText(value, secrets);
    const message = redact(input.message);
    const currentStep = redact(input.currentStep);
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
      ...(message === undefined ? {} : { message }),
      ...(currentStep === undefined ? {} : { currentStep }),
      createdAt: this.now()
    };
    this.repository.runLedgerEntries.push(entry);
    this.repository.persist();
    return entry;
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

  summary(runId: string) {
    const entries = this.repository.runLedgerEntries.filter(
      (entry) => runIdOf(entry) === runId
    );
    if (entries.length === 0) {
      throw new Error("Run ledger not found");
    }
    const first = entries[0];
    const latest = entries.at(-1)!;
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

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
