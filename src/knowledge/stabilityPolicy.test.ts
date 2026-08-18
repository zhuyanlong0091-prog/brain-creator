// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  claimStabilitySchedule,
  evaluateStabilityPolicy,
  isStabilityScheduleDue,
  nextStabilitySchedule,
  renewStabilityScheduleLease,
  releaseStabilityScheduleLease
} from "./stabilityPolicy.js";

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

  it("claims a due schedule and records a recoverable lease", () => {
    const due = {
      status: "active" as const,
      nextRunAt: "2026-08-17T00:00:00.000Z",
      attemptCount: 2
    };
    const claimed = claimStabilitySchedule(
      due,
      { owner: "codex", leaseId: "lease-1", leaseMs: 60_000 },
      new Date("2026-08-17T00:01:00.000Z")
    );

    expect(isStabilityScheduleDue(due, new Date("2026-08-17T00:01:00.000Z"))).toBe(true);
    expect(claimed).toMatchObject({
      leaseId: "lease-1",
      leaseOwner: "codex",
      leaseExpiresAt: "2026-08-17T00:02:00.000Z",
      lastStartedAt: "2026-08-17T00:01:00.000Z"
    });
    expect(claimed.nextRunAt).toBeUndefined();
  });

  it("rejects a competing owner but lets an expired lease recover", () => {
    const leased = {
      status: "active" as const,
      leaseId: "lease-1",
      leaseOwner: "codex",
      leaseExpiresAt: "2026-08-17T00:02:00.000Z"
    };
    expect(() => claimStabilitySchedule(
      leased,
      { owner: "claude", leaseId: "lease-2", leaseMs: 60_000 },
      new Date("2026-08-17T00:01:00.000Z")
    )).toThrow("another owner");

    const recovered = claimStabilitySchedule(
      leased,
      { owner: "claude", leaseId: "lease-2", leaseMs: 60_000 },
      new Date("2026-08-17T00:03:00.000Z")
    );
    expect(recovered.leaseOwner).toBe("claude");
    expect(recovered.leaseId).toBe("lease-2");
  });

  it("renews and releases a lease without losing the next schedule", () => {
    const claimed = claimStabilitySchedule(
      {
        status: "active",
        nextRunAt: "2026-08-17T00:00:00.000Z"
      },
      { owner: "codex", leaseId: "lease-1", leaseMs: 60_000 },
      new Date("2026-08-17T00:01:00.000Z")
    );
    const renewed = renewStabilityScheduleLease(
      claimed,
      { owner: "codex", leaseMs: 120_000 },
      new Date("2026-08-17T00:01:30.000Z")
    );
    const released = releaseStabilityScheduleLease(
      renewed,
      { owner: "codex", nextRunAt: "2026-08-18T00:00:00.000Z", lastError: "network" },
      new Date("2026-08-17T00:02:00.000Z")
    );

    expect(renewed.leaseExpiresAt).toBe("2026-08-17T00:03:30.000Z");
    expect(released).toMatchObject({
      nextRunAt: "2026-08-18T00:00:00.000Z",
      lastError: "network"
    });
    expect(released.leaseId).toBeUndefined();
  });
});
