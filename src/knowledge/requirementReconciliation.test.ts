// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  ExecutableCase,
  RequirementSet,
  TestIntent
} from "../domain/types.js";
import {
  reconcileRequirementCases,
  reconcileRequirementCoverage
} from "./requirementReconciliation.js";

function executableCase(overrides: Partial<ExecutableCase> = {}): ExecutableCase {
  return {
    id: "case-a",
    knowledgeProjectId: "knowledge",
    requirementSetId: "requirement-a",
    testIntentId: "intent-a",
    systemId: "system-a",
    title: "Case A",
    status: "ready",
    compileKey: "compile-a",
    preconditions: [],
    steps: [],
    dataProfileIds: [],
    gapIds: [],
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides
  };
}

function requirementSet(overrides: Partial<RequirementSet> = {}): RequirementSet {
  return {
    id: "requirement-a",
    knowledgeProjectId: "knowledge",
    sourceId: "source-a",
    version: 1,
    title: "Requirement A",
    summary: "A",
    contentHash: "hash-a",
    status: "approved",
    affectedNodeIds: [],
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides
  };
}

function testIntent(overrides: Partial<TestIntent> = {}): TestIntent {
  return {
    id: "intent-a",
    knowledgeProjectId: "knowledge",
    requirementSetId: "requirement-a",
    title: "Intent A",
    module: "orders",
    priority: "P1",
    objective: "Verify A",
    preconditions: [],
    expectedResults: [],
    requirementRefs: [],
    knowledgeNodeRefs: [],
    techniques: [],
    status: "approved",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides
  };
}

describe("same-system requirement reconciliation", () => {
  it("reports complete coverage across multiple requirement sets", () => {
    const result = reconcileRequirementCases({
      systemId: "system-a",
      expectedRequirementSetIds: ["requirement-a", "requirement-b"],
      cases: [
        executableCase(),
        executableCase({
          id: "case-b",
          requirementSetId: "requirement-b",
          testIntentId: "intent-b",
          compileKey: "compile-b"
        })
      ]
    });

    expect(result.status).toBe("complete");
    expect(result.missingRequirementSetIds).toEqual([]);
    expect(result.crossSystemCaseIds).toEqual([]);
  });

  it("reports missing and duplicate current cases instead of silently passing", () => {
    const result = reconcileRequirementCases({
      systemId: "system-a",
      expectedRequirementSetIds: ["requirement-a", "requirement-b"],
      cases: [
        executableCase(),
        executableCase({ id: "case-a-duplicate" })
      ]
    });

    expect(result.status).toBe("conflicted");
    expect(result.missingRequirementSetIds).toEqual(["requirement-b"]);
    expect(result.duplicateCompileKeys).toEqual(["compile-a"]);
  });

  it("blocks cross-system references", () => {
    const result = reconcileRequirementCases({
      systemId: "system-a",
      expectedRequirementSetIds: ["requirement-a"],
      cases: [executableCase({ id: "case-b", systemId: "system-b" })]
    });

    expect(result.status).toBe("conflicted");
    expect(result.crossSystemCaseIds).toEqual(["case-b"]);
  });

  it("reconciles active requirement revisions and their intents for one system", () => {
    const result = reconcileRequirementCoverage({
      knowledgeProject: { id: "knowledge" },
      systemId: "system-a",
      requirementSets: [
        requirementSet(),
        requirementSet({
          id: "requirement-b",
          version: 2,
          previousRequirementSetId: "requirement-a"
        })
      ],
      testIntents: [
        testIntent(),
        testIntent({
          id: "intent-b",
          requirementSetId: "requirement-b",
          title: "Intent B"
        })
      ],
      cases: [
        executableCase(),
        executableCase({
          id: "case-b",
          requirementSetId: "requirement-b",
          testIntentId: "intent-b",
          compileKey: "compile-b"
        })
      ]
    });

    expect(result.status).toBe("complete");
    expect(result.expectedTestIntentIds).toEqual(["intent-a", "intent-b"]);
    expect(result.missingTestIntentIds).toEqual([]);
  });

  it("reports an intent missing a current executable case and keeps old revisions traceable", () => {
    const result = reconcileRequirementCoverage({
      knowledgeProject: { id: "knowledge" },
      systemId: "system-a",
      requirementSets: [
        requirementSet({ status: "superseded" }),
        requirementSet({ id: "requirement-b", version: 2 })
      ],
      testIntents: [
        testIntent({ id: "intent-b", requirementSetId: "requirement-b" })
      ],
      cases: [
        executableCase({
          id: "old-case",
          status: "superseded",
          supersededById: "new-case"
        })
      ]
    });

    expect(result.status).toBe("partial");
    expect(result.missingTestIntentIds).toEqual(["intent-b"]);
    expect(result.missingExecutableCaseIntentIds).toEqual(["intent-b"]);
    expect(result.supersededRequirementSetIds).toEqual([]);
    expect(result.supersededCaseIds).toEqual(["old-case"]);
  });

  it("marks unbound and cross-system cases as unsafe coverage", () => {
    const result = reconcileRequirementCoverage({
      knowledgeProject: { id: "knowledge" },
      systemId: "system-a",
      requirementSets: [requirementSet()],
      testIntents: [testIntent()],
      cases: [executableCase({ id: "unbound", systemId: undefined })]
    });

    expect(result.unboundCaseIds).toEqual(["unbound"]);
    expect(result.status).toBe("partial");
  });
});
