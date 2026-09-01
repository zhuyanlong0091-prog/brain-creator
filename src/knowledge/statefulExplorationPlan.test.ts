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

  it("accepts numbered test environments such as test5", () => {
    const fixture = createFixture();
    fixture.repository.systemProfiles[0].environment = "test5";
    fixture.repository.authProfiles[0].env = "test5";
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

    expect(() => fixture.service.approve({
      planId: plan.id,
      note: "Approved for the numbered test environment.",
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

  it("rejects an actor journey role that does not match its AuthProfile", () => {
    const fixture = createFixture();
    const plan = fixture.service.create({
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [{ role: "approver", authProfileId: "auth-requester" }],
      allowedRoutes: ["https://orders.example.test/orders"],
      allowedActions: [{
        name: "Approve order",
        route: "https://orders.example.test/orders",
        role: "approver",
        write: true,
        sourceRefs: ["source:approve"]
      }],
      cleanupPolicy: "retain-with-label"
    });

    expect(() => fixture.service.approve({
      planId: plan.id,
      note: "Role binding must be rejected.",
      approvedBy: "qa@example.test"
    })).toThrow("does not match AuthProfile role");
  });

  it("requires write actions to name a role when an exploration spans multiple actors", () => {
    const fixture = createFixture();
    fixture.repository.authProfiles.push({
      id: "auth-approver",
      projectId: "system-1",
      env: "test",
      role: "approver",
      loginMethod: "token",
      encryptedSecrets: {},
      status: "succeeded",
      lastVerifiedAt: now(),
      createdAt: now(),
      updatedAt: now()
    });

    expect(() => fixture.service.create({
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [
        { role: "requester", authProfileId: "auth-requester" },
        { role: "approver", authProfileId: "auth-approver" }
      ],
      allowedRoutes: ["https://orders.example.test/orders"],
      allowedActions: [{
        name: "Submit order",
        route: "https://orders.example.test/orders",
        write: true,
        sourceRefs: ["source:submit"]
      }],
      cleanupPolicy: "retain-with-label"
    })).toThrow("must name an authorized role");
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

  it("requires task-specific evidence for every onboarding question", async () => {
    const fixture = createFixture();
    fixture.repository.explorationTasks.push({
      ...fixture.repository.explorationTasks[0],
      id: "exploration-task-2",
      requestedEvidence: ["approval result"],
      idempotencyKey: "task-key-2"
    });
    const plan = fixture.service.create({
      explorationTaskIds: ["exploration-task-1", "exploration-task-2"],
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
    fixture.repository.onboardingPlans.push({
      id: "onboarding-1",
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      systemId: "system-1",
      requirementSummary: "Order approval",
      baselineAssetIds: ["intent-1"],
      explorationPlanId: plan.id,
      unresolvedQuestions: [],
      allowedRoutes: plan.allowedRoutes,
      allowedActions: plan.allowedActions.map((action) => action.name),
      forbiddenActions: plan.forbiddenActions,
      maxWrites: plan.maxWrites,
      maxDurationMs: plan.maxDurationMs,
      cleanupPolicy: plan.cleanupPolicy,
      status: "approved"
    });
    fixture.service.approve({
      planId: plan.id,
      note: "Approve per-question evidence collection",
      approvedBy: "qa@example.test"
    });
    fixture.service.start(plan.id);
    const result = {
      planId: plan.id,
      status: "succeeded" as const,
      durationMs: 1_000,
      actionEvidence: [{
        actionId: plan.allowedActions[0].id,
        action: "Submit order",
        route: "https://orders.example.test/orders",
        role: "requester",
        sourceRefs: ["evidence:submit"]
      }],
      evidenceRefs: ["evidence:global"],
      pageModelIds: [],
      systemExplorationIds: [],
      trainingSessionIds: [],
      cleanupStatus: "not-required" as const
    };

    await expect(fixture.service.submit({
      ...result,
      taskEvidence: [{
        taskId: "exploration-task-1",
        observedEvidence: ["before and after state"],
        evidenceRefs: ["evidence:state"]
      }]
    })).rejects.toThrow("every onboarding question");

    await expect(fixture.service.submit({
      ...result,
      evidenceRefs: ["evidence:global", "evidence:state", "evidence:approval"],
      taskEvidence: [
        {
          taskId: "exploration-task-1",
          observedEvidence: ["before and after state"],
          evidenceRefs: ["evidence:state"]
        },
        {
          taskId: "exploration-task-2",
          observedEvidence: ["button text"],
          evidenceRefs: ["evidence:approval"]
        }
      ]
    })).rejects.toThrow("missing requested evidence");

    await expect(fixture.service.submit({
      ...result,
      taskEvidence: [
        {
          taskId: "exploration-task-1",
          observedEvidence: ["before and after state"],
          evidenceRefs: ["evidence:state"]
        },
        {
          taskId: "exploration-task-2",
          observedEvidence: ["approval result"],
          evidenceRefs: ["evidence:approval"]
        }
      ]
    })).rejects.toThrow("outside the submitted exploration evidence");

    const completed = await fixture.service.submit({
      ...result,
      evidenceRefs: ["evidence:global", "evidence:state", "evidence:approval"],
      taskEvidence: [
        {
          taskId: "exploration-task-1",
          observedEvidence: ["before and after state"],
          evidenceRefs: ["evidence:state"]
        },
        {
          taskId: "exploration-task-2",
          observedEvidence: ["approval result"],
          evidenceRefs: ["evidence:approval"]
        }
      ]
    });

    expect(completed.plan.status).toBe("completed");
    expect(fixture.port.resolveExplorationTask).toHaveBeenCalledWith({
      taskId: "exploration-task-1",
      outcome: "resolved",
      evidenceRefs: ["evidence:state"]
    });
    expect(fixture.port.resolveExplorationTask).toHaveBeenCalledWith({
      taskId: "exploration-task-2",
      outcome: "resolved",
      evidenceRefs: ["evidence:approval"]
    });
  });

  it("accepts evidence on a child route within the authorized action scope", async () => {
    const fixture = createFixture();
    const plan = fixture.service.create({
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [{ role: "requester", authProfileId: "auth-requester" }],
      allowedRoutes: ["https://orders.example.test"],
      allowedActions: [{
        name: "Submit order",
        route: "https://orders.example.test",
        role: "requester",
        write: true,
        sourceRefs: ["source:submit"]
      }],
      cleanupPolicy: "retain-with-label"
    });
    fixture.service.approve({
      planId: plan.id,
      note: "Approve route scope",
      approvedBy: "qa@example.test"
    });
    fixture.service.start(plan.id);

    const completed = await fixture.service.submit({
      planId: plan.id,
      status: "succeeded",
      durationMs: 1_000,
      actionEvidence: [{
        actionId: plan.allowedActions[0].id,
        action: "Submit order",
        route: "https://orders.example.test/orders/42",
        role: "requester",
        sourceRefs: ["evidence:submit"]
      }],
      evidenceRefs: ["evidence:submit"],
      pageModelIds: [],
      systemExplorationIds: [],
      trainingSessionIds: [],
      cleanupStatus: "not-required"
    });

    expect(completed.plan.status).toBe("completed");
  });

  it("rejects evidence that changes an approved action query", async () => {
    const fixture = createFixture();
    const plan = fixture.service.create({
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [{ role: "requester", authProfileId: "auth-requester" }],
      allowedRoutes: ["https://orders.example.test"],
      allowedActions: [{
        name: "Preview order",
        route: "https://orders.example.test/orders?operation=preview",
        role: "requester",
        write: false,
        sourceRefs: ["source:preview"]
      }],
      cleanupPolicy: "retain-with-label"
    });
    fixture.service.approve({
      planId: plan.id,
      note: "Approve preview only",
      approvedBy: "qa@example.test"
    });
    fixture.service.start(plan.id);

    await expect(fixture.service.submit({
      planId: plan.id,
      status: "succeeded",
      durationMs: 1_000,
      actionEvidence: [{
        actionId: plan.allowedActions[0].id,
        action: "Preview order",
        route: "https://orders.example.test/orders?operation=delete",
        role: "requester",
        sourceRefs: ["evidence:unexpected-query"]
      }],
      evidenceRefs: ["evidence:unexpected-query"],
      pageModelIds: [],
      systemExplorationIds: [],
      trainingSessionIds: [],
      cleanupStatus: "not-required"
    })).rejects.toThrow("does not match the authorized exploration plan");
  });

  it("rejects evidence that switches back to an earlier actor", async () => {
    const fixture = createFixture();
    fixture.repository.authProfiles.push({
      id: "auth-approver",
      projectId: "system-1",
      env: "test",
      role: "approver",
      loginMethod: "token",
      encryptedSecrets: {},
      status: "succeeded",
      lastVerifiedAt: now(),
      createdAt: now(),
      updatedAt: now()
    });
    const plan = fixture.service.create({
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [
        { role: "requester", authProfileId: "auth-requester" },
        { role: "approver", authProfileId: "auth-approver" }
      ],
      allowedRoutes: ["https://orders.example.test/orders"],
      allowedActions: [
        {
          name: "Submit order",
          route: "https://orders.example.test/orders",
          role: "requester",
          write: true,
          sourceRefs: ["source:submit"]
        },
        {
          name: "Approve order",
          route: "https://orders.example.test/orders",
          role: "approver",
          write: true,
          sourceRefs: ["source:approve"]
        }
      ],
      cleanupPolicy: "retain-with-label",
      maxWrites: 3
    });
    fixture.service.approve({
      planId: plan.id,
      note: "Approved for ordered actor journey.",
      approvedBy: "qa@example.test"
    });
    fixture.service.start(plan.id);

    await expect(fixture.service.submit({
      planId: plan.id,
      status: "succeeded",
      durationMs: 1_000,
      actionEvidence: [
        {
          actionId: plan.allowedActions[0].id,
          action: "Submit order",
          route: "https://orders.example.test/orders",
          role: "requester",
          sourceRefs: ["evidence:submit"]
        },
        {
          actionId: plan.allowedActions[1].id,
          action: "Approve order",
          route: "https://orders.example.test/orders",
          role: "approver",
          sourceRefs: ["evidence:approve"]
        },
        {
          actionId: plan.allowedActions[0].id,
          action: "Submit order",
          route: "https://orders.example.test/orders",
          role: "requester",
          sourceRefs: ["evidence:unexpected-switch-back"]
        }
      ],
      evidenceRefs: ["evidence:actor-journey"],
      pageModelIds: [],
      systemExplorationIds: [],
      trainingSessionIds: [],
      cleanupStatus: "not-required"
    })).rejects.toThrow("actor journey order");
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
