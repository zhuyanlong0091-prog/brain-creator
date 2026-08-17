// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ExecutableCase } from "../domain/types.js";
import { reconcileRequirementCases } from "./requirementReconciliation.js";

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
});
