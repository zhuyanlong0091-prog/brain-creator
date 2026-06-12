import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { AgentIntent, ContextReference, RagAssetType } from "../domain/types.js";
import { buildRagDocuments, retrieveRag } from "./rag.js";

export type ContextPack = {
  systemId: string;
  intent: AgentIntent;
  query: string;
  hot: Record<string, unknown>;
  warm: ContextReference[];
  cold: ContextReference[];
  estimatedChars: number;
};

export function buildContextPack(input: {
  repository: InMemoryBrainCreatorRepository;
  systemId: string;
  intent: AgentIntent;
  query: string;
  maxEstimatedChars?: number;
}): ContextPack {
  const system = input.repository.systemProfiles.find((item) => item.id === input.systemId);
  const authProfiles = input.repository.authProfiles
    .filter((item) => item.projectId === input.systemId)
    .map((item) => ({ id: item.id, env: item.env, role: item.role, status: item.status }));
  const openGaps = input.repository.gaps.filter(
    (item) => item.projectId === input.systemId && item.status === "open"
  );
  const hits = retrieveRag({
    documents: buildRagDocuments(input.repository),
    systemId: input.systemId,
    intent: input.intent,
    query: input.query,
    includeTypes: retrievalTypes(input.intent),
    limit: 20
  });
  const references = hits.map<ContextReference>((hit) => ({
    assetType: hit.assetType,
    assetId: hit.assetId,
    title: hit.title,
    summary: hit.summary,
    relevance: hit.score,
    reason: hit.reason
  }));
  const maxChars = input.maxEstimatedChars ?? 50000;
  const warm: ContextReference[] = [];
  let estimatedChars = JSON.stringify({ system, authProfiles, openGaps }).length;
  for (const reference of references) {
    const referenceSize = JSON.stringify(reference).length;
    if (estimatedChars + referenceSize > maxChars) {
      break;
    }
    warm.push(reference);
    estimatedChars += referenceSize;
  }

  return {
    systemId: input.systemId,
    intent: input.intent,
    query: input.query,
    hot: {
      system,
      authProfiles,
      openGaps: openGaps.map((gap) => ({
        id: gap.id,
        reason: gap.reason,
        severity: gap.severity,
        sourceType: gap.sourceType
      }))
    },
    warm,
    cold: references.slice(warm.length),
    estimatedChars
  };
}

function retrievalTypes(intent: AgentIntent): RagAssetType[] | undefined {
  if (intent === "generate_plan") {
    return ["glossary", "rule", "test-case", "gap", "run-summary"];
  }
  if (intent === "run_chain") {
    return ["test-case", "gap", "run-summary", "spec-summary", "test-summary"];
  }
  if (intent === "show_gaps") {
    return ["gap"];
  }
  return undefined;
}
