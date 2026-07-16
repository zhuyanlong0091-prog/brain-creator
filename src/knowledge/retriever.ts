import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { KnowledgeNodeType } from "../domain/types.js";

type RetrieveInput = {
  knowledgeProjectId: string;
  query: string;
  types?: KnowledgeNodeType[];
  limit?: number;
};

export function retrieveKnowledge(
  repository: InMemoryBrainCreatorRepository,
  input: RetrieveInput
) {
  const terms = tokenize(input.query);
  const candidates = repository.knowledgeNodes
    .filter((node) => node.knowledgeProjectId === input.knowledgeProjectId)
    .filter((node) => node.status !== "deprecated")
    .filter((node) => !input.types || input.types.includes(node.type));
  const directScores = new Map(
    candidates.map((node) => {
      const haystack = `${node.title} ${node.content} ${node.module}`.toLowerCase();
      const keywordScore = terms.reduce(
        (score, term) => score + (haystack.includes(term) ? 10 : 0),
        0
      );
      return [node.id, keywordScore] as const;
    })
  );
  return candidates
    .map((node) => {
      const keywordScore = directScores.get(node.id) ?? 0;
      const graphScore = repository.knowledgeEdges
        .filter((edge) => edge.knowledgeProjectId === input.knowledgeProjectId)
        .filter((edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id)
        .some((edge) => {
          const neighborId = edge.fromNodeId === node.id ? edge.toNodeId : edge.fromNodeId;
          return (directScores.get(neighborId) ?? 0) > 0;
        })
        ? 3
        : 0;
      const statusScore = node.status === "confirmed" ? 5 : node.status === "conflicted" ? -5 : 0;
      const typeScore = node.type === "rule" || node.type === "workflow" ? 2 : 0;
      return { node, score: keywordScore + graphScore + statusScore + typeScore + node.confidence };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
    .slice(0, input.limit ?? 10);
}

export function buildContextPack(
  repository: InMemoryBrainCreatorRepository,
  input: RetrieveInput & { purpose: "requirement-analysis" | "test-design" | "case-compiler" | "generator"; maxChars: number }
) {
  const results = retrieveKnowledge(repository, { ...input, limit: input.limit ?? 20 });
  const lines: string[] = [];
  const references: Array<{ nodeId: string; sourceRefs: string[]; type: KnowledgeNodeType }> = [];
  let truncated = false;
  for (const result of results) {
    const line = `[${result.node.type}] ${result.node.title}: ${result.node.content}`;
    const candidate = [...lines, line].join("\n");
    if (candidate.length > input.maxChars) {
      truncated = true;
      const remaining = input.maxChars - (lines.length > 0 ? lines.join("\n").length + 1 : 0);
      if (remaining > 0) {
        lines.push(line.slice(0, remaining));
        references.push({
          nodeId: result.node.id,
          sourceRefs: result.node.sourceRefs,
          type: result.node.type
        });
      }
      break;
    }
    lines.push(line);
    references.push({ nodeId: result.node.id, sourceRefs: result.node.sourceRefs, type: result.node.type });
  }
  return {
    knowledgeProjectId: input.knowledgeProjectId,
    purpose: input.purpose,
    query: input.query,
    content: lines.join("\n"),
    references,
    truncated
  };
}

function tokenize(value: string) {
  const normalized = value.toLowerCase().trim();
  const words = normalized.match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
  const chineseBigrams = [...normalized]
    .filter((char) => /[\u4e00-\u9fff]/.test(char))
    .map((char, index, chars) => `${char}${chars[index + 1] ?? ""}`)
    .filter((item) => item.length === 2);
  return [...new Set([...words, ...chineseBigrams])];
}
