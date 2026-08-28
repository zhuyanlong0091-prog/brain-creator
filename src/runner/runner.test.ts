import { describe, expect, it, vi } from "vitest";
import type { RequirementSuiteRun } from "../domain/types.js";
import { runScheduledSuites } from "./runner.js";

function scheduledRun(): RequirementSuiteRun {
  return {
    id: "suite-run-1",
    knowledgeProjectId: "knowledge-1",
    systemId: "system-1",
    status: "running",
    continueOnBlocked: false,
    allowCreateTestData: false,
    total: 1,
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    caseRuns: [],
    stabilitySchedule: {
      status: "active",
      nextRunAt: "2026-01-01T00:00:00.000Z"
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("scheduled Runner", () => {
  it("claims a due suite and drives it until completion", async () => {
    const run = scheduledRun();
    const controller = {
      listDueStabilityRuns: vi.fn(() => [run]),
      claimScheduled: vi.fn(() => {
        run.stabilitySchedule = {
          ...run.stabilitySchedule!,
          leaseId: "lease-1",
          leaseOwner: "ci",
          leaseExpiresAt: "2026-01-01T00:05:00.000Z",
          nextRunAt: undefined
        };
        return run;
      }),
      get: vi.fn(() => run),
      releaseScheduledLease: vi.fn()
    };
    const execute = vi.fn(async () => {
      run.status = "completed";
      run.stabilitySchedule = { status: "completed" };
    });

    const result = await runScheduledSuites({
      controller,
      owner: "ci",
      now: new Date("2026-01-01T00:01:00.000Z"),
      execute
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(controller.claimScheduled).toHaveBeenCalledWith("suite-run-1", {
      owner: "ci",
      leaseMs: 300_000
    }, expect.any(Date));
    expect(controller.releaseScheduledLease).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      status: "completed",
      processedRuns: 1
    }));
  });

  it("releases the lease when execution must wait for a provider", async () => {
    const run = scheduledRun();
    const controller = {
      listDueStabilityRuns: vi.fn(() => [run]),
      claimScheduled: vi.fn(() => {
        run.stabilitySchedule = {
          ...run.stabilitySchedule!,
          leaseId: "lease-1",
          leaseOwner: "ci",
          leaseExpiresAt: "2026-01-01T00:05:00.000Z",
          nextRunAt: undefined
        };
        return run;
      }),
      get: vi.fn(() => run),
      releaseScheduledLease: vi.fn(() => run)
    };
    const execute = vi.fn(async () => {
      run.status = "waiting-for-agent";
    });

    const result = await runScheduledSuites({
      controller,
      owner: "ci",
      now: new Date("2026-01-01T00:01:00.000Z"),
      execute
    });

    expect(controller.releaseScheduledLease).toHaveBeenCalledWith(
      "suite-run-1",
      expect.objectContaining({ owner: "ci", lastError: expect.stringContaining("waiting") }),
      expect.any(Date)
    );
    expect(result).toEqual(expect.objectContaining({ status: "waiting" }));
  });

  it("returns an explicit no-due-run result without claiming anything", async () => {
    const controller = {
      listDueStabilityRuns: vi.fn(() => []),
      claimScheduled: vi.fn(),
      get: vi.fn(),
      releaseScheduledLease: vi.fn()
    };

    const result = await runScheduledSuites({
      controller,
      owner: "ci",
      execute: vi.fn()
    });

    expect(result).toEqual(expect.objectContaining({ status: "no-due-runs", processedRuns: 0 }));
    expect(controller.claimScheduled).not.toHaveBeenCalled();
  });
});
