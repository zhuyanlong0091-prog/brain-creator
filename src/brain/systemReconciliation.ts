import { createHash } from "node:crypto";
import type {
  SemanticBinding,
  SystemBrainChangeSet,
  SystemBrainSnapshot,
  SystemBrainSnapshotAsset
} from "./types.js";
import type { ExecutableCase, TestIntent } from "../domain/types.js";
import type { SemanticConceptKind } from "./types.js";
import { canonicalActionAlias, normalizeSemanticTerm } from "./semanticSpine.js";

export type ExpectedSemanticFact = {
  id: string;
  requirementSetId: string;
  kind: SemanticConceptKind;
  label: string;
  sourceRefs: string[];
};

export type ObservedSemanticFact = {
  id: string;
  kind: SemanticConceptKind;
  label: string;
  content: string;
  sourceRefs: string[];
  assetKind?: SystemBrainSnapshotAsset["kind"];
  metadata?: SystemBrainSnapshotAsset["metadata"];
};

export type SemanticReconciliationResult = {
  bindings: SemanticBinding[];
  summary: {
    exact: number;
    alias: number;
    stepExpansion: number;
    conditional: number;
    missing: number;
    conflict: number;
  };
  unresolved: string[];
};

export type SystemBrainReconciliationStore = {
  semanticBindings: SemanticBinding[];
  persist(): void;
};

export function reconcileSemanticFacts(input: {
  systemId: string;
  expected: ExpectedSemanticFact[];
  observed: ObservedSemanticFact[];
  existingBindings?: SemanticBinding[];
  evidenceRefs?: string[];
}): SemanticReconciliationResult {
  const bindings: SemanticBinding[] = input.expected.map((expected): SemanticBinding => {
    const candidates = input.observed
      .map((candidate) => ({ candidate, score: matchScore(expected, candidate) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
    const top = candidates[0];
    const tied = Boolean(top && candidates[1] && candidates[1].score === top.score);
    const previous = input.existingBindings?.find(
      (binding) =>
        binding.systemId === input.systemId &&
        binding.requirementSetId === expected.requirementSetId &&
        binding.expectedSemanticId === expected.id
    );
    const evidenceRefs = unique([
      ...expected.sourceRefs,
      ...(top?.candidate.sourceRefs ?? []),
      ...(input.evidenceRefs ?? [])
    ]);
    if (!top) {
      return {
        id: previous?.id ?? stableBindingId(input.systemId, expected.id),
        requirementSetId: expected.requirementSetId,
        systemId: input.systemId,
        expectedSemanticId: expected.id,
        type: "missing",
        conditions: {},
        confidence: previous ? 0.2 : 0,
        status: previous?.status === "confirmed" ? "stale" : "candidate",
        evidenceRefs: unique([...previous?.evidenceRefs ?? [], ...evidenceRefs]),
        ...(previous?.observedSemanticId ? { observedSemanticId: previous.observedSemanticId } : {}),
        ...(previous?.confirmedBy ? { confirmedBy: previous.confirmedBy } : {})
      };
    }
    if (tied) {
      return {
        id: previous?.id ?? stableBindingId(input.systemId, expected.id),
        requirementSetId: expected.requirementSetId,
        systemId: input.systemId,
        expectedSemanticId: expected.id,
        type: "conflict",
        conditions: {},
        confidence: Math.min(0.49, top.score / 20),
        status: "conflicted",
        evidenceRefs: unique([
          ...evidenceRefs,
          ...candidates.slice(0, 3).flatMap((item) => item.candidate.sourceRefs)
        ])
      };
    }
    const type = bindingType(expected, top.candidate);
    const binding: SemanticBinding = {
      id: previous?.id ?? stableBindingId(input.systemId, expected.id),
      requirementSetId: expected.requirementSetId,
      systemId: input.systemId,
      expectedSemanticId: expected.id,
      observedSemanticId: top.candidate.id,
      type,
      conditions: bindingConditions(top.candidate),
      confidence: Math.min(1, top.score / 20),
      status: previous?.status === "confirmed" && previous.observedSemanticId === top.candidate.id && previous.type === type
        ? "confirmed"
        : "candidate",
      evidenceRefs,
      ...(previous?.confirmedBy && previous.observedSemanticId === top.candidate.id ? { confirmedBy: previous.confirmedBy } : {})
    };
    return binding;
  });
  return {
    bindings,
    summary: {
      exact: bindings.filter((binding) => binding.type === "exact").length,
      alias: bindings.filter((binding) => binding.type === "alias").length,
      stepExpansion: bindings.filter((binding) => binding.type === "step-expansion").length,
      conditional: bindings.filter((binding) => binding.type === "conditional").length,
      missing: bindings.filter((binding) => binding.type === "missing").length,
      conflict: bindings.filter((binding) => binding.type === "conflict").length
    },
    unresolved: bindings
      .filter((binding) => binding.type === "missing" || binding.type === "conflict")
      .map((binding) => binding.expectedSemanticId)
  };
}

export class SystemBrainReconciliationService {
  constructor(private readonly store: SystemBrainReconciliationStore) {}

  reconcile(input: {
    knowledgeProjectId: string;
    requirementSetId: string;
    systemId: string;
    expected: ExpectedSemanticFact[];
    observed: ObservedSemanticFact[];
    evidenceRefs?: string[];
  }) {
    if (input.expected.some((fact) => fact.requirementSetId !== input.requirementSetId)) {
      throw new Error("Expected semantic facts must belong to the selected RequirementSet");
    }
    const result = reconcileSemanticFacts({
      systemId: input.systemId,
      expected: input.expected,
      observed: input.observed,
      existingBindings: this.store.semanticBindings,
      evidenceRefs: input.evidenceRefs
    });
    const expectedIds = new Set(input.expected.map((fact) => fact.id));
    this.store.semanticBindings = this.store.semanticBindings.filter(
      (binding) =>
        !(binding.systemId === input.systemId &&
          binding.requirementSetId === input.requirementSetId &&
          expectedIds.has(binding.expectedSemanticId))
    );
    this.store.semanticBindings.push(...result.bindings);
    this.store.persist();
    return {
      knowledgeProjectId: input.knowledgeProjectId,
      requirementSetId: input.requirementSetId,
      systemId: input.systemId,
      expectedCount: input.expected.length,
      observedCount: input.observed.length,
      ...result
    };
  }

  reconcileSnapshot(input: {
    knowledgeProjectId: string;
    requirementSetId: string;
    systemId: string;
    expected: ExpectedSemanticFact[];
    snapshot: SystemBrainSnapshot;
  }) {
    if (input.snapshot.systemId !== input.systemId || input.snapshot.knowledgeProjectId !== input.knowledgeProjectId) {
      throw new Error("System Brain snapshot does not belong to the selected system and knowledge project");
    }
    const observed = input.snapshot.assets.map(snapshotAssetToFact);
    return this.reconcile({
      ...input,
      observed,
      evidenceRefs: [`system-brain-snapshot:${input.snapshot.id}`]
    });
  }

  confirm(bindingId: string, confirmedBy: string) {
    const binding = this.store.semanticBindings.find((item) => item.id === bindingId);
    if (!binding) throw new Error(`Semantic binding ${bindingId} not found`);
    if (binding.type === "missing" || binding.type === "conflict") {
      throw new Error("Missing or conflicted semantic bindings cannot be confirmed");
    }
    binding.status = "confirmed";
    binding.confirmedBy = confirmedBy;
    this.store.persist();
    return binding;
  }
}

export function propagateSystemBrainChangeSet(input: {
  changeSet: SystemBrainChangeSet;
  executableCases: ExecutableCase[];
  testIntents: TestIntent[];
  semanticBindings?: SemanticBinding[];
  persist: () => void;
}) {
  const actionable = input.changeSet.changes.filter((change) => change.impact !== "none");
  if (actionable.length === 0) {
    input.changeSet.affectedTestIntentIds = [];
    input.changeSet.affectedExecutableCaseIds = [];
    return { affectedTestIntentIds: [], affectedExecutableCaseIds: [] };
  }
  const changedRefs = new Set(actionable.flatMap((change) => change.sourceRefs));
  const changedSemanticIds = new Set(actionable.map((change) => change.semanticId));
  const boundRequirementSetIds = new Set(
    input.semanticBindings
      ?.filter((binding) =>
        binding.systemId === input.changeSet.systemId &&
        binding.observedSemanticId !== undefined &&
        changedSemanticIds.has(binding.observedSemanticId)
      )
      .map((binding) => binding.requirementSetId) ?? []
  );
  const affectedCases = input.executableCases.filter((executableCase) => {
    if (executableCase.systemId !== input.changeSet.systemId || executableCase.status === "superseded") return false;
    const caseRefs = [
      ...executableCase.steps.flatMap((step) => step.sourceRefs),
      ...(executableCase.pathPlan?.navigationSourceRefs ?? []),
      ...(executableCase.pathPlan?.candidatePaths.flatMap((path) => path.sourceRefs) ?? []),
      ...(executableCase.statePlan?.transitionSourceRefs ?? []),
      ...(executableCase.statePlan?.candidates.flatMap((candidate) => candidate.sourceRefs) ?? [])
    ];
    if (caseRefs.some((ref) => changedRefs.has(ref))) return true;
    if (boundRequirementSetIds.has(executableCase.requirementSetId)) return true;
    const behaviorChange = actionable.some((change) =>
      change.kind === "transition" || change.kind === "workflow" || change.kind === "api-flow"
    );
    return behaviorChange && executableCase.systemBrainSnapshotId === input.changeSet.fromSnapshotId;
  });
  const affectedExecutableCaseIds = affectedCases.map((item) => item.id).sort();
  const affectedTestIntentIds = [...new Set([
    ...affectedCases.map((item) => item.testIntentId),
    ...input.testIntents
      .filter((intent) =>
        intent.knowledgeProjectId === input.changeSet.knowledgeProjectId &&
        boundRequirementSetIds.has(intent.requirementSetId)
      )
      .map((intent) => intent.id)
  ])].sort();
  const now = new Date().toISOString();
  for (const executableCase of affectedCases) {
    executableCase.status = "stale";
    executableCase.staleAt = now;
    executableCase.staleByChangeSetId = input.changeSet.id;
    executableCase.staleReason = actionable
      .map((change) => change.reasons[0])
      .filter(Boolean)
      .join("; ") || "System Brain evidence changed";
    executableCase.updatedAt = now;
  }
  for (const intent of input.testIntents.filter((item) => affectedTestIntentIds.includes(item.id))) {
    if (intent.status !== "blocked") intent.status = "stale";
    intent.updatedAt = now;
  }
  input.changeSet.affectedTestIntentIds = affectedTestIntentIds;
  input.changeSet.affectedExecutableCaseIds = affectedExecutableCaseIds;
  if (affectedCases.length > 0 || affectedTestIntentIds.length > 0) input.persist();
  return { affectedTestIntentIds, affectedExecutableCaseIds };
}

export function snapshotAssetToFact(asset: SystemBrainSnapshotAsset): ObservedSemanticFact {
  const kind: SemanticConceptKind = asset.kind === "page"
    ? "module"
    : asset.kind === "locator"
      ? "object"
      : asset.kind === "state"
        ? "state"
        : asset.kind === "api-flow"
          ? "integration"
          : asset.kind === "transition"
            ? "action"
            : "workflow";
  return {
    id: asset.semanticId,
    kind,
    label: asset.label,
    content: asset.content,
    sourceRefs: asset.sourceRefs,
    assetKind: asset.kind,
    metadata: asset.metadata
  };
}

function bindingType(expected: ExpectedSemanticFact, observed: ObservedSemanticFact): SemanticBinding["type"] {
  if (expected.kind === "action" && observed.kind === "workflow") return "step-expansion";
  if (conditionalBinding(expected, observed)) return "conditional";
  if (normalizeSemanticTerm(expected.label) === normalizeSemanticTerm(observed.label)) return "exact";
  if (canonicalActionAlias(expected.label) === canonicalActionAlias(observed.label)) return "alias";
  return "alias";
}

function conditionalBinding(_expected: ExpectedSemanticFact, observed: ObservedSemanticFact) {
  return /\b(if|when|only|condition)\b|仅当|只有|当.+时|条件/iu.test(`${observed.label} ${observed.content}`) ||
    observed.metadata?.conditional === true;
}

function bindingConditions(observed: ObservedSemanticFact): SemanticBinding["conditions"] {
  const content = `${observed.label} ${observed.content}`;
  const state = content.match(/(?:状态|state)\s*(?:为|是|is)?\s*([\p{L}\p{N}_-]{2,32})/iu)?.[1];
  return state ? { state } : {};
}

function matchScore(expected: ExpectedSemanticFact, observed: ObservedSemanticFact) {
  const expectedLabel = normalizeSemanticTerm(expected.label);
  const observedLabel = normalizeSemanticTerm(observed.label);
  const expectedAction = canonicalActionAlias(expected.label);
  const observedAction = canonicalActionAlias(observed.label);
  const observedContent = canonicalActionAlias(`${observed.label} ${observed.content}`);
  let score = expected.kind === observed.kind ? 2 : expected.kind === "action" && observed.kind === "workflow" ? 1 : 0;
  if (expectedLabel && expectedLabel === observedLabel) score += 12;
  if (expected.kind === "action" && expectedAction === observedAction) score += 9;
  if (expected.kind === "action" && actionName(expectedAction) && observedContent.includes(actionName(expectedAction))) score += 7;
  if (tokenOverlap(expectedLabel, observedLabel) > 0) score += 3;
  if (tokenOverlap(expectedLabel, normalizeSemanticTerm(observed.content)) > 0) score += 2;
  return score;
}

function actionName(value: string) {
  return ["create", "edit", "delete", "search", "submit", "save", "approve", "reject", "close"]
    .find((action) => value.includes(action)) ?? "";
}

function tokenOverlap(left: string, right: string) {
  const leftTokens = new Set(left.split(/[^a-z0-9]+/iu).filter(Boolean));
  const rightTokens = new Set(right.split(/[^a-z0-9]+/iu).filter(Boolean));
  return [...leftTokens].filter((token) => rightTokens.has(token)).length;
}

function stableBindingId(systemId: string, expectedSemanticId: string) {
  return `semanticBinding_${createHash("sha256").update(`${systemId}:${expectedSemanticId}`).digest("hex").slice(0, 16)}`;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
