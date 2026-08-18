import type {
  ExecutableCase,
  KnowledgeProject,
  RequirementCoverageSnapshot,
  RequirementReconciliation,
  RequirementSet,
  TestIntent
} from "../domain/types.js";

export function reconcileRequirementCases(input: {
  systemId: string;
  expectedRequirementSetIds?: string[];
  expectedCaseIds?: string[];
  cases: ExecutableCase[];
}): RequirementReconciliation {
  const expected = [...new Set(input.expectedRequirementSetIds ?? [])].sort();
  const activeCases = input.cases.filter((item) => item.status !== "superseded");
  const supersededCaseIds = input.cases
    .filter((item) => item.status === "superseded")
    .map((item) => item.id)
    .sort();
  const observed = [...new Set(activeCases.map((item) => item.requirementSetId))].sort();
  const missing = expected.filter((item) => !observed.includes(item));
  const observedCaseIds = new Set(input.cases.map((item) => item.id));
  const missingCaseIds = (input.expectedCaseIds ?? []).filter((item) => !observedCaseIds.has(item));
  const compileGroups = new Map<string, ExecutableCase[]>();
  for (const item of activeCases) {
    if (!item.compileKey) continue;
    const group = compileGroups.get(item.compileKey) ?? [];
    group.push(item);
    compileGroups.set(item.compileKey, group);
  }
  const duplicateCompileKeys = [...compileGroups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key]) => key)
    .sort();
  const crossSystemCaseIds = activeCases
    .filter((item) => item.systemId !== undefined && item.systemId !== input.systemId)
    .map((item) => item.id)
    .sort();
  const status = crossSystemCaseIds.length > 0 || duplicateCompileKeys.length > 0
    ? "conflicted"
    : missing.length > 0 || missingCaseIds.length > 0
      ? "partial"
      : "complete";
  return {
    status,
    systemId: input.systemId,
    requirementSetIds: expected,
    observedRequirementSetIds: observed,
    caseIds: activeCases.map((item) => item.id),
    missingCaseIds,
    missingRequirementSetIds: missing,
    duplicateCompileKeys,
    crossSystemCaseIds,
    supersededCaseIds,
    evaluatedAt: new Date().toISOString()
  };
}

/**
 * Reconciles every active requirement revision and intent for one knowledge
 * project against the executable cases bound to one runtime system.
 */
export function reconcileRequirementCoverage(input: {
  knowledgeProject: Pick<KnowledgeProject, "id">;
  systemId: string;
  requirementSets: RequirementSet[];
  testIntents: TestIntent[];
  cases: ExecutableCase[];
  expectedRequirementSetIds?: string[];
}): RequirementCoverageSnapshot {
  const projectRequirementSets = input.requirementSets.filter(
    (item) => item.knowledgeProjectId === input.knowledgeProject.id
  );
  const selectedRequirementSetIds = new Set(
    input.expectedRequirementSetIds && input.expectedRequirementSetIds.length > 0
      ? input.expectedRequirementSetIds
      : projectRequirementSets
          .filter((item) => item.status !== "superseded")
          .map((item) => item.id)
  );
  const expectedRequirementSetIds = [...selectedRequirementSetIds].sort();
  const supersededRequirementSetIds = projectRequirementSets
    .filter((item) => selectedRequirementSetIds.has(item.id) && item.status === "superseded")
    .map((item) => item.id)
    .sort();
  const expectedIntents = input.testIntents.filter(
    (item) =>
      item.knowledgeProjectId === input.knowledgeProject.id &&
      selectedRequirementSetIds.has(item.requirementSetId) &&
      item.status !== "blocked"
  );
  const expectedTestIntentIds = expectedIntents.map((item) => item.id).sort();
  const scopedCases = input.cases.filter((item) =>
    selectedRequirementSetIds.has(item.requirementSetId)
  );
  const activeScopedCases = scopedCases.filter((item) => item.status !== "superseded");
  const base = reconcileRequirementCases({
    systemId: input.systemId,
    expectedRequirementSetIds,
    expectedCaseIds: activeScopedCases.map((item) => item.id),
    cases: scopedCases
  });
  const observedTestIntentIds = [...new Set(
    activeScopedCases
      .filter((item) => item.systemId === input.systemId)
      .map((item) => item.testIntentId)
  )].sort();
  const observedIntentSet = new Set(observedTestIntentIds);
  const missingTestIntentIds = expectedTestIntentIds.filter(
    (item) => !observedIntentSet.has(item)
  );
  const missingExecutableCaseIntentIds = expectedIntents
    .filter((item) => !observedIntentSet.has(item.id))
    .map((item) => item.id)
    .sort();
  const unboundCaseIds = activeScopedCases
    .filter((item) => item.systemId === undefined)
    .map((item) => item.id)
    .sort();
  const supersededCaseIds = [
    ...new Set([
      ...base.supersededCaseIds,
      ...input.cases
        .filter(
          (item) =>
            item.knowledgeProjectId === input.knowledgeProject.id &&
            item.status === "superseded"
        )
        .map((item) => item.id)
    ])
  ].sort();
  const status = base.status === "conflicted" || supersededRequirementSetIds.length > 0
    ? "conflicted"
    : missingTestIntentIds.length > 0 || unboundCaseIds.length > 0 || base.status === "partial"
      ? "partial"
      : "complete";
  return {
    ...base,
    status,
    knowledgeProjectId: input.knowledgeProject.id,
    requirementSetIds: expectedRequirementSetIds,
    expectedTestIntentIds,
    observedTestIntentIds,
    missingTestIntentIds,
    missingExecutableCaseIntentIds,
    supersededRequirementSetIds,
    unboundCaseIds,
    supersededCaseIds
  };
}
