import type { StabilityPolicy, StabilitySchedule } from "../domain/types.js";

export class StabilityScheduleError extends Error {}

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

export function isStabilityScheduleDue(
  schedule: StabilitySchedule,
  now = new Date()
) {
  if (schedule.status !== "active") return false;
  const leaseExpired = Boolean(
    schedule.leaseExpiresAt && Date.parse(schedule.leaseExpiresAt) <= now.getTime()
  );
  if (leaseExpired) return true;
  return Boolean(
    schedule.nextRunAt && Date.parse(schedule.nextRunAt) <= now.getTime()
  );
}

export function claimStabilitySchedule(
  schedule: StabilitySchedule,
  input: { owner: string; leaseId: string; leaseMs: number },
  now = new Date()
): StabilitySchedule {
  const owner = input.owner.trim();
  if (!owner) throw new StabilityScheduleError("Schedule owner is required.");
  const leaseMs = Math.max(1_000, Math.min(86_400_000, input.leaseMs));
  const leaseActive = Boolean(
    schedule.leaseExpiresAt && Date.parse(schedule.leaseExpiresAt) > now.getTime()
  );
  if (leaseActive && schedule.leaseOwner !== owner) {
    throw new StabilityScheduleError("Stability schedule is leased by another owner.");
  }
  if (!isStabilityScheduleDue(schedule, now) && !leaseActive) {
    throw new StabilityScheduleError("Stability schedule is not due yet.");
  }
  return {
    ...schedule,
    nextRunAt: undefined,
    leaseId: input.leaseId,
    leaseOwner: owner,
    leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    lastStartedAt: now.toISOString(),
    lastError: undefined
  };
}

export function renewStabilityScheduleLease(
  schedule: StabilitySchedule,
  input: { owner: string; leaseMs: number },
  now = new Date()
): StabilitySchedule {
  if (schedule.leaseOwner !== input.owner || !schedule.leaseId) {
    throw new StabilityScheduleError("Schedule lease is not owned by this operator.");
  }
  const expiresAt = schedule.leaseExpiresAt ? Date.parse(schedule.leaseExpiresAt) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    throw new StabilityScheduleError("Schedule lease has expired.");
  }
  const leaseMs = Math.max(1_000, Math.min(86_400_000, input.leaseMs));
  return {
    ...schedule,
    leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString()
  };
}

export function releaseStabilityScheduleLease(
  schedule: StabilitySchedule,
  input: { owner: string; nextRunAt?: string; lastError?: string },
  now = new Date()
): StabilitySchedule {
  if (schedule.leaseOwner !== input.owner || !schedule.leaseId) {
    throw new StabilityScheduleError("Schedule lease is not owned by this operator.");
  }
  return {
    ...schedule,
    nextRunAt: input.nextRunAt,
    leaseId: undefined,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    lastStartedAt: schedule.lastStartedAt ?? now.toISOString(),
    lastError: input.lastError
  };
}
