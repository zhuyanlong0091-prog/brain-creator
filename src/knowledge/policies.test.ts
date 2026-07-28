// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  analyzeRequirement,
  designTests,
  evaluatePolicyOutput,
  normalizeHostSkillAnalysis
} from "./policies.js";

describe("built-in knowledge policies", () => {
  const orderRequirement = {
    requirementSetId: "requirement_1",
    title: "Order approval",
    content:
      "Buyer creates an order. Orders above 1000 require manager approval. When the manager approves, status changes from draft to approved. Finance users may reject the order.",
    sourceRef: "source_1"
  };

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

  it("decomposes a requirement into atomic source-backed clauses and typed nodes", () => {
    const analysis = analyzeRequirement(orderRequirement);

    expect(analysis.clauses).toHaveLength(4);
    expect(analysis.clauses.map((clause) => clause.sourceRef)).toEqual([
      "source_1#clause-1",
      "source_1#clause-2",
      "source_1#clause-3",
      "source_1#clause-4"
    ]);
    expect(analysis.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "workflow", sourceRefs: ["source_1#clause-1"] }),
        expect.objectContaining({ type: "rule", sourceRefs: ["source_1#clause-2"] }),
        expect.objectContaining({ type: "state", sourceRefs: ["source_1#clause-3"] }),
        expect.objectContaining({ type: "actor", sourceRefs: ["source_1#clause-4"] }),
        expect.objectContaining({ type: "permission", sourceRefs: ["source_1#clause-4"] })
      ])
    );
    expect(
      analysis.nodes.filter((node) => node.type !== "module").every((node) => node.content !== orderRequirement.content)
    ).toBe(true);
  });

  it("creates one traceable test intent per atomic clause", () => {
    const analysis = analyzeRequirement(orderRequirement);
    const design = designTests({ knowledgeProjectId: "project_1", analysis });

    expect(design.testIntents).toHaveLength(4);
    expect(design.testIntents.every((intent) => !intent.title.includes("requirement coverage"))).toBe(true);
    expect(design.testIntents.map((intent) => intent.requirementRefs[0])).toEqual(
      analysis.clauses.map((clause) => clause.sourceRef)
    );
    expect(design.testIntents.map((intent) => intent.objective)).toEqual(
      analysis.clauses.map((clause) => clause.text)
    );
    expect(design.coverage).toEqual({
      totalClauses: 4,
      coveredClauseSourceRefs: analysis.clauses.map((clause) => clause.sourceRef),
      uncoveredClauseSourceRefs: [],
      intentCount: 4
    });
  });

  it("reports coverage, missing branches, and required actions in policy evaluation", () => {
    const analysis = analyzeRequirement(orderRequirement);
    const evaluation = evaluatePolicyOutput(analysis);

    expect(evaluation.verdict).toBe("needs-user");
    expect(evaluation.coverage).toEqual(
      expect.objectContaining({
        totalClauses: 4,
        coveredClauses: 4,
        coverageRate: 1,
        uncoveredSourceRefs: []
      })
    );
    expect(evaluation.missingBranches).toEqual(
      expect.arrayContaining([expect.stringContaining("manager approves")])
    );
    expect(evaluation.requiredActions).toEqual(
      expect.arrayContaining([expect.stringContaining("branch")])
    );
    expect(evaluation.unsupportedClaims).toEqual([]);
  });

  it("flags contradictory requirement clauses for user confirmation", () => {
    const analysis = analyzeRequirement({
      requirementSetId: "requirement_1",
      title: "Approval form",
      content: "The approval field is visible. The approval field is not visible.",
      sourceRef: "source_1"
    });
    const evaluation = evaluatePolicyOutput(analysis);

    expect(analysis.contradictions).toHaveLength(1);
    expect(evaluation.verdict).toBe("needs-user");
    expect(evaluation.contradictions).toEqual(analysis.contradictions);
    expect(evaluation.requiredActions).toEqual(
      expect.arrayContaining([expect.stringContaining("contradict")])
    );
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
      expect.objectContaining({
        verdict: "blocked",
        score: 0,
        unsupportedClaims: expect.arrayContaining([expect.stringContaining("source")])
      })
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
    expect(analysis.clauses).toEqual([
      expect.objectContaining({
        text: "The resulting stock must be zero or greater.",
        sourceRef: "source_1"
      })
    ]);
    expect(evaluatePolicyOutput(analysis).verdict).toBe("pass");
    expect(() =>
      normalizeHostSkillAnalysis(
        { module: "Inventory", nodes: [{ type: "rule", title: "Invalid", content: "No evidence", sourceRefs: [] }] },
        "requirement_1"
      )
    ).toThrow("sourceRefs");
  });
});
