import { describe, expect, it } from "vitest";
import type { SystemBrain } from "../knowledge/systemBrain.js";
import type { SystemPageIdentity, SystemBrainSnapshot } from "./types.js";
import { planSystemBrainExploration } from "./systemExplorationScope.js";

function brain(): SystemBrain {
  return {
    knowledgeProjectId: "knowledge-orders",
    systemId: "system-orders",
    pages: [
      {
        pageModelId: "page-stable",
        name: "订单列表",
        route: "https://example.test/orders",
        version: 1,
        screenshotId: "shot-stable",
        locatorCount: 2,
        probeIssueCount: 0,
        locators: [],
        probeResultIds: [],
        sourceRefs: ["page-model:page-stable"]
      },
      {
        pageModelId: "page-changed",
        name: "订单详情",
        route: "https://example.test/orders/1",
        version: 2,
        screenshotId: "shot-changed",
        locatorCount: 2,
        probeIssueCount: 0,
        locators: [],
        probeResultIds: [],
        sourceRefs: ["page-model:page-changed"]
      },
      {
        pageModelId: "page-low-confidence",
        name: "订单审批",
        route: "https://example.test/orders/1/approval",
        version: 1,
        screenshotId: "shot-low-confidence",
        locatorCount: 1,
        probeIssueCount: 1,
        locators: [],
        probeResultIds: [],
        sourceRefs: ["page-model:page-low-confidence"]
      }
    ],
    workflows: [],
    behaviorRules: [],
    apiFlows: [],
    navigationEdges: [{
      explorationId: "exploration-1",
      fromPageModelId: "page-stable",
      toPageModelId: "page-changed",
      fromUrl: "https://example.test/orders",
      toUrl: "https://example.test/orders/1",
      text: "查看详情",
      sourceRefs: ["system-exploration:exploration-1"]
    }],
    states: [],
    stateTransitions: [],
    observations: [],
    conflicts: [],
    readiness: {
      pageEvidence: true,
      locatorEvidence: true,
      workflowEvidence: false,
      apiEvidence: false,
      navigationEvidence: false,
      stateEvidence: false,
      readyForCompilation: true
    }
  };
}

function identity(identityKey: string, latestPageModelId: string): SystemPageIdentity {
  return {
    id: `identity-${latestPageModelId}`,
    systemId: "system-orders",
    identityKey,
    canonicalRoute: identityKey.replace(/^page:/, ""),
    semanticRole: "page",
    latestPageModelId,
    revision: 1,
    status: "confirmed",
    sourceRefs: [`page-model:${latestPageModelId}`],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
}

function snapshot(): SystemBrainSnapshot {
  return {
    id: "snapshot-orders-1",
    knowledgeProjectId: "knowledge-orders",
    systemId: "system-orders",
    revision: 1,
    status: "confirmed",
    explorationIds: ["exploration-1"],
    assets: [
      {
        semanticId: "page:/orders",
        kind: "page",
        label: "订单列表",
        content: "{}",
        contentHash: "stable",
        sourceRefs: ["page-model:page-stable"],
        metadata: { pageModelId: "page-stable" }
      },
      {
        semanticId: "page:/orders/:id",
        kind: "page",
        label: "订单详情",
        content: "{}",
        contentHash: "changed",
        sourceRefs: ["page-model:page-old"],
        metadata: { pageModelId: "page-old" }
      }
    ],
    contentHash: "snapshot-hash",
    createdAt: "2026-09-01T00:00:00.000Z"
  };
}

describe("incremental System Brain exploration", () => {
  it("targets changed, low-confidence, and previously uncovered pages", () => {
    const result = planSystemBrainExploration({
      mode: "incremental",
      startUrl: "https://example.test/orders",
      brain: brain(),
      identities: [
        identity("page:/orders", "page-stable"),
        identity("page:/orders/:id", "page-changed"),
        identity("page:/orders/:id/approval", "page-low-confidence")
      ],
      confirmedSnapshot: snapshot()
    });

    expect(result.targetRoutes).toEqual([
      "https://example.test/orders/1",
      "https://example.test/orders/1/approval"
    ]);
    expect(result.targetPageIdentityIds).toEqual([
      "identity-page-changed",
      "identity-page-low-confidence"
    ]);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("revision changed"),
      expect.stringContaining("low-confidence"),
      expect.stringContaining("not covered")
    ]));
    expect(result.skippedPageCount).toBe(1);
  });

  it("uses a full scope when there is no confirmed baseline", () => {
    const result = planSystemBrainExploration({
      mode: "incremental",
      startUrl: "https://example.test/orders",
      brain: brain(),
      identities: [],
      confirmedSnapshot: undefined
    });

    expect(result.mode).toBe("full");
    expect(result.targetRoutes).toEqual(["https://example.test/orders"]);
    expect(result.reason).toContain("confirmed baseline");
  });
});
