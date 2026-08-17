import type { ExecutableCase, RequirementReconciliation } from "../domain/types.js";

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
