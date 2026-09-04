// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutableCase } from "../domain/types.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("authorized exploration facade", () => {
  it("creates, approves, dispatches, reviews, and completes one bounded plan", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    seed(context);
    vi.spyOn(context.knowledgeService, "refreshSystemBrain").mockResolvedValue({} as never);
    vi.spyOn(context.knowledgeService, "resolveExplorationTask").mockImplementation((request) => {
      const task = context.repository.explorationTasks.find((item) => item.id === request.taskId)!;
      task.status = request.outcome === "resolved" ? "resolved" : "failed";
      return {
        task,
        executableCase: context.repository.executableCases.find(
          (item) => item.id === task.executableCaseId
        )
      } as never;
    });

    const created = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "create-exploration-plan",
      explorationTaskIds: ["exploration-task-1"],
      actorJourney: [{ role: "requester", authProfileId: "auth-requester" }],
      allowedRoutes: ["https://orders.example.test/orders"],
      explorationPlanActions: [{
        name: "Submit order",
        route: "https://orders.example.test/orders",
        role: "requester",
        write: true,
        sourceRefs: ["requirement:submit"]
      }],
      cleanupPolicy: "retain-with-label",
      maxWrites: 2,
      maxDurationMs: 60_000
    }));
    expect(created).toMatchObject({ status: "draft", requiresConfirmation: true });

    const preview = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-exploration-plan",
      explorationPlanId: created.plan.id,
      confirm: false
    }));
    expect(preview.status).toBe("preview");
    const approved = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-exploration-plan",
      explorationPlanId: created.plan.id,
      confirmationNote: "Approved for bounded test-environment exploration.",
      confirmedBy: "qa@example.test",
      confirm: true
    }));
    expect(approved.plan.status).toBe("approved");

    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {
      knowledgeProjectId: "project-1",
      responseMode: "full"
    }));
    expect(status).toMatchObject({
      activeExplorationPlanId: created.plan.id,
      nextAction: "start_exploration_plan"
    });

    const started = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "start-exploration-plan",
      explorationPlanId: created.plan.id
    }));
    expect(started).toMatchObject({
      status: "needs-agent-execution",
      workPackage: {
        maxWrites: 2,
        submitAction: "submit-exploration-result"
      }
    });

    const completed = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "submit-exploration-result",
      explorationPlanId: created.plan.id,
      explorationResult: {
        status: "succeeded",
        durationMs: 1_000,
        actionEvidence: [{
          actionId: started.plan.allowedActions[0].id,
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
      }
    }));
    expect(completed.status).toBe("completed");

    const review = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "exploration-plan",
      knowledgeProjectId: "project-1",
      id: created.plan.id
    }));
    expect(review.items).toEqual([
      expect.objectContaining({ id: created.plan.id, status: "completed" })
    ]);
  });
});

describe("requirement onboarding facade", () => {
  it("recommends onboarding for an evaluated draft with a bound system", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    seedOnboarding(context);

    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {
      knowledgeProjectId: "project-onboarding",
      responseMode: "full"
    }));

    expect(status.nextAction).toBe("create_onboarding_plan");
  });

  it("recommends test-data preparation while approved onboarding waits for data", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    seedOnboarding(context);
    context.repository.executableCases.push({
      id: "case-onboarding-needs-data",
      knowledgeProjectId: "project-onboarding",
      requirementSetId: "requirement-onboarding",
      testIntentId: "intent-onboarding",
      systemId: "system-onboarding",
      title: "Submit order with prepared data",
      status: "needs-data",
      preconditions: [],
      steps: [],
      dataPlan: {
        verdict: "blocked",
        reasons: ["Select an existing order"],
        operations: [],
        dependencyOrder: [],
        requiresConfirmation: true,
        requiresCleanup: false,
        sourceRefs: ["source:onboarding#line:1"]
      },
      dataProfileIds: [],
      explorationTaskIds: [],
      gapIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const created = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "create-onboarding-plan",
      requirementSetId: "requirement-onboarding",
      systemId: "system-onboarding",
      actorJourney: [{ role: "requester", authProfileId: "auth-onboarding" }],
      cleanupPolicy: "retain-with-label"
    }));
    dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-onboarding-plan",
      onboardingPlanId: created.onboardingPlan.id,
      confirmationNote: "Approve bounded onboarding.",
      confirmedBy: "qa-owner",
      confirm: true
    }));
    const started = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "start-onboarding-plan",
      onboardingPlanId: created.onboardingPlan.id
    }));
    expect(started.status).toBe("needs-data");

    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {
      knowledgeProjectId: "project-onboarding",
      responseMode: "full"
    }));

    expect(status.nextAction).toBe("prepare_test_data");
  });

  it("creates one reviewable plan and atomically approves the baseline and exploration", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    seedOnboarding(context);

    const created = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "create-onboarding-plan",
      requirementSetId: "requirement-onboarding",
      systemId: "system-onboarding",
      actorJourney: [{ role: "requester", authProfileId: "auth-onboarding" }],
      cleanupPolicy: "retain-with-label"
    }));
    expect(created).toEqual(expect.objectContaining({
      status: "draft",
      requiresConfirmation: true,
      explorationQuestions: expect.arrayContaining([
        expect.objectContaining({ query: expect.stringContaining("entry") })
      ])
    }));

    const preview = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-onboarding-plan",
      onboardingPlanId: created.onboardingPlan.id,
      confirm: false
    }));
    expect(preview).toEqual(expect.objectContaining({
      status: "preview",
      requiresConfirmation: true
    }));
    expect(context.repository.requirementSets[0].status).toBe("draft");

    const approved = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-onboarding-plan",
      onboardingPlanId: created.onboardingPlan.id,
      confirmationNote: "Approve the baseline and bounded exploration once.",
      confirmedBy: "qa-owner",
      confirm: true
    }));
    expect(approved).toMatchObject({
      status: "approved",
      onboardingPlan: { status: "approved" },
      requirementSet: { status: "approved" },
      explorationPlan: { status: "approved" }
    });

    const started = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "start-onboarding-plan",
      onboardingPlanId: created.onboardingPlan.id
    }));
    expect(started).toMatchObject({
      status: "needs-agent-execution",
      workPackage: {
        requirementQuestions: expect.arrayContaining([
          expect.objectContaining({ sourceRefs: ["source:onboarding#line:1"] })
        ])
      }
    });

    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {
      knowledgeProjectId: "project-onboarding",
      systemId: "system-onboarding",
      responseMode: "full"
    }));
    expect(status.knowledge.onboarding).toEqual(expect.objectContaining({
      active: expect.objectContaining({ id: created.onboardingPlan.id, status: "approved" })
    }));

    const review = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "onboarding-plan",
      requirementSetId: "requirement-onboarding",
      systemId: "system-onboarding"
    }));
    expect(review.items).toEqual([
      expect.objectContaining({ id: created.onboardingPlan.id, status: "approved" })
    ]);
  });

  it("returns the existing onboarding scope instead of creating a second plan", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    seedOnboarding(context);

    const first = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "create-onboarding-plan",
      requirementSetId: "requirement-onboarding",
      systemId: "system-onboarding",
      actorJourney: [{ role: "requester", authProfileId: "auth-onboarding" }],
      cleanupPolicy: "retain-with-label"
    }));
    const second = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "create-onboarding-plan",
      requirementSetId: "requirement-onboarding",
      systemId: "system-onboarding",
      actorJourney: [{ role: "requester", authProfileId: "auth-onboarding" }],
      cleanupPolicy: "retain-with-label",
      maxWrites: 10
    }));

    expect(second).toEqual(expect.objectContaining({
      reused: true,
      status: "draft",
      requiresConfirmation: true,
      nextAction: "approve-onboarding-plan",
      onboardingPlan: expect.objectContaining({ id: first.onboardingPlan.id }),
      explorationPlan: expect.objectContaining({ id: first.explorationPlan.id })
    }));
    expect(context.repository.onboardingPlans).toHaveLength(1);
    expect(context.repository.explorationPlans).toHaveLength(1);
  });
});

function seed(context: ReturnType<typeof createBrainCreatorMcpContext>) {
  const now = new Date().toISOString();
  context.repository.systemProfiles.push({
    id: "system-1",
    name: "Orders",
    environment: "test",
    baseUrl: "https://orders.example.test",
    defaultLocale: "en-US",
    urlAllowlist: ["https://orders.example.test"],
    status: "succeeded",
    createdAt: now,
    updatedAt: now
  });
  context.repository.knowledgeProjects.push({
    id: "project-1",
    key: "orders",
    name: "Orders Knowledge",
    defaultLocale: "en-US",
    status: "active",
    systemIds: ["system-1"],
    createdAt: now,
    updatedAt: now
  });
  context.repository.authProfiles.push({
    id: "auth-requester",
    projectId: "system-1",
    env: "test",
    role: "requester",
    loginMethod: "token",
    encryptedSecrets: {},
    status: "succeeded",
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now
  });
  context.repository.explorationTasks.push({
    id: "exploration-task-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    testIntentId: "intent-1",
    executableCaseId: "case-1",
    systemId: "system-1",
    kind: "state-action",
    status: "pending",
    reason: "Stateful submit evidence is missing",
    query: "Order submit",
    candidatePageModelIds: ["page-orders"],
    requestedEvidence: ["before and after state"],
    sourceRefs: ["requirement:submit"],
    resultSourceRefs: [],
    idempotencyKey: "exploration-task-key",
    createdAt: now,
    updatedAt: now
  });
  context.repository.executableCases.push(executableCase(now));
  context.repository.pageModels.push({
    id: "page-orders",
    projectId: "system-1",
    route: "https://orders.example.test/orders",
    name: "Orders",
    version: 1,
    domSnapshotId: "dom-orders",
    screenshotId: "shot-orders",
    status: "succeeded",
    createdAt: now,
    updatedAt: now
  });
}

function seedOnboarding(context: ReturnType<typeof createBrainCreatorMcpContext>) {
  const now = new Date().toISOString();
  context.repository.systemProfiles.push({
    id: "system-onboarding",
    name: "Orders",
    environment: "test",
    baseUrl: "https://orders.example.test",
    defaultLocale: "en-US",
    urlAllowlist: ["https://orders.example.test"],
    status: "succeeded",
    createdAt: now,
    updatedAt: now
  });
  context.repository.knowledgeProjects.push({
    id: "project-onboarding",
    key: "orders-onboarding",
    name: "Orders Knowledge",
    defaultLocale: "en-US",
    status: "active",
    systemIds: ["system-onboarding"],
    createdAt: now,
    updatedAt: now
  });
  context.repository.requirementSources.push({
    id: "source-onboarding",
    knowledgeProjectId: "project-onboarding",
    source: "requirements/orders.md",
    sourceType: "local-file",
    title: "Submit order",
    contentHash: "onboarding-hash",
    content: "A requester submits an order.",
    blocks: [{ type: "paragraph", text: "A requester submits an order." }],
    attachments: [],
    warnings: [],
    accessStatus: "available",
    revision: 1,
    latestRequirementSetId: "requirement-onboarding",
    createdAt: now,
    updatedAt: now
  });
  context.repository.requirementSets.push({
    id: "requirement-onboarding",
    knowledgeProjectId: "project-onboarding",
    sourceId: "source-onboarding",
    version: 1,
    title: "Submit order",
    summary: "A requester submits an order.",
    contentHash: "onboarding-hash",
    status: "draft",
    affectedNodeIds: [],
    evaluationGate: {
      policyId: "policy",
      policyVersion: "1",
      verdict: "pass",
      score: 1,
      coverage: { totalClauses: 1, coveredClauses: 1, coverageRate: 1, uncoveredSourceRefs: [] },
      status: "passed",
      actions: [],
      generatedAt: now
    },
    createdAt: now,
    updatedAt: now
  });
  context.repository.testIntents.push({
    id: "intent-onboarding",
    knowledgeProjectId: "project-onboarding",
    requirementSetId: "requirement-onboarding",
    title: "Submit order",
    module: "Orders",
    priority: "P0",
    objective: "Verify order submission",
    preconditions: [],
    expectedResults: ["Order is submitted"],
    requirementRefs: ["source:onboarding#line:1"],
    knowledgeNodeRefs: [],
    techniques: ["scenario"],
    processModelRefs: ["workflow-onboarding"],
    status: "draft",
    createdAt: now,
    updatedAt: now
  });
  context.repository.workflowModels.push({
    id: "workflow-onboarding",
    knowledgeProjectId: "project-onboarding",
    requirementSetId: "requirement-onboarding",
    title: "Order submission",
    actors: ["requester"],
    steps: [
      { id: "draft", label: "Draft", actor: "requester", sourceRefs: ["source:onboarding#line:1"] },
      { id: "submitted", label: "Submitted", actor: "requester", sourceRefs: ["source:onboarding#line:1"] }
    ],
    transitions: [{
      id: "submit",
      from: "draft",
      to: "submitted",
      actor: "requester",
      trigger: "submit",
      sourceRefs: ["source:onboarding#line:1"]
    }],
    startStepIds: ["draft"],
    endStepIds: ["submitted"],
    sourceRefs: ["source:onboarding#line:1"],
    confidence: 1,
    status: "draft",
    createdAt: now,
    updatedAt: now
  });
  context.repository.authProfiles.push({
    id: "auth-onboarding",
    projectId: "system-onboarding",
    env: "test",
    role: "requester",
    loginMethod: "token",
    encryptedSecrets: {},
    status: "succeeded",
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now
  });
}

function executableCase(now: string): ExecutableCase {
  return {
    id: "case-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    testIntentId: "intent-1",
    systemId: "system-1",
    title: "Submit order",
    status: "needs-exploration",
    preconditions: [],
    steps: [],
    dataProfileIds: [],
    explorationTaskIds: ["exploration-task-1"],
    gapIds: [],
    createdAt: now,
    updatedAt: now
  };
}

function dataOf(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Missing MCP text result");
  const envelope = JSON.parse(text);
  if (!envelope.success) throw new Error(envelope.errors?.join("; ") ?? "MCP call failed");
  return envelope.data;
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-stateful-exploration-"));
  tempDirs.push(dir);
  return dir;
}
