// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("System Brain snapshot MCP review", () => {
  it("captures refresh history and exposes a diff through the review facade", async () => {
    const root = await mkdtemp(join(tmpdir(), "brain-system-snapshot-"));
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
      key: "orders-knowledge",
      defaultLocale: "en-US"
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    context.repository.pageModels.push({
      id: "page-orders",
      projectId: system.id,
      route: "/orders",
      name: "Orders",
      version: 1,
      domSnapshotId: "dom-orders",
      screenshotId: "shot-orders",
      status: "succeeded",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z"
    });
    context.repository.locatorPoints.push({
      id: "locator-create",
      pageModelId: "page-orders",
      name: "Create",
      selector: "#create",
      role: "button",
      text: "Create",
      fallbackSelectors: [],
      confidence: 1
    });

    await context.knowledgeService.refreshSystemBrain(project.id, system.id);
    expect(context.semanticSpine.resolve("Create", { systemId: system.id })).toEqual(
      expect.objectContaining({ kind: "object", canonicalName: "create" })
    );
    context.repository.locatorPoints[0].selector = "[data-testid=create]";
    await context.knowledgeService.refreshSystemBrain(project.id, system.id);

    const historyResult = await handleBrainCreatorTool(context, "bc_review", {
      target: "system-brain",
      knowledgeProjectId: project.id,
      systemId: system.id,
      view: "history"
    });
    const historyText = historyResult.content.find((item) => item.type === "text");
    expect(historyText?.text).toContain("snapshots");
    expect(context.systemBrainSnapshots.history(system.id)).toHaveLength(2);

    const [first, second] = context.systemBrainSnapshots.history(system.id).reverse();
    const diffResult = await handleBrainCreatorTool(context, "bc_review", {
      target: "system-brain",
      knowledgeProjectId: project.id,
      systemId: system.id,
      view: "diff",
      fromSnapshotId: first.id,
      toSnapshotId: second.id
    });
    const diffText = diffResult.content.find((item) => item.type === "text");
    expect(diffText?.text).toContain("locator-changed");

    const latestCandidate = context.systemBrainSnapshots.history(system.id)[0];
    const preview = await handleBrainCreatorTool(context, "bc_prepare", {
      action: "confirm-system-snapshot",
      knowledgeProjectId: project.id,
      systemId: system.id,
      systemBrainSnapshotId: latestCandidate.id,
      confirm: false
    });
    const previewText = preview.content.find((item) => item.type === "text");
    expect(previewText?.text).toContain("requiresConfirmation");

    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "confirm-system-snapshot",
      knowledgeProjectId: project.id,
      systemId: system.id,
      systemBrainSnapshotId: latestCandidate.id,
      confirm: true,
      confirmedBy: "tester"
    });
    expect(context.systemBrainSnapshots.latest(system.id)?.id).toBe(latestCandidate.id);
  });

  it("marks cases stale when confirmed System Brain behavior changes and recompiles a new case", async () => {
    const root = await mkdtemp(join(tmpdir(), "brain-system-stale-"));
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
      key: "orders-stale",
      defaultLocale: "en-US"
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    context.repository.pageModels.push({
      id: "page-orders-stale",
      projectId: system.id,
      route: "/orders",
      name: "Orders",
      version: 1,
      domSnapshotId: "dom-orders",
      screenshotId: "shot-orders",
      status: "succeeded",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z"
    });
    context.repository.locatorPoints.push({
      id: "locator-submit-stale",
      pageModelId: "page-orders-stale",
      name: "Submit",
      selector: "#submit",
      role: "button",
      text: "Submit",
      fallbackSelectors: [],
      confidence: 1
    });
    const transition = {
      id: "transition-submit-stale",
      explorationId: "exploration-stale",
      pageModelId: "page-orders-stale",
      pageUrl: "/orders",
      targetName: "Submit",
      targetRole: "button" as const,
      targetSelector: "#submit",
      targetKind: "disclosure" as const,
      action: "click" as const,
      before: {
        id: "state-draft",
        url: "/orders",
        visibleElements: ["Submit"],
        dialogs: []
      },
      after: {
        id: "state-submitted",
        url: "/orders",
        visibleElements: ["Approval"],
        dialogs: []
      },
      beforeStateId: "state-draft",
      afterStateId: "state-submitted",
      visibleAdded: ["Approval"],
      visibleRemoved: [],
      dialogAdded: [],
      dialogRemoved: [],
      urlChanged: false,
      transitionKind: "state" as const,
      status: "observed" as const,
      blockedRequests: [],
      sourceRefs: ["system-exploration:exploration-stale"]
    };
    context.repository.systemExplorations.push({
      id: "exploration-stale",
      knowledgeProjectId: project.id,
      systemId: system.id,
      startUrl: "https://orders.example.test/orders",
      status: "completed",
      interactionMode: "safe",
      budget: { maxPages: 1, maxDepth: 1, maxDurationMs: 1000, maxInteractionsPerPage: 1 },
      pageModelIds: ["page-orders-stale"],
      navigationEdges: [],
      interactionTransitions: [transition],
      warnings: [],
      gapIds: [],
      artifactDir: root,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z"
    });
    const requirementSet = {
      id: "requirement-stale",
      knowledgeProjectId: project.id,
      sourceId: "source-stale",
      version: 1,
      title: "Submit order",
      summary: "Submit order",
      contentHash: "hash-stale",
      status: "approved" as const,
      affectedNodeIds: [],
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z"
    };
    context.repository.requirementSets.push(requirementSet);
    context.repository.testIntents.push({
      id: "intent-stale",
      knowledgeProjectId: project.id,
      requirementSetId: requirementSet.id,
      title: "Submit order",
      module: "Orders",
      priority: "P1",
      objective: "Submit an order",
      preconditions: [],
      expectedResults: ["Approval is visible"],
      requirementRefs: ["clause:submit"],
      knowledgeNodeRefs: [],
      techniques: [],
      status: "compiled",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z"
    });
    context.repository.executableCases.push({
      id: "case-stale",
      knowledgeProjectId: project.id,
      requirementSetId: requirementSet.id,
      testIntentId: "intent-stale",
      systemId: system.id,
      title: "Submit order",
      status: "ready",
      compileKey: "old-compile-key",
      preconditions: [],
      steps: [{
        id: "step-stale",
        order: 1,
        action: "click",
        instruction: "Submit the order",
        targetSemantic: "Submit",
        origin: "observed",
        sourceRefs: ["system-exploration:exploration-stale"]
      }],
      dataProfileIds: [],
      gapIds: [],
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z"
    });
    context.repository.testIntents.push({
      id: "intent-unaffected",
      knowledgeProjectId: project.id,
      requirementSetId: requirementSet.id,
      title: "Review order",
      module: "Orders",
      priority: "P1",
      objective: "Review an order",
      preconditions: [],
      expectedResults: ["Review is visible"],
      requirementRefs: ["clause:review"],
      knowledgeNodeRefs: [],
      techniques: [],
      status: "compiled",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z"
    });
    context.repository.executableCases.push({
      id: "case-unaffected",
      knowledgeProjectId: project.id,
      requirementSetId: requirementSet.id,
      testIntentId: "intent-unaffected",
      systemId: system.id,
      title: "Review order",
      status: "ready",
      compileKey: "unaffected-compile-key",
      preconditions: [],
      steps: [{
        id: "step-unaffected",
        order: 1,
        action: "click",
        instruction: "Review the order",
        targetSemantic: "Review",
        origin: "observed",
        sourceRefs: ["system-exploration:exploration-other"]
      }],
      dataProfileIds: [],
      gapIds: [],
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z"
    });

    await context.knowledgeService.refreshSystemBrain(project.id, system.id);
    const first = context.systemBrainSnapshots.history(system.id)[0];
    context.systemBrainSnapshots.confirm(first.id, "tester");
    context.repository.systemExplorations[0].interactionTransitions[0].visibleAdded = ["Approval", "Audit trail"];
    await context.knowledgeService.refreshSystemBrain(project.id, system.id);

    expect(context.repository.executableCases[0]).toEqual(expect.objectContaining({
      id: "case-stale",
      status: "stale",
      staleByChangeSetId: expect.any(String)
    }));
    expect(context.repository.testIntents[0].status).toBe("stale");
    expect(context.repository.executableCases.find((item) => item.id === "case-unaffected")?.status).toBe("ready");
    expect(context.repository.testIntents.find((item) => item.id === "intent-unaffected")?.status).toBe("compiled");
    const changeSet = context.repository.systemBrainChangeSets.at(-1);
    expect(changeSet).toEqual(expect.objectContaining({
      affectedTestIntentIds: ["intent-stale"],
      affectedExecutableCaseIds: ["case-stale"]
    }));
    const latestAfterChange = context.systemBrainSnapshots.history(system.id)[0];
    expect(() => context.knowledgeService.recompileStaleSystemBrainCases({
      projectId: project.id,
      systemId: system.id,
      changeSetId: changeSet?.id
    })).toThrow("Confirm the System Brain snapshot");
    context.systemBrainSnapshots.confirm(latestAfterChange.id, "tester");
    const incremental = context.knowledgeService.recompileStaleSystemBrainCases({
      projectId: project.id,
      systemId: system.id,
      changeSetId: changeSet?.id
    });
    expect(incremental.compileRun?.items.map((item) => item.testIntentId)).toEqual(["intent-stale"]);
    const compiled = context.knowledgeService.compileExecutableCases("intent-stale", system.id);
    expect(compiled.reused).toBe(true);
    expect(compiled.executableCase.id).not.toBe("case-stale");
    expect(compiled.executableCase.systemBrainSnapshotId).toBe(latestAfterChange.id);
  });
});
