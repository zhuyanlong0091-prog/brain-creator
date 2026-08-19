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
