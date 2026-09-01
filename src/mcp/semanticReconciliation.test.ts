// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SystemBrain } from "../knowledge/systemBrain.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function dataOf(result: CallToolResult) {
  const content = result.content[0];
  if (content.type !== "text") throw new Error("Expected text response");
  return JSON.parse(content.text).data;
}

function brain(): SystemBrain {
  return {
    knowledgeProjectId: "knowledge-orders",
    systemId: "system-orders",
    pages: [],
    workflows: [],
    behaviorRules: [],
    apiFlows: [],
    navigationEdges: [],
    states: [],
    stateTransitions: [{
      id: "transition-create",
      explorationId: "exploration-orders",
      pageModelId: "page-orders",
      pageUrl: "/orders",
      targetName: "新建订单",
      targetRole: "button",
      targetSelector: "#create-order",
      targetKind: "disclosure",
      action: "click",
      beforeStateId: "state-list",
      afterStateId: "state-form",
      visibleAdded: ["订单名称"],
      visibleRemoved: [],
      dialogAdded: [],
      dialogRemoved: [],
      urlChanged: false,
      sourceRefs: ["system-exploration:exploration-orders"]
    }],
    observations: [],
    conflicts: [],
    readiness: {
      pageEvidence: false,
      locatorEvidence: false,
      workflowEvidence: false,
      apiEvidence: false,
      navigationEvidence: false,
      stateEvidence: true,
      readyForCompilation: false
    }
  };
}

describe("semantic binding facade", () => {
  it("reconciles a requirement action against the current System Brain and reviews it", async () => {
    const root = await mkdtemp(join(tmpdir(), "brain-semantic-facade-"));
    tempDirs.push(root);
    const context = createBrainCreatorMcpContext({
      workDir: root,
      dataFilePath: join(root, "assets.json"),
      knowledgeDir: join(root, "knowledge")
    });
    const system = context.service.createSystemProfile({
      name: "Orders",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"]
    });
    const project = await context.knowledgeService.createProject({
      name: "Orders Knowledge",
      key: "orders-semantic",
      defaultLocale: "en-US"
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    const requirementSet = {
      id: "requirement-orders",
      knowledgeProjectId: project.id,
      sourceId: "source-orders",
      version: 1,
      title: "Create order",
      summary: "Create order",
      contentHash: "orders-hash",
      status: "approved" as const,
      affectedNodeIds: [],
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    context.repository.requirementSets.push(requirementSet);
    context.semanticSpine.upsertConcept({
      identityKey: "requirement:orders:create",
      kind: "action",
      canonicalName: "create",
      aliases: ["新增"],
      knowledgeProjectId: project.id,
      requirementSetId: requirementSet.id,
      sourceRefs: ["requirement:clause-create"],
      status: "confirmed",
      confidence: 1
    });
    context.systemBrainSnapshots.capture({
      knowledgeProjectId: project.id,
      systemId: system.id,
      brain: { ...brain(), knowledgeProjectId: project.id, systemId: system.id }
    });

    const reconciled = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reconcile-system-brain",
      knowledgeProjectId: project.id,
      systemId: system.id,
      requirementSetId: requirementSet.id,
      responseMode: "summary"
    }));
    expect(reconciled.summary.alias).toBe(1);
    expect(context.repository.semanticBindings).toHaveLength(1);

    const reviewed = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "semantic-binding",
      knowledgeProjectId: project.id,
      systemId: system.id
    }));
    expect(reviewed.summary.total).toBe(1);
    expect(reviewed.items[0].expectedSemanticId).toBe(context.repository.semanticBindings[0].expectedSemanticId);

    const preview = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "confirm-semantic-binding",
      semanticBindingId: context.repository.semanticBindings[0].id,
      confirm: false
    }));
    expect(preview.requiresConfirmation).toBe(true);
    const confirmed = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "confirm-semantic-binding",
      semanticBindingId: context.repository.semanticBindings[0].id,
      confirm: true,
      confirmedBy: "tester"
    }));
    expect(confirmed.binding.status).toBe("confirmed");
  });
});
