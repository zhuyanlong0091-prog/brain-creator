// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ExecutableCase, TestIntent } from "../domain/types.js";
import { buildCaseDependencyGraph } from "./caseDependencyGraph.js";

describe("Case dependency graph", () => {
  it("orders a consumer after the case that explicitly produces its entity", () => {
    const producer = intent({
      id: "intent-create-employee",
      title: "Create employee",
      producesEntityRefs: ["employee:testperson001"]
    });
    const consumer = intent({
      id: "intent-edit-employee",
      title: "Edit employee",
      consumesEntityRefs: ["employee:testperson001"]
    });

    const graph = buildCaseDependencyGraph({
      requirementSetId: "requirement-1",
      systemId: "system-hr",
      intents: [consumer, producer]
    });

    expect(graph.verdict).toBe("ready");
    expect(graph.dependencyOrder).toEqual([
      "intent-create-employee",
      "intent-edit-employee"
    ]);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        fromTestIntentId: producer.id,
        toTestIntentId: consumer.id,
        entityReference: "employee:testperson001",
        relation: "requires"
      })
    ]);
  });

  it("blocks a consumer with no declared producer instead of relying on run order", () => {
    const consumer = intent({
      consumesEntityRefs: ["employee:testperson001"]
    });

    const graph = buildCaseDependencyGraph({
      requirementSetId: "requirement-1",
      systemId: "system-hr",
      intents: [consumer]
    });

    expect(graph.verdict).toBe("needs-data");
    expect(graph.unresolved).toEqual([
      expect.objectContaining({
        testIntentId: consumer.id,
        entityReference: "employee:testperson001",
        reason: "missing-producer"
      })
    ]);
  });

  it("does not guess when multiple cases can produce the same entity", () => {
    const graph = buildCaseDependencyGraph({
      requirementSetId: "requirement-1",
      systemId: "system-hr",
      intents: [
        intent({ id: "intent-create-a", producesEntityRefs: ["employee:testperson001"] }),
        intent({ id: "intent-create-b", producesEntityRefs: ["employee:testperson001"] }),
        intent({ id: "intent-edit", consumesEntityRefs: ["employee:testperson001"] })
      ]
    });

    expect(graph.verdict).toBe("ambiguous");
    expect(graph.unresolved[0]).toEqual(expect.objectContaining({
      testIntentId: "intent-edit",
      reason: "ambiguous-producer",
      producerTestIntentIds: ["intent-create-a", "intent-create-b"]
    }));
    expect(graph.edges).toHaveLength(0);
  });

  it("detects a cycle in explicit entity dependencies", () => {
    const graph = buildCaseDependencyGraph({
      requirementSetId: "requirement-1",
      systemId: "system-hr",
      intents: [
        intent({
          id: "intent-a",
          producesEntityRefs: ["a:1"],
          consumesEntityRefs: ["b:1"]
        }),
        intent({
          id: "intent-b",
          producesEntityRefs: ["b:1"],
          consumesEntityRefs: ["a:1"]
        })
      ]
    });

    expect(graph.verdict).toBe("blocked");
    expect(graph.unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "cycle" })
      ])
    );
  });

  it("does not bind stale or superseded executable cases", () => {
    const graph = buildCaseDependencyGraph({
      requirementSetId: "requirement-1",
      systemId: "system-hr",
      intents: [
        intent({
          id: "intent-create",
          producesEntityRefs: ["employee:testperson001"]
        }),
        intent({
          id: "intent-edit",
          consumesEntityRefs: ["employee:testperson001"]
        })
      ],
      executableCases: [
        executableCase("intent-create", "stale"),
        executableCase("intent-edit", "superseded")
      ]
    });

    expect(graph.nodes).toEqual([
      expect.objectContaining({ testIntentId: "intent-create", executableCaseId: undefined }),
      expect.objectContaining({ testIntentId: "intent-edit", executableCaseId: undefined })
    ]);
  });
});

function intent(overrides: Partial<TestIntent>): TestIntent {
  return {
    id: "intent-default",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    title: "Default case",
    module: "Employee",
    priority: "P1",
    objective: "Exercise a business scenario",
    preconditions: [],
    expectedResults: ["The expected business result is visible"],
    requirementRefs: ["requirement:1"],
    knowledgeNodeRefs: [],
    techniques: ["scenario"],
    status: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function executableCase(
  testIntentId: string,
  status: "stale" | "superseded"
): ExecutableCase {
  return {
    id: `case-${testIntentId}`,
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    testIntentId,
    systemId: "system-hr",
    title: testIntentId,
    status,
    preconditions: [],
    steps: [],
    dataProfileIds: [],
    gapIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
