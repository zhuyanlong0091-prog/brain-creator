import { describe, expect, it } from "vitest";
import type {
  DecisionTableModel,
  StateMachineModel,
  TestDataProfile,
  TestIntent,
  WorkflowModel
} from "../domain/types.js";
import type { SemanticBinding, SystemBrainSnapshot } from "./types.js";
import {
  buildBusinessScenarios,
  buildScenarioAssurance,
  createScenarioTrustRecord,
  evaluateMutationSuite,
  updateScenarioTrust,
  EvaluationProviderRegistry
} from "./scenarioAssurance.js";

const now = "2026-09-01T00:00:00.000Z";

function workflow(): WorkflowModel {
  return {
    id: "workflow-order",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    title: "Submit order",
    actors: ["requester", "approver"],
    steps: [
      { id: "draft", label: "Draft", actor: "requester", sourceRefs: ["req:workflow"] },
      { id: "approved", label: "Approved", actor: "approver", sourceRefs: ["req:workflow"] }
    ],
    transitions: [{
      id: "transition-submit",
      from: "draft",
      to: "approved",
      condition: "amount is within limit",
      actor: "approver",
      trigger: "approve",
      sourceRefs: ["req:approve"]
    }],
    startStepIds: ["draft"],
    endStepIds: ["approved"],
    sourceRefs: ["req:workflow", "req:approve"],
    confidence: 1,
    status: "confirmed",
    createdAt: now,
    updatedAt: now
  };
}

function stateMachine(): StateMachineModel {
  return {
    id: "state-order",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    title: "Order states",
    states: [
      { id: "draft", label: "Draft", initial: true, terminal: false, sourceRefs: ["req:state"] },
      { id: "submitted", label: "Submitted", initial: false, terminal: true, sourceRefs: ["req:state"] }
    ],
    transitions: [{
      id: "transition-submit",
      from: "draft",
      to: "submitted",
      trigger: "submit",
      actor: "requester",
      preconditions: ["Order is complete"],
      validity: "legal",
      sourceRefs: ["req:submit"]
    }],
    sourceRefs: ["req:state", "req:submit"],
    confidence: 1,
    status: "confirmed",
    createdAt: now,
    updatedAt: now
  };
}

function decisionTable(): DecisionTableModel {
  return {
    id: "decision-order",
    requirementSetId: "requirement-1",
    title: "Approval routing",
    conditions: ["amount"],
    actions: ["route to approver"],
    rules: [{
      conditionValues: { amount: "within-limit" },
      expectedActions: ["route to approver"],
      sourceRefs: ["req:decision"]
    }],
    sourceRefs: ["req:decision"],
    status: "confirmed"
  };
}

function intent(id: string, refs: string[], dimensions: TestIntent["coverageDimensions"] = ["workflow"]): TestIntent {
  return {
    id,
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    title: "Submit order",
    module: "Orders",
    priority: "P1",
    objective: "Submit a complete order",
    preconditions: ["Order is complete"],
    expectedResults: ["Order is submitted"],
    requirementRefs: refs,
    knowledgeNodeRefs: [],
    techniques: ["scenario"],
    coverageDimensions: dimensions,
    processModelRefs: ["workflow-order"],
    actorJourney: ["requester", "approver"],
    status: "draft",
    createdAt: now,
    updatedAt: now
  };
}

function snapshot(): SystemBrainSnapshot {
  return {
    id: "snapshot-1",
    knowledgeProjectId: "project-1",
    systemId: "system-1",
    revision: 1,
    status: "confirmed",
    explorationIds: [],
    assets: [{
      semanticId: "action:approve",
      kind: "transition",
      label: "Approve",
      content: "Approve order",
      contentHash: "asset-hash",
      sourceRefs: ["system-observation:approve"],
      metadata: {}
    }],
    contentHash: "system-hash",
    createdAt: now,
    confirmedAt: now,
    confirmedBy: "qa"
  };
}

describe("scenario assurance", () => {
  it("builds domain-neutral scenarios for workflows, state transitions, branches, and actor journeys", () => {
    const scenarios = buildBusinessScenarios({
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      workflows: [workflow()],
      stateMachines: [stateMachine()],
      decisionTables: [decisionTable()],
      testIntents: [intent("intent-1", ["req:workflow", "req:approve"])]
    });

    expect(scenarios.some((item) => item.family === "main-flow")).toBe(true);
    expect(scenarios.some((item) => item.family === "branch")).toBe(true);
    expect(scenarios.some((item) => item.family === "state-transition")).toBe(true);
    expect(scenarios.some((item) => item.family === "cross-role")).toBe(true);
    expect(scenarios.some((item) => item.family === "invalid-transition")).toBe(true);
    expect(scenarios.every((item) => item.sourceRefs.length > 0)).toBe(true);
    expect(scenarios.every((item) => !item.title.includes("HR"))).toBe(true);
  });

  it("requires a unique system binding, usable data, and a strong oracle before passing", () => {
    const dataProfile: TestDataProfile = {
      id: "data-order",
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      name: "Order data",
      field: "order",
      strategy: "generated",
      constraints: [],
      seed: "order-1",
      sourceRefs: ["req:workflow"],
      createdAt: now
    };
    const scenario = buildBusinessScenarios({
      knowledgeProjectId: "project-1",
      requirementSetId: "requirement-1",
      workflows: [workflow()],
      stateMachines: [],
      decisionTables: [],
      testIntents: [intent("intent-1", ["req:workflow", "req:approve"])],
      dataProfiles: [dataProfile]
    }).find((item) => item.family === "main-flow")!;
    const binding: SemanticBinding = {
      id: "binding-1",
      requirementSetId: "requirement-1",
      systemId: "system-1",
      expectedSemanticId: "action:approve",
      observedSemanticId: "action:approve",
      type: "exact",
      conditions: {},
      confidence: 1,
      status: "confirmed",
      evidenceRefs: ["system-observation:approve"]
    };

    expect(buildScenarioAssurance({ scenario }).systemBinding).toBe("missing");
    const contract = buildScenarioAssurance({
      scenario,
      systemId: "system-1",
      systemSnapshot: snapshot(),
      semanticBindings: [binding],
      dataProfiles: [dataProfile],
      providerIndependence: "isolated-single-provider"
    });
    expect(contract).toEqual(expect.objectContaining({
      systemBinding: "unique",
      testDataReadiness: "creatable",
      oracleStrength: "strong",
      verdict: "pass",
      independence: "isolated-single-provider"
    }));

    expect(buildScenarioAssurance({
      scenario,
      systemId: "system-1",
      systemSnapshot: { ...snapshot(), status: "candidate", confirmedAt: undefined, confirmedBy: undefined },
      semanticBindings: [binding],
      dataProfiles: [dataProfile]
    })).toEqual(expect.objectContaining({
      systemBinding: "missing",
      verdict: "blocked"
    }));
  });

  it("promotes only after three unchanged strong runs and downgrades on evidence changes", () => {
    const initial = createScenarioTrustRecord({
      scenarioId: "scenario-1",
      requirementHash: "req-hash",
      systemSnapshotHash: "system-hash",
      dataPlanHash: "data-hash",
      grounded: true,
      bound: true,
      updatedAt: now
    });
    expect(initial.status).toBe("bound");
    const first = updateScenarioTrust(initial, {
      passed: true,
      strongEvidence: true,
      requirementHash: "req-hash",
      systemSnapshotHash: "system-hash",
      dataPlanHash: "data-hash",
      updatedAt: now
    });
    const second = updateScenarioTrust(first, {
      passed: true,
      strongEvidence: true,
      requirementHash: "req-hash",
      systemSnapshotHash: "system-hash",
      dataPlanHash: "data-hash",
      updatedAt: now
    });
    const trusted = updateScenarioTrust(second, {
      passed: true,
      strongEvidence: true,
      requirementHash: "req-hash",
      systemSnapshotHash: "system-hash",
      dataPlanHash: "data-hash",
      updatedAt: now
    });
    expect(first.status).toBe("verified");
    expect(trusted.status).toBe("trusted");
    expect(updateScenarioTrust(trusted, {
      passed: true,
      strongEvidence: true,
      requirementHash: "changed",
      systemSnapshotHash: "system-hash",
      dataPlanHash: "data-hash",
      updatedAt: now
    })).toEqual(expect.objectContaining({ status: "bound", strongRunCount: 0 }));
  });

  it("evaluates mutation outcomes without treating blocked mutants as caught", () => {
    const result = evaluateMutationSuite({
      threshold: 0.85,
      mutations: [
        { id: "m1", scenarioId: "scenario-1", status: "caught", evidenceRefs: ["e1"] },
        { id: "m2", scenarioId: "scenario-1", status: "survived", evidenceRefs: ["e2"] },
        { id: "m3", scenarioId: "scenario-1", status: "blocked", evidenceRefs: [] }
      ]
    });
    expect(result).toEqual(expect.objectContaining({ caught: 1, survived: 1, blocked: 1, detectionRate: 0.5, verdict: "needs-review" }));
  });

  it("exposes the host as the primary provider and optional CLI evaluators through an injectable registry", () => {
    const registry = new EvaluationProviderRegistry({
      primary: "host-agent",
      evaluator: "codex",
      probe: (provider) => provider === "codex"
    });
    expect(registry.primary()).toEqual(expect.objectContaining({ provider: "host-agent", role: "primary", available: true }));
    expect(registry.evaluator()).toEqual(expect.objectContaining({ provider: "codex", role: "evaluator", available: true, enabled: true }));
    expect(registry.list().filter((item) => item.role === "evaluator")).toHaveLength(1);
  });
});
