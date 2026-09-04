import { describe, expect, it, vi } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { StatefulExplorationPlanService } from "./statefulExplorationPlan.js";
import { OnboardingPlanService } from "./onboardingPlan.js";

describe("OnboardingPlanService", () => {
  it("turns requirement process models into bounded, traceable exploration questions", () => {
    const fixture = createFixture();
    fixture.repository.testIntents.push({
      ...fixture.repository.testIntents[0],
      id: "intent-unmodeled",
      title: "Search orders without a process model",
      requirementRefs: ["source:orders#line:3"],
      processModelRefs: []
    });
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });

    expect(created.onboardingPlan).toEqual(expect.objectContaining({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      status: "draft",
      maxWrites: 20,
      maxDurationMs: 300_000,
      explorationPlanId: created.explorationPlan.id
    }));
    expect(created.explorationQuestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "navigation-path", query: expect.stringContaining("entry") }),
      expect.objectContaining({ kind: "state-action", query: expect.stringContaining("state") }),
      expect.objectContaining({ kind: "state-action", query: expect.stringContaining("decision") })
    ]));
    expect(created.explorationQuestions.every((task) => task.sourceRefs.length > 0)).toBe(true);
    expect(created.explorationQuestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ testIntentId: "intent-unmodeled", kind: "locator-evidence" })
    ]));
    expect(created.explorationQuestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        testIntentId: "intent-1",
        kind: "locator-evidence",
        requestedEvidence: ["entry page", "controls", "role", "test data", "observable outcome"],
        approvedEvidenceScope: expect.arrayContaining([
          "page model",
          "state transition",
          "locator point"
        ])
      })
    ]));
    expect(created.explorationPlan.allowedActions
      .filter((action) => action.write)
      .every((action) => action.role)).toBe(true);
    expect(created.explorationPlan.allowedActions.map((action) => action.name)).toEqual(
      expect.arrayContaining(["submit", "approve"])
    );
    expect(created.onboardingPlan.baselineAssetIds).toEqual(expect.arrayContaining([
      "workflow-1",
      "state-machine-1",
      "decision-table-1",
      "intent-1"
    ]));
    expect(created.onboardingPlan.baselineFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects onboarding for archived projects and cancelled systems", () => {
    const archived = createFixture();
    archived.repository.knowledgeProjects[0].status = "archived";
    expect(() => archived.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    })).toThrow("active knowledge project");

    const cancelled = createFixture();
    cancelled.repository.systemProfiles[0].status = "cancelled";
    expect(() => cancelled.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    })).toThrow("cancelled business system");
  });

  it("requires a new onboarding plan when the requirement baseline changes", () => {
    const fixture = createFixture();
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });
    fixture.repository.testIntents[0].objective = "Verify a changed approval journey";
    fixture.repository.testIntents[0].updatedAt = "2026-09-01T00:00:00.000Z";

    expect(() => fixture.service.approve({
      onboardingPlanId: created.onboardingPlan.id,
      note: "Approve stale plan",
      approvedBy: "qa-owner"
    })).toThrow("baseline changed");
    expect(fixture.repository.requirementSets[0].status).toBe("draft");
    expect(fixture.repository.explorationPlans[0].status).toBe("draft");
  });

  it("does not start an approved onboarding plan after its baseline changes", () => {
    const fixture = createFixture();
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });
    fixture.service.approve({
      onboardingPlanId: created.onboardingPlan.id,
      note: "Approve current baseline",
      approvedBy: "qa-owner"
    });
    fixture.repository.testIntents[0].objective = "Verify a post-approval requirement change";
    fixture.repository.testIntents[0].updatedAt = "2026-09-01T00:01:00.000Z";

    expect(() => fixture.service.start(created.onboardingPlan.id)).toThrow("baseline changed");
    expect(created.onboardingPlan.status).toBe("approved");
    expect(created.explorationPlan.status).toBe("approved");
  });

  it("does not reuse exploration tasks across different intents or process models", () => {
    const fixture = createFixture();
    fixture.repository.testIntents.push({
      ...fixture.repository.testIntents[0],
      id: "intent-2",
      title: "Reject a submitted order",
      processModelRefs: []
    });
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });

    const bindingTasks = created.explorationQuestions.filter(
      (task) => task.kind === "locator-evidence"
    );
    expect(bindingTasks.map((task) => task.testIntentId).sort()).toEqual([
      "intent-1",
      "intent-2"
    ]);
    expect(new Set(bindingTasks.map((task) => task.idempotencyKey)).size).toBe(2);
  });

  it("reuses the same active onboarding and exploration plan", () => {
    const fixture = createFixture();
    const input = {
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete" as const
    };

    const first = fixture.service.create(input);
    const second = fixture.service.create(input);

    expect(second.onboardingPlan.id).toBe(first.onboardingPlan.id);
    expect(second.explorationPlan.id).toBe(first.explorationPlan.id);
    expect(fixture.repository.onboardingPlans).toHaveLength(1);
  });

  it("keeps one onboarding plan when the same scope is requested with a different budget", () => {
    const fixture = createFixture();
    const first = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });

    const second = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete",
      maxWrites: 10
    });

    expect(second.reused).toBe(true);
    expect(second.onboardingPlan.id).toBe(first.onboardingPlan.id);
    expect(second.explorationPlan.id).toBe(first.explorationPlan.id);
    expect(fixture.repository.onboardingPlans).toHaveLength(1);
    expect(fixture.repository.explorationPlans).toHaveLength(1);
  });

  it("keeps one onboarding plan after the existing scope reaches a terminal state", () => {
    const fixture = createFixture();
    const first = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });
    first.onboardingPlan.status = "blocked";
    first.explorationPlan.status = "blocked";

    const second = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });

    expect(second.reused).toBe(true);
    expect(second.onboardingPlan.id).toBe(first.onboardingPlan.id);
    expect(second.onboardingPlan.status).toBe("blocked");
    expect(fixture.repository.onboardingPlans).toHaveLength(1);
    expect(fixture.repository.explorationPlans).toHaveLength(1);
  });

  it("keeps onboarding plans independent across systems and requirement versions", () => {
    const fixture = createFixture();
    fixture.repository.systemProfiles.push({
      ...fixture.repository.systemProfiles[0],
      id: "system-2",
      name: "Orders EU",
      baseUrl: "https://orders-eu.example.test",
      urlAllowlist: ["https://orders-eu.example.test"]
    });
    fixture.repository.knowledgeProjects[0].systemIds.push("system-2");
    fixture.repository.requirementSets.push({
      ...fixture.repository.requirementSets[0],
      id: "requirement-2",
      version: 2,
      title: "Order approval revision",
      contentHash: "requirement-hash-v2"
    });
    fixture.repository.testIntents.push({
      ...fixture.repository.testIntents[0],
      id: "intent-2",
      requirementSetId: "requirement-2",
      title: "Approve the revised order journey"
    });

    const first = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });
    const second = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-2",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });
    const third = fixture.service.create({
      requirementSetId: "requirement-2",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });

    expect(new Set([
      first.onboardingPlan.id,
      second.onboardingPlan.id,
      third.onboardingPlan.id
    ])).toHaveLength(3);
    expect(fixture.repository.onboardingPlans).toHaveLength(3);
    expect(fixture.repository.onboardingPlans.map((plan) => [
      plan.requirementSetId,
      plan.systemId
    ])).toEqual(expect.arrayContaining([
      ["requirement-1", "system-1"],
      ["requirement-1", "system-2"],
      ["requirement-2", "system-1"]
    ]));
  });

  it("approves the requirement baseline and exploration boundary in one operation", () => {
    const fixture = createFixture();
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });

    const approved = fixture.service.approve({
      onboardingPlanId: created.onboardingPlan.id,
      note: "Approve the requirement baseline and bounded exploration",
      approvedBy: "qa-owner"
    });

    expect(approved.onboardingPlan).toEqual(expect.objectContaining({
      status: "approved",
      approvedBy: "qa-owner"
    }));
    expect(approved.requirementSet.status).toBe("approved");
    expect(approved.explorationPlan.status).toBe("approved");
    expect(fixture.knowledge.validateRequirementSetApproval).toHaveBeenCalledBefore(
      fixture.knowledge.approveRequirementSet
    );
  });

  it("does not partially approve the requirement when exploration authentication is invalid", () => {
    const fixture = createFixture({ verifiedAuth: false });
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });

    expect(() => fixture.service.approve({
      onboardingPlanId: created.onboardingPlan.id,
      note: "Attempt approval",
      approvedBy: "qa-owner"
    })).toThrow("verified authentication");
    expect(fixture.repository.requirementSets[0].status).toBe("draft");
    expect(fixture.repository.explorationPlans[0].status).toBe("draft");
    expect(fixture.knowledge.approveRequirementSet).not.toHaveBeenCalled();
  });

  it("rolls back both approvals when the transaction cannot be persisted", () => {
    const fixture = createFixture();
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });
    vi.spyOn(fixture.repository, "persist").mockImplementation(() => {
      throw new Error("store unavailable");
    });

    expect(() => fixture.service.approve({
      onboardingPlanId: created.onboardingPlan.id,
      note: "Approve as one transaction",
      approvedBy: "qa-owner"
    })).toThrow("store unavailable");
    expect(fixture.repository.requirementSets[0].status).toBe("draft");
    expect(fixture.repository.explorationPlans[0].status).toBe("draft");
    expect(fixture.repository.onboardingPlans[0].status).toBe("draft");
  });

  it("rejects destructive model triggers instead of hiding them behind generic actions", () => {
    const fixture = createFixture();
    fixture.repository.workflowModels[0].transitions[0].trigger = "Delete order";
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });

    expect(() => fixture.service.approve({
      onboardingPlanId: created.onboardingPlan.id,
      note: "Unsafe action must not be approved",
      approvedBy: "qa-owner"
    })).toThrow("action is forbidden");
  });

  it("rechecks requirement questions after the user resolves them", () => {
    const fixture = createFixture({ pendingEval: true });
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });
    expect(created.onboardingPlan.unresolvedQuestions).toEqual([
      "Confirm who may approve an order"
    ]);

    const evaluationGate = fixture.repository.requirementSets[0].evaluationGate!;
    evaluationGate.actions[0].status = "confirmed";
    evaluationGate.status = "passed";
    evaluationGate.verdict = "pass";

    const approved = fixture.service.approve({
      onboardingPlanId: created.onboardingPlan.id,
      note: "Requirement question resolved",
      approvedBy: "qa-owner"
    });

    expect(approved.onboardingPlan.status).toBe("approved");
    expect(approved.onboardingPlan.unresolvedQuestions).toEqual([]);
  });

  it("starts an approved onboarding with requirement questions and active data leases", () => {
    const fixture = createFixture();
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });
    fixture.service.approve({
      onboardingPlanId: created.onboardingPlan.id,
      note: "Approved",
      approvedBy: "qa-owner"
    });
    fixture.repository.testDataLeases.push({
      id: "lease-1",
      knowledgeProjectId: "project-1",
      systemId: "system-1",
      executableCaseId: "case-1",
      profileId: "profile-1",
      taskId: "data-task-1",
      decision: "reuse",
      reference: "order:fixture-1",
      cleanup: "none",
      status: "active",
      sourceRefs: ["test-data:order:fixture-1"],
      createdAt: now(),
      updatedAt: now()
    });
    fixture.repository.explorationPlans[0].executableCaseIds = ["case-1"];
    fixture.repository.executableCases.push({
      id: "case-1",
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      testIntentId: "intent-1",
      systemId: "system-1",
      title: "Explore approval",
      status: "needs-exploration",
      preconditions: [],
      steps: [],
      dataProfileIds: [],
      explorationTaskIds: created.explorationQuestions.map((task) => task.id),
      gapIds: [],
      createdAt: now(),
      updatedAt: now()
    });

    const started = fixture.service.start(created.onboardingPlan.id);

    expect(started.status).toBe("needs-agent-execution");
    expect(started.workPackage).toEqual(expect.objectContaining({
      requirementQuestions: expect.arrayContaining([
        expect.objectContaining({ sourceRefs: expect.any(Array) })
      ]),
      testDataLeaseIds: ["lease-1"],
      maxWrites: 20,
      maxDurationMs: 300_000
    }));
  });

  it("compiles and binds intent-level test data before exploration starts", () => {
    const fixture = createFixture();
    fixture.repository.testDataProfiles.push({
      id: "profile-order",
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      name: "Order fixture",
      field: "orderId",
      strategy: "existing-reference",
      constraints: [],
      seed: "order-fixture",
      sourceRefs: ["source:orders#line:1"],
      createdAt: now()
    });
    const approvedTaskIds: string[] = [];
    fixture.knowledge.compileExecutableCases.mockImplementation(() => {
      const compilerTask = {
        ...fixture.repository.explorationTasks[0],
        id: "compiler-task",
        status: "pending" as const,
        requestedEvidence: ["page model", "navigation edge", "confirmed page binding"],
        idempotencyKey: "compiler-task-key"
      };
      fixture.repository.explorationTasks.push(compilerTask);
      const executableCase = {
        id: "case-needs-data",
        knowledgeProjectId: "project-1",
        requirementSetId: "requirement-1",
        testIntentId: "intent-1",
        systemId: "system-1",
        title: "Approve a submitted order",
        status: "needs-data" as const,
        preconditions: [],
        steps: [],
        dataPlan: {
          verdict: "blocked" as const,
          reasons: ["Select an existing order"],
          operations: [],
          dependencyOrder: [],
          requiresConfirmation: true,
          requiresCleanup: false,
          sourceRefs: ["source:orders#line:1"]
        },
        dataProfileIds: ["profile-order"],
        explorationTaskIds: [compilerTask.id],
        gapIds: [],
        createdAt: now(),
        updatedAt: now()
      };
      fixture.repository.executableCases.push(executableCase);
      return { executableCase };
    });
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });
    approvedTaskIds.push(...created.explorationPlan.explorationTaskIds);
    fixture.service.approve({
      onboardingPlanId: created.onboardingPlan.id,
      note: "Approved",
      approvedBy: "qa-owner"
    });

    const started = fixture.service.start(created.onboardingPlan.id);

    expect(started).toEqual(expect.objectContaining({
      status: "needs-data",
      executableCaseIds: ["case-needs-data"]
    }));
    expect(fixture.repository.explorationPlans[0].executableCaseIds).toEqual([
      "case-needs-data"
    ]);
    expect(fixture.repository.explorationPlans[0].explorationTaskIds).toEqual(approvedTaskIds);
    expect(fixture.repository.explorationTasks.find((item) => item.id === "compiler-task"))
      .toEqual(expect.objectContaining({ status: "cancelled" }));
  });

  it("preserves terminal compiler task history while binding an approved plan", () => {
    const fixture = createFixture();
    fixture.knowledge.compileExecutableCases.mockImplementation(() => {
      const compilerTask = {
        ...fixture.repository.explorationTasks[0],
        id: "compiler-task-failed",
        status: "failed" as const,
        requestedEvidence: ["locator point", "action binding", "assertion evidence"],
        failureReason: "Earlier probe failed",
        idempotencyKey: "compiler-task-failed-key"
      };
      fixture.repository.explorationTasks.push(compilerTask);
      const executableCase = {
        id: "case-with-history",
        knowledgeProjectId: "project-1",
        requirementSetId: "requirement-1",
        testIntentId: "intent-1",
        systemId: "system-1",
        title: "Approve a submitted order",
        status: "needs-exploration" as const,
        preconditions: [],
        steps: [],
        dataProfileIds: [],
        explorationTaskIds: [compilerTask.id],
        gapIds: [],
        createdAt: now(),
        updatedAt: now()
      };
      fixture.repository.executableCases.push(executableCase);
      return { executableCase };
    });
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });
    fixture.service.approve({
      onboardingPlanId: created.onboardingPlan.id,
      note: "Approved",
      approvedBy: "qa-owner"
    });

    fixture.service.start(created.onboardingPlan.id);

    expect(fixture.repository.explorationTasks.find((item) => item.id === "compiler-task-failed"))
      .toEqual(expect.objectContaining({
        status: "failed",
        failureReason: "Earlier probe failed"
      }));
  });

  it("does not execute a post-approval data plan before its values are confirmed", () => {
    const fixture = createFixture();
    fixture.knowledge.compileExecutableCases.mockImplementation(() => {
      const executableCase = {
        id: "case-unconfirmed-data",
        knowledgeProjectId: "project-1",
        requirementSetId: "requirement-1",
        testIntentId: "intent-1",
        systemId: "system-1",
        title: "Create an order with generated data",
        status: "ready",
        preconditions: [],
        steps: [],
        dataPlan: {
          verdict: "ready",
          reasons: [],
          operations: [{
            profileId: "profile-generated",
            decision: "generate",
            status: "proposed",
            value: "bc-order-001",
            sourceRefs: ["source:orders#line:1"]
          }],
          dependencyOrder: ["profile-generated"],
          requiresConfirmation: true,
          requiresCleanup: false,
          sourceRefs: ["source:orders#line:1"]
        },
        dataProfileIds: ["profile-generated"],
        explorationTaskIds: [],
        gapIds: [],
        createdAt: now(),
        updatedAt: now()
      } as never;
      fixture.repository.executableCases.push(executableCase);
      fixture.repository.testIntents[0].status = "needs-data";
      return { executableCase };
    });
    const created = fixture.service.create({
      requirementSetId: "requirement-1",
      systemId: "system-1",
      actorJourney: actorJourney(),
      cleanupPolicy: "delete"
    });
    fixture.service.approve({
      onboardingPlanId: created.onboardingPlan.id,
      note: "Approved",
      approvedBy: "qa-owner"
    });

    const started = fixture.service.start(created.onboardingPlan.id);
    const restarted = fixture.service.start(created.onboardingPlan.id);

    expect(started).toEqual(expect.objectContaining({
      status: "needs-data",
      executableCaseIds: ["case-unconfirmed-data"]
    }));
    expect(restarted).toEqual(expect.objectContaining({
      status: "needs-data",
      executableCaseIds: ["case-unconfirmed-data"]
    }));
    expect(fixture.repository.executableCases[0].dataPlan?.confirmedAt).toBeUndefined();
  });
});

function createFixture(input: { verifiedAuth?: boolean; pendingEval?: boolean } = {}) {
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
    key: "orders",
    name: "Orders Knowledge",
    defaultLocale: "en-US",
    status: "active",
    systemIds: ["system-1"],
    createdAt: now(),
    updatedAt: now()
  });
  repository.requirementSets.push({
    id: "requirement-1",
    knowledgeProjectId: "project-1",
    sourceId: "source-1",
    version: 1,
    title: "Order approval",
    summary: "A requester submits an order and an approver decides it.",
    contentHash: "requirement-hash",
    status: "draft",
    affectedNodeIds: [],
    evaluationGate: {
      policyId: "policy",
      policyVersion: "1",
      verdict: input.pendingEval ? "needs-user" : "pass",
      score: input.pendingEval ? 0.6 : 1,
      coverage: { totalClauses: 3, coveredClauses: 3, coverageRate: 1, uncoveredSourceRefs: [] },
      status: input.pendingEval ? "needs-confirmation" : "passed",
      actions: input.pendingEval ? [{
        id: "eval-action-1",
        kind: "clarification",
        message: "Confirm who may approve an order",
        sourceRefs: ["source:orders#line:2"],
        gapIds: [],
        status: "pending",
        createdAt: now()
      }] : [],
      generatedAt: now()
    },
    createdAt: now(),
    updatedAt: now()
  });
  repository.testIntents.push({
    id: "intent-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    title: "Approve a submitted order",
    module: "Orders",
    priority: "P0",
    objective: "Verify the approval journey",
    preconditions: ["An order exists"],
    expectedResults: ["The order becomes approved"],
    requirementRefs: ["source:orders#line:1"],
    knowledgeNodeRefs: [],
    techniques: ["state-transition"],
    coverageDimensions: ["workflow", "state"],
    processModelRefs: ["workflow-1", "state-machine-1", "decision-table-1"],
    actorJourney: ["requester", "approver"],
    status: "draft",
    createdAt: now(),
    updatedAt: now()
  });
  repository.workflowModels.push({
    id: "workflow-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    title: "Order approval journey",
    actors: ["requester", "approver"],
    steps: [
      { id: "draft", label: "Draft order", actor: "requester", sourceRefs: ["source:orders#line:1"] },
      { id: "submitted", label: "Submit order", actor: "requester", sideEffects: ["status becomes submitted"], sourceRefs: ["source:orders#line:1"] },
      { id: "approved", label: "Approve order", actor: "approver", sourceRefs: ["source:orders#line:2"] }
    ],
    transitions: [
      { id: "submit", from: "draft", to: "submitted", actor: "requester", trigger: "submit", sourceRefs: ["source:orders#line:1"] },
      { id: "approve", from: "submitted", to: "approved", actor: "approver", trigger: "approve", sourceRefs: ["source:orders#line:2"] }
    ],
    startStepIds: ["draft"],
    endStepIds: ["approved"],
    sourceRefs: ["source:orders#line:1", "source:orders#line:2"],
    confidence: 1,
    status: "draft",
    createdAt: now(),
    updatedAt: now()
  });
  repository.stateMachineModels.push({
    id: "state-machine-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    title: "Order states",
    states: [
      { id: "draft", label: "Draft", initial: true, terminal: false, sourceRefs: ["source:orders#line:1"] },
      { id: "approved", label: "Approved", initial: false, terminal: true, sourceRefs: ["source:orders#line:2"] }
    ],
    transitions: [{ id: "approve", from: "draft", to: "approved", trigger: "approve", actor: "approver", validity: "legal", sourceRefs: ["source:orders#line:2"] }],
    sourceRefs: ["source:orders#line:1", "source:orders#line:2"],
    confidence: 1,
    status: "draft",
    createdAt: now(),
    updatedAt: now()
  });
  repository.decisionTableModels.push({
    id: "decision-table-1",
    requirementSetId: "requirement-1",
    title: "Approval permission",
    conditions: ["role is approver"],
    actions: ["allow approval"],
    rules: [{
      conditionValues: { role: "approver" },
      expectedActions: ["allow approval"],
      sourceRefs: ["source:orders#line:2"]
    }],
    sourceRefs: ["source:orders#line:2"],
    status: "draft"
  });
  repository.authProfiles.push({
    id: "auth-requester",
    projectId: "system-1",
    env: "test",
    role: "requester",
    loginMethod: "token",
    encryptedSecrets: {},
    status: input.verifiedAuth === false ? "failed" : "succeeded",
    ...(input.verifiedAuth === false ? {} : { lastVerifiedAt: now() }),
    createdAt: now(),
    updatedAt: now()
  });
  repository.authProfiles.push({
    id: "auth-approver",
    projectId: "system-1",
    env: "test",
    role: "approver",
    loginMethod: "token",
    encryptedSecrets: {},
    status: input.verifiedAuth === false ? "failed" : "succeeded",
    ...(input.verifiedAuth === false ? {} : { lastVerifiedAt: now() }),
    createdAt: now(),
    updatedAt: now()
  });
  const knowledge = {
    validateRequirementSetApproval: vi.fn(() => {
      const requirement = repository.requirementSets[0];
      if (requirement.evaluationGate?.actions.some((action) => action.status === "pending")) {
        throw new Error("Requirement Eval actions must be confirmed before approval");
      }
      return requirement;
    }),
    approveRequirementSet: vi.fn(() => {
      repository.requirementSets[0].status = "approved";
      return repository.requirementSets[0];
    }),
    compileExecutableCases: vi.fn((
      _testIntentId: string,
      _systemId?: string
    ): { executableCase: { id: string; explorationTaskIds?: string[] } } => {
      throw new Error("Unexpected compile in fixture");
    }),
    confirmExecutableCaseTestData: vi.fn(),
    refreshSystemBrain: vi.fn(async () => ({})),
    resolveExplorationTask: vi.fn()
  };
  const exploration = new StatefulExplorationPlanService(repository, knowledge);
  return {
    repository,
    knowledge,
    exploration,
    service: new OnboardingPlanService(repository, knowledge, exploration)
  };
}

function actorJourney() {
  return [
    { role: "requester", authProfileId: "auth-requester" },
    { role: "approver", authProfileId: "auth-approver" }
  ];
}

function now() {
  return "2026-08-31T00:00:00.000Z";
}
