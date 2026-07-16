// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  analyzeRequirement,
  designTests,
  evaluatePolicyOutput,
  normalizeHostSkillAnalysis
} from "./policies.js";

describe("built-in knowledge policies", () => {
  it("extracts generic modules, rules, flows, and unresolved questions without HR defaults", () => {
    const analysis = analyzeRequirement({
      requirementSetId: "requirement_1",
      title: "Order approval",
      content:
        "Buyer creates an order. Orders above 1000 require manager approval. Finance users may reject an approved order. The timeout is not specified.",
      sourceRef: "source_1"
    });

    expect(analysis.policyId).toBe("brain-creator.requirement-analysis");
    expect(analysis.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "module" }),
        expect.objectContaining({ type: "rule" }),
        expect.objectContaining({ type: "workflow" })
      ])
    );
    expect(JSON.stringify(analysis)).not.toContain("招聘管理");
    expect(analysis.openQuestions).toEqual(expect.arrayContaining([expect.stringContaining("timeout")]))
  });

  it("uses systematic test design techniques and emits data profiles", () => {
    const analysis = analyzeRequirement({
      requirementSetId: "requirement_1",
      title: "Order approval",
      content: "Orders above 1000 require approval. Status changes from draft to approved.",
      sourceRef: "source_1"
    });
    const design = designTests({ knowledgeProjectId: "project_1", analysis });

    expect(design.testIntents.length).toBeGreaterThan(0);
    expect(design.techniques).toEqual(expect.arrayContaining(["boundary-value", "state-transition"]));
    expect(design.dataProfiles.length).toBeGreaterThan(0);
    expect(evaluatePolicyOutput(analysis).verdict).toBe("pass");
  });

  it("blocks policy output that has no source references", () => {
    const analysis = analyzeRequirement({
      requirementSetId: "requirement_1",
      title: "Empty",
      content: "A user can save a record.",
      sourceRef: "source_1"
    });
    analysis.nodes[0].sourceRefs = [];

    expect(evaluatePolicyOutput(analysis)).toEqual(
      expect.objectContaining({ verdict: "blocked", score: 0 })
    );
  });

  it("normalizes host Skill output without allowing it to bypass source validation", () => {
    const analysis = normalizeHostSkillAnalysis(
      {
        module: "Inventory",
        nodes: [
          {
            type: "rule",
            title: "Stock cannot be negative",
            content: "The resulting stock must be zero or greater.",
            sourceRefs: ["source_1"],
            confidence: 0.95
          }
        ],
        openQuestions: [],
        risks: ["Concurrent adjustment risk"],
        policyVersion: "external-1"
      },
      "requirement_1"
    );

    expect(analysis.provider).toBe("host-skill");
    expect(evaluatePolicyOutput(analysis).verdict).toBe("pass");
    expect(() =>
      normalizeHostSkillAnalysis(
        { module: "Inventory", nodes: [{ type: "rule", title: "Invalid", content: "No evidence", sourceRefs: [] }] },
        "requirement_1"
      )
    ).toThrow("sourceRefs");
  });
});
