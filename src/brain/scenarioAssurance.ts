import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type {
  DecisionTableModel,
  StateMachineModel,
  TestDataProfile,
  TestIntent,
  WorkflowModel
} from "../domain/types.js";
import type {
  BusinessScenario,
  EvaluationProviderDescriptor,
  ScenarioAssuranceContract,
  ScenarioDataPlan,
  ScenarioTrustRecord,
  SemanticBinding,
  SystemBrainSnapshot
} from "./types.js";

type ScenarioBuildInput = {
  knowledgeProjectId: string;
  requirementSetId: string;
  workflows: WorkflowModel[];
  stateMachines: StateMachineModel[];
  decisionTables: DecisionTableModel[];
  testIntents: TestIntent[];
  dataProfiles?: TestDataProfile[];
};

type ScenarioDraft = Omit<BusinessScenario, "id"> & { id?: string };

export type ScenarioAssuranceInput = {
  scenario: BusinessScenario;
  systemId?: string;
  systemSnapshot?: SystemBrainSnapshot;
  semanticBindings?: SemanticBinding[];
  dataProfiles?: TestDataProfile[];
  readyDataProfileIds?: string[];
  dataPlan?: ScenarioDataPlan;
  providerIndependence?: ScenarioAssuranceContract["independence"];
};

export type ScenarioTrustUpdate = {
  systemId?: string;
  passed: boolean;
  strongEvidence: boolean;
  requirementHash: string;
  systemSnapshotHash?: string;
  dataPlanHash?: string;
  evidenceRefs?: string[];
  updatedAt?: string;
  reason?: string;
};

export type MutationOutcome = {
  id: string;
  scenarioId: string;
  status: "caught" | "survived" | "blocked";
  evidenceRefs: string[];
  reason?: string;
};

export type MutationEvaluation = {
  threshold: number;
  detectionRate: number;
  caught: number;
  survived: number;
  blocked: number;
  totalEvaluated: number;
  verdict: "pass" | "needs-review" | "blocked";
  reasons: string[];
  affectedScenarioIds: string[];
  evidenceRefs: string[];
};

type ProviderKind = EvaluationProviderDescriptor["provider"];

export type EvaluationProviderRegistryOptions = {
  primary?: ProviderKind;
  evaluator?: Exclude<ProviderKind, "host-agent">;
  environment?: Record<string, string | undefined>;
  probe?: (provider: Exclude<ProviderKind, "host-agent">) => boolean;
};

/**
 * Builds a scenario portfolio from structured requirement models. It deliberately
 * does not infer business-specific rules or write executable tests.
 */
export function buildBusinessScenarios(input: ScenarioBuildInput): BusinessScenario[] {
  const scenarios: BusinessScenario[] = [];
  const coveredIntentIds = new Set<string>();
  const add = (draft: ScenarioDraft) => {
    const scenario: BusinessScenario = {
      ...draft,
      id: draft.id ?? stableId("scenario", {
        family: draft.family,
        refs: [...draft.sourceRefs].sort(),
        workflowRefs: draft.workflowRefs,
        stateTransitionRefs: draft.stateTransitionRefs,
        decisionRuleRefs: draft.decisionRuleRefs
      })
    };
    const duplicate = scenarios.some((existing) => existing.id === scenario.id);
    if (duplicate) return;
    scenarios.push(scenario);
    scenario.testIntentIds?.forEach((intentId) => coveredIntentIds.add(intentId));
  };

  for (const model of input.workflows) {
    const related = relatedIntents(input.testIntents, model.sourceRefs, model.id);
    const outcomes = unique(
      related.flatMap((intent) => intent.expectedResults)
    );
    add(baseScenario({
      knowledgeProjectId: input.knowledgeProjectId,
      requirementSetId: input.requirementSetId,
      title: model.title,
      objective: `Complete the workflow: ${model.title}`,
      family: "main-flow",
      actors: model.actors,
      preconditions: model.steps.flatMap((step) => step.preconditions ?? []),
      workflowRefs: [model.id],
      stateTransitionRefs: [],
      decisionRuleRefs: [],
      expectedBusinessOutcomes: outcomes.length > 0 ? outcomes : endStepLabels(model),
      sourceRefs: [...model.sourceRefs, ...related.flatMap((intent) => intent.requirementRefs)],
      testIntentIds: related.map((intent) => intent.id),
      risk: riskForIntents(related)
    }));
    for (const transition of model.transitions) {
      if (!transition.condition && !transition.trigger) continue;
      const from = model.steps.find((step) => step.id === transition.from)?.label ?? transition.from;
      const to = model.steps.find((step) => step.id === transition.to)?.label ?? transition.to;
      const transitionIntents = relatedIntents(input.testIntents, transition.sourceRefs, model.id);
      add(baseScenario({
        knowledgeProjectId: input.knowledgeProjectId,
        requirementSetId: input.requirementSetId,
        title: `${from} -> ${to}: conditional path`,
        objective: transition.condition ?? transition.trigger ?? `Complete ${from} -> ${to}`,
        family: "branch",
        actors: unique([transition.actor ?? "", ...model.actors]),
        preconditions: unique([...(transition.preconditions ?? []), ...model.steps.find((step) => step.id === transition.from)?.preconditions ?? []]),
        workflowRefs: [model.id],
        stateTransitionRefs: [],
        decisionRuleRefs: [],
        expectedBusinessOutcomes: transitionIntents.flatMap((intent) => intent.expectedResults).length > 0
          ? unique(transitionIntents.flatMap((intent) => intent.expectedResults))
          : [`The workflow reaches ${to}`],
        sourceRefs: [...transition.sourceRefs, ...model.sourceRefs],
        testIntentIds: transitionIntents.map((intent) => intent.id),
        risk: riskForIntents(transitionIntents)
      }));
    }
    if (unique(model.actors).filter(Boolean).length > 1) {
      add(baseScenario({
        knowledgeProjectId: input.knowledgeProjectId,
        requirementSetId: input.requirementSetId,
        title: `${model.title}: cross-role journey`,
        objective: `Complete ${model.title} across actors`,
        family: "cross-role",
        actors: unique(model.actors),
        preconditions: ["Each actor has an available test identity"],
        workflowRefs: [model.id],
        stateTransitionRefs: [],
        decisionRuleRefs: [],
        expectedBusinessOutcomes: [`Every workflow transition completes under the expected actor`],
        sourceRefs: model.sourceRefs,
        testIntentIds: related.map((intent) => intent.id),
        risk: "high"
      }));
    }
  }

  for (const model of input.stateMachines) {
    for (const transition of model.transitions) {
      const from = model.states.find((state) => state.id === transition.from)?.label ?? transition.from;
      const to = model.states.find((state) => state.id === transition.to)?.label ?? transition.to;
      const related = relatedIntents(input.testIntents, transition.sourceRefs, model.id);
      add(baseScenario({
        knowledgeProjectId: input.knowledgeProjectId,
        requirementSetId: input.requirementSetId,
        title: `${from} -> ${to}: state transition`,
        objective: transition.trigger ?? `Move from ${from} to ${to}`,
        family: "state-transition",
        actors: transition.actor ? [transition.actor] : [],
        preconditions: unique([from, ...(transition.preconditions ?? [])]),
        workflowRefs: [],
        stateTransitionRefs: [transition.id],
        decisionRuleRefs: [],
        expectedBusinessOutcomes: [`The state changes from ${from} to ${to}`],
        sourceRefs: transition.sourceRefs,
        testIntentIds: related.map((intent) => intent.id),
        risk: riskForIntents(related)
      }));
    }
    const negative = input.testIntents.filter(
      (intent) => intent.scenarioType === "negative" && intent.processModelRefs?.includes(model.id)
    );
    for (const intent of negative.length > 0 ? negative : model.transitions.map((transition) => ({
      id: `${transition.id}:implicit-negative`,
      title: "Invalid state transition",
      objective: `Reject an invalid transition from ${transition.from} to ${transition.to}`,
      requirementRefs: transition.sourceRefs,
      expectedResults: ["The current state is preserved"],
      preconditions: [],
      priority: "P1" as const
    }))) {
      const transition = model.transitions.find((item) => item.sourceRefs.some((ref) => intent.requirementRefs.includes(ref)));
      add(baseScenario({
        knowledgeProjectId: input.knowledgeProjectId,
        requirementSetId: input.requirementSetId,
        title: intent.title,
        objective: intent.objective,
        family: "invalid-transition",
        actors: transition?.actor ? [transition.actor] : [],
        preconditions: intent.preconditions,
        workflowRefs: [],
        stateTransitionRefs: transition ? [transition.id] : [],
        decisionRuleRefs: [],
        expectedBusinessOutcomes: intent.expectedResults,
        sourceRefs: intent.requirementRefs,
        testIntentIds: "id" in intent && input.testIntents.some((candidate) => candidate.id === intent.id) ? [intent.id] : [],
        risk: riskForPriority(intent.priority)
      }));
    }
  }

  for (const model of input.decisionTables) {
    for (const [index, rule] of model.rules.entries()) {
      const ruleLabel = Object.entries(rule.conditionValues)
        .map(([condition, value]) => `${condition}=${value}`)
        .join(", ");
      const related = relatedIntents(input.testIntents, rule.sourceRefs, undefined);
      add(baseScenario({
        knowledgeProjectId: input.knowledgeProjectId,
        requirementSetId: input.requirementSetId,
        title: `${model.title}: rule ${index + 1}`,
        objective: ruleLabel || model.title,
        family: "branch",
        actors: [],
        preconditions: Object.values(rule.conditionValues),
        workflowRefs: [],
        stateTransitionRefs: [],
        decisionRuleRefs: [model.id],
        expectedBusinessOutcomes: rule.expectedActions,
        sourceRefs: [...rule.sourceRefs, ...model.sourceRefs],
        testIntentIds: related.map((intent) => intent.id),
        risk: riskForIntents(related)
      }));
    }
  }

  for (const intent of input.testIntents) {
    if (coveredIntentIds.has(intent.id)) continue;
    add(baseScenario({
      knowledgeProjectId: input.knowledgeProjectId,
      requirementSetId: input.requirementSetId,
      title: intent.title,
      objective: intent.objective,
      family: intent.coverageDimensions?.includes("integration") ? "integration" : intent.coverageDimensions?.includes("field") ? "data" : "main-flow",
      actors: intent.actorJourney ?? [],
      preconditions: intent.preconditions,
      workflowRefs: [],
      stateTransitionRefs: [],
      decisionRuleRefs: [],
      expectedBusinessOutcomes: intent.expectedResults,
      sourceRefs: intent.requirementRefs,
      testIntentIds: [intent.id],
      risk: riskForPriority(intent.priority)
    }));
  }

  return scenarios.map((scenario) => ({
    ...scenario,
    sourceRefs: unique(scenario.sourceRefs),
    actors: unique(scenario.actors.filter(Boolean)),
    preconditions: unique(scenario.preconditions.filter(Boolean)),
    expectedBusinessOutcomes: unique(scenario.expectedBusinessOutcomes.filter(Boolean)),
    testDataNeeds: input.dataProfiles
      ? input.dataProfiles
          .filter((profile) => profile.sourceRefs.some((ref) => scenario.sourceRefs.includes(ref)))
          .map((profile) => profile.id)
      : []
  }));
}

export function buildScenarioAssurance(input: ScenarioAssuranceInput): ScenarioAssuranceContract {
  const bindings = (input.semanticBindings ?? []).filter(
    (binding) => binding.requirementSetId === input.scenario.requirementSetId && binding.systemId === input.systemId
  );
  const reasons: string[] = [];
  const requiredActions: string[] = [];
  let systemBinding: ScenarioAssuranceContract["systemBinding"] = "missing";
  if (!input.systemId || !input.systemSnapshot || input.systemSnapshot.status !== "confirmed") {
    reasons.push("A confirmed System Brain snapshot and system binding are required.");
    requiredActions.push("Explore and confirm the target system before executing this scenario.");
  } else if (bindings.some((binding) => binding.status === "conflicted" || binding.type === "conflict")) {
    systemBinding = "ambiguous";
    reasons.push("The requirement-to-system semantic binding is conflicted.");
    requiredActions.push("Review the conflicting semantic binding.");
  } else if (bindings.some((binding) => binding.type === "missing" || binding.status === "stale")) {
    systemBinding = "missing";
    reasons.push("A required system semantic binding is missing or stale.");
    requiredActions.push("Refresh or confirm the affected System Brain binding.");
  } else if (bindings.length === 0) {
    reasons.push("No semantic binding connects this scenario to the selected system.");
    requiredActions.push("Confirm a page, workflow, or state binding for this scenario.");
  } else {
    systemBinding = "unique";
  }

  const dataProfiles = input.dataProfiles ?? [];
  const missingData = input.scenario.testDataNeeds.filter(
    (profileId) => !dataProfiles.some((profile) => profile.id === profileId)
  );
  const testDataReadiness: ScenarioAssuranceContract["testDataReadiness"] = input.dataPlan
    ? input.dataPlan.readiness
    : input.scenario.testDataNeeds.length === 0
      ? "ready"
      : missingData.length > 0
        ? "blocked"
        : input.scenario.testDataNeeds.every((profileId) => input.readyDataProfileIds?.includes(profileId))
          ? "ready"
          : "creatable";
  if (missingData.length > 0) {
    reasons.push(`Missing test data profiles: ${missingData.join(", ")}.`);
    requiredActions.push("Create or bind the required test data before execution.");
  } else if (input.dataPlan?.readiness === "blocked") {
    reasons.push(...input.dataPlan.reasons);
    requiredActions.push("Resolve the scenario data plan before execution.");
  } else if (testDataReadiness === "creatable") {
    requiredActions.push("Prepare the generated test data profiles before execution.");
  }

  const requirementRefs = requirementRefsFor(input.scenario.sourceRefs);
  const oracleStrength: ScenarioAssuranceContract["oracleStrength"] = input.scenario.expectedBusinessOutcomes.length === 0
    ? "none"
    : requirementRefs.length === 0
      ? "limited"
      : "strong";
  if (oracleStrength !== "strong") {
    reasons.push("Expected business outcomes do not have complete requirement evidence.");
    requiredActions.push("Attach a requirement clause or confirmed model source to the expected outcome.");
  }

  const unsupportedInferences = [
    ...(input.scenario.workflowRefs.length === 0 && input.scenario.stateTransitionRefs.length === 0 && input.scenario.decisionRuleRefs.length === 0
      ? ["No confirmed workflow, state, or decision model backs this scenario."]
      : [])
  ];
  if (unsupportedInferences.length > 0) {
    reasons.push(...unsupportedInferences);
    requiredActions.push("Review the scenario as a requirement-grounded data or exception case.");
  }
  const blocked = systemBinding !== "unique" || testDataReadiness === "blocked" || oracleStrength === "none";
  const verdict: ScenarioAssuranceContract["verdict"] = blocked
    ? "blocked"
    : reasons.length > 0 || oracleStrength === "limited"
      ? "needs-review"
      : "pass";
  return {
    scenarioId: input.scenario.id,
    systemId: input.systemId,
    systemBrainSnapshotId: input.systemSnapshot?.id,
    requirementRefs,
    workflowRefs: input.scenario.workflowRefs,
    stateTransitionRefs: input.scenario.stateTransitionRefs,
    decisionRuleRefs: input.scenario.decisionRuleRefs,
    systemBinding,
    testDataReadiness,
    oracleStrength,
    unsupportedInferences,
    risk: input.scenario.risk,
    independence: input.providerIndependence ?? "deterministic",
    verdict,
    evidenceRefs: unique([
      ...input.scenario.sourceRefs,
      ...(input.systemSnapshot ? [`system-brain:${input.systemSnapshot.id}`] : []),
      ...bindings.flatMap((binding) => binding.evidenceRefs)
    ]),
    reasons,
    requiredActions
  };
}

export function createScenarioTrustRecord(input: {
  scenarioId: string;
  requirementHash: string;
  systemSnapshotHash?: string;
  dataPlanHash?: string;
  grounded: boolean;
  bound: boolean;
  updatedAt?: string;
}): ScenarioTrustRecord {
  return {
    scenarioId: input.scenarioId,
    status: input.bound ? "bound" : input.grounded ? "grounded" : "generated",
    strongRunCount: 0,
    lastRequirementHash: input.requirementHash,
    lastSystemSnapshotHash: input.systemSnapshotHash,
    lastDataPlanHash: input.dataPlanHash,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
}

export function updateScenarioTrust(
  record: ScenarioTrustRecord,
  input: ScenarioTrustUpdate
): ScenarioTrustRecord {
  const changed = record.lastRequirementHash !== input.requirementHash ||
    record.lastSystemSnapshotHash !== input.systemSnapshotHash ||
    record.lastDataPlanHash !== input.dataPlanHash;
  const base = {
    ...record,
    lastRequirementHash: input.requirementHash,
    lastSystemSnapshotHash: input.systemSnapshotHash,
    lastDataPlanHash: input.dataPlanHash,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    downgradeReason: undefined
  };
  if (changed && record.strongRunCount > 0) {
    return {
      ...base,
      status: "bound",
      strongRunCount: 0,
      downgradeReason: input.reason ?? "Requirement, System Brain, or test data evidence changed."
    };
  }
  if (!input.passed || !input.strongEvidence) {
    return {
      ...base,
      status: "quarantined",
      strongRunCount: 0,
      downgradeReason: input.reason ?? "The run did not produce a strong passing evidence set."
    };
  }
  const strongRunCount = record.strongRunCount + 1;
  return {
    ...base,
    status: strongRunCount >= 3 ? "trusted" : "verified",
    strongRunCount
  };
}

export function evaluateMutationSuite(input: {
  mutations: MutationOutcome[];
  threshold?: number;
}): MutationEvaluation {
  const threshold = input.threshold ?? 0.85;
  const caught = input.mutations.filter((mutation) => mutation.status === "caught").length;
  const survived = input.mutations.filter((mutation) => mutation.status === "survived").length;
  const blocked = input.mutations.filter((mutation) => mutation.status === "blocked").length;
  const totalEvaluated = caught + survived;
  const detectionRate = totalEvaluated === 0 ? 0 : caught / totalEvaluated;
  const reasons: string[] = [];
  if (totalEvaluated === 0) reasons.push("No mutation outcome was executable.");
  if (survived > 0) reasons.push(`${survived} mutation(s) survived the scenario portfolio.`);
  if (blocked > 0) reasons.push(`${blocked} mutation(s) were blocked and excluded from the detection rate.`);
  return {
    threshold,
    detectionRate,
    caught,
    survived,
    blocked,
    totalEvaluated,
    verdict: totalEvaluated === 0 ? "blocked" : detectionRate >= threshold ? "pass" : "needs-review",
    reasons,
    affectedScenarioIds: unique(input.mutations.map((mutation) => mutation.scenarioId)),
    evidenceRefs: unique(input.mutations.flatMap((mutation) => mutation.evidenceRefs))
  };
}

export class EvaluationProviderRegistry {
  private readonly selectedEvaluator?: Exclude<ProviderKind, "host-agent">;
  private readonly primaryProvider: ProviderKind;
  private readonly environment: Record<string, string | undefined>;
  private readonly probe: (provider: Exclude<ProviderKind, "host-agent">) => boolean;

  constructor(options: EvaluationProviderRegistryOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.primaryProvider = options.primary ?? "host-agent";
    this.selectedEvaluator = options.evaluator ?? configuredEvaluator(this.environment);
    this.probe = options.probe ?? ((provider) => commandAvailable(provider, this.environment));
  }

  primary(): EvaluationProviderDescriptor {
    return descriptor(this.primaryProvider, "primary", this.primaryProvider === "host-agent" || this.probe(this.primaryProvider));
  }

  evaluator(): EvaluationProviderDescriptor | undefined {
    if (!this.selectedEvaluator) return undefined;
    return descriptor(this.selectedEvaluator, "evaluator", this.probe(this.selectedEvaluator));
  }

  list(): EvaluationProviderDescriptor[] {
    const primary = this.primary();
    const evaluator = this.evaluator();
    return evaluator ? [primary, evaluator] : [primary];
  }

  enableEvaluator(provider: Exclude<ProviderKind, "host-agent">) {
    return descriptor(provider, "evaluator", this.probe(provider));
  }
}

function baseScenario(input: Omit<ScenarioDraft, "id" | "status" | "testDataNeeds">): ScenarioDraft {
  return {
    ...input,
    testDataNeeds: [],
    status: "draft"
  };
}

function relatedIntents(intents: TestIntent[], refs: string[], modelId?: string) {
  return intents.filter((intent) =>
    (modelId ? intent.processModelRefs?.includes(modelId) : true) ||
    intent.requirementRefs.some((ref) => refs.includes(ref))
  );
}

function endStepLabels(model: WorkflowModel) {
  return model.endStepIds.map((id) => model.steps.find((step) => step.id === id)?.label ?? id);
}

function requirementRefsFor(refs: string[]) {
  return unique(refs.filter((ref) => !/^(workflow|state-machine|decision-table|system-brain):/i.test(ref)));
}

function riskForIntents(intents: Array<Pick<TestIntent, "priority">>) {
  if (intents.some((intent) => intent.priority === "P0")) return "critical" as const;
  if (intents.some((intent) => intent.priority === "P1")) return "high" as const;
  if (intents.some((intent) => intent.priority === "P2")) return "medium" as const;
  return "low" as const;
}

function riskForPriority(priority: TestIntent["priority"]) {
  return priority === "P0" ? "critical" as const : priority === "P1" ? "high" as const : priority === "P2" ? "medium" as const : "low" as const;
}

function stableId(prefix: string, value: unknown) {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function descriptor(
  provider: ProviderKind,
  role: EvaluationProviderDescriptor["role"],
  available: boolean
): EvaluationProviderDescriptor {
  return {
    provider,
    modelFamily: provider === "claude" ? "claude" : provider === "codex" ? "openai" : "unknown",
    available,
    enabled: role === "primary" || available,
    role
  };
}

function configuredEvaluator(environment: Record<string, string | undefined>) {
  const provider = environment.BRAIN_CREATOR_EVAL_PROVIDER;
  return provider === "claude" || provider === "codex" ? provider : undefined;
}

function commandAvailable(provider: Exclude<ProviderKind, "host-agent">, environment: Record<string, string | undefined>) {
  const command = provider;
  const pathValue = environment.PATH ?? "";
  const extensions = (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.PS1")
    .split(";")
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
  return pathValue.split(delimiter).some((directory) =>
    existsSync(join(directory, command)) || extensions.some((extension) => existsSync(join(directory, `${command}${extension}`)))
  );
}
