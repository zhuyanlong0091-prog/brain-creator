import { describe, expect, it } from "vitest";
import type {
  BusinessObjectModel,
  DecisionTableModel,
  RequirementEvaluationGate,
  RequirementSet,
  StateMachineModel,
  TestIntent,
  WorkflowModel
} from "../domain/types.js";
import type { BusinessScenario } from "../brain/types.js";
import type { RequirementAnalysis, RequirementPolicyEvaluation } from "./policies.js";
import { renderRequirementAnalysisReport, renderTestIntentReport } from "./reportWriter.js";

describe("review report writer", () => {
  it("renders readable Chinese requirement and business scenario sections", () => {
    const report = renderRequirementAnalysisReport({
      title: "订单审批需求",
      setStatus: "draft",
      analysis: analysisFixture(),
      evaluation: evaluationFixture(),
      evaluationGate: gateFixture(),
      coverage: { totalClauses: 2, coveredClauseSourceRefs: ["需求:1"], uncoveredClauseSourceRefs: ["需求:2"], intentCount: 1 },
      coverageProfile: coverageFixture(),
      workflowModels: [workflowFixture()],
      stateMachineModels: [stateMachineFixture()],
      businessObjectModels: [objectFixture()],
      decisionTableModels: [decisionTableFixture()],
      businessScenarios: [scenarioFixture()],
      scenarioAssuranceContracts: [],
      scenarioTrustRecords: [],
      intents: [intentFixture()]
    });

    expect(report).toContain("# 订单审批需求：需求分析报告");
    expect(report).toContain("## 五、业务流程与状态");
    expect(report).toContain("## 六、业务场景分析");
    expect(report).toContain("订单提交并进入审批");
    expect(report).toContain("跨角色业务流程");
    expect(report).toContain("测试数据准备");
    expect(report).toContain("从草稿转为审批，条件：提交");
    expect(report).not.toContain("Move from");
    expect(report).not.toContain("## Requirement Clauses");
    expect(report).not.toContain("module=");
  });

  it("renders complete test intent details in a separate document", () => {
    const report = renderTestIntentReport({
      title: "订单审批需求",
      setStatus: "draft",
      intents: [intentFixture()],
      scenarioCount: 1,
      workflowCount: 1,
      stateMachineCount: 1
    });

    expect(report).toContain("# 订单审批需求：测试意图");
    expect(report).toContain("## 测试意图总览");
    expect(report).toContain("## 1. 提交订单并进入审批");
    expect(report).toContain("验证目标");
    expect(report).toContain("前置条件");
    expect(report).toContain("预期结果");
    expect(report).toContain("业务流程");
  });

  it("falls back to a readable module title when source title is corrupted", () => {
    const report = renderRequirementAnalysisReport({
      title: "HRone-�\u0006乱码",
      setStatus: "draft",
      analysis: analysisFixture(),
      evaluation: evaluationFixture(),
      evaluationGate: gateFixture(),
      coverage: { totalClauses: 2, coveredClauseSourceRefs: [], uncoveredClauseSourceRefs: [], intentCount: 0 },
      workflowModels: [],
      stateMachineModels: [],
      businessObjectModels: [],
      decisionTableModels: [],
      businessScenarios: [],
      scenarioAssuranceContracts: [],
      scenarioTrustRecords: [],
      intents: []
    });

    expect(report).toContain("# 订单审批：需求分析报告");
    expect(report).not.toContain("乱码");
  });
});

function analysisFixture(): RequirementAnalysis {
  return {
    requirementSetId: "req-1",
    policyId: "brain-creator.requirement-analysis",
    policyVersion: "2.2.1",
    provider: "host-skill",
    module: "订单审批",
    clauses: [
      { id: "clause-1", index: 1, text: "申请人提交订单后进入审批。", sourceRef: "需求:1", sourceRefs: ["需求:1"], module: "订单审批", nodeTypes: ["workflow"], kind: "workflow", origin: "explicit", confidence: 1, status: "confirmed", policyId: "brain-creator.requirement-analysis", policyVersion: "2.2.1" },
      { id: "clause-2", index: 2, text: "金额超过1000元需要经理审批。", sourceRef: "需求:2", sourceRefs: ["需求:2"], module: "订单审批", nodeTypes: ["rule", "data-constraint"], kind: "rule", origin: "explicit", confidence: 1, status: "confirmed", policyId: "brain-creator.requirement-analysis", policyVersion: "2.2.1" }
    ],
    nodes: [],
    openQuestions: [],
    risks: [],
    contradictions: [],
    missingBranches: []
  };
}

function evaluationFixture(): RequirementPolicyEvaluation {
  return {
    verdict: "needs-user",
    score: 80,
    reasons: ["需要绑定真实系统"],
    requiredActions: ["确认目标系统入口"],
    coverage: { totalClauses: 2, coveredClauses: 1, coverageRate: 0.5, uncoveredSourceRefs: ["需求:2"] },
    contradictions: [],
    missingBranches: [],
    unsupportedClaims: []
  };
}

function gateFixture(): RequirementEvaluationGate {
  return {
    policyId: "brain-creator.requirement-analysis",
    policyVersion: "2.2.1",
    verdict: "needs-user",
    score: 80,
    coverage: { totalClauses: 2, coveredClauses: 1, coverageRate: 0.5, uncoveredSourceRefs: ["需求:2"] },
    status: "needs-confirmation",
    actions: [{ id: "action-1", kind: "uncovered-coverage", message: "确认金额规则的测试覆盖", sourceRefs: ["需求:2"], gapIds: [], status: "pending", createdAt: "2026-01-01T00:00:00.000Z" }],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function coverageFixture() {
  const empty = { requirementRefs: [], coveredRefs: [], missingRefs: [], intentCount: 0 };
  return {
    id: "coverage-1", knowledgeProjectId: "project-1", requirementSetId: "req-1", inputHash: "hash",
    dimensions: {
      field: empty,
      workflow: { requirementRefs: ["需求:1"], coveredRefs: ["需求:1"], missingRefs: [], intentCount: 1 },
      state: { requirementRefs: ["需求:1"], coveredRefs: ["需求:1"], missingRefs: [], intentCount: 1 },
      permission: empty,
      integration: empty
    },
    workflowModelIds: ["workflow-1"], stateMachineModelIds: ["state-1"], status: "complete" as const, reasons: [], generatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function intentFixture(): TestIntent {
  return {
    id: "intent-1", knowledgeProjectId: "project-1", requirementSetId: "req-1", title: "提交订单并进入审批", module: "订单审批", priority: "P0",
    objective: "验证提交订单后进入审批流程", preconditions: ["订单处于草稿状态"], expectedResults: ["订单状态变为审批中"], requirementRefs: ["需求:1"], knowledgeNodeRefs: ["node-1"],
    techniques: ["scenario", "state-transition"], coverageDimensions: ["workflow", "state"], scenarioType: "positive", processModelRefs: ["workflow-1"], actorJourney: ["申请人", "经理"], scenarioIds: ["scenario-1"],
    status: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function workflowFixture(): WorkflowModel {
  return {
    id: "workflow-1", knowledgeProjectId: "project-1", requirementSetId: "req-1", title: "订单审批流程", actors: ["申请人", "经理"],
    steps: [{ id: "draft", label: "草稿", actor: "申请人", sourceRefs: ["需求:1"] }, { id: "review", label: "审批", actor: "经理", sourceRefs: ["需求:1"] }],
    transitions: [{ id: "transition-1", from: "draft", to: "review", condition: "提交订单", actor: "申请人", sourceRefs: ["需求:1"] }], startStepIds: ["draft"], endStepIds: ["review"], sourceRefs: ["需求:1"], confidence: 0.95, status: "confirmed", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function stateMachineFixture(): StateMachineModel {
  return {
    id: "state-1", knowledgeProjectId: "project-1", requirementSetId: "req-1", title: "订单状态", states: [{ id: "draft", label: "草稿", initial: true, terminal: false, sourceRefs: ["需求:1"] }, { id: "review", label: "审批中", initial: false, terminal: true, sourceRefs: ["需求:1"] }],
    transitions: [{ id: "state-transition-1", from: "draft", to: "review", trigger: "提交", actor: "申请人", sourceRefs: ["需求:1"] }], sourceRefs: ["需求:1"], confidence: 0.95, status: "confirmed", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function objectFixture(): BusinessObjectModel {
  return { id: "object-1", requirementSetId: "req-1", semanticConceptId: "concept-1", name: "订单", actors: ["申请人"], fields: ["金额"], states: ["草稿", "审批中"], invariants: ["金额必须大于0"], sourceRefs: ["需求:1"], status: "confirmed" };
}

function decisionTableFixture(): DecisionTableModel {
  return { id: "decision-1", requirementSetId: "req-1", title: "金额审批规则", conditions: ["金额超过1000"], actions: ["需要经理审批"], rules: [{ conditionValues: { 金额: "超过1000" }, expectedActions: ["需要经理审批"], sourceRefs: ["需求:2"] }], sourceRefs: ["需求:2"], status: "confirmed" };
}

function scenarioFixture(): BusinessScenario {
  return { id: "scenario-1", knowledgeProjectId: "project-1", requirementSetId: "req-1", title: "订单提交并进入审批", objective: "申请人提交订单，经理完成审批", family: "cross-role", actors: ["申请人", "经理"], preconditions: ["订单处于草稿状态"], workflowRefs: ["workflow-1"], stateTransitionRefs: ["state-1:transition-1"], decisionRuleRefs: ["decision-1"], testDataNeeds: ["订单金额"], expectedBusinessOutcomes: ["订单进入审批中", "Move from 草稿 to 审批 when 提交"], sourceRefs: ["需求:1"], testIntentIds: ["intent-1"], risk: "high", status: "draft" };
}
