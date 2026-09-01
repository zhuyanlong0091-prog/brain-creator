// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type {
  SemanticBinding,
  SystemBrainSnapshot,
  SystemBrainSnapshotAsset
} from "./types.js";
import {
  reconcileSemanticFacts,
  SystemBrainReconciliationService,
  propagateSystemBrainChangeSet,
  type ExpectedSemanticFact,
  type ObservedSemanticFact
} from "./systemReconciliation.js";

function expected(overrides: Partial<ExpectedSemanticFact> = {}): ExpectedSemanticFact {
  return {
    id: "semantic-requirement-create",
    requirementSetId: "requirement-orders",
    kind: "action",
    label: "新增订单",
    sourceRefs: ["requirement:clause-create"],
    ...overrides
  };
}

function observed(overrides: Partial<ObservedSemanticFact> = {}): ObservedSemanticFact {
  return {
    id: "transition-create-order",
    kind: "action",
    label: "新建订单",
    content: "点击新建订单后进入订单表单",
    sourceRefs: ["system-exploration:orders-1"],
    ...overrides
  };
}

function snapshot(assets: SystemBrainSnapshotAsset[]): SystemBrainSnapshot {
  return {
    id: "snapshot-orders-2",
    knowledgeProjectId: "knowledge-orders",
    systemId: "system-orders",
    revision: 2,
    status: "candidate",
    explorationIds: ["exploration-orders-2"],
    assets,
    contentHash: "snapshot-hash-2",
    createdAt: "2026-08-31T00:00:00.000Z"
  };
}

function store() {
  return {
    semanticConcepts: [],
    semanticBindings: [] as SemanticBinding[],
    systemBrainSnapshots: [],
    persist: vi.fn()
  };
}

describe("semantic reconciliation", () => {
  it("maps requirement and observed action aliases without overwriting expected language", () => {
    const result = reconcileSemanticFacts({
      systemId: "system-orders",
      expected: [expected()],
      observed: [observed()]
    });

    expect(result.bindings[0]).toEqual(expect.objectContaining({
      type: "alias",
      expectedSemanticId: "semantic-requirement-create",
      observedSemanticId: "transition-create-order",
      status: "candidate"
    }));
    expect(result.bindings[0].evidenceRefs).toEqual(expect.arrayContaining([
      "requirement:clause-create",
      "system-exploration:orders-1"
    ]));
  });

  it("uses a workflow observation as a step expansion instead of inventing a UI control", () => {
    const result = reconcileSemanticFacts({
      systemId: "system-orders",
      expected: [expected({ label: "创建订单" })],
      observed: [observed({
        id: "workflow-order-create",
        kind: "workflow",
        label: "订单创建流程",
        content: "进入订单列表 -> 点击新建 -> 填写订单 -> 保存",
        sourceRefs: ["training-session:orders-create"]
      })]
    });

    expect(result.bindings[0]).toEqual(expect.objectContaining({ type: "step-expansion" }));
  });

  it("marks conditional implementation when the observed behavior has a condition", () => {
    const result = reconcileSemanticFacts({
      systemId: "system-orders",
      expected: [expected({ id: "semantic-requirement-approval", label: "审批通过" })],
      observed: [observed({
        id: "transition-approval",
        label: "通过",
        content: "仅当订单状态为待审批时，点击通过才会进入已审批",
        sourceRefs: ["system-exploration:orders-approval"]
      })]
    });

    expect(result.bindings[0]).toEqual(expect.objectContaining({ type: "conditional" }));
  });

  it("does not choose between two equally plausible system actions", () => {
    const result = reconcileSemanticFacts({
      systemId: "system-orders",
      expected: [expected()],
      observed: [
        observed({ id: "transition-create-a", sourceRefs: ["page:/orders"] }),
        observed({ id: "transition-create-b", sourceRefs: ["page:/draft-orders"] })
      ]
    });

    expect(result.bindings[0]).toEqual(expect.objectContaining({
      type: "conflict",
      status: "conflicted"
    }));
    expect(result.bindings[0]).not.toHaveProperty("observedSemanticId");
  });

  it("keeps a one-run absence as stale evidence instead of deleting a confirmed binding", () => {
    const repository = store();
    repository.semanticBindings.push({
      id: "binding-create",
      requirementSetId: "requirement-orders",
      systemId: "system-orders",
      expectedSemanticId: "semantic-requirement-create",
      observedSemanticId: "transition-create-order",
      type: "alias",
      conditions: {},
      confidence: 0.95,
      status: "confirmed",
      evidenceRefs: ["system-exploration:old"],
      confirmedBy: "tester"
    });
    const service = new SystemBrainReconciliationService(repository);
    const result = service.reconcile({
      knowledgeProjectId: "knowledge-orders",
      requirementSetId: "requirement-orders",
      systemId: "system-orders",
      expected: [expected()],
      observed: []
    });

    expect(result.bindings[0]).toEqual(expect.objectContaining({
      type: "missing",
      status: "stale",
      observedSemanticId: "transition-create-order"
    }));
  });

  it("rejects expected facts from another requirement set", () => {
    const repository = store();
    const service = new SystemBrainReconciliationService(repository);

    expect(() => service.reconcile({
      knowledgeProjectId: "knowledge-orders",
      requirementSetId: "requirement-orders",
      systemId: "system-orders",
      expected: [expected({ requirementSetId: "requirement-other" })],
      observed: []
    })).toThrow("selected RequirementSet");
  });

  it("marks intents stale when a bound requirement set has no compiled case yet", () => {
    const repository = store();
    repository.semanticBindings.push({
      id: "binding-create",
      requirementSetId: "requirement-orders",
      systemId: "system-orders",
      expectedSemanticId: "semantic-requirement-create",
      observedSemanticId: "transition-create-order",
      type: "alias",
      conditions: {},
      confidence: 0.95,
      status: "confirmed",
      evidenceRefs: ["system-exploration:old"]
    });
    const intent = {
      id: "intent-create",
      knowledgeProjectId: "knowledge-orders",
      requirementSetId: "requirement-orders",
      title: "Create order",
      module: "Orders",
      priority: "P1" as const,
      objective: "Create an order",
      preconditions: [],
      expectedResults: ["Order is created"],
      requirementRefs: ["requirement:clause-create"],
      knowledgeNodeRefs: [],
      techniques: [],
      status: "approved" as const,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    const changeSet = {
      id: "changeset-orders",
      knowledgeProjectId: "knowledge-orders",
      systemId: "system-orders",
      fromSnapshotId: "snapshot-orders-1",
      toSnapshotId: "snapshot-orders-2",
      status: "needs-review" as const,
      changes: [{
        semanticId: "transition-create-order",
        kind: "transition" as const,
        changeType: "behavior-changed" as const,
        confidence: 1,
        impact: "recompile" as const,
        status: "needs-review" as const,
        reasons: ["Observed behavior changed"],
        sourceRefs: ["system-exploration:new"]
      }],
      summary: { added: 0, removed: 0, renamed: 0, locatorChanged: 0, behaviorChanged: 1, evidenceRefreshed: 0 },
      createdAt: "2026-08-31T00:00:00.000Z"
    };

    const result = propagateSystemBrainChangeSet({
      changeSet,
      executableCases: [],
      testIntents: [intent],
      semanticBindings: repository.semanticBindings,
      persist: repository.persist
    });

    expect(result.affectedTestIntentIds).toEqual(["intent-create"]);
    expect(intent.status).toBe("stale");
    expect(repository.persist).toHaveBeenCalled();
  });
});

describe("System Brain reconciliation service", () => {
  it("builds observed facts from a snapshot without changing requirement facts", () => {
    const repository = store();
    const service = new SystemBrainReconciliationService(repository);
    const result = service.reconcileSnapshot({
      knowledgeProjectId: "knowledge-orders",
      requirementSetId: "requirement-orders",
      systemId: "system-orders",
      expected: [expected()],
      snapshot: snapshot([{
        semanticId: "transition:create:/orders",
        kind: "transition",
        label: "新建订单",
        content: "点击新建订单",
        contentHash: "hash-transition",
        sourceRefs: ["system-exploration:orders-1"],
        metadata: {}
      }])
    });

    expect(result.observedCount).toBe(1);
    expect(result.bindings[0].expectedSemanticId).toBe("semantic-requirement-create");
    expect(result.bindings[0].evidenceRefs).toContain("system-brain-snapshot:snapshot-orders-2");
  });
});
