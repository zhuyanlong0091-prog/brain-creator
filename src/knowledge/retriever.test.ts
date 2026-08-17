// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { buildContextPack, retrieveKnowledge } from "./retriever.js";

describe("knowledge retrieval", () => {
  it("isolates projects and boosts matching confirmed rules", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.knowledgeNodes.push(
      node("node_a", "project_a", "rule", "Replacement rule", "离职替补显示替补人员字段", "confirmed"),
      node("node_b", "project_b", "rule", "Other rule", "离职替补不显示字段", "confirmed"),
      node("node_c", "project_a", "field", "Unrelated field", "备注字段", "draft")
    );

    const result = retrieveKnowledge(repository, {
      knowledgeProjectId: "project_a",
      query: "离职替补 替补人员",
      types: ["rule"],
      limit: 5
    });

    expect(result.map((item) => item.node.id)).toEqual(["node_a"]);
  });

  it("builds a traceable context pack within the configured character budget", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.knowledgeNodes.push(
      node("node_a", "project_a", "workflow", "Create", "进入列表后点击新建并填写表单", "confirmed"),
      node("node_b", "project_a", "rule", "Conditional", "选择离职替补后显示替补人员字段", "confirmed")
    );

    const pack = buildContextPack(repository, {
      knowledgeProjectId: "project_a",
      query: "新建 离职替补",
      purpose: "case-compiler",
      maxChars: 55
    });

    expect(pack.content.length).toBeLessThanOrEqual(55);
    expect(pack.references.length).toBeGreaterThan(0);
    expect(pack.truncated).toBe(true);
  });

  it("adds one-hop graph context without crossing knowledge projects", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.knowledgeNodes.push(
      node("requirement_a", "project_a", "field", "Order requirement", "Create an order", "confirmed"),
      node("rule_a", "project_a", "rule", "Approval", "Manager approval is required", "confirmed"),
      node("rule_b", "project_b", "rule", "Other", "Manager approval is not required", "confirmed")
    );
    repository.knowledgeEdges.push({
      id: "edge_a",
      knowledgeProjectId: "project_a",
      fromNodeId: "requirement_a",
      toNodeId: "rule_a",
      relation: "covers",
      sourceRefs: ["source_a"],
      createdAt: "2026-07-16T00:00:00.000Z"
    });

    const result = retrieveKnowledge(repository, {
      knowledgeProjectId: "project_a",
      query: "Create an order"
    });

    expect(result.map((item) => item.node.id)).toEqual(
      expect.arrayContaining(["requirement_a", "rule_a"])
    );
    expect(result.map((item) => item.node.id)).not.toContain("rule_b");
  });

  it("keeps execution retrieval inside the selected system and requirement revision", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.knowledgeNodes.push(
      scopedNode("node-shared", "Shared rule", "system-a", "requirement-a"),
      scopedNode("node-system-b", "Other system rule", "system-b", "requirement-a"),
      scopedNode("node-requirement-b", "Other requirement rule", "system-a", "requirement-b")
    );

    const result = retrieveKnowledge(repository, {
      knowledgeProjectId: "project_a",
      systemId: "system-a",
      requirementSetId: "requirement-a",
      query: "rule"
    });

    expect(result.map((item) => item.node.id)).toEqual(["node-shared"]);
  });
});

function scopedNode(
  id: string,
  title: string,
  systemId: string,
  requirementSetId: string
) {
  return {
    id,
    knowledgeProjectId: "project_a",
    systemId,
    requirementSetId,
    type: "rule" as const,
    title,
    content: title,
    module: "Orders",
    sourceRefs: [`source:${id}`],
    origin: "source" as const,
    confidence: 1,
    status: "confirmed" as const,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z"
  };
}

function node(
  id: string,
  knowledgeProjectId: string,
  type: "rule" | "field" | "workflow",
  title: string,
  content: string,
  status: "draft" | "confirmed"
) {
  return {
    id,
    knowledgeProjectId,
    type,
    title,
    content,
    module: "test",
    sourceRefs: [`source_${id}`],
    origin: "derived" as const,
    confidence: 0.9,
    status,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z"
  };
}
