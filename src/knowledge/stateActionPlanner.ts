import type { ExecutableCaseStep, LocatorPoint } from "../domain/types.js";
import { id } from "../shared/id.js";
import type {
  SystemBrain,
  SystemBrainStateTransition
} from "./systemBrain.js";

export type StateActionCandidate = {
  transitionId: string;
  targetName: string;
  action: "click" | "select";
  inputValue?: string;
  effects: string[];
  sourceRefs: string[];
};

export type StateActionPlan = {
  verdict: "not-required" | "unique" | "ambiguous" | "missing";
  reason?: string;
  pageModelId?: string;
  candidateCount: number;
  candidates: StateActionCandidate[];
  transitionSourceRefs: string[];
  steps: ExecutableCaseStep[];
};

const MAX_STATE_ACTION_CANDIDATES = 10;
const MIN_STATE_ACTION_SCORE = 1;

export function planStateActions(
  steps: ExecutableCaseStep[],
  brain: SystemBrain,
  contextQuery = "",
  targetPageModelId?: string
): StateActionPlan {
  const pageModelId =
    targetPageModelId ??
    uniqueValue(
      steps
        .map((step) => step.pageModelId)
        .filter((value): value is string => Boolean(value))
    ) ??
    (brain.pages.length === 1 ? brain.pages[0].pageModelId : undefined);
  if (!pageModelId) return emptyPlan("not-required", steps);

  const transitions = brain.stateTransitions.filter(
    (transition) => transition.pageModelId === pageModelId
  );
  if (transitions.length === 0) {
    return { ...emptyPlan("not-required", steps), pageModelId };
  }

  const query = stateRequirementQuery(steps, contextQuery);
  const scored = transitions
    .map((transition) => ({
      transition,
      score: semanticScore(query, transitionEvidence(transition))
    }))
    .filter((candidate) => candidate.score >= MIN_STATE_ACTION_SCORE)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.transition.id.localeCompare(right.transition.id)
    );
  if (scored.length === 0) {
    return { ...emptyPlan("not-required", steps), pageModelId };
  }

  const highest = scored[0].score;
  const matches = scored
    .filter((candidate) => candidate.score === highest)
    .map((candidate) => candidate.transition);
  if (matches.length > 1) {
    return {
      ...emptyPlan("ambiguous", steps),
      reason: "System Brain has multiple equally relevant state transitions",
      pageModelId,
      candidateCount: matches.length,
      candidates: matches
        .slice(0, MAX_STATE_ACTION_CANDIDATES)
        .map(stateActionCandidate)
    };
  }

  const transition = matches[0];
  if (transition.action === "select" && !transition.inputValue) {
    return {
      ...emptyPlan("missing", steps),
      reason: `System Brain state transition ${transition.targetName} has no input value`,
      pageModelId,
      candidateCount: 1,
      candidates: [stateActionCandidate(transition)]
    };
  }
  const page = brain.pages.find(
    (candidate) => candidate.pageModelId === pageModelId
  );
  const locator = page
    ? findTransitionLocator(page.locators, transition)
    : undefined;
  if (!locator) {
    return {
      ...emptyPlan("missing", steps),
      reason: `System Brain has no locator evidence for state transition control: ${transition.targetName}`,
      pageModelId,
      candidateCount: 1,
      candidates: [stateActionCandidate(transition)]
    };
  }

  const compiled = compileStateAction(steps, transition, locator, pageModelId);
  if (compiled.verdict === "ambiguous") {
    return {
      ...emptyPlan("ambiguous", steps),
      reason: compiled.reason,
      pageModelId,
      candidateCount: 1,
      candidates: [stateActionCandidate(transition)]
    };
  }
  const sourceRefs = [
    ...new Set([...transition.sourceRefs, `locator-point:${locator.id}`])
  ];
  return {
    verdict: "unique",
    pageModelId,
    candidateCount: 1,
    candidates: [
      {
        ...stateActionCandidate(transition),
        sourceRefs
      }
    ],
    transitionSourceRefs: sourceRefs,
    steps: compiled.steps
  };
}

function compileStateAction(
  steps: ExecutableCaseStep[],
  transition: SystemBrainStateTransition,
  locator: LocatorPoint,
  pageModelId: string
):
  | { verdict: "unique"; steps: ExecutableCaseStep[] }
  | { verdict: "ambiguous"; reason: string } {
  const matchingActionSteps = steps.filter(
    (step) => step.action === transition.action
  );
  const semanticMatches = matchingActionSteps.filter(
    (step) =>
      semanticScore(
        `${step.instruction} ${step.targetSemantic}`,
        transition.targetName
      ) > 0
  );
  const reusable =
    semanticMatches.length === 1
      ? semanticMatches[0]
      : semanticMatches.length === 0 && matchingActionSteps.length === 1
        ? matchingActionSteps[0]
        : undefined;
  if (
    semanticMatches.length > 1 ||
    (!reusable && matchingActionSteps.length > 1)
  ) {
    return {
      verdict: "ambiguous",
      reason: `Executable case has multiple ${transition.action} steps for state transition ${transition.targetName}`
    };
  }

  const sourceRefs = [
    ...new Set([
      ...(reusable?.sourceRefs ?? []),
      ...transition.sourceRefs,
      `page-model:${pageModelId}`,
      `locator-point:${locator.id}`
    ])
  ];
  const actionStep: ExecutableCaseStep = {
    ...(reusable ?? {
      id: id("step"),
      order: 0,
      action: transition.action,
      instruction: observedInstruction(transition),
      targetSemantic: transition.targetName,
      origin: "observed",
      sourceRefs: []
    }),
    instruction: reusable?.instruction ?? observedInstruction(transition),
    targetSemantic: transition.targetName,
    value:
      transition.action === "select" ? transition.inputValue : reusable?.value,
    pageModelId,
    locatorPointId: locator.id,
    sourceRefs
  };

  if (reusable) {
    return {
      verdict: "unique",
      steps: steps.map((step) => (step.id === reusable.id ? actionStep : step))
    };
  }
  const assertionIndex = steps.findIndex((step) => step.action === "assert");
  const insertionIndex = assertionIndex >= 0 ? assertionIndex : steps.length;
  const compiled = [
    ...steps.slice(0, insertionIndex),
    actionStep,
    ...steps.slice(insertionIndex)
  ];
  return {
    verdict: "unique",
    steps: compiled.map((step, index) => ({ ...step, order: index + 1 }))
  };
}

function stateRequirementQuery(
  steps: ExecutableCaseStep[],
  contextQuery: string
) {
  return [
    contextQuery,
    ...steps
      .filter((step) =>
        ["select", "click", "assert"].includes(step.action)
      )
      .flatMap((step) => [
        step.instruction,
        step.targetSemantic,
        step.expected ?? ""
      ])
  ]
    .join(" ")
    .toLowerCase();
}

function transitionEvidence(transition: SystemBrainStateTransition) {
  return [
    transition.targetName,
    transition.inputValue ?? "",
    ...transition.visibleAdded,
    ...transition.visibleRemoved,
    ...transition.dialogAdded,
    ...transition.dialogRemoved
  ]
    .join(" ")
    .toLowerCase();
}

function stateActionCandidate(
  transition: SystemBrainStateTransition
): StateActionCandidate {
  return {
    transitionId: transition.id,
    targetName: transition.targetName,
    action: transition.action,
    inputValue: transition.inputValue,
    effects: [
      ...transition.visibleAdded.map((value) => `visible+${value}`),
      ...transition.visibleRemoved.map((value) => `visible-${value}`),
      ...transition.dialogAdded.map((value) => `dialog+${value}`),
      ...transition.dialogRemoved.map((value) => `dialog-${value}`)
    ],
    sourceRefs: transition.sourceRefs
  };
}

function findTransitionLocator(
  locators: LocatorPoint[],
  transition: SystemBrainStateTransition
) {
  return locators.find(
    (locator) =>
      locator.selector === transition.targetSelector ||
      normalizeSemantic(locator.name) ===
        normalizeSemantic(transition.targetName)
  );
}

function observedInstruction(transition: SystemBrainStateTransition) {
  return transition.action === "select"
    ? `Select the observed value for ${transition.targetName}`
    : `Activate the observed state control ${transition.targetName}`;
}

function emptyPlan(
  verdict: StateActionPlan["verdict"],
  steps: ExecutableCaseStep[]
): StateActionPlan {
  return {
    verdict,
    candidateCount: 0,
    candidates: [],
    transitionSourceRefs: [],
    steps
  };
}

function uniqueValue(values: string[]) {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : undefined;
}

function semanticScore(left: string, right: string) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  const tokens = new Set(
    normalizedLeft
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .filter((token) => token.length > 1)
  );
  const tokenScore = normalizedRight
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((token) => tokens.has(token)).length;
  const compactLeft = normalizedLeft.replace(
    /[^a-z0-9\u4e00-\u9fff]+/g,
    ""
  );
  const compactRight = normalizedRight.replace(
    /[^a-z0-9\u4e00-\u9fff]+/g,
    ""
  );
  const substringScore =
    compactLeft.length > 1 &&
    compactRight.length > 1 &&
    (compactLeft.includes(compactRight) ||
      compactRight.includes(compactLeft))
      ? 3
      : 0;
  return tokenScore + substringScore;
}

function normalizeSemantic(value: string) {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}
