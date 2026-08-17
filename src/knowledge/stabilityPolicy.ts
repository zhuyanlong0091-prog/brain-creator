import type { StabilityPolicy, StabilitySchedule } from "../domain/types.js";

type StabilityRun = {
  id: string;
  status: string;
  failed: number;
  blocked: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type StabilityEvaluation = {
  verdict: "stable" | "unstable" | "running" | "blocked" | "insufficient-sample" | "exhausted";
  target: number;
  minIterations: number;
  iterations: number;
  completed: number;
  passed: number;
  failed: number;
  blocked: number;
  strongVerified: number;
  failureRate: number;
  consecutiveFailures: number;
  elapsedMs: number;
  nextRunAt?: string;
};

export function evaluateStabilityPolicy(
  runs: StabilityRun[],
  policy: StabilityPolicy,
  evidence: { strongVerifiedRunIds?: string[] } = {},
  now = new Date()
): StabilityEvaluation {
  const target = Math.max(1, policy.targetIterations);
  const minIterations = Math.max(1, policy.minIterations ?? 2);
  const completedRuns = runs.filter((run) => run.status === "completed" || run.status === "failed");
  const failed = completedRuns.filter((run) => run.status === "failed").length;
  const blocked = runs.filter((run) => run.status === "blocked").length;
  const passed = completedRuns.filter((run) => run.status === "completed" && run.failed === 0).length;
  const strong = new Set(evidence.strongVerifiedRunIds ?? []);
  const strongVerified = completedRuns.filter((run) => strong.has(run.id)).length;
  const failureRate = completedRuns.length === 0 ? 0 : failed / completedRuns.length;
  const ordered = [...completedRuns].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  let consecutiveFailures = 0;
  for (let index = ordered.length - 1; index >= 0 && ordered[index].status === "failed"; index -= 1) {
    consecutiveFailures += 1;
  }
  const firstTimestamp = runs.map((run) => Date.parse(run.createdAt)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const elapsedMs = firstTimestamp === undefined ? 0 : Math.max(0, now.getTime() - firstTimestamp);
  const maxDurationExceeded = policy.maxDurationMs !== undefined && elapsedMs > policy.maxDurationMs;
  const verdict = blocked > 0 && (policy.stopOnBlocked ?? true)
    ? "blocked"
    : maxDurationExceeded && completedRuns.length < target
      ? "exhausted"
      : completedRuns.length < minIterations
        ? "insufficient-sample"
        : failureRate > (policy.maxFailureRate ?? 0)
          ? "unstable"
          : consecutiveFailures > (policy.maxConsecutiveFailures ?? Number.POSITIVE_INFINITY)
            ? "unstable"
            : completedRuns.length < target
              ? "running"
              : (policy.requireStrongEvidence ?? true) && strongVerified < completedRuns.length
                ? "unstable"
                : "stable";
  return {
    verdict,
    target,
    minIterations,
    iterations: runs.length,
    completed: completedRuns.length,
    passed,
    failed,
    blocked,
    strongVerified,
    failureRate,
    consecutiveFailures,
    elapsedMs
  };
}

export function nextStabilitySchedule(
  schedule: StabilitySchedule,
  policy: Pick<StabilityPolicy, "minIntervalMs" | "maxIntervalMs">,
  now = new Date()
): StabilitySchedule {
  if (schedule.status !== "active" || schedule.nextRunAt) return schedule;
  const delay = Math.max(0, Math.min(policy.maxIntervalMs ?? Number.MAX_SAFE_INTEGER, policy.minIntervalMs ?? 0));
  return {
    ...schedule,
    nextRunAt: new Date(now.getTime() + delay).toISOString()
  };
}
