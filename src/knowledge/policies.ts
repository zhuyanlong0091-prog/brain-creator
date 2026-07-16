import { id } from "../shared/id.js";
import type {
  KnowledgeNode,
  TestDataProfile,
  TestDesignTechnique,
  TestIntent
} from "../domain/types.js";

export const REQUIREMENT_ANALYSIS_POLICY = {
  id: "brain-creator.requirement-analysis",
  version: "1.0.0"
} as const;

export const TEST_DESIGN_POLICY = {
  id: "brain-creator.test-design",
  version: "1.0.0"
} as const;

export type RequirementAnalysis = {
  requirementSetId: string;
  policyId: string;
  policyVersion: string;
  provider: "builtin" | "host-skill";
  module: string;
  nodes: Array<Omit<KnowledgeNode, "id" | "knowledgeProjectId" | "createdAt" | "updatedAt">>;
  openQuestions: string[];
  risks: string[];
};

export function analyzeRequirement(input: {
  requirementSetId: string;
  title: string;
  content: string;
  sourceRef: string;
  provider?: RequirementAnalysis["provider"];
}): RequirementAnalysis {
  const module = inferModule(input.title, input.content);
  const base = {
    requirementSetId: input.requirementSetId,
    module,
    sourceRefs: [input.sourceRef],
    origin: "derived" as const,
    confidence: 0.8,
    status: "draft" as const,
    policyId: REQUIREMENT_ANALYSIS_POLICY.id,
    policyVersion: REQUIREMENT_ANALYSIS_POLICY.version
  };
  const nodes: RequirementAnalysis["nodes"] = [
    { ...base, type: "module", title: module, content: `Module inferred from ${input.title}` },
    { ...base, type: "requirement", title: input.title, content: input.content }
  ];

  if (matches(input.content, /create|new|fill|submit|approve|reject|\u65b0\u5efa|\u586b\u5199|\u63d0\u4ea4|\u5ba1\u6279|\u9a73\u56de|\u8fdb\u5165/i)) {
    nodes.push({ ...base, type: "workflow", title: `${module} workflow`, content: input.content });
  }
  if (matches(input.content, /require|must|above|below|\u8d85\u8fc7|\u4f4e\u4e8e|\u5fc5\u987b|\u9009\u62e9.+\u540e|\u5982\u679c|\u624d\u4f1a/i)) {
    nodes.push({ ...base, type: "rule", title: `${module} business rule`, content: input.content });
  }
  if (matches(input.content, /status|state|draft|approved|\u72b6\u6001|\u8349\u7a3f|\u5df2\u5ba1\u6279|\u53d8\u4e3a/i)) {
    nodes.push({ ...base, type: "state", title: `${module} state model`, content: input.content });
  }
  if (matches(input.content, /role|user|manager|finance|\u6743\u9650|\u89d2\u8272|\u7528\u6237|\u7ecf\u7406|\u8d22\u52a1/i)) {
    nodes.push({ ...base, type: "actor", title: `${module} actors`, content: input.content });
    nodes.push({ ...base, type: "permission", title: `${module} permissions`, content: input.content });
  }
  if (matches(input.content, /field|form|amount|\u5b57\u6bb5|\u8868\u5355|\u91d1\u989d|\u59d3\u540d|\u7c7b\u578b/i)) {
    nodes.push({ ...base, type: "field", title: `${module} fields`, content: input.content });
  }
  if (matches(input.content, /api|webhook|integration|\u540c\u6b65|\u63a5\u53e3|\u7b2c\u4e09\u65b9/i)) {
    nodes.push({ ...base, type: "integration", title: `${module} integration`, content: input.content });
  }

  const openQuestions = sentenceMatches(
    input.content,
    /not specified|unspecified|\u5f85\u786e\u8ba4|\u672a\u660e\u786e|\u672a\u77e5/i
  );
  const risks = [
    ...sentenceMatches(
      input.content,
      /permission|amount|payment|approval|\u6743\u9650|\u91d1\u989d|\u652f\u4ed8|\u5ba1\u6279/i
    ).map((value) => `Business risk: ${value}`),
    ...openQuestions.map((value) => `Ambiguity risk: ${value}`)
  ];

  return {
    requirementSetId: input.requirementSetId,
    policyId: REQUIREMENT_ANALYSIS_POLICY.id,
    policyVersion: REQUIREMENT_ANALYSIS_POLICY.version,
    provider: input.provider ?? "builtin",
    module,
    nodes,
    openQuestions,
    risks
  };
}

export function designTests(input: {
  knowledgeProjectId: string;
  analysis: RequirementAnalysis;
}) {
  const content = input.analysis.nodes.map((node) => node.content).join("\n");
  const techniques = new Set<TestDesignTechnique>(["scenario", "error-guessing"]);
  if (matches(content, /above|below|between|\u8d85\u8fc7|\u4f4e\u4e8e|\u8303\u56f4|\u957f\u5ea6|\u91d1\u989d/i)) techniques.add("boundary-value");
  if (matches(content, /status|state|draft|approved|\u72b6\u6001|\u8349\u7a3f|\u53d8\u4e3a/i)) techniques.add("state-transition");
  if (matches(content, /if|when|\u9009\u62e9.+\u540e|\u6761\u4ef6|\u5426\u5219/i)) techniques.add("decision-table");
  if (matches(content, /field|form|input|\u5b57\u6bb5|\u8868\u5355|\u8f93\u5165/i)) techniques.add("equivalence-partitioning");

  const now = new Date().toISOString();
  const requirementRefs = input.analysis.nodes
    .filter((node) => node.type === "requirement")
    .flatMap((node) => node.sourceRefs);
  const intent: TestIntent = {
    id: id("intent"),
    knowledgeProjectId: input.knowledgeProjectId,
    requirementSetId: input.analysis.requirementSetId,
    title: `${input.analysis.module} requirement coverage`,
    module: input.analysis.module,
    priority: "P0",
    objective: content,
    preconditions: ["The requirement baseline is approved", "The target environment is available"],
    expectedResults: ["The system behavior matches the approved requirement"],
    requirementRefs,
    knowledgeNodeRefs: input.analysis.nodes.map((node) => `${node.type}:${node.title}`),
    techniques: [...techniques],
    status: "draft",
    createdAt: now,
    updatedAt: now
  };
  const needsData =
    techniques.has("boundary-value") ||
    techniques.has("equivalence-partitioning") ||
    matches(content, /field|form|amount|\u5b57\u6bb5|\u8868\u5355|\u91d1\u989d|\u8f93\u5165/i);
  const dataProfiles: TestDataProfile[] = needsData
    ? [
        {
          id: id("data"),
          knowledgeProjectId: input.knowledgeProjectId,
          requirementSetId: input.analysis.requirementSetId,
          name: `${input.analysis.module} generated data`,
          field: "requirement-input",
          strategy: "generated",
          constraints: [...techniques].map((technique) => `cover:${technique}`),
          seed: input.analysis.requirementSetId,
          sourceRefs: requirementRefs,
          createdAt: now
        }
      ]
    : [];

  return {
    policyId: TEST_DESIGN_POLICY.id,
    policyVersion: TEST_DESIGN_POLICY.version,
    provider: input.analysis.provider,
    techniques: [...techniques],
    testIntents: [intent],
    dataProfiles
  };
}

export function evaluatePolicyOutput(analysis: RequirementAnalysis) {
  const invalid = analysis.nodes.length === 0 || analysis.nodes.some((node) => node.sourceRefs.length === 0);
  if (invalid) {
    return {
      verdict: "blocked" as const,
      score: 0,
      reasons: ["Every generated knowledge node must reference source evidence"]
    };
  }
  return {
    verdict: analysis.openQuestions.length > 0 ? ("needs-user" as const) : ("pass" as const),
    score: Math.max(0, 100 - analysis.openQuestions.length * 10),
    reasons: analysis.openQuestions
  };
}

export function normalizeHostSkillAnalysis(
  raw: unknown,
  requirementSetId: string
): RequirementAnalysis {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Host Skill analysisPackage must be an object");
  }
  const input = raw as Record<string, unknown>;
  if (typeof input.module !== "string" || !Array.isArray(input.nodes)) {
    throw new Error("Host Skill analysisPackage requires module and nodes");
  }
  const validTypes = new Set([
    "module", "actor", "object", "field", "rule", "workflow", "state", "permission",
    "integration", "data-constraint", "term", "requirement"
  ]);
  const nodes = input.nodes.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Host Skill nodes[${index}] must be an object`);
    }
    const node = value as Record<string, unknown>;
    if (
      typeof node.type !== "string" ||
      !validTypes.has(node.type) ||
      typeof node.title !== "string" ||
      typeof node.content !== "string" ||
      !Array.isArray(node.sourceRefs) ||
      node.sourceRefs.length === 0 ||
      node.sourceRefs.some((ref) => typeof ref !== "string")
    ) {
      throw new Error(`Host Skill nodes[${index}] requires valid type, title, content, and sourceRefs`);
    }
    return {
      requirementSetId,
      type: node.type as KnowledgeNode["type"],
      title: node.title,
      content: node.content,
      module: input.module as string,
      sourceRefs: node.sourceRefs as string[],
      origin: "derived" as const,
      confidence: typeof node.confidence === "number" ? node.confidence : 0.7,
      status: "draft" as const,
      policyId: typeof input.policyId === "string" ? input.policyId : REQUIREMENT_ANALYSIS_POLICY.id,
      policyVersion: typeof input.policyVersion === "string" ? input.policyVersion : "host-skill"
    };
  });
  return {
    requirementSetId,
    policyId: typeof input.policyId === "string" ? input.policyId : REQUIREMENT_ANALYSIS_POLICY.id,
    policyVersion: typeof input.policyVersion === "string" ? input.policyVersion : "host-skill",
    provider: "host-skill",
    module: input.module,
    nodes,
    openQuestions: stringList(input.openQuestions),
    risks: stringList(input.risks)
  };
}

function inferModule(title: string, content: string) {
  const chinese = /([\u4e00-\u9fff]{2,8})(?:\u9700\u6c42|\u8ba2\u5355|\u5408\u540c|\u5ba1\u6279|\u8868\u5355|\u7ba1\u7406)/.exec(`${title} ${content}`)?.[1];
  if (chinese) return chinese;
  const english = /\b(order|contract|customer|account|invoice|recruiting|approval)\b/i.exec(
    `${title} ${content}`
  )?.[1];
  return english ? `${english[0].toUpperCase()}${english.slice(1)}` : title.trim() || "General";
}

function sentenceMatches(content: string, pattern: RegExp) {
  return content
    .split(/[\u3002\uff01\uff0c?!\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && matches(item, pattern));
}

function matches(content: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  return pattern.test(content);
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
