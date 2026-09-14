import type {
  ExecutableCase,
  ExecutableCaseStep,
  StateMachineModel,
  TestIntent,
  WorkflowModel
} from "../domain/types.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { id } from "../shared/id.js";
import { normalizeRequirementText } from "./policies.js";

export type SemanticCompilationResult = {
  steps: ExecutableCaseStep[];
  source: "state-machine" | "workflow" | "requirement-clause";
  processPathSourceRefs: string[];
  ambiguity?: {
    reason: string;
    sourceRefs: string[];
  };
};

export type ExecutableCaseReadiness = {
  verdict: "ready" | "blocked";
  reasons: string[];
  sourceRefs: string[];
};

/**
 * A persisted `ready` status is not proof that a case can be executed.
 * Keep this gate deterministic so incomplete cases fail closed before an
 * agent or browser is started.
 */
export function evaluateExecutableCaseReadiness(
  executableCase: Pick<
    ExecutableCase,
    "steps" | "assertionContracts" | "pathPlan" | "statePlan" | "dataPlan"
  >
): ExecutableCaseReadiness {
  const reasons: string[] = [];
  const sourceRefs = unique([
    ...executableCase.steps.flatMap((step) => step.sourceRefs),
    ...(executableCase.pathPlan?.navigationSourceRefs ?? []),
    ...(executableCase.statePlan?.transitionSourceRefs ?? []),
    ...(executableCase.dataPlan?.sourceRefs ?? []),
  ]);
  if (executableCase.steps.length === 0) reasons.push("Executable case has no steps.");
  const stepIds = executableCase.steps.map((step) => step.id);
  if (new Set(stepIds).size !== stepIds.length) reasons.push("Executable case contains duplicate step ids.");
  if (executableCase.steps.some((step, index) => step.order !== index + 1)) {
    reasons.push("Executable case step order is not contiguous.");
  }
  const provenance = validateStepProvenance(executableCase.steps);
  if (!provenance.valid) {
    reasons.push(`Executable case steps lack source provenance: ${provenance.invalidStepIds.join(", ")}.`);
  }

  const assertionSteps = executableCase.steps.filter((step) => step.action === "assert");
  const contracts = executableCase.assertionContracts ?? [];
  const hasDataPreparationStep = executableCase.steps.some((step) => Boolean(step.dataProfileId));
  if (assertionSteps.length === 0 && !hasDataPreparationStep) {
    reasons.push("Executable case has no business assertion oracle.");
  }
  if (contracts.length !== assertionSteps.length) {
    reasons.push(
      `Assertion contract count (${contracts.length}) does not match assertion step count (${assertionSteps.length}).`
    );
  }
  const assertionStepIds = new Set(assertionSteps.map((step) => step.id));
  for (const contract of contracts) {
    if (!contract.stepId || !assertionStepIds.has(contract.stepId)) {
      reasons.push(`Assertion contract ${contract.id} is not bound to an assertion step.`);
    }
    if (contract.requirementRefs.length === 0) reasons.push(`Assertion contract ${contract.id} has no requirement source.`);
    if (contract.evidenceRequirements.length === 0) reasons.push(`Assertion contract ${contract.id} has no evidence requirements.`);
  }
  for (const plan of [executableCase.pathPlan, executableCase.statePlan]) {
    if (plan && !["not-required", "unique"].includes(plan.verdict)) {
      reasons.push(`Executable case plan is ${plan.verdict}.`);
    }
  }
  return { verdict: reasons.length === 0 ? "ready" : "blocked", reasons, sourceRefs };
}

export function compileIntentSemanticSteps(input: {
  intent: TestIntent;
  workflowModels: WorkflowModel[];
  stateMachineModels: StateMachineModel[];
  additionalSourceRefs: string[];
}): SemanticCompilationResult {
  const sourceRefs = unique([...input.intent.requirementRefs, ...input.additionalSourceRefs]);
  const candidates = [
    ...confirmedStateTransitions(input.intent, input.stateMachineModels),
    ...confirmedWorkflowTransitions(input.intent, input.workflowModels)
  ];
  const explicitModelRefs = unique(input.intent.processModelRefs ?? []);
  const confirmedModelIds = new Set([
    ...confirmedModels(input.intent, input.stateMachineModels),
    ...confirmedModels(input.intent, input.workflowModels)
  ].map((model) => model.id));
  const unresolvedModelRefs = explicitModelRefs.filter((modelRef) => !confirmedModelIds.has(modelRef));
  if (unresolvedModelRefs.length > 0) {
    const missingModelRefs = unique([
      ...sourceRefs,
      ...unresolvedModelRefs.map((modelRef) => `process-model:${modelRef}`)
    ]);
    return {
      source: "requirement-clause",
      processPathSourceRefs: missingModelRefs,
      steps: [],
      ambiguity: {
        reason: `The intent has unresolved explicit process model references: ${unresolvedModelRefs.join(", ")}; the compiler cannot compile a process action with a partial model scope.`,
        sourceRefs: missingModelRefs
      }
    };
  }
  const matches = matchingIntentTransitions(input.intent, candidates);
  if (matches.length > 1) {
    const ambiguousSourceRefs = unique([
      ...sourceRefs,
      ...matches.flatMap((match) => [
        ...match.transition.sourceRefs,
        modelSourceRef(match),
        transitionSourceRef(match)
      ])
    ]);
    const missingStateEndpoint = matches.some(
      (match) => match.source === "state-machine" && (
        !match.model.states.some((state) => state.id === match.transition.from) ||
        !match.model.states.some((state) => state.id === match.transition.to)
      )
    );
    return {
      source: compilationSourceFor(matches),
      processPathSourceRefs: ambiguousSourceRefs,
      steps: [],
      ambiguity: {
        reason: [
          `Multiple confirmed process transitions match the intent; an explicit model and transition reference or a unique confirmed path is required (${matches.length} candidates).`,
          "The compiler resolves directly referenced edges only and does not select a path by keyword scoring.",
          ...(missingStateEndpoint
            ? ["At least one candidate state transition has an endpoint missing from the model; endpoint inference is outside this compiler."]
            : [])
        ].join(" "),
        sourceRefs: ambiguousSourceRefs
      }
    };
  }

  const match = matches[0];
  if (match?.source === "state-machine") {
    const from = match.model.states.find((state) => state.id === match.transition.from)?.label ?? match.transition.from;
    const to = match.model.states.find((state) => state.id === match.transition.to)?.label ?? match.transition.to;
    const transitionRefs = unique([...sourceRefs, ...match.transition.sourceRefs, modelSourceRef(match)]);
    if (missingStateEndpoint(match)) {
      return {
        source: "state-machine",
        processPathSourceRefs: transitionRefs,
        steps: [],
        ambiguity: {
          reason: `The confirmed state transition ${match.transition.id} references a missing state endpoint; the compiler does not infer incomplete state paths.`,
          sourceRefs: unique([...transitionRefs, transitionSourceRef(match)])
        }
      };
    }
    return {
      source: "state-machine",
      processPathSourceRefs: transitionRefs,
      steps: processSteps({
        module: input.intent.module,
        action: transitionAction(match.transition.trigger),
        actionInstruction: `Trigger the confirmed state transition from ${from} to ${to}${match.transition.trigger ? ` using ${match.transition.trigger}` : ""}`,
        targetSemantic: match.transition.trigger || `transition to ${to}`,
        expected: input.intent.expectedResults[0] || `State becomes ${to}`,
        sourceRefs: transitionRefs
      })
    };
  }

  if (match?.source === "workflow") {
    const from = match.model.steps.find((step) => step.id === match.transition.from)?.label ?? match.transition.from;
    const to = match.model.steps.find((step) => step.id === match.transition.to)?.label ?? match.transition.to;
    const transitionRefs = unique([...sourceRefs, ...match.transition.sourceRefs, modelSourceRef(match)]);
    if (missingWorkflowEndpoint(match)) {
      return {
        source: "workflow",
        processPathSourceRefs: transitionRefs,
        steps: [],
        ambiguity: {
          reason: `The confirmed workflow transition ${match.transition.id} references a missing workflow step endpoint; the compiler does not infer incomplete workflow paths.`,
          sourceRefs: unique([...transitionRefs, transitionSourceRef(match)])
        }
      };
    }
    return {
      source: "workflow",
      processPathSourceRefs: transitionRefs,
      steps: processSteps({
        module: input.intent.module,
        action: transitionAction(match.transition.condition),
        actionInstruction: `Follow the confirmed workflow from ${from} to ${to}${match.transition.condition ? ` when ${match.transition.condition}` : ""}`,
        targetSemantic: match.transition.condition || to,
        expected: input.intent.expectedResults[0] || `Workflow reaches ${to}`,
        sourceRefs: transitionRefs
      })
    };
  }

  if (explicitModelRefs.length > 0) {
    const explicitModelSourceRefs = unique([
      ...sourceRefs,
      ...explicitModelRefs.map((modelRef) => `process-model:${modelRef}`)
    ]);
    return {
      source: "requirement-clause",
      processPathSourceRefs: explicitModelSourceRefs,
      steps: [],
      ambiguity: {
        reason: "The explicitly referenced confirmed process model has no transition matching the intent source evidence; the compiler cannot choose a process action.",
        sourceRefs: explicitModelSourceRefs
      }
    };
  }

  return {
    source: "requirement-clause",
    processPathSourceRefs: sourceRefs,
    steps: clauseSteps(input.intent, sourceRefs)
  };
}

export function validateStepProvenance(steps: ExecutableCaseStep[]) {
  const invalidStepIds = steps
    .filter((step) => step.sourceRefs.length === 0 || step.sourceRefs.some((ref) => !ref.trim()))
    .map((step) => step.id);
  return { valid: invalidStepIds.length === 0, invalidStepIds };
}

export function executableCaseCompileStatus(
  repository: InMemoryBrainCreatorRepository,
  executableCase: ExecutableCase
): "ready" | "needs-exploration" | "needs-data" | "ambiguous" | "blocked" {
  if (executableCase.status === "ready" && evaluateExecutableCaseReadiness(executableCase).verdict === "blocked") {
    return "blocked";
  }
  const hasOpenGap = executableCase.gapIds.some((gapId) =>
    repository.gaps.some((gap) => gap.id === gapId && gap.status === "open")
  );
  if (hasOpenGap) return "blocked";
  const dependencyIssues = executableCase.caseDependencyGraph?.unresolved.filter(
    (issue) => issue.testIntentId === executableCase.testIntentId
  ) ?? [];
  if (dependencyIssues.some((issue) => issue.reason === "cycle")) return "blocked";
  if (dependencyIssues.some((issue) => issue.reason === "ambiguous-producer")) return "ambiguous";
  if (dependencyIssues.some((issue) => issue.reason === "missing-producer")) return "needs-data";
  const plannedEntityReferences = new Set(executableCase.dataPlan?.entityReferences ?? []);
  if ((executableCase.entityReferenceRequirements ?? []).some(
    (reference) => !plannedEntityReferences.has(reference)
  )) return "needs-data";
  const pendingTasks = repository.explorationTasks.filter(
    (task) => executableCase.explorationTaskIds?.includes(task.id) && task.status === "pending"
  );
  if (pendingTasks.length > 0) {
    return executableCase.pathPlan?.verdict === "ambiguous" ||
      executableCase.statePlan?.verdict === "ambiguous"
      ? "ambiguous"
      : "needs-exploration";
  }
  if (
    executableCase.dataPlan?.operations.some(
      (operation) => operation.status === "needs-resolution"
    )
  ) {
    return "needs-data";
  }
  return "ready";
}

function processSteps(input: {
  module: string;
  action: "click" | "select";
  actionInstruction: string;
  targetSemantic: string;
  expected: string;
  sourceRefs: string[];
}): ExecutableCaseStep[] {
  return [
    step(1, "navigate", `Open the ${input.module} workflow entry`, `${input.module} entry`, input.sourceRefs, "derived"),
    step(2, input.action, input.actionInstruction, input.targetSemantic, input.sourceRefs, "derived"),
    {
      ...step(3, "assert", "Verify the requirement-defined transition outcome", "transition outcome", input.sourceRefs, "source"),
      expected: normalizeRequirementText(input.expected),
      assertion: deriveAssertion(input.expected)
    }
  ];
}

function clauseSteps(intent: TestIntent, sourceRefs: string[]): ExecutableCaseStep[] {
  const steps: ExecutableCaseStep[] = [
    step(1, "navigate", `Open the ${intent.module} entry`, `${intent.module} entry`, sourceRefs, "derived")
  ];
  const content = `${intent.title} ${intent.objective}`;
  if (/\b(create|new)\b|\u65b0\u5efa|\u521b\u5efa/i.test(content)) {
    steps.push(step(steps.length + 1, "click", "Start the requirement-defined create action", "new record action", sourceRefs, "source"));
  }
  if (/\b(fill|form|input|enter)\b|\u586b\u5199|\u8868\u5355|\u8f93\u5165/i.test(content)) {
    steps.push(step(steps.length + 1, "fill", "Fill the requirement-defined fields", "business form", sourceRefs, "source"));
  }
  if (/\b(select|choose)\b|\u9009\u62e9/i.test(content)) {
    const selectionTarget = extractSelectionTarget(content);
    steps.push(
      step(
        steps.length + 1,
        "select",
        selectionTarget
          ? `Select ${selectionTarget}`
          : "Select the requirement-defined option",
        selectionTarget || "conditional selector",
        sourceRefs,
        "source"
      )
    );
  }
  const expected = normalizeRequirementText(intent.expectedResults[0] || intent.objective);
  const assertion = deriveAssertion(`${content} ${expected}`);
  steps.push({
    ...step(steps.length + 1, "assert", "Verify the approved requirement outcome", "requirement outcome", sourceRefs, "source"),
    expected: assertion?.expected ?? expected,
    assertion
  });
  return steps;
}

function deriveAssertion(content: string): ExecutableCaseStep["assertion"] {
  const normalized = normalizeRequirementText(content);
  const branches = [...normalized.matchAll(
    /(?:当|若)?\s*([^；。;]+?)\s*(?:时|then)\s*[,，、:]?\s*(?:应|should)?\s*(显示|展示|隐藏|可编辑|不可编辑|出现|消失)\s*[:：]?\s*([^；。;]+)/giu
  )]
    .map((match) => {
      const condition = match[1]
        .replace(/^.*(?:当|若)\s*/u, "")
        .trim();
      const fields = normalizeFieldList(match[3]);
      if (!fields.length) return undefined;
      const visibility = /隐藏|不可编辑|消失/u.test(match[2]) ? match[2] : "显示";
      return `当${condition}时，应${visibility}：${fields.join("、")}`;
    })
    .filter((value): value is string => Boolean(value));

  if (branches.length > 0) {
    return { type: "visibility", strength: "limited", expected: branches.join("；") };
  }
  if (/显示|隐藏|可见|visible|shown|hidden/i.test(normalized)) {
    return { type: "visibility", strength: "limited", expected: normalized };
  }
  if (/状态|state|启用|禁用|draft|approved|rejected/i.test(normalized)) {
    return { type: "state", strength: "limited", expected: normalized };
  }
  if (/流程|审批|驳回|workflow|approved|rejected/i.test(normalized)) {
    return { type: "workflow", strength: "limited", expected: normalized };
  }
  return undefined;
}

function normalizeFieldList(value: string) {
  return [...new Set(
    value
      .replace(/\s+(?:选择|按|验证|检查|verify|check).*/i, "")
      .replace(/[，,]\s*(?:在|位于).*/u, "")
      .split(/[、，,]/)
      .map((field) => field.trim())
      .filter(Boolean)
  )];
}

function extractSelectionTarget(content: string) {
  const match = content.match(
    /(?:选择|选取|choose|select)\s*([^，,。.;；\s后若时则]{2,24})/i
  );
  return match?.[1]?.trim() || undefined;
}

function step(
  order: number,
  action: ExecutableCaseStep["action"],
  instruction: string,
  targetSemantic: string,
  sourceRefs: string[],
  origin: ExecutableCaseStep["origin"]
): ExecutableCaseStep {
  return { id: id("step"), order, action, instruction, targetSemantic, sourceRefs, origin };
}

type StateTransitionMatch = {
  source: "state-machine";
  model: StateMachineModel;
  transition: StateMachineModel["transitions"][number];
};

type WorkflowTransitionMatch = {
  source: "workflow";
  model: WorkflowModel;
  transition: WorkflowModel["transitions"][number];
};

type SemanticTransitionMatch = StateTransitionMatch | WorkflowTransitionMatch;

function confirmedStateTransitions(intent: TestIntent, models: StateMachineModel[]): StateTransitionMatch[] {
  return confirmedModels(intent, models).flatMap((model) =>
    model.transitions.map((transition) => ({
      source: "state-machine" as const,
      model,
      transition
    }))
  );
}

function confirmedWorkflowTransitions(intent: TestIntent, models: WorkflowModel[]): WorkflowTransitionMatch[] {
  return confirmedModels(intent, models).flatMap((model) =>
    model.transitions.map((transition) => ({
      source: "workflow" as const,
      model,
      transition
    }))
  );
}

function confirmedModels<T extends StateMachineModel | WorkflowModel>(intent: TestIntent, models: T[]): T[] {
  const explicitModelRefs = new Set(intent.processModelRefs ?? []);
  return models.filter((model) =>
    model.status === "confirmed" &&
    model.knowledgeProjectId === intent.knowledgeProjectId &&
    model.requirementSetId === intent.requirementSetId &&
    (explicitModelRefs.size === 0 || explicitModelRefs.has(model.id))
  );
}

function missingStateEndpoint(match: StateTransitionMatch) {
  return !match.model.states.some((state) => state.id === match.transition.from) ||
    !match.model.states.some((state) => state.id === match.transition.to);
}

function missingWorkflowEndpoint(match: WorkflowTransitionMatch) {
  return !match.model.steps.some((step) => step.id === match.transition.from) ||
    !match.model.steps.some((step) => step.id === match.transition.to);
}

function matchingIntentTransitions(
  intent: TestIntent,
  candidates: SemanticTransitionMatch[]
): SemanticTransitionMatch[] {
  const references = new Set([...intent.requirementRefs, ...intent.knowledgeNodeRefs]);
  const explicitTransitionMatches = candidates.filter(({ transition }) => references.has(transition.id));
  const selected = explicitTransitionMatches.length > 0
    ? explicitTransitionMatches
    : candidates.filter(({ transition }) =>
      transition.sourceRefs.some((ref) => intent.requirementRefs.includes(ref))
      );
  return selected;
}

function compilationSourceFor(matches: SemanticTransitionMatch[]): SemanticCompilationResult["source"] {
  if (matches.every((match) => match.source === "state-machine")) return "state-machine";
  if (matches.every((match) => match.source === "workflow")) return "workflow";
  return "requirement-clause";
}

function modelSourceRef(match: SemanticTransitionMatch) {
  return `${match.source}:${match.model.id}`;
}

function transitionSourceRef(match: SemanticTransitionMatch) {
  return `${modelSourceRef(match)}#transition:${match.transition.id}`;
}

function transitionAction(trigger?: string): "click" | "select" {
  return trigger && /\b(select|choose)\b|\u9009\u62e9/i.test(trigger) ? "select" : "click";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
