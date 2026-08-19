// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { ExecutableCase } from "../domain/types.js";
import { StatefulExplorationPlanService } from "./statefulExplorationPlan.js";

describe("StatefulExplorationPlanService", () => {
  it("creates and approves one bounded plan for pending compilation exploration", () => {
    const fixture = createFixture();
    const plan = fixture.service.create({
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [{ role: "requester", authProfileId: "auth-requester" }],
      allowedRoutes: ["https://orders.example.test/orders"],
      allowedActions: [{
        name: "Submit order",
        route: "https://orders.example.test/orders",
        role: "requester",
        write: true,
        sourceRefs: ["source:submit"]
      }],
      cleanupPolicy: "retain-with-label",
      maxWrites: 2,
      maxDurationMs: 60_000
    });

    expect(plan).toEqual(expect.objectContaining({
      status: "draft",
      systemId: "system-1",
      explorationTaskIds: ["exploration-task-1"]
    }));
    expect(() => fixture.service.approve({
      planId: plan.id,
      note: "Approved for the isolated test environment.",
      approvedBy: "qa@example.test"
    })).not.toThrow();
    expect(plan.status).toBe("approved");
  });

  it("rejects production, cross-allowlist, unverified-role, and destructive plans", () => {
    const fixture = createFixture();
    const outside = fixture.service.create({
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [{ role: "requester", authProfileId: "auth-requester" }],
      allowedRoutes: ["https://outside.example.test/orders"],
      allowedActions: [{
        name: "Delete order",
        route: "https://outside.example.test/orders",
        role: "requester",
        write: true,
        sourceRefs: ["source:delete"]
      }],
      cleanupPolicy: "delete"
    });

    expect(() => fixture.service.approve({
      planId: outside.id,
      note: "Try unsafe plan",
      approvedBy: "qa@example.test"
    })).toThrow("outside the business system allowlist");

    fixture.repository.systemProfiles[0].environment = "production";
    const production = fixture.service.create({
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [{ role: "requester", authProfileId: "auth-requester" }],
      allowedRoutes: ["https://orders.example.test/orders"],
      allowedActions: [{
        name: "Submit order",
        route: "https://orders.example.test/orders",
        role: "requester",
        write: true,
        sourceRefs: ["source:submit"]
      }],
      cleanupPolicy: "close"
    });
    expect(() => fixture.service.approve({
      planId: production.id,
      note: "Try production",
      approvedBy: "qa@example.test"
    })).toThrow("test or staging environment");

    const unverifiedFixture = createFixture();
    unverifiedFixture.repository.authProfiles[0].status = "failed";
    const unverified = unverifiedFixture.service.create({
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [{ role: "requester", authProfileId: "auth-requester" }],
      allowedRoutes: ["https://orders.example.test/orders"],
      allowedActions: [{
        name: "Submit order",
        route: "https://orders.example.test/orders",
        role: "requester",
        write: true,
        sourceRefs: ["source:submit"]
      }],
      cleanupPolicy: "close"
    });
    expect(() => unverifiedFixture.service.approve({
      planId: unverified.id,
      note: "Try unverified role",
      approvedBy: "qa@example.test"
    })).toThrow("requires verified authentication");

    const destructiveFixture = createFixture();
    const destructive = destructiveFixture.service.create({
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [{ role: "requester", authProfileId: "auth-requester" }],
      allowedRoutes: ["https://orders.example.test/orders"],
      allowedActions: [{
        name: "Delete order",
        route: "https://orders.example.test/orders",
        role: "requester",
        write: true,
        sourceRefs: ["source:delete"]
      }],
      cleanupPolicy: "delete"
    });
    expect(() => destructiveFixture.service.approve({
      planId: destructive.id,
      note: "Try destructive action",
      approvedBy: "qa@example.test"
    })).toThrow("action is forbidden");
  });

  it("waits for test data before returning an evidence-bound host work package", () => {
    const fixture = createFixture({ needsData: true });
    const plan = approvedPlan(fixture);

    expect(fixture.service.start(plan.id)).toEqual(expect.objectContaining({
      status: "needs-data",
      executableCaseIds: ["case-1"]
    }));

    fixture.repository.executableCases[0].dataPlan!.operations[0].status = "ready";
    fixture.repository.executableCases[0].dataPlan!.operations[0].decision = "reuse";
    fixture.repository.executableCases[0].dataPlan!.operations[0].reference = "order:42";
    fixture.repository.executableCases[0].dataPlan!.verdict = "ready";
    const started = fixture.service.start(plan.id);

    expect(started).toEqual(expect.objectContaining({
      status: "needs-agent-execution",
      plan: expect.objectContaining({ status: "running" }),
      workPackage: expect.objectContaining({
        maxWrites: 2,
        evidenceRequirements: expect.arrayContaining(["before-state", "after-state"])
      })
    }));
  });

  it("cancels an unstarted plan and releases its pending compilation task", () => {
    const fixture = createFixture();
    const plan = fixture.service.create({
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [{ role: "requester", authProfileId: "auth-requester" }],
      allowedRoutes: ["https://orders.example.test/orders"],
      allowedActions: [{
        name: "Submit order",
        route: "https://orders.example.test/orders",
        role: "requester",
        write: true,
        sourceRefs: ["source:submit"]
      }],
      cleanupPolicy: "retain-with-label"
    });

    expect(fixture.service.cancel({
      planId: plan.id,
      note: "User declined stateful writes."
    }).status).toBe("cancelled");
    expect(fixture.port.resolveExplorationTask).toHaveBeenCalledWith({
      taskId: "exploration-task-1",
      outcome: "cancelled"
    });
  });

  it("validates submitted actions and resolves compilation tasks after evidence returns", async () => {
    const fixture = createFixture();
    const plan = approvedPlan(fixture);
    fixture.service.start(plan.id);

    await expect(fixture.service.submit({
      planId: plan.id,
      status: "succeeded",
      durationMs: 1_000,
      actionEvidence: [{
        actionId: "unknown-action",
        action: "Publish order",
        route: "https://orders.example.test/orders",
        role: "requester",
        sourceRefs: ["evidence:publish"]
      }],
      evidenceRefs: ["page-model:page-orders"],
      pageModelIds: ["page-orders"],
      systemExplorationIds: [],
      trainingSessionIds: [],
      cleanupStatus: "not-required"
    })).rejects.toThrow("not authorized by the exploration plan");

    const completed = await fixture.service.submit({
      planId: plan.id,
      status: "succeeded",
      durationMs: 1_000,
      actionEvidence: [{
        actionId: plan.allowedActions[0].id,
        action: "Submit order",
        route: "https://orders.example.test/orders",
        role: "requester",
        sourceRefs: ["evidence:submit"]
      }],
      evidenceRefs: ["page-model:page-orders", "evidence:submit"],
      pageModelIds: ["page-orders"],
      systemExplorationIds: [],
      trainingSessionIds: [],
      cleanupStatus: "not-required"
    });

    expect(completed.plan.status).toBe("completed");
    expect(fixture.port.refreshSystemBrain).toHaveBeenCalledWith("project-1", "system-1");
    expect(fixture.port.resolveExplorationTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "exploration-task-1",
      outcome: "resolved"
    }));
  });

  it("blocks completion and creates a gap while created test data still needs cleanup", async () => {
    const fixture = createFixture();
    const plan = fixture.service.create({
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [{ role: "requester", authProfileId: "auth-requester" }],
      allowedRoutes: ["https://orders.example.test/orders"],
      allowedActions: [{
        name: "Submit order",
        route: "https://orders.example.test/orders",
        role: "requester",
        write: true,
        sourceRefs: ["source:submit"]
      }],
      cleanupPolicy: "delete",
      maxWrites: 1
    });
    fixture.repository.testDataLeases.push({
      id: "lease-created-order",
      knowledgeProjectId: "project-1",
      systemId: "system-1",
      executableCaseId: "case-1",
      profileId: "profile-order",
      taskId: "task-order",
      decision: "create",
      reference: "order:42",
      cleanup: "delete-created",
      status: "active",
      sourceRefs: ["evidence:created-order"],
      createdAt: now(),
      updatedAt: now()
    });
    fixture.service.approve({
      planId: plan.id,
      note: "Approved with mandatory cleanup.",
      approvedBy: "qa@example.test"
    });
    fixture.service.start(plan.id);

    const blocked = await fixture.service.submit({
      planId: plan.id,
      status: "succeeded",
      durationMs: 1_000,
      actionEvidence: [{
        actionId: plan.allowedActions[0].id,
        action: "Submit order",
        route: "https://orders.example.test/orders",
        role: "requester",
        sourceRefs: ["evidence:submit"]
      }],
      evidenceRefs: ["evidence:submit"],
      pageModelIds: [],
      systemExplorationIds: [],
      trainingSessionIds: [],
      cleanupStatus: "failed"
    });

    expect(blocked.plan).toEqual(expect.objectContaining({
      status: "blocked",
      gapIds: [expect.any(String)]
    }));
    expect(fixture.repository.gaps).toEqual([
      expect.objectContaining({ sourceType: "stateful-exploration", severity: "high" })
    ]);
    expect(fixture.port.resolveExplorationTask).not.toHaveBeenCalled();
  });

  it("fails closed with a gap when System Brain refresh cannot resume compilation", async () => {
    const fixture = createFixture();
    const plan = approvedPlan(fixture);
    fixture.service.start(plan.id);
    fixture.port.refreshSystemBrain.mockRejectedValueOnce(new Error("refresh unavailable"));

    const blocked = await fixture.service.submit({
      planId: plan.id,
      status: "succeeded",
      durationMs: 1_000,
      actionEvidence: [{
        actionId: plan.allowedActions[0].id,
        action: "Submit order",
        route: "https://orders.example.test/orders",
        role: "requester",
        sourceRefs: ["evidence:submit"]
      }],
      evidenceRefs: ["evidence:submit"],
      pageModelIds: [],
      systemExplorationIds: [],
      trainingSessionIds: [],
      cleanupStatus: "not-required"
    });

    expect(blocked).toEqual(expect.objectContaining({
      plan: expect.objectContaining({ status: "blocked" }),
      gap: expect.objectContaining({
        reason: expect.stringContaining("refresh unavailable")
      })
    }));
  });
});

function approvedPlan(fixture: ReturnType<typeof createFixture>) {
  const plan = fixture.service.create({
    explorationTaskIds: ["exploration-task-1"],
    actorJourney: [{ role: "requester", authProfileId: "auth-requester" }],
    allowedRoutes: ["https://orders.example.test/orders"],
    allowedActions: [{
      name: "Submit order",
      route: "https://orders.example.test/orders",
      role: "requester",
      write: true,
      sourceRefs: ["source:submit"]
    }],
    cleanupPolicy: "retain-with-label",
    maxWrites: 2,
    maxDurationMs: 60_000
  });
  fixture.service.approve({
    planId: plan.id,
    note: "Approved for bounded state exploration.",
    approvedBy: "qa@example.test"
  });
  return plan;
}

function createFixture(input: { needsData?: boolean } = {}) {
  const repository = new InMemoryBrainCreatorRepository();
  repository.systemProfiles.push({
    id: "system-1",
    name: "Orders",
    environment: "test",
    baseUrl: "https://orders.example.test",
    defaultLocale: "en-US",
    urlAllowlist: ["https://orders.example.test"],
    status: "succeeded",
    createdAt: now(),
    updatedAt: now()
  });
  repository.knowledgeProjects.push({
    id: "project-1",
    name: "Orders Knowledge",
    key: "orders",
    defaultLocale: "en-US",
    systemIds: ["system-1"],
    status: "active",
    createdAt: now(),
    updatedAt: now()
  });
  repository.authProfiles.push({
    id: "auth-requester",
    projectId: "system-1",
    env: "test",
    role: "requester",
    loginMethod: "token",
    encryptedSecrets: {},
    status: "succeeded",
    lastVerifiedAt: now(),
    createdAt: now(),
    updatedAt: now()
  });
  repository.explorationTasks.push({
    id: "exploration-task-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    testIntentId: "intent-1",
    executableCaseId: "case-1",
    systemId: "system-1",
    kind: "state-action",
    status: "pending",
    reason: "Approval and close actions require stateful evidence",
    query: "Order approval",
    candidatePageModelIds: [],
    requestedEvidence: ["before and after state"],
    sourceRefs: ["source:approval"],
    resultSourceRefs: [],
    idempotencyKey: "task-key",
    createdAt: now(),
    updatedAt: now()
  });
  repository.executableCases.push(executableCase(input.needsData));
  repository.pageModels.push({
    id: "page-orders",
    projectId: "system-1",
    route: "https://orders.example.test/orders",
    name: "Orders",
    version: 1,
    domSnapshotId: "dom-orders",
    screenshotId: "shot-orders",
    status: "succeeded",
    createdAt: now(),
    updatedAt: now()
  });
  const port = {
    confirmExecutableCaseTestData: vi.fn(),
    refreshSystemBrain: vi.fn(async () => ({})),
    resolveExplorationTask: vi.fn((request: { taskId: string; outcome: string }) => {
      const task = repository.explorationTasks.find((item) => item.id === request.taskId)!;
      task.status = request.outcome === "resolved" ? "resolved" : "failed";
      return { task };
    })
  };
  return {
    repository,
    port,
    service: new StatefulExplorationPlanService(repository, port)
  };
}

function executableCase(needsData = false): ExecutableCase {
  return {
    id: "case-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    testIntentId: "intent-1",
    systemId: "system-1",
    title: "Approve order",
    status: needsData ? "needs-data" : "needs-exploration",
    preconditions: [],
    steps: [],
    dataPlan: needsData ? {
      verdict: "blocked",
      reasons: ["Order reference must be selected"],
      operations: [{
        profileId: "profile-order",
        field: "Order",
        strategy: "existing-reference",
        decision: "lookup",
        status: "needs-resolution",
        dependsOnProfileIds: [],
        cleanup: "none",
        constraints: [],
        sourceRefs: ["source:order"]
      }],
      dependencyOrder: ["profile-order"],
      requiresConfirmation: false,
      requiresCleanup: false,
      sourceRefs: ["source:order"]
    } : undefined,
    dataProfileIds: needsData ? ["profile-order"] : [],
    explorationTaskIds: ["exploration-task-1"],
    gapIds: [],
    createdAt: now(),
    updatedAt: now()
  };
}

function now() {
  return "2026-08-19T00:00:00.000Z";
}
