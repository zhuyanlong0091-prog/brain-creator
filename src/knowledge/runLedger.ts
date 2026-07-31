import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  RunLedgerEntry
} from "../domain/types.js";
import { id } from "../shared/id.js";

type AppendRunLedgerEntryInput = Omit<RunLedgerEntry, "id" | "createdAt">;

type RunLedgerFilter = {
  knowledgeProjectId?: string;
  systemId?: string;
  requirementSuiteRunId?: string;
  executableCaseId?: string;
};

export class RunLedgerService {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  append(input: AppendRunLedgerEntryInput): RunLedgerEntry {
    const entry: RunLedgerEntry = {
      id: id("runLedger"),
      ...input,
      createdAt: this.now()
    };
    this.repository.runLedgerEntries.push(entry);
    this.repository.persist();
    return entry;
  }

  list(filter: RunLedgerFilter = {}): RunLedgerEntry[] {
    return this.repository.runLedgerEntries.filter(
      (entry) =>
        (!filter.knowledgeProjectId ||
          entry.knowledgeProjectId === filter.knowledgeProjectId) &&
        (!filter.systemId || entry.systemId === filter.systemId) &&
        (!filter.requirementSuiteRunId ||
          entry.requirementSuiteRunId === filter.requirementSuiteRunId) &&
        (!filter.executableCaseId ||
          entry.executableCaseId === filter.executableCaseId)
    );
  }

  summary(requirementSuiteRunId: string) {
    const entries = this.list({ requirementSuiteRunId });
    if (entries.length === 0) {
      throw new Error("Run ledger not found");
    }
    const first = entries[0];
    const latest = entries.at(-1)!;
    return {
      requirementSuiteRunId,
      knowledgeProjectId: first.knowledgeProjectId,
      systemId: first.systemId,
      currentStage: latest.stage,
      currentStatus: latest.toStatus,
      currentExecutableCaseId: latest.executableCaseId,
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

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
