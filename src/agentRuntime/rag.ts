import { createHash } from "node:crypto";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { AgentIntent, RagAssetType, RagDocument } from "../domain/types.js";

export type RetrieveRagInput = {
  documents: RagDocument[];
  systemId: string;
  intent: AgentIntent;
  query: string;
  includeTypes?: RagAssetType[];
  limit?: number;
};

export type RagHit = RagDocument & {
  score: number;
  reason: string;
};

export function buildRagDocuments(repository: InMemoryBrainCreatorRepository): RagDocument[] {
  const documents: RagDocument[] = [];

  for (const system of repository.systemProfiles) {
    documents.push(
      document({
        systemId: system.id,
        assetType: "system",
        assetId: system.id,
        title: system.name,
        summary: `${system.environment} ${system.baseUrl}`,
        content: `${system.name} ${system.environment} ${system.baseUrl} ${system.urlAllowlist.join(" ")}`,
        tags: ["system", system.environment],
        metadata: { status: system.status, baseUrl: system.baseUrl },
        visibility: system.status === "cancelled" ? "archived" : "active",
        updatedAt: system.updatedAt
      })
    );
  }

  for (const term of repository.glossaryTerms) {
    documents.push(
      document({
        systemId: term.projectId,
        assetType: "glossary",
        assetId: term.id,
        title: term.key,
        summary: `${term.zhCN} / ${term.enUS}`,
        content: `${term.key} ${term.zhCN} ${term.enUS} ${term.aliases.join(" ")} ${term.pageScope}`,
        tags: ["glossary", ...term.aliases],
        metadata: { pageScope: term.pageScope },
        visibility: "active",
        updatedAt: term.updatedAt
      })
    );
  }

  for (const rule of repository.businessRules) {
    documents.push(
      document({
        systemId: rule.systemId,
        assetType: "rule",
        assetId: rule.id,
        title: rule.name,
        summary: rule.condition,
        content: `${rule.name} ${rule.condition} ${rule.severity}`,
        tags: ["rule", rule.severity],
        metadata: { severity: rule.severity },
        visibility: "active",
        updatedAt: rule.createdAt
      })
    );
  }

  for (const testCase of repository.testCases) {
    documents.push(
      document({
        systemId: testCase.systemId,
        assetType: "test-case",
        assetId: testCase.id,
        title: testCase.requirement,
        summary: `${testCase.status}: ${testCase.scenarios.map((item) => item.title).join(", ")}`,
        content: `${testCase.requirement} ${testCase.status} ${testCase.scenarios
          .map((scenario) => `${scenario.title} ${scenario.steps.map((step) => step.target).join(" ")}`)
          .join(" ")}`,
        tags: ["test-case", testCase.status],
        metadata: { status: testCase.status },
        visibility: testCase.status === "cancelled" ? "archived" : "active",
        updatedAt: testCase.updatedAt
      })
    );
  }

  for (const gap of repository.gaps) {
    documents.push(
      document({
        systemId: gap.projectId,
        assetType: "gap",
        assetId: gap.id,
        title: gap.reason,
        summary: `${gap.status} ${gap.severity}`,
        content: `${gap.reason} ${gap.sourceType} ${gap.status} ${gap.severity}`,
        tags: ["gap", gap.status, gap.severity],
        metadata: { status: gap.status, severity: gap.severity, sourceType: gap.sourceType },
        visibility: gap.status === "resolved" ? "archived" : "active",
        updatedAt: gap.updatedAt
      })
    );
  }

  for (const run of repository.agentRuns) {
    documents.push(
      document({
        systemId: run.systemId,
        assetType: "run-summary",
        assetId: run.id,
        title: `${run.agent} ${run.status}`,
        summary: run.inputSummary,
        content: `${run.agent} ${run.status} ${run.inputSummary} ${run.logs.join(" ")}`,
        tags: ["agent-run", run.agent, run.status],
        metadata: { status: run.status, agent: run.agent },
        visibility: run.status === "cancelled" ? "archived" : "active",
        updatedAt: run.createdAt
      })
    );
  }

  for (const run of repository.chainRuns) {
    documents.push(
      document({
        systemId: run.systemId,
        assetType: "run-summary",
        assetId: run.id,
        title: `chain ${run.status}`,
        summary: `${run.specPath ?? ""} ${run.testPath ?? ""}`.trim(),
        content: `${run.status} ${run.specPath ?? ""} ${run.testPath ?? ""} ${run.gaps
          .map((gap) => gap.reason)
          .join(" ")}`,
        tags: ["chain-run", run.status],
        metadata: { status: run.status, testCaseId: run.testCaseId },
        visibility: run.status === "failed" ? "active" : "active",
        updatedAt: run.completedAt ?? run.createdAt
      })
    );
  }

  return documents;
}

export function retrieveRag(input: RetrieveRagInput): RagHit[] {
  const terms = tokenize(input.query);
  const includeTypes = new Set(input.includeTypes);
  return input.documents
    .filter((document) => document.systemId === input.systemId)
    .filter((document) => includeTypes.size === 0 || includeTypes.has(document.assetType))
    .map((document) => scoreDocument(document, terms, input.intent))
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, input.limit ?? 10);
}

function scoreDocument(document: RagDocument, terms: string[], intent: AgentIntent): RagHit {
  const haystack = `${document.title} ${document.summary} ${document.content}`.toLowerCase();
  const keywordScore = terms.reduce(
    (score, term) => score + (haystack.includes(term.toLowerCase()) ? 1 : 0),
    0
  );
  const gapBoost = document.assetType === "gap" && document.metadata.status === "open" ? 3 : 0;
  const ruleBoost = intent === "generate_plan" && document.assetType === "rule" ? 1 : 0;
  const glossaryBoost = intent === "generate_plan" && document.assetType === "glossary" ? 1 : 0;
  const score = keywordScore + gapBoost + ruleBoost + glossaryBoost;
  return {
    ...document,
    score,
    reason:
      gapBoost > 0
        ? "open gap is relevant to the current request"
        : `matched ${keywordScore} query term(s)`
  };
}

function document(input: Omit<RagDocument, "id" | "contentHash">): RagDocument {
  const contentHash = createHash("sha256").update(input.content).digest("hex");
  return {
    ...input,
    id: `rag_${input.assetType}_${input.assetId}`,
    contentHash
  };
}

function tokenize(value: string) {
  const ascii = value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((item) => item.length >= 2);
  const cjk = Array.from(value.matchAll(/[\u4e00-\u9fff]{2,}/g)).map((match) => match[0]);
  const cjkPairs = cjk.flatMap((chunk) => {
    const pairs: string[] = [];
    for (let index = 0; index < chunk.length - 1; index += 1) {
      pairs.push(chunk.slice(index, index + 2));
    }
    return pairs;
  });
  return [...new Set([...ascii, ...cjk, ...cjkPairs])];
}
