import type {
  ExecutableCase,
  ExecutableCaseDataOperation,
  TestDataLease
} from "../domain/types.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";

/**
 * Resolve a data binding without allowing an unrelated case in the same
 * system to satisfy it. A cross-case lease is valid only when the executable
 * case declares the producer edge in its dependency graph.
 */
export function findActiveTestDataLease(
  repository: InMemoryBrainCreatorRepository,
  executableCase: ExecutableCase,
  systemId: string,
  operation: Pick<ExecutableCaseDataOperation, "profileId" | "reference" | "entityReference">
): TestDataLease | undefined {
  const direct = repository.testDataLeases.find(
    (lease) =>
      lease.knowledgeProjectId === executableCase.knowledgeProjectId &&
      lease.systemId === systemId &&
      lease.executableCaseId === executableCase.id &&
      lease.profileId === operation.profileId &&
      operation.reference !== undefined &&
      lease.reference === operation.reference &&
      lease.status === "active"
  );
  if (direct) return direct;
  if (!operation.entityReference) return undefined;

  const producerIntentIds = new Set(
    (executableCase.caseDependencyGraph?.edges ?? [])
      .filter(
        (edge) =>
          edge.toTestIntentId === executableCase.testIntentId &&
          edge.entityReference === operation.entityReference
      )
      .map((edge) => edge.fromTestIntentId)
  );
  if (producerIntentIds.size !== 1) return undefined;

  const producerCaseIds = new Set(
    repository.executableCases
      .filter(
        (candidate) =>
          candidate.knowledgeProjectId === executableCase.knowledgeProjectId &&
          candidate.systemId === systemId &&
          candidate.testIntentId !== executableCase.testIntentId &&
          producerIntentIds.has(candidate.testIntentId) &&
          candidate.status !== "stale" &&
          candidate.status !== "superseded"
      )
      .map((candidate) => candidate.id)
  );
  if (producerCaseIds.size !== 1) return undefined;

  const candidates = repository.testDataLeases.filter(
    (lease) =>
      lease.knowledgeProjectId === executableCase.knowledgeProjectId &&
      lease.systemId === systemId &&
      producerCaseIds.has(lease.executableCaseId) &&
      lease.entityReference === operation.entityReference &&
      lease.status === "active"
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}
