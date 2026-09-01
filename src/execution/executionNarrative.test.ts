// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ExecutionEvidence } from "../domain/types.js";
import { buildExecutionNarrative } from "./executionNarrative.js";

describe("execution narrative", () => {
  it("explains the evidence in plain language instead of only exposing ids", () => {
    const narrative = buildExecutionNarrative({ evidence: evidence(), locale: "zh-CN" });

    expect(narrative.understood).toContain("1 个步骤");
    expect(narrative.observed).toContain("通过");
    expect(narrative.data).toContain("employee:testperson001");
    expect(narrative.trust).toContain("强验证");
  });

  it("explains why a blocked run cannot be treated as a requirement result", () => {
    const narrative = buildExecutionNarrative({
      evidence: { ...evidence(), status: "blocked", assuranceLevel: "none", evidenceWarnings: ["Auth checkpoint required"] },
      locale: "en-US"
    });

    expect(narrative.result).toContain("blocked");
    expect(narrative.trust).toContain("not sufficient");
    expect(narrative.waiting).toContain("Auth checkpoint required");
  });
});

function evidence(): ExecutionEvidence {
  return {
    id: "evidence-1",
    knowledgeProjectId: "project-1",
    systemId: "system-1",
    executableCaseId: "case-1",
    testCaseId: "test-1",
    contextPackPath: "context.json",
    status: "passed",
    assuranceLevel: "strong",
    assertionContracts: [{
      id: "assert-1",
      type: "workflow",
      strength: "strong",
      expected: "approved",
      requirementRefs: ["requirement:approval"],
      evidenceRequirements: ["actual-value", "screenshot", "trace"]
    }],
    steps: [{
      stepId: "step-1",
      order: 1,
      action: "assert",
      instruction: "Verify approval",
      targetSemantic: "Approval status",
      dataReference: "employee:testperson001",
      expected: "approved",
      actual: "approved",
      assertionStatus: "passed",
      sourceRefs: ["requirement:approval"],
      origin: "source"
    }],
    tracePaths: ["trace.zip"],
    artifactPaths: ["step-01.png"],
    consoleErrors: [],
    networkFailures: [],
    evidenceWarnings: [],
    coverage: { required: ["workflow"], verified: ["workflow"], missing: [] },
    createdAt: "2026-09-01T00:00:00.000Z"
  };
}
