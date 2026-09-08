import type { RequirementSuiteRun } from "../domain/types.js";

export type ScheduledRunnerController = {
  listDueStabilityRuns: (knowledgeProjectId?: string, now?: Date) => RequirementSuiteRun[];
  claimScheduled: (
    runId: string,
    input: { owner: string; leaseMs?: number },
    now?: Date
  ) => RequirementSuiteRun;
  get: (runId: string) => RequirementSuiteRun;
  renewScheduledLease?: (
    runId: string,
    input: { owner: string; leaseMs?: number },
    now?: Date
  ) => RequirementSuiteRun;
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
    status: RequirementSuiteRun["status"] | "claim-failed" | "lease-lost";
    processedCases: number;
    durationMs?: number;
    leaseRenewals?: number;
    budgetExceeded?: boolean;
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
  maxWallTimeMs?: number;
  leaseRenewalMs?: number;
  retryBackoffMs?: number;
  maxRetryBackoffMs?: number;
  now?: Date;
  clock?: () => number;
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
  const clock = input.clock ?? Date.now;
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

    const startedAt = clock();
    const wallTimeBudget = Math.max(
      1,
      input.maxWallTimeMs ?? run.stabilityPolicy?.maxDurationMs ?? 300_000
    );
    const leaseRenewalMs = Math.max(
      0,
      input.leaseRenewalMs ?? Math.max(1_000, Math.floor((input.leaseMs ?? 300_000) / 3))
    );
    let leaseRenewals = 0;
    let leaseError: string | undefined;
    let renewalInFlight = false;
    const heartbeat = input.controller.renewScheduledLease && leaseRenewalMs > 0
      ? setInterval(() => {
          if (renewalInFlight || leaseError) return;
          renewalInFlight = true;
          void Promise.resolve(input.controller.renewScheduledLease!(
            run.id,
            { owner, leaseMs: input.leaseMs ?? 300_000 },
            new Date(clock())
          ))
            .then(() => {
              leaseRenewals += 1;
            })
            .catch((error) => {
              leaseError = `Runner lease renewal failed: ${errorMessage(error)}`;
            })
            .finally(() => {
              renewalInFlight = false;
            });
        }, leaseRenewalMs)
      : undefined;
    let processedCases = 0;
    const maxCases = Math.max(1, input.maxCasesPerRun ?? Number.MAX_SAFE_INTEGER);
    let errorMessageValue: string | undefined;
    let budgetExceeded = false;
    try {
      while (!isTerminal(run.status) && processedCases < maxCases) {
        if (clock() - startedAt >= wallTimeBudget) {
          budgetExceeded = true;
          errorMessageValue = `Runner wall-time budget of ${wallTimeBudget}ms was exhausted.`;
          break;
        }
        try {
          await input.execute(run.id);
        } catch (error) {
          errorMessageValue = errorMessage(error);
          break;
        }
        processedCases += 1;
        run = input.controller.get(run.id);
        if (leaseError) {
          errorMessageValue = leaseError;
          break;
        }
        if (clock() - startedAt >= wallTimeBudget && !isTerminal(run.status)) {
          budgetExceeded = true;
          errorMessageValue = `Runner wall-time budget of ${wallTimeBudget}ms was exhausted.`;
          break;
        }
        if (isWaiting(run.status)) break;
      }
      if (!isTerminal(run.status) && processedCases >= maxCases && !errorMessageValue) {
        errorMessageValue = waitingReason(run.status, true);
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (renewalInFlight) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(leaseRenewalMs || 1, 50)));
      }
    }

    run = input.controller.get(run.id);
    const durationMs = Math.max(0, clock() - startedAt);
    if (leaseError && !errorMessageValue) errorMessageValue = leaseError;
    if (errorMessageValue || isWaiting(run.status) || !isTerminal(run.status)) {
      const reason = errorMessageValue ?? waitingReason(run.status, processedCases >= maxCases);
      const released = leaseError
        ? run
        : releaseLease(input, run, owner, new Date(clock()), reason);
      results.push({
        runId: run.id,
        status: leaseError ? "lease-lost" : released.status,
        processedCases,
        durationMs,
        leaseRenewals,
        ...(budgetExceeded ? { budgetExceeded: true } : {}),
        ...(reason ? { error: reason } : {}),
        nextRunAt: released.stabilitySchedule?.nextRunAt
      });
      continue;
    }
    results.push({
      runId: run.id,
      status: run.status,
      processedCases,
      durationMs,
      leaseRenewals,
      ...(budgetExceeded ? { budgetExceeded: true } : {})
    });
  }

  return {
    status: overallStatus(results),
    owner,
    processedRuns: results.length,
    runs: results
  };
}

function releaseLease(
  input: {
    controller: ScheduledRunnerController;
    retryBackoffMs?: number;
    maxRetryBackoffMs?: number;
  },
  run: RequirementSuiteRun,
  owner: string,
  now: Date,
  reason: string
) {
  const schedule = run.stabilitySchedule;
  if (!schedule?.leaseId || schedule.leaseOwner !== owner) return run;
  const baseInterval = Math.max(
    1_000,
    input.retryBackoffMs ?? run.stabilityPolicy?.minIntervalMs ?? 60_000
  );
  const maxInterval = Math.max(
    baseInterval,
    input.maxRetryBackoffMs ?? run.stabilityPolicy?.maxIntervalMs ?? baseInterval * 16
  );
  const attempt = Math.max(1, schedule.attemptCount ?? 1);
  const interval = Math.min(maxInterval, baseInterval * 2 ** Math.min(attempt - 1, 10));
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
  if (results.some((result) => result.status === "claim-failed" || result.status === "lease-lost" || result.status === "failed")) return "failed";
  if (results.some((result) => result.status === "waiting-for-agent" || result.status === "waiting-for-test-data")) return "waiting";
  if (results.some((result) => result.status === "blocked")) return "blocked";
  if (results.every((result) => result.status === "completed")) return "completed";
  return "partial";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
