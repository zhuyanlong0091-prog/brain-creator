import type {
  ExecutableCase,
  ExecutableCaseStep,
  StateMachineModel,
  TestIntent,
  WorkflowModel
} from "../domain/types.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { id } from "../shared/id.js";

export type SemanticCompilationResult = {
  steps: ExecutableCaseStep[];
  source: "state-machine" | "workflow" | "requirement-clause";
  processPathSourceRefs: string[];
};

export function compileIntentSemanticSteps(input: {
  intent: TestIntent;
  workflowModels: WorkflowModel[];
  stateMachineModels: StateMachineModel[];
  additionalSourceRefs: string[];
}): SemanticCompilationResult {
  const sourceRefs = unique([...input.intent.requirementRefs, ...input.additionalSourceRefs]);
  const stateMatch = matchingStateTransition(input.intent, input.stateMachineModels);
  if (stateMatch) {
    const from = stateMatch.model.states.find((state) => state.id === stateMatch.transition.from)?.label ?? stateMatch.transition.from;
    const to = stateMatch.model.states.find((state) => state.id === stateMatch.transition.to)?.label ?? stateMatch.transition.to;
    const transitionRefs = unique([...sourceRefs, ...stateMatch.transition.sourceRefs, `state-machine:${stateMatch.model.id}`]);
    return {
      source: "state-machine",
      processPathSourceRefs: transitionRefs,
      steps: processSteps({
        module: input.intent.module,
        action: transitionAction(stateMatch.transition.trigger),
        actionInstruction: `Trigger the confirmed state transition from ${from} to ${to}${stateMatch.transition.trigger ? ` using ${stateMatch.transition.trigger}` : ""}`,
        targetSemantic: stateMatch.transition.trigger || `transition to ${to}`,
        expected: input.intent.expectedResults[0] || `State becomes ${to}`,
        sourceRefs: transitionRefs
      })
    };
  }

  const workflowMatch = matchingWorkflowTransition(input.intent, input.workflowModels);
  if (workflowMatch) {
    const from = workflowMatch.model.steps.find((step) => step.id === workflowMatch.transition.from)?.label ?? workflowMatch.transition.from;
    const to = workflowMatch.model.steps.find((step) => step.id === workflowMatch.transition.to)?.label ?? workflowMatch.transition.to;
    const transitionRefs = unique([...sourceRefs, ...workflowMatch.transition.sourceRefs, `workflow:${workflowMatch.model.id}`]);
    return {
      source: "workflow",
      processPathSourceRefs: transitionRefs,
      steps: processSteps({
        module: input.intent.module,
        action: transitionAction(workflowMatch.transition.condition),
        actionInstruction: `Follow the confirmed workflow from ${from} to ${to}${workflowMatch.transition.condition ? ` when ${workflowMatch.transition.condition}` : ""}`,
        targetSemantic: workflowMatch.transition.condition || to,
        expected: input.intent.expectedResults[0] || `Workflow reaches ${to}`,
        sourceRefs: transitionRefs
      })
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
  const hasOpenGap = executableCase.gapIds.some((gapId) =>
    repository.gaps.some((gap) => gap.id === gapId && gap.status === "open")
  );
  if (hasOpenGap) return "blocked";
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
    { ...step(3, "assert", "Verify the requirement-defined transition outcome", "transition outcome", input.sourceRefs, "source"), expected: input.expected }
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
    steps.push(step(steps.length + 1, "select", "Select the requirement-defined option", "conditional selector", sourceRefs, "source"));
  }
  steps.push({
    ...step(steps.length + 1, "assert", "Verify the approved requirement outcome", "requirement outcome", sourceRefs, "source"),
    expected: intent.expectedResults[0] || intent.objective
  });
  return steps;
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

function matchingStateTransition(intent: TestIntent, models: StateMachineModel[]) {
  for (const model of models.filter((item) => intent.processModelRefs?.includes(item.id))) {
    const transition = model.transitions.find((item) => item.sourceRefs.some((ref) => intent.requirementRefs.includes(ref)));
    if (transition) return { model, transition };
  }
  return undefined;
}

function matchingWorkflowTransition(intent: TestIntent, models: WorkflowModel[]) {
  for (const model of models.filter((item) => intent.processModelRefs?.includes(item.id))) {
    const transition = model.transitions.find((item) => item.sourceRefs.some((ref) => intent.requirementRefs.includes(ref)));
    if (transition) return { model, transition };
  }
  return undefined;
}

function transitionAction(trigger?: string): "click" | "select" {
  return trigger && /\b(select|choose)\b|\u9009\u62e9/i.test(trigger) ? "select" : "click";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
