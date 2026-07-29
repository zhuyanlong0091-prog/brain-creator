import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutableCaseStep,
  KnowledgeNodeType,
  LocatorPoint
} from "../domain/types.js";

export type SystemBrainPage = {
  pageModelId: string;
  name: string;
  route: string;
  version: number;
  screenshotId: string;
  locatorCount: number;
  probeIssueCount: number;
  locators: LocatorPoint[];
  probeResultIds: string[];
  sourceRefs: string[];
};

export type SystemBrainWorkflow = {
  trainingSessionId: string;
  pageModelId: string;
  pageName: string;
  actionStepIds: string[];
  apiFlowIds: string[];
  sourceRefs: string[];
};

export type SystemBrainBehaviorRule = {
  id: string;
  pageModelId: string;
  trainingSessionId: string;
  pageName: string;
  locatorPointId: string;
  locatorName: string;
  trigger: string;
  effect: string;
  sourceRefs: string[];
};

export type SystemBrainApiFlow = {
  apiFlowId: string;
  trainingSessionId: string;
  name: string;
  requests: Array<{ method: string; url: string; status: number }>;
  sourceRefs: string[];
};

export type SystemBrainNavigationEdge = {
  explorationId: string;
  fromPageModelId: string;
  toPageModelId?: string;
  fromUrl: string;
  toUrl: string;
  text: string;
  sourceRefs: string[];
};

export type SystemBrainState = {
  id: string;
  url: string;
  visibleElements: string[];
  dialogs: string[];
  sourceRefs: string[];
};

export type SystemBrainStateTransition = {
  id: string;
  explorationId: string;
  pageModelId: string;
  pageUrl: string;
  targetName: string;
  targetRole: string;
  targetSelector: string;
  targetKind: "tab" | "disclosure" | "select";
  action: "click" | "select";
  inputValue?: string;
  beforeStateId: string;
  afterStateId: string;
  visibleAdded: string[];
  visibleRemoved: string[];
  dialogAdded: string[];
  dialogRemoved: string[];
  urlChanged: boolean;
  screenshotPath?: string;
  sourceRefs: string[];
};

export type SystemBrain = {
  knowledgeProjectId: string;
  systemId: string;
  pages: SystemBrainPage[];
  workflows: SystemBrainWorkflow[];
  behaviorRules: SystemBrainBehaviorRule[];
  apiFlows: SystemBrainApiFlow[];
  navigationEdges: SystemBrainNavigationEdge[];
  states: SystemBrainState[];
  stateTransitions: SystemBrainStateTransition[];
  observations: Array<{
    id: string;
    type: KnowledgeNodeType;
    title: string;
    content: string;
    status: "draft" | "confirmed" | "conflicted" | "deprecated";
    systemId?: string;
    sourceRefs: string[];
  }>;
  conflicts: Array<{
    id: string;
    type: KnowledgeNodeType;
    title: string;
    content: string;
    status: "conflicted";
    systemId?: string;
    sourceRefs: string[];
  }>;
  readiness: {
    pageEvidence: boolean;
    locatorEvidence: boolean;
    workflowEvidence: boolean;
    apiEvidence: boolean;
    navigationEvidence: boolean;
    stateEvidence: boolean;
    readyForCompilation: boolean;
  };
};

export type SystemObservationDraft = {
  type: KnowledgeNodeType;
  title: string;
  content: string;
  module: string;
  sourceRefs: string[];
  confidence: number;
};

export function buildSystemBrain(
  repository: InMemoryBrainCreatorRepository,
  knowledgeProjectId: string,
  systemId: string
): SystemBrain {
  const allPageModels = repository.pageModels.filter((page) => page.projectId === systemId);
  const pageModels = latestPageModels(allPageModels);
  const pageIds = new Set(allPageModels.map((page) => page.id));
  const sessions = repository.trainingSessions.filter(
    (session) => session.projectId === systemId && pageIds.has(session.pageModelId)
  );
  const sessionIds = new Set(sessions.map((session) => session.id));
  const apiFlows = repository.apiFlows.filter((flow) => sessionIds.has(flow.sessionId));
  const pages = pageModels.map((page): SystemBrainPage => {
    const locators = repository.locatorPoints.filter(
      (locator) => locator.pageModelId === page.id
    );
    const probes = repository.probeResults.filter((probe) => probe.pageModelId === page.id);
    return {
      pageModelId: page.id,
      name: page.name,
      route: page.route,
      version: page.version,
      screenshotId: page.screenshotId,
      locatorCount: locators.length,
      probeIssueCount: probes.reduce((total, probe) => total + probe.issues.length, 0),
      locators,
      probeResultIds: probes.map((probe) => probe.id),
      sourceRefs: [
        `page-model:${page.id}`,
        ...locators.map((locator) => `locator-point:${locator.id}`),
        ...probes.map((probe) => `probe-result:${probe.id}`)
      ]
    };
  });
  const workflows = sessions.map((session): SystemBrainWorkflow => {
    const actions = repository.actionSteps
      .filter((action) => action.sessionId === session.id)
      .sort((left, right) => left.order - right.order);
    const sessionApiFlows = apiFlows.filter((flow) => flow.sessionId === session.id);
    return {
      trainingSessionId: session.id,
      pageModelId: session.pageModelId,
      pageName:
        allPageModels.find((page) => page.id === session.pageModelId)?.name ??
        session.pageModelId,
      actionStepIds: actions.map((action) => action.id),
      apiFlowIds: sessionApiFlows.map((flow) => flow.id),
      sourceRefs: [
        `training-session:${session.id}`,
        ...actions.map((action) => `action-step:${action.id}`),
        ...sessionApiFlows.map((flow) => `api-flow:${flow.id}`)
      ]
    };
  });
  const behaviorRules = sessions.flatMap((session) =>
    repository.actionSteps
      .filter((action) => action.sessionId === session.id && action.assertion.trim().length > 0)
      .sort((left, right) => left.order - right.order)
      .map((action): SystemBrainBehaviorRule => {
        const locator = repository.locatorPoints.find(
          (candidate) =>
            candidate.id === action.targetLocatorId &&
            candidate.pageModelId === session.pageModelId
        );
        const locatorName = locator?.name || locator?.text || action.targetLocatorId;
        return {
          id: action.id,
          pageModelId: session.pageModelId,
          trainingSessionId: session.id,
          pageName:
            allPageModels.find((page) => page.id === session.pageModelId)?.name ??
            session.pageModelId,
          locatorPointId: action.targetLocatorId,
          locatorName,
          trigger: actionTrigger(action.type, locatorName, action.inputValue),
          effect: action.assertion.trim(),
          sourceRefs: [
            `training-session:${session.id}`,
            `action-step:${action.id}`,
            `locator-point:${action.targetLocatorId}`
          ]
        };
      })
  );
  const normalizedApiFlows = apiFlows.map((flow): SystemBrainApiFlow => ({
    apiFlowId: flow.id,
    trainingSessionId: flow.sessionId,
    name: flow.name,
    requests: flow.requests,
    sourceRefs: [`training-session:${flow.sessionId}`, `api-flow:${flow.id}`]
  }));
  const navigationEdges = uniqueNavigationEdges(
    repository.systemExplorations
      .filter(
        (exploration) =>
          exploration.knowledgeProjectId === knowledgeProjectId &&
          exploration.systemId === systemId &&
          (exploration.status === "completed" || exploration.status === "partial")
      )
      .flatMap((exploration) =>
        exploration.navigationEdges.map(
          (edge): SystemBrainNavigationEdge => ({
            explorationId: exploration.id,
            ...edge,
            sourceRefs: [
              `system-exploration:${exploration.id}`,
              `page-model:${edge.fromPageModelId}`,
              ...(edge.toPageModelId ? [`page-model:${edge.toPageModelId}`] : []),
              navigationSourceRef(exploration.id, edge)
            ]
          })
        )
      )
  );
  const stateTransitions = repository.systemExplorations
    .filter(
      (exploration) =>
        exploration.knowledgeProjectId === knowledgeProjectId &&
        exploration.systemId === systemId &&
        (exploration.status === "completed" || exploration.status === "partial")
    )
    .flatMap((exploration) =>
      (exploration.interactionTransitions ?? [])
        .filter((transition) => transition.status === "observed")
        .map(
          (transition): SystemBrainStateTransition => ({
            id: transition.id,
            explorationId: exploration.id,
            pageModelId: transition.pageModelId,
            pageUrl: transition.pageUrl,
            targetName: transition.targetName,
            targetRole: transition.targetRole,
            targetSelector: transition.targetSelector,
            targetKind: transition.targetKind,
            action: transition.action,
            inputValue: transition.inputValue,
            beforeStateId: transition.before.id,
            afterStateId: transition.after.id,
            visibleAdded: transition.visibleAdded,
            visibleRemoved: transition.visibleRemoved,
            dialogAdded: transition.dialogAdded,
            dialogRemoved: transition.dialogRemoved,
            urlChanged: transition.urlChanged,
            screenshotPath: transition.screenshotPath,
            sourceRefs: [
              `system-exploration:${exploration.id}`,
              `system-interaction:${transition.id}`,
              `page-model:${transition.pageModelId}`,
              `system-state:${transition.before.id}`,
              `system-state:${transition.after.id}`
            ]
          })
        )
    );
  const states = uniqueStates(
    repository.systemExplorations
      .filter(
        (exploration) =>
          exploration.knowledgeProjectId === knowledgeProjectId &&
          exploration.systemId === systemId
      )
      .flatMap((exploration) =>
        (exploration.interactionTransitions ?? [])
          .filter((transition) => transition.status === "observed")
          .flatMap((transition) => [
            {
              ...transition.before,
              sourceRefs: [
                `system-exploration:${exploration.id}`,
                `system-interaction:${transition.id}`
              ]
            },
            {
              ...transition.after,
              sourceRefs: [
                `system-exploration:${exploration.id}`,
                `system-interaction:${transition.id}`
              ]
            }
          ])
      )
  );
  const observations = repository.knowledgeNodes
    .filter(
      (node) =>
        node.knowledgeProjectId === knowledgeProjectId &&
        node.origin === "observed" &&
        node.systemId === systemId
    )
    .map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      content: node.content,
      status: node.status,
      systemId: node.systemId,
      sourceRefs: node.sourceRefs
    }));
  const conflicts = observations.filter(
    (node): node is (typeof observations)[number] & { status: "conflicted" } =>
      node.status === "conflicted"
  );
  const readiness = {
    pageEvidence: pages.length > 0,
    locatorEvidence: pages.some((page) => page.locatorCount > 0),
    workflowEvidence: workflows.some((workflow) => workflow.actionStepIds.length > 0),
    apiEvidence: normalizedApiFlows.length > 0,
    navigationEvidence: navigationEdges.length > 0,
    stateEvidence: stateTransitions.length > 0,
    readyForCompilation:
      pages.length > 0 && pages.some((page) => page.locatorCount > 0)
  };

  return {
    knowledgeProjectId,
    systemId,
    pages,
    workflows,
    behaviorRules,
    apiFlows: normalizedApiFlows,
    navigationEdges,
    states,
    stateTransitions,
    observations,
    conflicts,
    readiness
  };
}

export function systemObservationDrafts(brain: SystemBrain): SystemObservationDraft[] {
  const drafts: SystemObservationDraft[] = [];
  for (const page of brain.pages) {
    const module = pageModule(page.name);
    drafts.push({
      type: "workflow",
      title: `${page.name} page`,
      content: `${page.name} is available at ${page.route}`,
      module,
      sourceRefs: page.sourceRefs,
      confidence: 0.96
    });
    for (const locator of page.locators) {
      const isField = /textbox|combobox|select|input|checkbox|radio|searchbox/i.test(
        locator.role
      );
      drafts.push({
        type: isField ? "field" : "workflow",
        title: `${locator.name} ${isField ? "field" : "action"}`,
        content: `${locator.name} is observed as role ${locator.role} on ${page.route}`,
        module,
        sourceRefs: [
          `page-model:${page.pageModelId}`,
          `locator-point:${locator.id}`
        ],
        confidence: locator.confidence
      });
    }
  }
  for (const workflow of brain.workflows) {
    drafts.push({
      type: "workflow",
      title: `${workflow.pageName} trained workflow`,
      content: `Observed ${workflow.actionStepIds.length} ordered actions on ${workflow.pageName}`,
      module: pageModule(workflow.pageName),
      sourceRefs: workflow.sourceRefs,
      confidence: 0.95
    });
  }
  for (const edge of brain.navigationEdges) {
    const fromPage = brain.pages.find((page) => page.pageModelId === edge.fromPageModelId);
    const toPage = brain.pages.find((page) => page.pageModelId === edge.toPageModelId);
    drafts.push({
      type: "workflow",
      title: `${edge.text} navigation`,
      content: `${edge.text} navigates from ${edge.fromUrl} to ${edge.toUrl}`,
      module: pageModule(fromPage?.name ?? toPage?.name ?? "General"),
      sourceRefs: edge.sourceRefs,
      confidence: edge.toPageModelId ? 0.96 : 0.85
    });
  }
  for (const transition of brain.stateTransitions) {
    const changeSummary = [
      transition.visibleAdded.length > 0
        ? `visible +${transition.visibleAdded.join(", ")}`
        : "",
      transition.visibleRemoved.length > 0
        ? `visible -${transition.visibleRemoved.join(", ")}`
        : "",
      transition.dialogAdded.length > 0
        ? `dialogs +${transition.dialogAdded.join(", ")}`
        : "",
      transition.dialogRemoved.length > 0
        ? `dialogs -${transition.dialogRemoved.join(", ")}`
        : "",
      transition.urlChanged ? "URL changed" : ""
    ].filter(Boolean);
    drafts.push({
      type: "workflow",
      title: `${transition.targetName} state transition`,
      content: `${transition.action} ${transition.targetName}${
        transition.inputValue ? ` with ${transition.inputValue}` : ""
      } changes state: ${changeSummary.join("; ") || "state changed"}`,
      module: pageModule(
        brain.pages.find((page) => page.pageModelId === transition.pageModelId)?.name ??
          "General"
      ),
      sourceRefs: transition.sourceRefs,
      confidence: 0.97
    });
    if (transition.visibleAdded.length > 0 || transition.visibleRemoved.length > 0) {
      drafts.push({
        type: "rule",
        title: `${transition.targetName} visibility behavior`,
        content: `${transition.action} ${transition.targetName}${
          transition.inputValue ? ` with ${transition.inputValue}` : ""
        } results in visible fields +[${transition.visibleAdded.join(", ")}] -[${
          transition.visibleRemoved.join(", ")
        }]`,
        module: pageModule(
          brain.pages.find((page) => page.pageModelId === transition.pageModelId)?.name ??
            "General"
        ),
        sourceRefs: transition.sourceRefs,
        confidence: 0.97
      });
    }
  }
  for (const rule of brain.behaviorRules) {
    drafts.push({
      type: "rule",
      title: `${rule.locatorName} behavior`,
      content: `${rule.trigger}; expected effect: ${rule.effect}`,
      module: pageModule(rule.pageName),
      sourceRefs: rule.sourceRefs,
      confidence: 0.95
    });
  }
  for (const flow of brain.apiFlows) {
    const workflow = brain.workflows.find(
      (candidate) => candidate.trainingSessionId === flow.trainingSessionId
    );
    drafts.push({
      type: "integration",
      title: `API flow ${flow.name}`,
      content: flow.requests
        .map((request) => `${request.method} ${request.url} -> ${request.status}`)
        .join("; "),
      module: pageModule(workflow?.pageName ?? "General"),
      sourceRefs: flow.sourceRefs,
      confidence: 0.95
    });
  }
  return drafts;
}

export function bindStepsToSystemBrain(
  steps: ExecutableCaseStep[],
  brain: SystemBrain,
  contextQuery = ""
): {
  steps: ExecutableCaseStep[];
  missingEvidence: Array<{ stepId: string; action: ExecutableCaseStep["action"]; reason: string }>;
} {
  const page = selectPage(
    brain.pages,
    `${contextQuery} ${steps.map((step) => step.instruction).join(" ")}`
  );
  const hasUnpinnedSteps = steps.some((step) => !step.pageModelId);
  const missingEvidence: Array<{
    stepId: string;
    action: ExecutableCaseStep["action"];
    reason: string;
  }> = [];
  if (!page && hasUnpinnedSteps) {
    return {
      steps,
      missingEvidence: steps.map((step) => ({
        stepId: step.id,
        action: step.action,
        reason:
          brain.pages.length === 0
            ? "System Brain has no page evidence"
            : "System Brain has no unambiguous page evidence"
      }))
    };
  }

  const bound = steps.map((step) => {
    const stepPage = step.pageModelId
      ? brain.pages.find((candidate) => candidate.pageModelId === step.pageModelId)
      : page;
    if (!stepPage) {
      missingEvidence.push({
        stepId: step.id,
        action: step.action,
        reason: `System Brain has no page evidence for planned step: ${step.targetSemantic}`
      });
      return step;
    }
    const sourceRefs = new Set([
      ...step.sourceRefs,
      `page-model:${stepPage.pageModelId}`
    ]);
    if (step.action === "navigate") {
      stepPage.probeResultIds.forEach((probeId) =>
        sourceRefs.add(`probe-result:${probeId}`)
      );
      return {
        ...step,
        pageModelId: stepPage.pageModelId,
        sourceRefs: [...sourceRefs]
      };
    }
    if (step.action === "assert") {
      stepPage.probeResultIds.forEach((probeId) =>
        sourceRefs.add(`probe-result:${probeId}`)
      );
      matchingStateTransitions(
        step,
        stepPage.pageModelId,
        brain,
        contextQuery
      ).forEach(
        (transition) =>
          transition.sourceRefs.forEach((sourceRef) => sourceRefs.add(sourceRef))
      );
      return {
        ...step,
        pageModelId: stepPage.pageModelId,
        sourceRefs: [...sourceRefs]
      };
    }
    if (step.action === "api") {
      brain.apiFlows.forEach((flow) =>
        flow.sourceRefs.forEach((sourceRef) => sourceRefs.add(sourceRef))
      );
      return {
        ...step,
        pageModelId: stepPage.pageModelId,
        sourceRefs: [...sourceRefs]
      };
    }
    if (step.action === "wait") {
      return {
        ...step,
        pageModelId: stepPage.pageModelId,
        sourceRefs: [...sourceRefs]
      };
    }
    const locator = selectLocator(step, stepPage.locators, contextQuery);
    if (!locator) {
      missingEvidence.push({
        stepId: step.id,
        action: step.action,
        reason: `System Brain has no locator evidence for ${step.action}: ${step.targetSemantic}`
      });
      return {
        ...step,
        pageModelId: stepPage.pageModelId,
        sourceRefs: [...sourceRefs]
      };
    }
    sourceRefs.add(`locator-point:${locator.id}`);
    brain.stateTransitions
      .filter(
        (transition) =>
          transition.pageModelId === stepPage.pageModelId &&
          (transition.targetSelector === locator.selector ||
            normalizeSemantic(transition.targetName) === normalizeSemantic(locator.name))
      )
      .forEach((transition) =>
        transition.sourceRefs.forEach((sourceRef) => sourceRefs.add(sourceRef))
      );
    return {
      ...step,
      pageModelId: stepPage.pageModelId,
      locatorPointId: locator.id,
      sourceRefs: [...sourceRefs]
    };
  });

  return { steps: bound, missingEvidence };
}

function selectLocator(
  step: ExecutableCaseStep,
  locators: LocatorPoint[],
  contextQuery = ""
) {
  const preferredRoles =
    step.action === "click"
      ? /button|link|menuitem/i
      : step.action === "fill"
        ? /textbox|input|searchbox/i
        : /combobox|select|listbox|radio|checkbox/i;
  const roleMatches = locators.filter((locator) => preferredRoles.test(locator.role));
  const candidates = roleMatches;
  const query = `${contextQuery} ${step.instruction} ${step.targetSemantic}`.toLowerCase();
  const scored = candidates
    .map((locator) => ({
      locator,
      score:
        tokenOverlap(query, `${locator.name} ${locator.text}`.toLowerCase()) +
        (/new|create|add|\u65b0\u5efa|\u521b\u5efa/.test(query) &&
        /new|create|add|\u65b0\u5efa|\u521b\u5efa/i.test(`${locator.name} ${locator.text}`)
          ? 5
          : 0)
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.locator.confidence - left.locator.confidence
    );
  return scored[0]?.score > 0 ? scored[0].locator : undefined;
}

function matchingStateTransitions(
  step: ExecutableCaseStep,
  pageModelId: string,
  brain: SystemBrain,
  contextQuery: string
) {
  const query = `${contextQuery} ${step.instruction} ${step.targetSemantic} ${
    step.expected ?? ""
  }`.toLowerCase();
  return brain.stateTransitions.filter((transition) => {
    if (transition.pageModelId !== pageModelId) return false;
    const evidence = [
      transition.targetName,
      transition.inputValue ?? "",
      ...transition.visibleAdded,
      ...transition.visibleRemoved,
      ...transition.dialogAdded,
      ...transition.dialogRemoved
    ].join(" ");
    return tokenOverlap(query, evidence.toLowerCase()) > 0;
  });
}

function selectPage(pages: SystemBrainPage[], query: string) {
  if (pages.length <= 1) return pages[0];
  const scored = pages
    .map((page) => ({
      page,
      score: tokenOverlap(query.toLowerCase(), `${page.name} ${page.route}`.toLowerCase())
    }))
    .sort((left, right) => right.score - left.score);
  if (scored[0].score === 0 || scored[0].score === scored[1].score) return undefined;
  return scored[0].page;
}

function tokenOverlap(left: string, right: string) {
  const tokens = new Set(left.split(/[^a-z0-9\u4e00-\u9fff]+/).filter((token) => token.length > 1));
  const tokenScore = right
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((token) => tokens.has(token)).length;
  const compactLeft = left.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  const compactRight = right.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  const substringScore =
    compactLeft.length > 1 &&
    compactRight.length > 1 &&
    (compactLeft.includes(compactRight) || compactRight.includes(compactLeft))
      ? 3
      : 0;
  return tokenScore + substringScore;
}

function normalizeSemantic(value: string) {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function actionTrigger(type: string, locatorName: string, inputValue: string) {
  const value = inputValue.trim();
  return `${type} ${locatorName}${value ? ` with ${value}` : ""}`;
}

function pageModule(pageName: string) {
  return pageName.trim().split(/\s+/)[0] || "General";
}

function latestPageModels<T extends { route: string; version: number; updatedAt: string }>(
  pages: T[]
) {
  const latest = new Map<string, T>();
  for (const page of pages) {
    const current = latest.get(page.route);
    if (
      !current ||
      page.version > current.version ||
      (page.version === current.version && page.updatedAt > current.updatedAt)
    ) {
      latest.set(page.route, page);
    }
  }
  return [...latest.values()];
}

function uniqueNavigationEdges(edges: SystemBrainNavigationEdge[]) {
  const unique = new Map<string, SystemBrainNavigationEdge>();
  for (const edge of edges) {
    const key = `${edge.fromUrl}\u0000${edge.toUrl}\u0000${edge.text}`;
    unique.set(key, edge);
  }
  return [...unique.values()];
}

function uniqueStates(states: SystemBrainState[]) {
  const unique = new Map<string, SystemBrainState>();
  for (const state of states) {
    const existing = unique.get(state.id);
    unique.set(state.id, {
      ...state,
      sourceRefs: [...new Set([...(existing?.sourceRefs ?? []), ...state.sourceRefs])]
    });
  }
  return [...unique.values()];
}

function navigationSourceRef(
  explorationId: string,
  edge: {
    fromPageModelId: string;
    toPageModelId?: string;
    toUrl: string;
    text: string;
  }
) {
  return `system-navigation:${explorationId}:${edge.fromPageModelId}:${
    edge.toPageModelId ?? normalizeSemantic(edge.toUrl)
  }:${normalizeSemantic(edge.text)}`;
}
