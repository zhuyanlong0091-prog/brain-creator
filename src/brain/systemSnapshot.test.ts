import { describe, expect, it, vi } from "vitest";
import type { SystemBrain } from "../knowledge/systemBrain.js";
import {
  SystemBrainSnapshotService,
  diffSystemBrainSnapshots,
  systemBrainToSnapshotAssets
} from "./systemSnapshot.js";

function brain(overrides: Partial<SystemBrain> = {}): SystemBrain {
  return {
    knowledgeProjectId: "knowledge-orders",
    systemId: "system-orders",
    pages: [
      {
        pageModelId: "page-1",
        name: "订单列表",
        route: "/orders",
        version: 1,
        screenshotId: "shot-1",
        locatorCount: 1,
        probeIssueCount: 0,
        locators: [
          {
            id: "locator-1",
            pageModelId: "page-1",
            name: "新增",
            selector: "#create-order",
            role: "button",
            text: "新增",
            fallbackSelectors: [],
            confidence: 0.99
          }
        ],
        probeResultIds: [],
        sourceRefs: ["page-model:page-1"]
      }
    ],
    workflows: [],
    behaviorRules: [],
    apiFlows: [],
    navigationEdges: [],
    states: [],
    stateTransitions: [
      {
        id: "transition-1",
        explorationId: "exploration-1",
        pageModelId: "page-1",
        pageUrl: "/orders",
        targetName: "新增",
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
        transitionKind: "state",
        sourceRefs: ["system-exploration:exploration-1"]
      }
    ],
    observations: [],
    conflicts: [],
    readiness: {
      pageEvidence: true,
      locatorEvidence: true,
      workflowEvidence: false,
      apiEvidence: false,
      navigationEvidence: false,
      stateEvidence: true,
      readyForCompilation: true
    },
    ...overrides
  };
}

function store() {
  return {
    systemBrainSnapshots: [],
    systemBrainChangeSets: [],
    persist: vi.fn()
  };
}

describe("System Brain snapshots", () => {
  it("keeps the same semantic identity for 新增 and 新建", () => {
    const first = systemBrainToSnapshotAssets(brain());
    const second = systemBrainToSnapshotAssets(
      brain({
        pages: brain().pages.map((page) => ({
          ...page,
          locators: page.locators.map((locator) => ({
            ...locator,
            name: "新建",
            text: "新建"
          }))
        })),
        stateTransitions: brain().stateTransitions.map((transition) => ({
          ...transition,
          targetName: "新建"
        }))
      })
    );

    expect(second.map((asset) => asset.semanticId)).toEqual(first.map((asset) => asset.semanticId));
    const changeSet = diffSystemBrainSnapshots(
      snapshot("snapshot-1", first),
      snapshot("snapshot-2", second)
    );
    expect(changeSet.summary.renamed).toBeGreaterThan(0);
    expect(changeSet.summary.removed).toBe(0);
    expect(changeSet.status).toBe("clean");
  });

  it("auto-accepts a selector refresh without requiring recompilation", () => {
    const first = systemBrainToSnapshotAssets(brain());
    const second = systemBrainToSnapshotAssets(
      brain({
        pages: brain().pages.map((page) => ({
          ...page,
          locators: page.locators.map((locator) => ({ ...locator, selector: "[data-testid=create-order]" }))
        }))
      })
    );

    const changeSet = diffSystemBrainSnapshots(
      snapshot("snapshot-1", first),
      snapshot("snapshot-2", second)
    );
    expect(changeSet.summary.locatorChanged).toBe(1);
    expect(changeSet.changes[0]).toEqual(expect.objectContaining({
      changeType: "locator-changed",
      impact: "none",
      status: "auto-accepted"
    }));
  });

  it("requires review when a confirmed state transition changes behavior", () => {
    const first = systemBrainToSnapshotAssets(brain());
    const second = systemBrainToSnapshotAssets(
      brain({
        stateTransitions: brain().stateTransitions.map((transition) => ({
          ...transition,
          visibleAdded: ["订单名称", "订单金额"]
        }))
      })
    );

    const changeSet = diffSystemBrainSnapshots(
      snapshot("snapshot-1", first),
      snapshot("snapshot-2", second)
    );
    expect(changeSet.summary.behaviorChanged).toBe(1);
    expect(changeSet.changes[0]).toEqual(expect.objectContaining({
      changeType: "behavior-changed",
      impact: "recompile",
      status: "needs-review"
    }));
    expect(changeSet.status).toBe("needs-review");
  });

  it("persists candidate snapshots and confirms one snapshot at a time", () => {
    const repository = store();
    const service = new SystemBrainSnapshotService(repository);
    const first = service.capture({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      brain: brain()
    });
    const second = service.capture({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      brain: brain({
        stateTransitions: brain().stateTransitions.map((transition) => ({
          ...transition,
          visibleAdded: ["订单名称", "订单金额"]
        }))
      })
    });

    service.confirm(first.snapshot.id, "tester");
    service.confirm(second.snapshot.id, "tester");

    expect(service.latest("system-orders")?.id).toBe(second.snapshot.id);
    expect(repository.systemBrainSnapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.snapshot.id, status: "superseded" }),
      expect.objectContaining({ id: second.snapshot.id, status: "confirmed" })
    ]));
    expect(repository.persist).toHaveBeenCalled();
  });

  it("confirms the stable page identities represented by a snapshot", () => {
    const repository = {
      ...store(),
      systemPageIdentities: [{
        id: "identity-orders",
        systemId: "system-orders",
        identityKey: "page:/orders",
        canonicalRoute: "/orders",
        semanticRole: "list",
        latestPageModelId: "page-1",
        revision: 1,
        status: "candidate" as const,
        sourceRefs: ["page-model:page-1"],
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z"
      }]
    };
    const service = new SystemBrainSnapshotService(repository);
    const captured = service.capture({
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      brain: brain()
    });

    service.confirm(captured.snapshot.id, "tester");

    expect(repository.systemPageIdentities[0]).toEqual(expect.objectContaining({
      identityKey: "page:/orders",
      status: "confirmed",
      lastConfirmedRevision: 1,
      confirmedBy: "tester"
    }));
  });
});

function snapshot(id: string, assets: ReturnType<typeof systemBrainToSnapshotAssets>) {
  return {
    id,
    knowledgeProjectId: "knowledge-orders",
    systemId: "system-orders",
    revision: 1,
    explorationIds: [],
    status: "confirmed" as const,
    assets,
    contentHash: id,
    createdAt: "2026-08-27T00:00:00.000Z"
  };
}
