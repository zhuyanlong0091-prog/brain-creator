// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  AuthProfile,
  ExecutableCase,
  Gap,
  KnowledgeProject,
  RequirementSet,
  SystemProfile,
  TestDataLease,
  TestDataTask,
  TestIntent
} from "../domain/types.js";
import { ExecutionPreflightService } from "./executionPreflight.js";

describe("ExecutionPreflightService", () => {
  it("persists one immutable ready plan for the same snapshot", () => {
    const fixture = preflightFixture();

    const preview = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: false
    });
    const first = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    const second = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    expect(preview).toEqual(
      expect.objectContaining({
        status: "preview",
        persisted: false,
        draft: expect.objectContaining({ verdict: "ready" })
      })
    );
    expect(first.executionPlan).toEqual(
      expect.objectContaining({
        title: fixture.executableCase.title,
        preconditions: fixture.executableCase.preconditions,
        contextPack: expect.objectContaining({
          knowledgeProjectId: fixture.project.id,
          purpose: "generator"
        }),
        verdict: "ready",
        snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    );
    expect(second.executionPlan?.id).toBe(first.executionPlan?.id);
    expect(fixture.repository.executionPlans).toHaveLength(1);

    fixture.executableCase.updatedAt = "2026-07-30T01:00:00.000Z";
    const timestampOnly = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    expect(timestampOnly.executionPlan?.id).toBe(first.executionPlan?.id);

    fixture.executableCase.steps[0].instruction = "Open a changed form";
    const changed = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    expect(changed.executionPlan?.id).not.toBe(first.executionPlan?.id);
    expect(fixture.repository.executionPlans).toHaveLength(2);
    expect(first.executionPlan!.steps[0].instruction).toBe("Open the form");
  });

  it("validates a frozen plan and rejects semantic or blocking changes", () => {
    const fixture = preflightFixture();
    const prepared = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    const executionPlanId = prepared.executionPlan!.id;

    expect(fixture.service.validatePlan(executionPlanId)).toEqual(
      expect.objectContaining({
        status: "valid",
        valid: true,
        currentSnapshotHash: prepared.executionPlan!.snapshotHash
      })
    );

    fixture.executableCase.updatedAt = "2026-07-30T02:00:00.000Z";
    expect(fixture.service.validatePlan(executionPlanId).status).toBe("valid");

    fixture.executableCase.steps[0].instruction = "Open another form";
    const stale = fixture.service.validatePlan(executionPlanId);
    expect(stale).toEqual(
      expect.objectContaining({
        status: "stale",
        valid: false,
        reasons: [expect.stringContaining("snapshot")]
      })
    );

    fixture.executableCase.steps[0].instruction = "Open the form";
    fixture.repository.knowledgeNodes.push({
      id: "knowledge-after-plan",
      knowledgeProjectId: fixture.project.id,
      requirementSetId: fixture.requirementSet.id,
      type: "rule",
      title: "Create order validation",
      content: "Create order requires a newly confirmed validation rule.",
      module: "Orders",
      sourceRefs: ["requirement:orders-rule"],
      origin: "source",
      confidence: 1,
      status: "confirmed",
      createdAt: now(),
      updatedAt: now()
    });
    expect(fixture.service.validatePlan(executionPlanId).status).toBe("stale");
    fixture.repository.knowledgeNodes.pop();

    const gap: Gap = {
      id: "gap-after-plan",
      projectId: fixture.project.id,
      sourceType: "system-observation",
      sourceId: fixture.executableCase.id,
      reason: "The observed workflow changed.",
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: now(),
      updatedAt: now()
    };
    fixture.repository.gaps.push(gap);
    fixture.executableCase.gapIds.push(gap.id);
    const blocked = fixture.service.validatePlan(executionPlanId);
    expect(blocked).toEqual(
      expect.objectContaining({
        status: "blocked",
        valid: false,
        reasons: [expect.stringContaining("open Gap")]
      })
    );
  });

  it("blocks unapproved requirements, open case gaps, and cross-system execution", () => {
    const fixture = preflightFixture();
    fixture.requirementSet.status = "draft";
    const gap: Gap = {
      id: "gap-open",
      projectId: fixture.project.id,
      sourceType: "system-observation",
      sourceId: fixture.executableCase.id,
      reason: "Observed behavior conflicts with the approved expectation.",
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: now(),
      updatedAt: now()
    };
    fixture.repository.gaps.push(gap);
    fixture.executableCase.gapIds.push(gap.id);

    const result = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    expect(result.status).toBe("blocked");
    expect(result.persisted).toBe(false);
    expect(result.draft.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("approved"),
        expect.stringContaining("open Gap")
      ])
    );
    expect(() =>
      fixture.service.prepare({
        knowledgeProjectId: fixture.project.id,
        systemId: "system-other",
        executableCaseId: fixture.executableCase.id,
        confirm: false
      })
    ).toThrow("system");
  });

  it("requires explicit confirmation for proposed generated data", () => {
    const fixture = preflightFixture();
    fixture.executableCase.dataPlan = {
      verdict: "ready",
      reasons: [],
      operations: [{
        profileId: "profile-name",
        field: "Name",
        strategy: "generated",
        decision: "generate",
        status: "proposed",
        value: "bc-name-42",
        dependsOnProfileIds: [],
        cleanup: "none",
        constraints: [],
        sourceRefs: ["requirement:name"]
      }],
      dependencyOrder: ["profile-name"],
      requiresConfirmation: true,
      requiresCleanup: false,
      sourceRefs: ["requirement:name"]
    };

    const result = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    expect(result.status).toBe("needs-confirmation");
    expect(result.persisted).toBe(false);
    expect(result.draft.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "test-data",
          status: "action-required"
        })
      ])
    );
  });

  it("requires an active matching lease for reused or created references", () => {
    const fixture = preflightFixture();
    fixture.executableCase.dataPlan = referenceDataPlan();

    const blocked = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.draft.blockers).toEqual([
      expect.stringContaining("active data lease")
    ]);

    const lease = dataLease(fixture, { decision: "reuse", cleanup: "none" });
    fixture.repository.testDataLeases.push(lease);
    const ready = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });
    expect(ready.status).toBe("ready");
    expect(ready.executionPlan?.dataBindings).toEqual([
      expect.objectContaining({
        profileId: "profile-customer",
        reference: "customer:42",
        leaseId: lease.id
      })
    ]);
  });

  it("blocks while a test-data task is pending", () => {
    const fixture = preflightFixture();
    fixture.repository.testDataTasks.push(dataTask(fixture));

    const result = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    expect(result.status).toBe("blocked");
    expect(result.draft.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "test-data-tasks",
          status: "blocked"
        })
      ])
    );
  });

  it("blocks reruns until created data from terminal execution is cleaned", () => {
    const fixture = preflightFixture();
    fixture.executableCase.dataPlan = referenceDataPlan("create");
    fixture.repository.testDataLeases.push(
      dataLease(fixture, {
        decision: "create",
        cleanup: "delete-created"
      })
    );
    fixture.repository.executionEvidence.push({
      id: "evidence-terminal",
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      testCaseId: "test-case-terminal",
      contextPackPath: "context.json",
      status: "passed",
      steps: [],
      tracePaths: [],
      artifactPaths: [],
      consoleErrors: [],
      networkFailures: [],
      createdAt: now(),
      completedAt: now()
    });

    const result = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    expect(result.status).toBe("blocked");
    expect(result.draft.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "test-data-cleanup",
          status: "blocked"
        })
      ])
    );
  });

  it("validates an explicitly selected auth profile without storing secrets", () => {
    const fixture = preflightFixture();
    const auth: AuthProfile = {
      id: "auth-manager",
      projectId: fixture.system.id,
      env: "test",
      role: "manager",
      loginMethod: "token",
      encryptedSecrets: { token: "encrypted-secret-token" },
      status: "pending",
      createdAt: now(),
      updatedAt: now()
    };
    fixture.repository.authProfiles.push(auth);

    const blocked = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      authProfileId: auth.id,
      confirm: true
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.draft.blockers).toEqual([
      expect.stringContaining("verified")
    ]);

    auth.status = "succeeded";
    auth.lastVerifiedAt = now();
    const ready = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      authProfileId: auth.id,
      confirm: true
    });
    expect(ready.status).toBe("ready");
    expect(ready.executionPlan?.auth).toEqual({
      profileId: auth.id,
      role: "manager",
      method: "token",
      verifiedAt: auth.lastVerifiedAt
    });
    expect(JSON.stringify(ready.executionPlan)).not.toContain(
      "encrypted-secret-token"
    );
  });

  it("stores secret references without copying secret values", () => {
    const fixture = preflightFixture();
    fixture.executableCase.dataPlan = {
      verdict: "ready",
      reasons: [],
      operations: [{
        profileId: "profile-token",
        field: "API Token",
        strategy: "secret-reference",
        decision: "resolve-secret",
        status: "ready",
        secretRef: "env:TEST_API_TOKEN",
        dependsOnProfileIds: [],
        cleanup: "none",
        constraints: [],
        sourceRefs: ["requirement:token"]
      }],
      dependencyOrder: ["profile-token"],
      requiresConfirmation: false,
      requiresCleanup: false,
      sourceRefs: ["requirement:token"]
    };

    const result = fixture.service.prepare({
      knowledgeProjectId: fixture.project.id,
      systemId: fixture.system.id,
      executableCaseId: fixture.executableCase.id,
      confirm: true
    });

    expect(result.executionPlan?.dataBindings).toEqual([
      expect.objectContaining({
        profileId: "profile-token",
        secretRef: "env:TEST_API_TOKEN"
      })
    ]);
    expect(result.executionPlan?.dataBindings[0]).not.toHaveProperty("value");
  });
});

function preflightFixture() {
  const repository = new InMemoryBrainCreatorRepository();
  const project: KnowledgeProject = {
    id: "knowledge-orders",
    key: "orders",
    name: "Orders",
    defaultLocale: "en-US",
    status: "active",
    systemIds: ["system-orders"],
    createdAt: now(),
    updatedAt: now()
  };
  const system: SystemProfile = {
    id: "system-orders",
    name: "Orders Test",
    environment: "test",
    baseUrl: "https://orders.example.test",
    defaultLocale: "en-US",
    urlAllowlist: ["https://orders.example.test"],
    status: "succeeded",
    createdAt: now(),
    updatedAt: now()
  };
  const requirementSet: RequirementSet = {
    id: "requirement-orders",
    knowledgeProjectId: project.id,
    sourceId: "source-orders",
    version: 1,
    title: "Orders",
    summary: "Users create orders.",
    contentHash: "orders-v1",
    status: "approved",
    affectedNodeIds: [],
    approvedAt: now(),
    createdAt: now(),
    updatedAt: now()
  };
  const intent: TestIntent = {
    id: "intent-orders",
    knowledgeProjectId: project.id,
    requirementSetId: requirementSet.id,
    title: "Create an order",
    module: "Orders",
    priority: "P1",
    objective: "Create an order.",
    preconditions: [],
    expectedResults: ["The order is created."],
    requirementRefs: ["requirement:orders"],
    knowledgeNodeRefs: [],
    techniques: ["scenario"],
    status: "compiled",
    createdAt: now(),
    updatedAt: now()
  };
  const executableCase: ExecutableCase = {
    id: "executable-orders",
    knowledgeProjectId: project.id,
    requirementSetId: requirementSet.id,
    testIntentId: intent.id,
    systemId: system.id,
    title: intent.title,
    status: "ready",
    preconditions: [],
    steps: [{
      id: "step-open",
      order: 1,
      action: "navigate",
      instruction: "Open the form",
      targetSemantic: "Order form",
      origin: "source",
      sourceRefs: ["requirement:orders"]
    }],
    dataProfileIds: [],
    gapIds: [],
    createdAt: now(),
    updatedAt: now()
  };
  repository.knowledgeProjects.push(project);
  repository.systemProfiles.push(system);
  repository.requirementSets.push(requirementSet);
  repository.testIntents.push(intent);
  repository.executableCases.push(executableCase);
  return {
    repository,
    project,
    system,
    requirementSet,
    intent,
    executableCase,
    service: new ExecutionPreflightService(repository)
  };
}

function referenceDataPlan(decision: "reuse" | "create" = "reuse"): NonNullable<ExecutableCase["dataPlan"]> {
  return {
    verdict: "ready",
    reasons: [],
    operations: [{
      profileId: "profile-customer",
      field: "Customer",
      strategy: "existing-reference",
      decision,
      status: "ready",
      value: "Existing Customer",
      reference: "customer:42",
      dependsOnProfileIds: [],
      cleanup: decision === "create" ? "delete-created" : "none",
      constraints: ["status must be active"],
      sourceRefs: ["requirement:customer"]
    }],
    dependencyOrder: ["profile-customer"],
    requiresConfirmation: false,
    requiresCleanup: decision === "create",
    sourceRefs: ["requirement:customer"]
  };
}

function dataTask(fixture: ReturnType<typeof preflightFixture>): TestDataTask {
  return {
    id: "testDataTask-pending",
    knowledgeProjectId: fixture.project.id,
    systemId: fixture.system.id,
    executableCaseId: fixture.executableCase.id,
    profileId: "profile-customer",
    field: "Customer",
    action: "lookup-or-create",
    status: "pending",
    idempotencyKey: "pending-task",
    allowCreate: false,
    cleanup: "none",
    contextPath: "input.context.json",
    promptPath: "input.prompt.md",
    sourceRefs: ["requirement:customer"],
    outputSourceRefs: [],
    createdAt: now(),
    updatedAt: now()
  };
}

function dataLease(
  fixture: ReturnType<typeof preflightFixture>,
  input: Pick<TestDataLease, "decision" | "cleanup">
): TestDataLease {
  return {
    id: `testDataLease-${input.decision}`,
    knowledgeProjectId: fixture.project.id,
    systemId: fixture.system.id,
    executableCaseId: fixture.executableCase.id,
    profileId: "profile-customer",
    taskId: "testDataTask-complete",
    decision: input.decision,
    reference: "customer:42",
    value: "Existing Customer",
    cleanup: input.cleanup,
    status: "active",
    sourceRefs: ["api:customers/42"],
    createdAt: now(),
    updatedAt: now()
  };
}

function now() {
  return "2026-07-30T00:00:00.000Z";
}
