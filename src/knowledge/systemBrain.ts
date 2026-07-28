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

export type SystemBrain = {
  knowledgeProjectId: string;
  systemId: string;
  pages: SystemBrainPage[];
  workflows: SystemBrainWorkflow[];
  behaviorRules: SystemBrainBehaviorRule[];
  apiFlows: SystemBrainApiFlow[];
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
  const page = selectPage(brain.pages, `${contextQuery} ${steps.map((step) => step.instruction).join(" ")}`);
  const missingEvidence: Array<{
    stepId: string;
    action: ExecutableCaseStep["action"];
    reason: string;
  }> = [];
  if (!page) {
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
    const sourceRefs = new Set([...step.sourceRefs, `page-model:${page.pageModelId}`]);
    if (step.action === "navigate" || step.action === "assert") {
      page.probeResultIds.forEach((probeId) => sourceRefs.add(`probe-result:${probeId}`));
      return { ...step, pageModelId: page.pageModelId, sourceRefs: [...sourceRefs] };
    }
    if (step.action === "api") {
      brain.apiFlows.forEach((flow) =>
        flow.sourceRefs.forEach((sourceRef) => sourceRefs.add(sourceRef))
      );
      return { ...step, pageModelId: page.pageModelId, sourceRefs: [...sourceRefs] };
    }
    if (step.action === "wait") {
      return { ...step, pageModelId: page.pageModelId, sourceRefs: [...sourceRefs] };
    }
    const locator = selectLocator(step, page.locators);
    if (!locator) {
      missingEvidence.push({
        stepId: step.id,
        action: step.action,
        reason: `System Brain has no locator evidence for ${step.action}: ${step.targetSemantic}`
      });
      return { ...step, pageModelId: page.pageModelId, sourceRefs: [...sourceRefs] };
    }
    sourceRefs.add(`locator-point:${locator.id}`);
    return {
      ...step,
      pageModelId: page.pageModelId,
      locatorPointId: locator.id,
      sourceRefs: [...sourceRefs]
    };
  });

  return { steps: bound, missingEvidence };
}

function selectLocator(step: ExecutableCaseStep, locators: LocatorPoint[]) {
  const preferredRoles =
    step.action === "click"
      ? /button|link|menuitem/i
      : step.action === "fill"
        ? /textbox|input|searchbox/i
        : /combobox|select|listbox|radio|checkbox/i;
  const roleMatches = locators.filter((locator) => preferredRoles.test(locator.role));
  const candidates = roleMatches;
  const query = `${step.instruction} ${step.targetSemantic}`.toLowerCase();
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
