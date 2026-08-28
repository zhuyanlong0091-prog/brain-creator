import type { RequirementSuiteRun } from "../domain/types.js";

export type ScheduledRunnerController = {
  listDueStabilityRuns: (knowledgeProjectId?: string, now?: Date) => RequirementSuiteRun[];
  claimScheduled: (
    runId: string,
    input: { owner: string; leaseMs?: number },
    now?: Date
  ) => RequirementSuiteRun;
  get: (runId: string) => RequirementSuiteRun;
  releaseScheduledLease: (
    runId: string,
    input: { owner: string; nextRunAt?: string; lastError?: string },
    now?: Date
  ) => RequirementSuiteRun;
};

export type ScheduledRunnerResult = {
  status: "no-due-runs" | "completed" | "waiting" | "blocked" | "failed" | "partial";
  owner: string;
  processedRuns: number;
  runs: Array<{
    runId: string;
    status: RequirementSuiteRun["status"] | "claim-failed";
    processedCases: number;
    error?: string;
    nextRunAt?: string;
  }>;
};

export async function runScheduledSuites(input: {
  controller: ScheduledRunnerController;
  owner: string;
  knowledgeProjectId?: string;
  systemId?: string;
  leaseMs?: number;
  maxRuns?: number;
  maxCasesPerRun?: number;
  now?: Date;
  execute: (runId: string) => Promise<unknown>;
}): Promise<ScheduledRunnerResult> {
  const owner = input.owner.trim();
  if (!owner) throw new Error("Runner owner is required");
  const now = input.now ?? new Date();
  const dueRuns = input.controller
    .listDueStabilityRuns(input.knowledgeProjectId, now)
    .filter((run) => !input.systemId || run.systemId === input.systemId)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, Math.max(1, input.maxRuns ?? 1));
  if (dueRuns.length === 0) {
    return { status: "no-due-runs", owner, processedRuns: 0, runs: [] };
  }

  const results: ScheduledRunnerResult["runs"] = [];
  for (const dueRun of dueRuns) {
    let run: RequirementSuiteRun;
    try {
      run = input.controller.claimScheduled(
        dueRun.id,
        { owner, leaseMs: input.leaseMs ?? 300_000 },
        now
      );
    } catch (error) {
      results.push({
        runId: dueRun.id,
        status: "claim-failed",
        processedCases: 0,
        error: errorMessage(error)
      });
      continue;
    }

    let processedCases = 0;
    const maxCases = Math.max(1, input.maxCasesPerRun ?? Number.MAX_SAFE_INTEGER);
    let errorMessageValue: string | undefined;
    while (!isTerminal(run.status) && processedCases < maxCases) {
      try {
        await input.execute(run.id);
      } catch (error) {
        errorMessageValue = errorMessage(error);
        break;
      }
      processedCases += 1;
      run = input.controller.get(run.id);
      if (isWaiting(run.status)) break;
    }

    run = input.controller.get(run.id);
    if (errorMessageValue || isWaiting(run.status) || !isTerminal(run.status)) {
      const reason = errorMessageValue ?? waitingReason(run.status, processedCases >= maxCases);
      const released = releaseLease(input, run, owner, now, reason);
      results.push({
        runId: run.id,
        status: released.status,
        processedCases,
        ...(reason ? { error: reason } : {}),
        nextRunAt: released.stabilitySchedule?.nextRunAt
      });
      continue;
    }
    results.push({ runId: run.id, status: run.status, processedCases });
  }

  return {
    status: overallStatus(results),
    owner,
    processedRuns: results.length,
    runs: results
  };
}

function releaseLease(
  input: { controller: ScheduledRunnerController; now?: Date },
  run: RequirementSuiteRun,
  owner: string,
  now: Date,
  reason: string
) {
  const schedule = run.stabilitySchedule;
  if (!schedule?.leaseId || schedule.leaseOwner !== owner) return run;
  const interval = Math.max(1_000, run.stabilityPolicy?.minIntervalMs ?? 60_000);
  return input.controller.releaseScheduledLease(
    run.id,
    {
      owner,
      nextRunAt: new Date(now.getTime() + interval).toISOString(),
      lastError: reason
    },
    now
  );
}

function isTerminal(status: RequirementSuiteRun["status"]) {
  return status === "completed" || status === "failed" || status === "blocked" || status === "cancelled";
}

function isWaiting(status: RequirementSuiteRun["status"]) {
  return status === "waiting-for-agent" || status === "waiting-for-test-data";
}

function waitingReason(status: RequirementSuiteRun["status"], limitReached: boolean) {
  if (isWaiting(status)) return `Runner paused because the suite is ${status}.`;
  return limitReached ? "Runner case budget reached before the suite completed." : "Runner stopped before the suite completed.";
}

function overallStatus(
  results: ScheduledRunnerResult["runs"]
): ScheduledRunnerResult["status"] {
  if (results.length === 0) return "no-due-runs";
  if (results.some((result) => result.status === "claim-failed" || result.status === "failed")) return "failed";
  if (results.some((result) => result.status === "waiting-for-agent" || result.status === "waiting-for-test-data")) return "waiting";
  if (results.some((result) => result.status === "blocked")) return "blocked";
  if (results.every((result) => result.status === "completed")) return "completed";
  return "partial";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
