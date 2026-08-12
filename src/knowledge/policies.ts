import { id } from "../shared/id.js";
import type {
  KnowledgeNode,
  KnowledgeNodeType,
  CoverageDimension,
  TestDataProfile,
  TestDesignTechnique,
  TestIntent
} from "../domain/types.js";

export const REQUIREMENT_ANALYSIS_POLICY = {
  id: "brain-creator.requirement-analysis",
  version: "2.0.0"
} as const;

export const TEST_DESIGN_POLICY = {
  id: "brain-creator.test-design",
  version: "2.0.0"
} as const;

export type RequirementClause = {
  id: string;
  index: number;
  text: string;
  sourceRef: string;
  module: string;
  nodeTypes: KnowledgeNodeType[];
};

export type RequirementAnalysis = {
  requirementSetId: string;
  policyId: string;
  policyVersion: string;
  provider: "builtin" | "host-skill";
  module: string;
  clauses: RequirementClause[];
  nodes: Array<Omit<KnowledgeNode, "id" | "knowledgeProjectId" | "createdAt" | "updatedAt">>;
  openQuestions: string[];
  risks: string[];
  contradictions: string[];
  missingBranches: string[];
};

export type RequirementPolicyEvaluation = {
  verdict: "pass" | "needs-user" | "blocked";
  score: number;
  reasons: string[];
  requiredActions: string[];
  coverage: {
    totalClauses: number;
    coveredClauses: number;
    coverageRate: number;
    uncoveredSourceRefs: string[];
  };
  contradictions: string[];
  missingBranches: string[];
  unsupportedClaims: string[];
};

export function analyzeRequirement(input: {
  requirementSetId: string;
  title: string;
  content: string;
  sourceRef: string;
  provider?: RequirementAnalysis["provider"];
}): RequirementAnalysis {
  const module = inferModule(input.title, input.content);
  const clauses = splitRequirementClauses(input.content, input.sourceRef, input.requirementSetId, module);
  const policyMetadata = {
    requirementSetId: input.requirementSetId,
    status: "draft" as const,
    policyId: REQUIREMENT_ANALYSIS_POLICY.id,
    policyVersion: REQUIREMENT_ANALYSIS_POLICY.version
  };
  const modules = [...new Set(clauses.map((clause) => clause.module))];
  const nodes: RequirementAnalysis["nodes"] = modules.map((clauseModule) => ({
      ...policyMetadata,
      module: clauseModule,
      type: "module",
      title: clauseModule,
      content: `Module inferred from requirement clauses in ${input.title}`,
      sourceRefs: clauses
        .filter((clause) => clause.module === clauseModule)
        .map((clause) => clause.sourceRef),
      origin: "derived",
      confidence: 0.8
    }));

  for (const clause of clauses) {
    nodes.push({
      ...policyMetadata,
      module: clause.module,
      type: "requirement",
      title: `${input.title} ${clause.index}`,
      content: clause.text,
      sourceRefs: [clause.sourceRef],
      origin: "source",
      confidence: 1
    });
    for (const type of clause.nodeTypes) {
      nodes.push({
        ...policyMetadata,
        module: clause.module,
        type,
        title: `${clause.module} ${nodeTypeLabel(type)}: ${shortText(clause.text)}`,
        content: clause.text,
        sourceRefs: [clause.sourceRef],
        origin: "derived",
        confidence: 0.85
      });
    }
  }

  const openQuestions = clauses
    .filter((clause) => matches(clause.text, /not specified|unspecified|\u5f85\u786e\u8ba4|\u672a\u660e\u786e|\u672a\u77e5/i))
    .map((clause) => clause.text);
  const risks = [
    ...clauses
      .filter((clause) => matches(clause.text, /permission|amount|payment|approval|\u6743\u9650|\u91d1\u989d|\u652f\u4ed8|\u5ba1\u6279/i))
      .map((clause) => `Business risk: ${clause.text}`),
    ...openQuestions.map((value) => `Ambiguity risk: ${value}`)
  ];

  return {
    requirementSetId: input.requirementSetId,
    policyId: REQUIREMENT_ANALYSIS_POLICY.id,
    policyVersion: REQUIREMENT_ANALYSIS_POLICY.version,
    provider: input.provider ?? "builtin",
    module,
    clauses,
    nodes,
    openQuestions,
    risks,
    contradictions: findContradictions(clauses),
    missingBranches: findMissingBranches(clauses)
  };
}

export function designTests(input: {
  knowledgeProjectId: string;
  analysis: RequirementAnalysis;
}) {
  const now = new Date().toISOString();
  const allTechniques = new Set<TestDesignTechnique>();
  const testIntents = input.analysis.clauses.map((clause): TestIntent => {
    const techniques = techniquesForClause(clause);
    techniques.forEach((technique) => allTechniques.add(technique));
    const relatedNodes = input.analysis.nodes.filter(
      (node) => node.sourceRefs.includes(clause.sourceRef) && node.type !== "module"
    );

    return {
      id: id("intent"),
      knowledgeProjectId: input.knowledgeProjectId,
      requirementSetId: input.analysis.requirementSetId,
      title: `${clause.module}: ${shortText(clause.text)}`,
      module: clause.module,
      priority: priorityForClause(clause),
      objective: clause.text,
      preconditions: ["The requirement baseline is approved", "The target environment is available"],
      expectedResults: [clause.text],
      requirementRefs: [clause.sourceRef],
      knowledgeNodeRefs: relatedNodes.map((node) => `${node.type}:${node.title}`),
      techniques,
      coverageDimensions: coverageDimensionsForClause(clause),
      status: "draft",
      createdAt: now,
      updatedAt: now
    };
  });

  const dataProfiles = input.analysis.clauses.flatMap((clause): TestDataProfile[] => {
    const techniques = techniquesForClause(clause);
    const needsData =
      clause.nodeTypes.includes("field") ||
      clause.nodeTypes.includes("data-constraint") ||
      techniques.includes("boundary-value") ||
      techniques.includes("equivalence-partitioning");
    if (!needsData) return [];
    return [{
      id: id("data"),
      knowledgeProjectId: input.knowledgeProjectId,
      requirementSetId: input.analysis.requirementSetId,
      name: `${clause.module} clause ${clause.index} data`,
      field: semanticFieldName(clause.text, clause.index),
      strategy: "generated",
      constraints: techniques.map((technique) => `cover:${technique}`),
      seed: `${input.analysis.requirementSetId}:${clause.index}`,
      sourceRefs: [clause.sourceRef],
      createdAt: now
    }];
  });
  const coveredClauseSourceRefs = testIntents.flatMap((intent) => intent.requirementRefs);
  const uncoveredClauseSourceRefs = input.analysis.clauses
    .map((clause) => clause.sourceRef)
    .filter((sourceRef) => !coveredClauseSourceRefs.includes(sourceRef));

  return {
    policyId: TEST_DESIGN_POLICY.id,
    policyVersion: TEST_DESIGN_POLICY.version,
    provider: input.analysis.provider,
    techniques: [...allTechniques],
    testIntents,
    dataProfiles,
    coverage: {
      totalClauses: input.analysis.clauses.length,
      coveredClauseSourceRefs,
      uncoveredClauseSourceRefs,
      intentCount: testIntents.length
    }
  };
}

function coverageDimensionsForClause(clause: RequirementClause): CoverageDimension[] {
  return [
    ...new Set(
      clause.nodeTypes.flatMap((type): CoverageDimension[] => {
        if (type === "field" || type === "data-constraint") return ["field"];
        if (type === "workflow" || type === "object") return ["workflow"];
        if (type === "state" || type === "rule") return ["state"];
        if (type === "permission") return ["permission"];
        if (type === "integration") return ["integration"];
        return [];
      })
    )
  ];
}

export function evaluatePolicyOutput(analysis: RequirementAnalysis): RequirementPolicyEvaluation {
  const allowedSourceRefs = new Set(analysis.clauses.map((clause) => clause.sourceRef));
  const unsupportedClaims = analysis.nodes.flatMap((node) => {
    if (node.sourceRefs.length === 0) return [`${node.type}:${node.title} has no source evidence`];
    const unknownRefs = node.sourceRefs.filter((sourceRef) => !allowedSourceRefs.has(sourceRef));
    return unknownRefs.map((sourceRef) => `${node.type}:${node.title} references unsupported source ${sourceRef}`);
  });
  const uncoveredSourceRefs = analysis.clauses
    .filter((clause) =>
      !analysis.nodes.some(
        (node) =>
          node.type !== "module" &&
          node.type !== "requirement" &&
          node.sourceRefs.includes(clause.sourceRef)
      )
    )
    .map((clause) => clause.sourceRef);
  const coveredClauses = analysis.clauses.length - uncoveredSourceRefs.length;
  const coverageRate = analysis.clauses.length === 0 ? 0 : coveredClauses / analysis.clauses.length;
  const coverage = {
    totalClauses: analysis.clauses.length,
    coveredClauses,
    coverageRate,
    uncoveredSourceRefs
  };

  if (analysis.nodes.length === 0 || analysis.clauses.length === 0 || unsupportedClaims.length > 0) {
    return {
      verdict: "blocked",
      score: 0,
      reasons: ["Every generated knowledge node must reference source evidence"],
      requiredActions: ["Remove unsupported claims or attach valid requirement source references"],
      coverage,
      contradictions: analysis.contradictions,
      missingBranches: analysis.missingBranches,
      unsupportedClaims
    };
  }

  const reasons = [
    ...analysis.openQuestions,
    ...analysis.contradictions,
    ...analysis.missingBranches,
    ...uncoveredSourceRefs.map((sourceRef) => `No typed knowledge coverage for ${sourceRef}`)
  ];
  const requiredActions: string[] = [];
  if (analysis.openQuestions.length > 0) requiredActions.push("Confirm unresolved requirement questions");
  if (analysis.contradictions.length > 0) requiredActions.push("Resolve contradictory requirement clauses");
  if (analysis.missingBranches.length > 0) requiredActions.push("Confirm the missing conditional branch behavior");
  if (uncoveredSourceRefs.length > 0) requiredActions.push("Classify uncovered requirement clauses");

  return {
    verdict: reasons.length > 0 ? "needs-user" : "pass",
    score: Math.max(
      0,
      Math.round(coverageRate * 100) -
        analysis.openQuestions.length * 10 -
        analysis.contradictions.length * 15 -
        analysis.missingBranches.length * 5
    ),
    reasons,
    requiredActions,
    coverage,
    contradictions: analysis.contradictions,
    missingBranches: analysis.missingBranches,
    unsupportedClaims
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
  const validTypes = new Set<KnowledgeNodeType>([
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
      !validTypes.has(node.type as KnowledgeNodeType) ||
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
      type: node.type as KnowledgeNodeType,
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
  const clauses = normalizeHostClauses(input.clauses, nodes, requirementSetId, input.module);

  return {
    requirementSetId,
    policyId: typeof input.policyId === "string" ? input.policyId : REQUIREMENT_ANALYSIS_POLICY.id,
    policyVersion: typeof input.policyVersion === "string" ? input.policyVersion : "host-skill",
    provider: "host-skill",
    module: input.module,
    clauses,
    nodes,
    openQuestions: stringList(input.openQuestions),
    risks: stringList(input.risks),
    contradictions: stringList(input.contradictions),
    missingBranches: stringList(input.missingBranches)
  };
}

function splitRequirementClauses(
  content: string,
  sourceRef: string,
  requirementSetId: string,
  module: string
) {
  const parts = requirementParts(content)
    .map((item) => item.trim())
    .filter((item) => !/^#{1,6}\s+/.test(item))
    .map((item) => item.replace(/^(?:[-*]\s+|\d+[.)\u3001]\s*)/, "").trim())
    .filter(Boolean);
  const values = parts.length > 0 ? parts : [content.trim()].filter(Boolean);

  return values.map((text, index): RequirementClause => ({
    id: `${requirementSetId}:clause-${index + 1}`,
    index: index + 1,
    text,
    sourceRef: `${sourceRef}#clause-${index + 1}`,
    module: inferClauseModule(text, module),
    nodeTypes: classifyClause(text)
  }));
}

function requirementParts(content: string) {
  const lines = content.split(/\r?\n/);
  const parts: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const nextLine = lines[index + 1]?.trim() ?? "";
    if (isMarkdownTableRow(line) && isMarkdownTableSeparator(nextLine)) {
      const headers = markdownTableCells(line);
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        const cells = markdownTableCells(lines[index]);
        if (cells.length > 0) {
          parts.push(
            headers
              .map((header, cellIndex) => `${header}: ${cells[cellIndex] ?? ""}`)
              .join("; ")
          );
        }
        index += 1;
      }
      index -= 1;
      continue;
    }
    parts.push(
      ...line
        .split(/[.!?\u3002\uff01\uff1f;\uff1b]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    );
  }
  return parts;
}

function isMarkdownTableRow(value: string) {
  const trimmed = value.trim();
  return trimmed.includes("|") && markdownTableCells(trimmed).length > 1;
}

function isMarkdownTableSeparator(value: string) {
  const cells = markdownTableCells(value);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function markdownTableCells(value: string) {
  const trimmed = value.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function classifyClause(text: string): KnowledgeNodeType[] {
  const types = new Set<KnowledgeNodeType>();
  if (matches(text, /create|new|fill|submit|approve|approval|reject|navigate|select|click|save|\u65b0\u5efa|\u521b\u5efa|\u586b\u5199|\u63d0\u4ea4|\u5ba1\u6279|\u9a73\u56de|\u8fdb\u5165|\u9009\u62e9|\u70b9\u51fb|\u4fdd\u5b58|\u5207\u6362|\u914d\u7f6e|\u6821\u9a8c/i)) {
    types.add("workflow");
  }
  if (matches(text, /require|must|above|below|only|cannot|\bif\b|\bwhen\b|\u8d85\u8fc7|\u4f4e\u4e8e|\u5fc5\u987b|\u4ec5|\u4e0d\u5141\u8bb8|\u9009\u62e9.+\u540e|\u5207\u6362.+\u540e|\u5982\u679c|\u5f53.+\u65f6|\u672a\u547d\u4e2d|\u914d\u7f6e\u4e3a|\u9ed8\u8ba4\u503c|\u4f18\u5148\u7ea7|\u91cd\u590d\u6027|\u624d\u4f1a/i)) {
    types.add("rule");
  }
  if (matches(text, /status|state|draft|approved|enabled|disabled|\u72b6\u6001|\u8349\u7a3f|\u5df2\u5ba1\u6279|\u542f\u7528|\u505c\u7528|\u53d8\u4e3a/i)) {
    types.add("state");
  }
  if (matches(text, /buyer|user|manager|finance|admin|employee|recruiter|specialist|approver|auditor|\u91c7\u8d2d|\u7528\u6237|\u7ecf\u7406|\u8d22\u52a1|\u7ba1\u7406\u5458|\u5458\u5de5|\u89d2\u8272|\u4e13\u5458|\u5ba1\u6279\u4eba|\u5ba1\u8ba1\u5458/i)) {
    types.add("actor");
  }
  if (matches(text, /\bmay\b|\bcan\b|permission|role|only .+ can|allowed|not allowed|read-only|\u53ef\u4ee5|\u80fd\u591f|\u6743\u9650|\u89d2\u8272|\u4ec5.+\u53ef|\u5141\u8bb8|\u7981\u6b62|\u53ea\u8bfb/i)) {
    types.add("permission");
  }
  if (matches(text, /field|form|input|select|name|type|amount|visible|hidden|editable|default value|\u5b57\u6bb5|\u8868\u5355|\u8f93\u5165|\u4e0b\u62c9|\u59d3\u540d|\u7c7b\u578b|\u91d1\u989d|\u663e\u793a|\u9690\u85cf|\u53ef\u7f16\u8f91|\u9ed8\u8ba4\u503c/i)) {
    types.add("field");
  }
  if (matches(text, /api|webhook|integration|sync|third party|\u540c\u6b65|\u63a5\u53e3|\u7b2c\u4e09\u65b9/i)) {
    types.add("integration");
  }
  if (matches(text, /\d|length|max(?:imum)?|min(?:imum)?|required|empty|unique|enum|multi-select|default value|\u957f\u5ea6|\u6700\u5927|\u6700\u5c0f|\u5fc5\u586b|\u7a7a\u503c|\u4e3a\u7a7a|\u9ed8\u8ba4\u503c|\u552f\u4e00|\u679a\u4e3e|\u591a\u9009|\u8303\u56f4/i)) {
    types.add("data-constraint");
  }
  if (matches(text, /order|record|request|contract|invoice|form|account|offer|\u8ba2\u5355|\u8bb0\u5f55|\u9700\u6c42|\u5408\u540c|\u53d1\u7968|\u8868\u5355|\u8d26\u53f7/i)) {
    types.add("object");
  }
  return [...types];
}

function techniquesForClause(clause: RequirementClause) {
  const techniques = new Set<TestDesignTechnique>(["scenario", "error-guessing"]);
  if (clause.nodeTypes.includes("data-constraint") || matches(clause.text, /above|below|between|\u8d85\u8fc7|\u4f4e\u4e8e|\u8303\u56f4|\u957f\u5ea6|\u91d1\u989d/i)) {
    techniques.add("boundary-value");
  }
  if (clause.nodeTypes.includes("state")) techniques.add("state-transition");
  if (clause.nodeTypes.includes("rule") && matches(clause.text, /\bif\b|\bwhen\b|\u9009\u62e9.+\u540e|\u5f53.+\u65f6|\u6761\u4ef6|\u5426\u5219/i)) {
    techniques.add("decision-table");
  }
  if (clause.nodeTypes.includes("field")) techniques.add("equivalence-partitioning");
  return [...techniques];
}

function priorityForClause(clause: RequirementClause): TestIntent["priority"] {
  if (clause.nodeTypes.some((type) => ["rule", "workflow", "state", "permission"].includes(type))) return "P0";
  if (clause.nodeTypes.some((type) => ["field", "data-constraint", "integration"].includes(type))) return "P1";
  return "P2";
}

function findMissingBranches(clauses: RequirementClause[]) {
  return clauses
    .filter(
      (clause) =>
        matches(clause.text, /\bif\b|\bwhen\b|\u5982\u679c|\u5f53.+\u65f6|\u9009\u62e9.+\u540e|\u5207\u6362.+\u540e|\u542f\u7528.+\u65f6/i) &&
        !matches(clause.text, /\belse\b|otherwise|\u5426\u5219|\u672a\u547d\u4e2d|\u4e0d\u6ee1\u8db3/i)
    )
    .map((clause) => `Missing alternate branch: ${clause.text}`);
}

function findContradictions(clauses: RequirementClause[]) {
  const contradictions: string[] = [];
  for (let left = 0; left < clauses.length; left += 1) {
    for (let right = left + 1; right < clauses.length; right += 1) {
      const first = contradictionKey(clauses[left].text);
      const second = contradictionKey(clauses[right].text);
      if (first.key && first.key === second.key && first.negative !== second.negative) {
        contradictions.push(`Contradictory clauses: "${clauses[left].text}" <> "${clauses[right].text}"`);
      }
    }
  }
  return contradictions;
}

function contradictionKey(text: string) {
  const negativePattern = /\bnot\b|\bcannot\b|\bmust not\b|\bdoes not\b|disabled|hidden|\u4e0d\u53ef|\u4e0d\u5141\u8bb8|\u7981\u6b62|\u9690\u85cf|\u505c\u7528|\u4e0d/g;
  const negative = matches(text, new RegExp(negativePattern.source, "i"));
  const key = text
    .toLowerCase()
    .replace(negativePattern, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  return { key, negative };
}

function normalizeHostClauses(
  raw: unknown,
  nodes: RequirementAnalysis["nodes"],
  requirementSetId: string,
  module: string
) {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((value, index): RequirementClause => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Host Skill clauses[${index}] must be an object`);
      }
      const clause = value as Record<string, unknown>;
      if (typeof clause.text !== "string" || typeof clause.sourceRef !== "string") {
        throw new Error(`Host Skill clauses[${index}] requires text and sourceRef`);
      }
      const text = clause.text;
      const sourceRef = clause.sourceRef;
      return {
        id: typeof clause.id === "string" ? clause.id : `${requirementSetId}:clause-${index + 1}`,
        index: index + 1,
        text,
        sourceRef,
        module,
        nodeTypes: nodes
          .filter((node) => node.sourceRefs.includes(sourceRef) && node.type !== "module" && node.type !== "requirement")
          .map((node) => node.type)
      };
    });
  }

  const sourceRefs = [...new Set(nodes.flatMap((node) => node.sourceRefs))];
  return sourceRefs.map((sourceRef, index): RequirementClause => {
    const related = nodes.filter((node) => node.sourceRefs.includes(sourceRef));
    return {
      id: `${requirementSetId}:clause-${index + 1}`,
      index: index + 1,
      text: related[0]?.content ?? sourceRef,
      sourceRef,
      module,
      nodeTypes: related
        .filter((node) => node.type !== "module" && node.type !== "requirement")
        .map((node) => node.type)
    };
  });
}

function inferModule(title: string, content: string) {
  const chinese = /([\u4e00-\u9fff]{2,8})(?:\u9700\u6c42|\u8ba2\u5355|\u5408\u540c|\u5ba1\u6279|\u8868\u5355|\u7ba1\u7406)/.exec(`${title} ${content}`)?.[1];
  if (chinese) return chinese;
  const english = /\b(order|contract|customer|account|invoice|recruiting|approval)\b/i.exec(
    `${title} ${content}`
  )?.[1];
  return english ? `${english[0].toUpperCase()}${english.slice(1)}` : title.trim() || "General";
}

function inferClauseModule(text: string, fallback: string) {
  const explicitEnglish =
    /\b(recruiting|offer|order|contract|customer|account|invoice|approval)\s+module\b/i.exec(
      text
    )?.[1];
  if (explicitEnglish) return titleCase(explicitEnglish);
  const explicitChinese = /([\u4e00-\u9fff]{2,12})(?:\u6a21\u5757|\u529f\u80fd)/.exec(text)?.[1];
  if (explicitChinese) return explicitChinese;
  const english =
    /\b(recruiter|recruiting|offer|order|contract|customer|account|invoice|approval)\b/i.exec(
      text
    )?.[1];
  if (/^recruiter$/i.test(english ?? "")) return "Recruiting";
  return english ? titleCase(english) : fallback;
}

function titleCase(value: string) {
  const normalized = value.trim().toLowerCase();
  return `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`;
}

function nodeTypeLabel(type: KnowledgeNodeType) {
  return type.replace("-", " ");
}

function shortText(value: string) {
  return value.length > 72 ? `${value.slice(0, 69)}...` : value;
}

function semanticFieldName(text: string, index: number) {
  const match = /\b([a-z][a-z0-9 -]{1,30})(?: field| input| amount| type)\b/i.exec(text);
  return match?.[1]?.trim().replace(/\s+/g, "-").toLowerCase() ?? `clause-${index}-input`;
}

function matches(content: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  return pattern.test(content);
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
