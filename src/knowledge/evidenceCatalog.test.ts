import { describe, expect, it } from "vitest";
import type { AttachmentAnalysis, RequirementSource, TestIntent } from "../domain/types.js";
import type { RequirementAnalysis } from "./policies.js";
import { buildEvidenceCatalog, renderEvidenceIndex } from "./evidenceCatalog.js";

describe("evidence catalog", () => {
  it("assigns stable short ids and readable locations to source references", () => {
    const input = catalogInput();
    const first = buildEvidenceCatalog(input);
    const second = buildEvidenceCatalog({
      ...input,
      intents: [...input.intents].reverse()
    });

    expect(first.byRawRef.get("source-1#line:12")).toMatchObject({
      id: "REQ-001",
      location: "正文第 12 行",
      summary: "系统支持创建订单并提交审批。"
    });
    expect([...first.byRawRef.entries()].map(([rawRef, entry]) => [rawRef, entry.id])).toEqual(
      [...second.byRawRef.entries()].map(([rawRef, entry]) => [rawRef, entry.id])
    );
  });

  it("renders an index without exposing raw source references", () => {
    const catalog = buildEvidenceCatalog(catalogInput());
    const report = renderEvidenceIndex({
      title: "订单审批需求",
      requirementSetId: "requirement-1",
      catalog
    });

    expect(report).toContain("# 订单审批需求：证据索引");
    expect(report).toContain("### REQ-001");
    expect(report).toContain("正文第 12 行");
    expect(report).toContain("系统支持创建订单并提交审批");
    expect(report).not.toContain("source-1#line:12");
  });
});

function catalogInput() {
  const source: RequirementSource = {
    id: "source-1",
    knowledgeProjectId: "project-1",
    source: "requirements/order.md",
    sourceType: "local-file",
    title: "订单审批需求",
    contentHash: "source-hash",
    content: "背景\n业务范围\n系统支持创建订单并提交审批。\n金额超过1000元需要经理审批。",
    blocks: [],
    attachments: [],
    warnings: [],
    accessStatus: "available",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const analysis: RequirementAnalysis = {
    requirementSetId: "requirement-1",
    policyId: "policy",
    policyVersion: "1",
    provider: "builtin",
    module: "订单审批",
    clauses: [
      {
        id: "clause-1",
        index: 1,
        text: "系统支持创建订单并提交审批。",
        sourceRef: "source-1#line:12",
        sourceRefs: ["source-1#line:12"],
        module: "订单审批",
        kind: "workflow",
        origin: "explicit",
        confidence: 1,
        status: "confirmed",
        policyId: "policy",
        policyVersion: "1",
        nodeTypes: ["workflow"]
      }
    ],
    nodes: [],
    openQuestions: [],
    risks: [],
    contradictions: [],
    missingBranches: []
  };
  const attachmentAnalysis: AttachmentAnalysis = {
    id: "attachment-analysis-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    sourceId: "source-1",
    attachmentId: "attachment-1",
    kind: "state-machine",
    markdown: "草稿\n审批中\n已完成",
    nodes: [
      { id: "draft", type: "state", label: "草稿" },
      { id: "review", type: "state", label: "审批中" }
    ],
    edges: [{ from: "draft", to: "review", condition: "提交", actor: "申请人" }],
    confidence: 0.9,
    sourceRefs: ["attachment-analysis-1#edge:1"],
    provider: "adapter",
    status: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const intent: TestIntent = {
    id: "intent-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    title: "提交订单",
    module: "订单审批",
    priority: "P0",
    objective: "验证订单进入审批",
    preconditions: [],
    expectedResults: ["订单进入审批中"],
    requirementRefs: ["source-1#line:12"],
    knowledgeNodeRefs: [],
    techniques: ["scenario"],
    status: "draft",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  return {
    source,
    analysis,
    intents: [intent],
    attachmentAnalyses: [attachmentAnalysis]
  };
}
