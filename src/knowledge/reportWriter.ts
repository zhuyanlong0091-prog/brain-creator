import type {
  BusinessObjectModel,
  DecisionTableModel,
  RequirementCoverageProfile,
  RequirementEvaluationGate,
  RequirementSet,
  StateMachineModel,
  TestIntent,
  WorkflowModel
} from "../domain/types.js";
import type {
  BusinessScenario,
  ScenarioAssuranceContract,
  ScenarioTrustRecord
} from "../brain/types.js";
import type {
  RequirementAnalysis,
  RequirementClause,
  RequirementPolicyEvaluation
} from "./policies.js";
import type { EvidenceCatalog } from "./evidenceCatalog.js";
import { evidenceLinks } from "./evidenceCatalog.js";

type DesignCoverage = {
  totalClauses: number;
  coveredClauseSourceRefs: string[];
  uncoveredClauseSourceRefs: string[];
  intentCount: number;
};

export type RequirementAnalysisReportInput = {
  title: string;
  setStatus: RequirementSet["status"];
  analysis: RequirementAnalysis;
  evaluation: RequirementPolicyEvaluation;
  evaluationGate: RequirementEvaluationGate;
  coverage: DesignCoverage;
  coverageProfile?: RequirementCoverageProfile;
  workflowModels: WorkflowModel[];
  stateMachineModels: StateMachineModel[];
  businessObjectModels: BusinessObjectModel[];
  decisionTableModels: DecisionTableModel[];
  businessScenarios: BusinessScenario[];
  scenarioAssuranceContracts: ScenarioAssuranceContract[];
  scenarioTrustRecords: ScenarioTrustRecord[];
  intents: TestIntent[];
  evidenceCatalog?: EvidenceCatalog;
};

export type TestIntentReportInput = {
  title: string;
  setStatus: RequirementSet["status"];
  intents: TestIntent[];
  scenarioCount: number;
  workflowCount: number;
  stateMachineCount: number;
  evidenceCatalog?: EvidenceCatalog;
};

const nodeLabels: Record<string, string> = {
  module: "业务模块", actor: "参与角色", object: "业务对象", field: "字段", rule: "业务规则",
  workflow: "业务流程", state: "状态", permission: "权限", integration: "系统集成",
  "data-constraint": "数据约束", term: "业务术语", requirement: "原始需求"
};

const dimensionLabels: Record<string, string> = {
  field: "字段与表单", workflow: "业务流程", state: "状态转换", permission: "角色与权限", integration: "系统集成"
};

const techniqueLabels: Record<string, string> = {
  "equivalence-partitioning": "等价类", "boundary-value": "边界值", "decision-table": "决策表",
  "state-transition": "状态转换", scenario: "场景法", "error-guessing": "错误推测"
};

export function renderRequirementAnalysisReport(input: RequirementAnalysisReportInput) {
  const coverageRows = input.coverageProfile ? Object.entries(input.coverageProfile.dimensions) : [];
  const scenarios = input.businessScenarios.filter((item) => item.status !== "stale");
  const lines = [
    "---",
    `需求版本: ${input.analysis.requirementSetId}`,
    `分析状态: ${statusLabel(input.setStatus)}`,
    `分析来源: ${providerLabel(input.analysis.provider)}`,
    "---", "",
    `# ${reportTitle(input.title, input.analysis)}：需求分析报告`, "",
    "> 本报告面向需求负责人、测试工程师和业务审核人，说明需求表达了什么、业务流程如何运转、准备验证哪些场景，以及当前还不能确认什么。",
    "> 测试意图的完整清单请查看同目录的 `test-intents.md`；原始 JSON 资产仅供 Brain Creator 内部编译和追溯。", "",
    "## 一、分析结论", "",
    `- **总体判断**：${verdictLabel(input.evaluation.verdict)}`,
    `- **需求评估分数**：${input.evaluation.score}/100`,
    `- **需求评估门禁**：${gateStatusLabel(input.evaluationGate.status)}`,
    `- **需求条款数量**：${input.analysis.clauses.length}`,
    `- **测试意图数量**：${input.coverage.intentCount}`,
    `- **业务场景数量**：${scenarios.length}`,
    `- **业务对象**：${input.businessObjectModels.length} 个；**决策表**：${input.decisionTableModels.length} 个`,
    `- **业务流程模型**：${input.workflowModels.length} 个；**状态模型**：${input.stateMachineModels.length} 个`, "",
    "## 二、需求范围概览", "",
    `- **主要业务模块**：${unique(input.analysis.clauses.map((clause) => clause.module)).join("、") || "未识别"}`,
    `- **需求来源**：${input.analysis.clauses.length > 0 ? "正文、表格或已确认图片证据" : "未提取到需求条款"}`,
    `- **分析方式**：${providerLabel(input.analysis.provider)}；策略版本 ${input.analysis.policyVersion}`,
    `- **当前阶段**：${statusLabel(input.setStatus)}。这表示分析结果等待审核，不代表真实系统已经符合需求。`, "",
    "## 三、需求条款", "",
    "| 序号 | 需求内容 | 所属模块 | 识别内容 | 来源证据 |",
    "| ---: | --- | --- | --- | --- |",
    ...(input.analysis.clauses.length > 0 ? input.analysis.clauses.map((clause) => clauseRow(clause, input.evidenceCatalog)) : ["| - | 暂未提取到需求条款 | - | - | - |"]), "",
    "## 四、已理解的业务知识", "",
    ...(input.analysis.nodes.length > 0
      ? [
          "| 知识类型 | 业务名称 | 业务含义 | 来源证据 | 可信度 | 状态 |",
          "| --- | --- | --- | --- | ---: | --- |",
          ...input.analysis.nodes.map((node) => `| ${mdCell(nodeLabels[node.type] ?? node.type)} | ${mdCell(knowledgeName(node.title))} | ${mdCell(node.content)} | ${evidenceLinks(node.sourceRefs, input.evidenceCatalog)} | ${percent(node.confidence)} | ${statusLabel(node.status)} |`),
          ""
        ]
      : ["| 知识类型 | 业务名称 | 业务含义 | 来源证据 | 可信度 | 状态 |", "| --- | --- | --- | --- | ---: | --- |", "| - | 暂未形成结构化业务知识 | - | 暂无来源 | - | 待处理 |", ""]),
    "## 五、业务流程与状态", "",
    ...(input.workflowModels.length + input.stateMachineModels.length + input.businessObjectModels.length + input.decisionTableModels.length > 0
      ? [
          ...input.businessObjectModels.flatMap((model) => renderBusinessObject(model, input.evidenceCatalog)),
          ...input.decisionTableModels.flatMap((model) => renderDecisionTable(model, input.evidenceCatalog)),
          ...input.workflowModels.flatMap((model, index) => renderWorkflow(model, index + 1, input.evidenceCatalog)),
          ...input.stateMachineModels.flatMap((model, index) => renderStateMachine(model, index + 1, input.evidenceCatalog))
        ]
      : ["- 当前没有已确认的业务流程、状态、业务对象或决策模型。", "- 如果需求包含流程图或状态图，应先完成识别和确认。", ""]),
    "## 六、业务场景分析", "",
    "> 业务场景是对业务目标的完整验证路径，包含角色、前置状态、条件分支、数据准备和业务结果。它不是字段清单，也不是已经绑定页面的自动化脚本。", "",
    `- **场景总数**：${scenarios.length}`,
    `- **场景分类**：${scenarioSummary(scenarios)}`,
    `- **系统绑定与质量门禁**：${scenarioAssuranceSummary(input.scenarioAssuranceContracts)}`,
    ...(scenarios.length > 0
      ? [
          "", "| 场景 | 类型 | 风险 | 参与角色 | 前置条件 | 预期业务结果 | 测试数据准备 | 质量门禁 | 状态 | 来源证据 |",
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
          ...scenarios.map((scenario) => scenarioRow(scenario, input.scenarioAssuranceContracts, input.scenarioTrustRecords, input.evidenceCatalog)), ""
        ]
      : ["", "- 当前没有形成可审核的业务场景。", ""]),
    "## 七、覆盖情况", "",
    `- **总体条款覆盖**：${input.coverage.coveredClauseSourceRefs.length}/${input.coverage.totalClauses}（${percent(input.evaluation.coverage.coverageRate)}）`,
    ...(coverageRows.length > 0
      ? ["", "| 覆盖方面 | 需求依据数 | 已覆盖 | 测试意图数 | 未覆盖依据 |", "| --- | ---: | ---: | ---: | --- |",
          ...coverageRows.map(([dimension, detail]) => `| ${dimensionLabels[dimension] ?? dimension} | ${detail.requirementRefs.length} | ${detail.coveredRefs.length} | ${detail.intentCount} | ${evidenceLinks(detail.missingRefs, input.evidenceCatalog)} |`)]
      : ["- 尚未生成分维度覆盖统计。"]), "",
    "## 八、风险与待确认事项", "",
    ...(input.analysis.risks.length > 0 ? ["### 已识别风险", "", ...input.analysis.risks.map((item) => `- ${plainText(item)}`), ""] : ["- 暂未识别到额外风险。", ""]),
    ...(input.analysis.openQuestions.length > 0 ? ["### 待澄清问题", "", ...input.analysis.openQuestions.map((item) => `- ${plainText(item)}`), ""] : ["### 待澄清问题", "", "- 暂无。", ""]),
    ...(input.analysis.contradictions.length > 0 ? ["### 需求矛盾", "", ...input.analysis.contradictions.map((item) => `- ${plainText(item)}`), ""] : ["### 需求矛盾", "", "- 暂未发现。", ""]),
    ...(input.analysis.missingBranches.length > 0 ? ["### 可能缺失的分支", "", ...input.analysis.missingBranches.map((item) => `- ${plainText(item)}`), ""] : ["### 可能缺失的分支", "", "- 暂未发现。", ""]),
    ...(input.evaluationGate.actions.length > 0
      ? ["### 评估门禁要求", "", ...input.evaluationGate.actions.map((action) => `- **${statusLabel(action.status)}**：${plainText(action.message)}（依据：${evidenceLinks(action.sourceRefs, input.evidenceCatalog)}）`), ""]
      : ["### 评估门禁要求", "", "- 暂无待处理门禁。", ""]),
    "## 九、审核建议", "",
    `- 当前报告建议：${input.evaluationGate.status === "passed" ? "可以进入下一阶段审核。" : "先处理上面的待确认事项，再决定是否接受需求基线。"}`,
    "- 需求基线确认后，还需要把业务场景绑定到目标系统页面、角色、状态和测试数据。",
    "- 页面上观察到的实际行为只能作为系统观察，不能覆盖本报告中的需求预期。", "",
    "## 十、阅读边界", "",
    "- 本报告不是可执行脚本，也不代表目标系统已经通过测试。",
    "- 测试意图进入系统探索和用例编译后，才会补充页面入口、操作步骤、测试数据和断言证据。",
    "- 需求预期、系统观察和执行结果保持分层，任何一层都不会静默覆盖另一层。"
  ];
  return renderReport(lines, input.evidenceCatalog);
}

export function renderTestIntentReport(input: TestIntentReportInput) {
  const byPriority = countBy(input.intents, (intent) => intent.priority);
  const byStatus = countBy(input.intents, (intent) => intent.status);
  const byType = countBy(input.intents, (intent) => scenarioType(intent));
  const lines = [
    "---", `需求版本: ${input.intents[0]?.requirementSetId ?? "未生成"}`, `文档状态: ${statusLabel(input.setStatus)}`, "---", "",
    `# ${reportTitle(input.title, { module: input.intents[0]?.module })}：测试意图`, "",
    "> 本文档供人工审核测试范围。测试意图回答“要验证什么”，不是已经绑定真实页面的自动化脚本。",
    "> 每条意图均应能追溯到需求依据或已确认的业务模型；系统绑定和测试数据准备在后续阶段完成。", "",
    "## 测试意图总览", "",
    `- **总数**：${input.intents.length}`,
    `- **优先级**：P0 ${byPriority.P0 ?? 0}、P1 ${byPriority.P1 ?? 0}、P2 ${byPriority.P2 ?? 0}、P3 ${byPriority.P3 ?? 0}`,
    `- **场景类型**：${Object.entries(byType).map(([key, value]) => `${key} ${value}`).join("、") || "暂无"}`,
    `- **当前状态**：${Object.entries(byStatus).map(([key, value]) => `${statusLabel(key)} ${value}`).join("、") || "暂无"}`,
    `- **关联业务流程模型**：${input.workflowCount} 个；状态模型：${input.stateMachineCount} 个；业务场景：${input.scenarioCount} 个`, "",
    "## 审核重点", "",
    "- 是否覆盖主流程、关键分支、异常路径和最终状态。",
    "- 每条意图的前置条件和预期结果是否符合业务逻辑。",
    "- 需要跨角色协作时，角色顺序和身份切换是否正确。",
    "- 来源证据不足、系统入口不唯一或数据无法准备的意图，应保持待确认，不应直接执行。", "",
    ...(input.intents.length > 0 ? input.intents.flatMap((intent, index) => renderIntent(intent, index + 1, input.evidenceCatalog)) : ["## 当前没有测试意图", "", "- 请先完成需求分析和测试设计。"])
  ];
  return renderReport(lines, input.evidenceCatalog);
}

function renderBusinessObject(model: BusinessObjectModel, catalog?: EvidenceCatalog) {
  return [
    `### 业务对象：${plainText(model.name)}`, "",
    `- **参与角色**：${listText(model.actors)}`,
    `- **关键字段**：${listText(model.fields)}`,
    `- **生命周期状态**：${listText(model.states)}`,
    `- **业务不变量**：${listText(model.invariants)}`,
    `- **状态**：${statusLabel(model.status)}；**来源证据**：${evidenceLinks(model.sourceRefs, catalog)}`, ""
  ];
}

function renderDecisionTable(model: DecisionTableModel, catalog?: EvidenceCatalog) {
  return [
    `### 条件决策：${plainText(model.title)}`, "",
    `- **判断条件**：${listText(model.conditions)}`,
    `- **执行动作**：${listText(model.actions)}`,
    `- **规则数量**：${model.rules.length}`,
    ...model.rules.map((rule, index) => `  - 规则 ${index + 1}：${Object.entries(rule.conditionValues).map(([key, value]) => `${key}=${value}`).join("；") || "无条件"} → ${listText(rule.expectedActions)}（依据：${evidenceLinks(rule.sourceRefs, catalog)}）`),
    `- **状态**：${statusLabel(model.status)}；**来源证据**：${evidenceLinks(model.sourceRefs, catalog)}`, ""
  ];
}

function renderWorkflow(model: WorkflowModel, index: number, catalog?: EvidenceCatalog) {
  return [
    `### 业务流程 ${index}：${modelTitle(model.title, "业务流程")}`, "",
    `- **参与角色**：${listText(model.actors)}`,
    `- **可信度**：${percent(model.confidence)}；**状态**：${statusLabel(model.status)}`,
    `- **流程步骤**：${model.steps.map((step) => `${humanizeText(step.label)}${step.actor ? `（${humanizeText(step.actor)}）` : ""}`).join(" → ") || "未识别"}`,
    "- **关键转换**：",
    ...(model.transitions.length > 0 ? model.transitions.map((transition) => `  - ${humanizeText(stepLabel(model.steps, transition.from))} → ${humanizeText(stepLabel(model.steps, transition.to))}${transition.condition ? `；触发条件：${humanizeText(transition.condition)}` : ""}${transition.actor ? `；执行角色：${humanizeText(transition.actor)}` : ""}${transition.preconditions?.length ? `；前置：${listText(transition.preconditions)}` : ""}${transition.sideEffects?.length ? `；副作用：${listText(transition.sideEffects)}` : ""}（依据：${evidenceLinks(transition.sourceRefs, catalog)}）`) : ["  - 暂未识别到转换。"]),
    `- **来源证据**：${evidenceLinks(model.sourceRefs, catalog)}`, ""
  ];
}

function renderStateMachine(model: StateMachineModel, index: number, catalog?: EvidenceCatalog) {
  return [
    `### 状态模型 ${index}：${modelTitle(model.title, "状态模型")}`, "",
    `- **状态集合**：${model.states.map((state) => `${humanizeText(state.label)}${state.initial ? "（初始）" : ""}${state.terminal ? "（终态）" : ""}`).join("、") || "未识别"}`,
    `- **可信度**：${percent(model.confidence)}；**状态**：${statusLabel(model.status)}`,
    "- **允许的状态转换**：",
    ...(model.transitions.length > 0 ? model.transitions.map((transition) => `  - ${humanizeText(stepLabel(model.states, transition.from))} → ${humanizeText(stepLabel(model.states, transition.to))}${transition.trigger ? `；触发动作：${humanizeText(transition.trigger)}` : ""}${transition.actor ? `；执行角色：${humanizeText(transition.actor)}` : ""}${transition.validity ? `；规则：${validityLabel(transition.validity)}` : ""}（依据：${evidenceLinks(transition.sourceRefs, catalog)}）`) : ["  - 暂未识别到转换。"]),
    `- **来源证据**：${evidenceLinks(model.sourceRefs, catalog)}`, ""
  ];
}

function renderIntent(intent: TestIntent, index: number, catalog?: EvidenceCatalog) {
  return [
    `## ${index}. ${plainText(humanizeTitle(intent.title))}`, "",
    `- **优先级**：${intent.priority}`,
    `- **场景类型**：${scenarioType(intent)}`,
    `- **所属模块**：${plainText(intent.module)}`,
    `- **当前状态**：${statusLabel(intent.status)}`,
    `- **验证目标**：${plainText(humanizeText(intent.objective))}`,
    `- **前置条件**：${listText(intent.preconditions)}`,
    `- **预期结果**：${listText(intent.expectedResults)}`,
    `- **覆盖方面**：${intent.coverageDimensions?.map((item) => dimensionLabels[item] ?? item).join("、") || "功能行为"}`,
    `- **设计方法**：${intent.techniques.map((item) => techniqueLabels[item] ?? item).join("、") || "场景法"}`,
    `- **需求依据**：${evidenceLinks(intent.requirementRefs, catalog)}`,
    `- **业务模型依据**：${evidenceLinks(intent.processModelRefs ?? [], catalog)}`,
    `- **关联业务场景**：${evidenceLinks(intent.scenarioIds ?? [], catalog)}`,
    `- **产生的数据**：${evidenceLinks(intent.producesEntityRefs ?? [], catalog)}`,
    `- **依赖的数据**：${evidenceLinks(intent.consumesEntityRefs ?? [], catalog)}`,
    `- **角色路径**：${intent.actorJourney?.map(humanizeText).join(" → ") || "未指定"}`,
    `- **内部标识**：${intent.id}`, ""
  ];
}

function scenarioRow(scenario: BusinessScenario, contracts: ScenarioAssuranceContract[], trusts: ScenarioTrustRecord[], catalog?: EvidenceCatalog) {
  const contract = contracts.find((item) => item.scenarioId === scenario.id);
  const trust = trusts.find((item) => item.scenarioId === scenario.id);
  const data = scenario.dataPlan;
  const readiness = data ? `${dataReadinessLabel(data.readiness)}；生命周期：${data.plannedLifecycle.map(lifecycleLabel).join(" → ") || "未指定"}` : "未规划";
  const assurance = contract ? `${contractVerdictLabel(contract.verdict)}；绑定：${bindingLabel(contract.systemBinding)}；断言：${oracleLabel(contract.oracleStrength)}` : "尚未评估";
  const trustText = trust ? `${statusLabel(trust.status)}（强证据运行 ${trust.strongRunCount} 次）` : statusLabel(scenario.status);
  return `| ${mdCell(scenario.title)} | ${familyLabel(scenario.family)} | ${riskLabel(scenario.risk)} | ${mdCell(listText(scenario.actors))} | ${mdCell(listText(scenario.preconditions))} | ${mdCell(listText(scenario.expectedBusinessOutcomes))} | ${mdCell(readiness)} | ${mdCell(assurance)} | ${mdCell(trustText)} | ${evidenceLinks(scenario.sourceRefs, catalog)} |`;
}

function clauseRow(clause: RequirementClause, catalog?: EvidenceCatalog) {
  return `| ${clause.index} | ${mdCell(clause.text)} | ${mdCell(clause.module)} | ${clause.nodeTypes.map((type) => nodeLabels[type] ?? type).join("、") || "待分类"} | ${evidenceLinks(unique(clause.sourceRefs?.length ? clause.sourceRefs : clause.sourceRef ? [clause.sourceRef] : []), catalog)} |`;
}

function scenarioSummary(scenarios: BusinessScenario[]) {
  const counts = countBy(scenarios, (scenario) => familyLabel(scenario.family));
  return Object.entries(counts).map(([key, value]) => `${key} ${value}`).join("、") || "暂无";
}

function scenarioAssuranceSummary(contracts: ScenarioAssuranceContract[]) {
  if (contracts.length === 0) return "尚未进行目标系统绑定评估";
  const counts = countBy(contracts, (contract) => contractVerdictLabel(contract.verdict));
  return Object.entries(counts).map(([key, value]) => `${key} ${value}`).join("、");
}

function scenarioType(intent: TestIntent) {
  const title = intent.title.toLowerCase();
  if ((intent.actorJourney?.length ?? 0) > 1) return "跨角色业务流程";
  if (/missing prerequisite|role mismatch|invalid transition|非法|前置|角色不匹配/i.test(title)) return "异常或非法状态";
  if (intent.coverageDimensions?.includes("state")) return "状态转换";
  if (intent.coverageDimensions?.includes("workflow")) return "业务流程";
  if (intent.techniques.includes("decision-table")) return "条件分支";
  if (intent.coverageDimensions?.includes("field")) return "字段与数据规则";
  return intent.scenarioType === "negative" ? "异常场景" : "功能场景";
}

function familyLabel(value: BusinessScenario["family"]) {
  return {
    "main-flow": "主流程", branch: "条件分支", "state-transition": "状态转换", "invalid-transition": "非法状态转换",
    "cross-role": "跨角色业务流程", exception: "异常流程", compensation: "补偿流程", data: "数据场景", integration: "集成场景"
  }[value];
}

function riskLabel(value: BusinessScenario["risk"]) {
  return { low: "低", medium: "中", high: "高", critical: "严重" }[value];
}

function dataReadinessLabel(value: string) { return { ready: "数据已就绪", creatable: "可创建", blocked: "数据阻塞" }[value] ?? value; }
function contractVerdictLabel(value: string) { return { pass: "通过", "needs-review": "需要复核", blocked: "已阻塞" }[value] ?? value; }
function bindingLabel(value: string) { return { unique: "唯一绑定", ambiguous: "存在歧义", missing: "未绑定" }[value] ?? value; }
function oracleLabel(value: string) { return { strong: "强断言", limited: "有限断言", none: "无断言" }[value] ?? value; }
function lifecycleLabel(value: string) { return { lookup: "查询", create: "创建", transition: "流转", verify: "验证", cleanup: "清理" }[value] ?? value; }
function validityLabel(value: string) { return { legal: "允许", forbidden: "禁止", unknown: "未知" }[value] ?? value; }
function modelTitle(title: string, fallback: string) { return /^workflow from |^state machine from /i.test(title) ? fallback : humanizeText(title); }
function stepLabel(items: Array<{ id: string; label: string }>, id: string) { return items.find((item) => item.id === id)?.label ?? id; }
function countBy<T>(items: T[], key: (item: T) => string) { return items.reduce<Record<string, number>>((counts, item) => { const value = key(item); counts[value] = (counts[value] ?? 0) + 1; return counts; }, {}); }
function listText(values: string[]) { return values.length > 0 ? values.map(humanizeText).join("；") : "未指定"; }
function knowledgeName(title: string) {
  const base = title.split(/\s+(?:requirement|workflow|state|rule|field|actor|object|integration|permission|term|module|data-constraint):/i)[0];
  return plainText(base || title);
}
function plainText(value: string) { return humanizeText(value).replace(/\s+/g, " ").trim(); }
function mdCell(value: string) { return plainText(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " "); }
function reportTitle(title: string, analysis: { module?: string }) {
  const readable = plainText(title);
  return /[�\u0000-\u001F]/.test(title) || readable.length < 2
    ? plainText(analysis.module || "需求文档")
    : readable;
}
function humanizeTitle(value: string) { return humanizeText(value).replace(/cross-role actor journey/gi, "跨角色业务流程").replace(/missing prerequisite/gi, "缺少前置状态").replace(/role mismatch/gi, "角色不匹配").replace(/invalid transition/gi, "非法状态转换"); }
function humanizeText(value: string) {
  return value
    .replace(/\b(requirement|workflow|state|rule|field|actor|object|integration|permission|term|module|data-constraint):\s*/gi, "")
    .replace(/^Requirement\s+(\d+)$/i, "需求条款 $1")
    .replace(/Complete the workflow across roles:/gi, "按角色顺序完成业务流程：")
    .replace(/Module inferred from requirement clauses in .+$/gi, "根据需求条款识别出的业务模块")
    .replace(/Move from (.+?) to (.+?)(?: when (.+))?$/gi, (_, from: string, to: string, condition?: string) =>
      condition ? `从${from}转为${to}，条件：${condition}` : `从${from}转为${to}`
    )
    .replace(/Every workflow transition completes under the expected actor/gi, "每个流程转换都应由预期角色完成")
    .replace(/Attempt the transition without first reaching/gi, "在未进入以下状态前尝试执行转换：")
    .replace(/The transition to (.+) is rejected and the current state is preserved/gi, "转换被拒绝，当前状态保持不变：$1")
    .replace(/Attempt the transition as an actor other than/gi, "使用非以下角色尝试执行转换：")
    .replace(/The transition is rejected for an unauthorized actor/gi, "未授权角色不能执行该转换")
    .replace(/Attempt a direct transition from (.+)/gi, "尝试直接从以下状态转换：$1")
    .replace(/The undefined state transition is rejected/gi, "未定义的状态转换应被拒绝")
    .replace(/The requirement baseline is approved/gi, "需求基线已审核通过")
    .replace(/The target environment is available/gi, "目标测试环境可用")
    .replace(/Each actor has an available test identity/gi, "每个参与角色都有可用的测试账号")
    .replace(/No confirmed entries/gi, "暂无已确认内容")
    .replace(/\bnone\b/gi, "无")
    .replace(/\bdraft\b/gi, "草稿")
    .replace(/\bconfirmed\b/gi, "已确认")
    .replace(/\bblocked\b/gi, "已阻塞")
    .replace(/\bpending\b/gi, "待处理")
    .replace(/\bpositive\b/gi, "正向")
    .replace(/\bnegative\b/gi, "负向");
}
function statusLabel(value: string) { return ({ draft: "草稿，待审核", approved: "已批准", superseded: "已被新版本替代", compiled: "已编译", stale: "需要重新确认", "needs-exploration": "等待系统探索", "needs-data": "等待测试数据", ambiguous: "存在歧义", blocked: "已阻塞", confirmed: "已确认", pending: "待处理", pass: "通过", "needs-user": "需要人工确认", generated: "已生成", grounded: "已具备需求依据", bound: "已绑定系统", verified: "已验证", trusted: "已建立信任", quarantined: "已隔离" } as Record<string, string>)[value] ?? value; }
function gateStatusLabel(value: RequirementEvaluationGate["status"]) { return ({ passed: "已通过", "needs-confirmation": "等待人工确认", confirmed: "已确认", blocked: "已阻塞" })[value]; }
function verdictLabel(value: RequirementPolicyEvaluation["verdict"]) { return ({ pass: "通过", "needs-user": "需要人工确认", blocked: "已阻塞" })[value]; }
function providerLabel(value: RequirementAnalysis["provider"]) { return value === "host-skill" ? "宿主 Skill 增强分析" : "Brain Creator 内置分析"; }
function percent(value: number) { return `${Math.round(value * 100)}%`; }
function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }
function renderReport(lines: string[], catalog?: EvidenceCatalog) {
  let report = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  if (catalog) {
    for (const entry of [...catalog.entries].sort((left, right) => right.rawRef.length - left.rawRef.length)) {
      report = report.split(entry.rawRef).join(evidenceLinks([entry.rawRef], catalog));
    }
  }
  return `${report}\n`;
}
