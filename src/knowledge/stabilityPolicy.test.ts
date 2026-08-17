// @vitest-environment node

import { describe, expect, it } from "vitest";
import { evaluateStabilityPolicy, nextStabilitySchedule } from "./stabilityPolicy.js";

const base = (overrides: Record<string, unknown> = {}) => ({
  id: "run-1",
  status: "completed" as const,
  failed: 0,
  blocked: 0,
  passed: 1,
  total: 1,
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:01:00.000Z",
  completedAt: "2026-08-17T00:01:00.000Z",
  ...overrides
});

describe("stability policy", () => {
  it("requires the configured sample and strong evidence", () => {
    const result = evaluateStabilityPolicy(
      [base()],
      {
        targetIterations: 2,
        minIterations: 2,
        requireStrongEvidence: true,
        maxFailureRate: 0
      },
      { strongVerifiedRunIds: [] },
      new Date("2026-08-17T00:02:00.000Z")
    );

    expect(result.verdict).toBe("insufficient-sample");
    expect(result.strongVerified).toBe(0);
  });

  it("stops as unstable when failure rate exceeds the policy", () => {
    const result = evaluateStabilityPolicy(
      [base(), base({ id: "run-2", status: "failed", failed: 1, passed: 0 })],
      { targetIterations: 2, minIterations: 2, maxFailureRate: 0.25 },
      { strongVerifiedRunIds: ["run-1"] },
      new Date("2026-08-17T00:02:00.000Z")
    );

    expect(result.verdict).toBe("unstable");
    expect(result.failureRate).toBe(0.5);
  });

  it("provides an explicit next run time for long-cycle execution", () => {
    expect(
      nextStabilitySchedule(
        { status: "active", nextRunAt: undefined },
        { minIntervalMs: 60_000 },
        new Date("2026-08-17T00:00:00.000Z")
      )
    ).toMatchObject({ status: "active", nextRunAt: "2026-08-17T00:01:00.000Z" });
  });
});
