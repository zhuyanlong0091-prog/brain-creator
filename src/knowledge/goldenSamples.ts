import type { KnowledgeNodeType } from "../domain/types.js";
import {
  analyzeRequirement,
  designTests,
  evaluatePolicyOutput,
  type RequirementAnalysis
} from "./policies.js";

export type RequirementGoldenSample = {
  id: string;
  domain: string;
  title: string;
  content: string;
  expected: {
    clauseCount: number;
    nodeTypes: KnowledgeNodeType[];
    modules?: string[];
    verdict: "pass" | "needs-user" | "blocked";
    minimumCoverageRate: number;
    minimumContradictions?: number;
    minimumMissingBranches?: number;
  };
};

export type RequirementGoldenResult = {
  sample: RequirementGoldenSample;
  analysis: RequirementAnalysis;
  evaluation: ReturnType<typeof evaluatePolicyOutput>;
  design: ReturnType<typeof designTests>;
  passed: boolean;
  failures: string[];
};

export const REQUIREMENT_GOLDEN_SAMPLES: RequirementGoldenSample[] = [
  {
    id: "hr-intern-headcount-rules",
    domain: "hr",
    title: "支持实习生占编和占编规则配置",
    content:
      "实习生是否占编默认值为空。切换占编规则后，是否占编字段变为可编辑字段。优先级最小值为1，最大值为999。未命中规则时，可配置为占编或不占编。启用规则时校验重复性。",
    expected: {
      clauseCount: 5,
      nodeTypes: ["field", "workflow", "rule", "data-constraint", "state"],
      verdict: "needs-user",
      minimumCoverageRate: 1,
      minimumMissingBranches: 1
    }
  },
  {
    id: "order-approval-workflow",
    domain: "order",
    title: "Order approval",
    content:
      "Buyer creates an order. Orders above 1000 require manager approval. When the manager approves, status changes from draft to approved. Finance users may reject the order.",
    expected: {
      clauseCount: 4,
      nodeTypes: ["actor", "object", "workflow", "rule", "state", "permission", "data-constraint"],
      verdict: "needs-user",
      minimumCoverageRate: 1,
      minimumMissingBranches: 1
    }
  },
  {
    id: "inventory-field-conflict",
    domain: "inventory",
    title: "Stock adjustment",
    content:
      "The stock adjustment field is visible. The stock adjustment field is not visible.",
    expected: {
      clauseCount: 2,
      nodeTypes: ["field"],
      verdict: "needs-user",
      minimumCoverageRate: 1,
      minimumContradictions: 1
    }
  },
  {
    id: "order-customer-record",
    domain: "order",
    title: "Customer record",
    content:
      "Sales users create a customer record. Customer name is required and has a maximum length of 100 characters. The saved customer status is active.",
    expected: {
      clauseCount: 3,
      nodeTypes: ["actor", "object", "workflow", "field", "data-constraint", "state"],
      verdict: "pass",
      minimumCoverageRate: 1
    }
  },
  {
    id: "commerce-discount-rule-table",
    domain: "commerce",
    title: "Discount approval matrix",
    content: [
      "| Customer tier | Discount range | Approval result |",
      "| --- | --- | --- |",
      "| Standard | 1-10% | Sales manager approval is required |",
      "| Strategic | 11-30% | Finance approval is required |",
      "| Any | Above 30% | Discount is not allowed |"
    ].join("\n"),
    expected: {
      clauseCount: 3,
      nodeTypes: ["actor", "rule", "workflow", "permission", "data-constraint"],
      verdict: "pass",
      minimumCoverageRate: 1
    }
  },
  {
    id: "recruiting-offer-cross-module-flow",
    domain: "hr",
    title: "Recruiting to Offer handoff",
    content:
      "Recruiter creates a hiring request. When the recruiting request is approved, the Offer module creates an offer. When the offer is approved, the Recruiting module keeps the headcount occupied.",
    expected: {
      clauseCount: 3,
      nodeTypes: ["actor", "object", "workflow", "rule", "state"],
      modules: ["Recruiting", "Offer"],
      verdict: "needs-user",
      minimumCoverageRate: 1,
      minimumMissingBranches: 2
    }
  },
  {
    id: "account-permission-matrix",
    domain: "access-control",
    title: "Account permission matrix",
    content: [
      "| Role | Create account | Approve account | View account |",
      "| --- | --- | --- | --- |",
      "| Account specialist | Allowed | Not allowed | Allowed |",
      "| Account approver | Not allowed | Allowed | Allowed |",
      "| Auditor | Not allowed | Not allowed | Read-only |"
    ].join("\n"),
    expected: {
      clauseCount: 3,
      nodeTypes: ["actor", "object", "permission"],
      modules: ["Account"],
      verdict: "pass",
      minimumCoverageRate: 1
    }
  }
];

export function evaluateRequirementGoldenSample(
  sample: RequirementGoldenSample
): RequirementGoldenResult {
  const analysis = analyzeRequirement({
    requirementSetId: `golden:${sample.id}`,
    title: sample.title,
    content: sample.content,
    sourceRef: `golden-source:${sample.id}`
  });
  const evaluation = evaluatePolicyOutput(analysis);
  const design = designTests({
    knowledgeProjectId: `golden-project:${sample.domain}`,
    analysis
  });
  const failures: string[] = [];
  const actualNodeTypes = new Set(analysis.nodes.map((node) => node.type));
  const actualModules = new Set(analysis.clauses.map((clause) => clause.module));

  if (analysis.clauses.length !== sample.expected.clauseCount) {
    failures.push(
      `Expected ${sample.expected.clauseCount} clauses, received ${analysis.clauses.length}`
    );
  }
  for (const nodeType of sample.expected.nodeTypes) {
    if (!actualNodeTypes.has(nodeType)) failures.push(`Missing knowledge node type: ${nodeType}`);
  }
  for (const module of sample.expected.modules ?? []) {
    if (!actualModules.has(module)) failures.push(`Missing clause module: ${module}`);
  }
  if (evaluation.verdict !== sample.expected.verdict) {
    failures.push(`Expected verdict ${sample.expected.verdict}, received ${evaluation.verdict}`);
  }
  if (evaluation.coverage.coverageRate < sample.expected.minimumCoverageRate) {
    failures.push(
      `Coverage ${evaluation.coverage.coverageRate} is below ${sample.expected.minimumCoverageRate}`
    );
  }
  if (
    analysis.contradictions.length <
    (sample.expected.minimumContradictions ?? 0)
  ) {
    failures.push("Expected contradiction evidence was not detected");
  }
  if (
    analysis.missingBranches.length <
    (sample.expected.minimumMissingBranches ?? 0)
  ) {
    failures.push("Expected missing branch evidence was not detected");
  }
  if (evaluation.unsupportedClaims.length > 0) {
    failures.push(`Unsupported claims: ${evaluation.unsupportedClaims.join("; ")}`);
  }
  if (design.testIntents.length !== analysis.clauses.length) {
    failures.push(
      `Expected one TestIntent per clause, received ${design.testIntents.length}/${analysis.clauses.length}`
    );
  }

  return {
    sample,
    analysis,
    evaluation,
    design,
    passed: failures.length === 0,
    failures
  };
}

export function summarizeRequirementGoldenSamples(results: RequirementGoldenResult[]) {
  const totalSamples = results.length;
  const passedSamples = results.filter((result) => result.passed).length;
  return {
    totalSamples,
    passedSamples,
    passRate: totalSamples === 0 ? 0 : passedSamples / totalSamples,
    averageCoverageRate:
      totalSamples === 0
        ? 0
        : results.reduce(
            (total, result) => total + result.evaluation.coverage.coverageRate,
            0
          ) / totalSamples,
    unsupportedClaimCount: results.reduce(
      (total, result) => total + result.evaluation.unsupportedClaims.length,
      0
    ),
    domains: [...new Set(results.map((result) => result.sample.domain))].sort()
  };
}

export type GoldenExecutionFixture = {
  knowledgeProjectId: string;
  testIntentCount: number;
  executableCaseCount: number;
  classifications: Record<"strong-verified" | "limited" | "blocked" | "failed" | "not-selected" | "superseded", number>;
};

/**
 * Builds a deterministic, synthetic scale fixture for coverage reconciliation.
 * It contains no business data and is intentionally separate from the seven
 * semantic policy samples above.
 */
export function buildGoldenExecutionFixture(): GoldenExecutionFixture {
  const classifications: GoldenExecutionFixture["classifications"] = {
    "strong-verified": 0,
    limited: 0,
    blocked: 0,
    failed: 0,
    "not-selected": 0,
    superseded: 0
  };
  const executableCaseCount = 61;
  const testIntentCount = 457;
  for (let index = 0; index < testIntentCount; index += 1) {
    if (index < 40) classifications["strong-verified"] += 1;
    else if (index < 50) classifications.limited += 1;
    else if (index < 55) classifications.blocked += 1;
    else if (index < executableCaseCount) classifications.failed += 1;
    else if (index < 435) classifications["not-selected"] += 1;
    else classifications.superseded += 1;
  }
  return {
    knowledgeProjectId: "golden-execution-scale",
    testIntentCount,
    executableCaseCount,
    classifications
  };
}
