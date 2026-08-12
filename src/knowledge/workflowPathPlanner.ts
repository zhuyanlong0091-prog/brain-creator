import type { ExecutableCaseStep } from "../domain/types.js";
import { id } from "../shared/id.js";
import type {
  SystemBrain,
  SystemBrainNavigationEdge,
  SystemBrainPage
} from "./systemBrain.js";

export type WorkflowPathCandidate = {
  pageModelIds: string[];
  navigationLabels: string[];
  sourceRefs: string[];
};

export type WorkflowPathPlan = {
  verdict: "not-required" | "unique" | "ambiguous" | "missing";
  reason?: string;
  startPageModelId?: string;
  targetPageModelId?: string;
  pageModelIds: string[];
  navigationSourceRefs: string[];
  candidatePathCount: number;
  candidatePaths: WorkflowPathCandidate[];
  steps: ExecutableCaseStep[];
};

const MAX_WORKFLOW_PATH_DEPTH = 8;
const MAX_WORKFLOW_PATH_EXPANSIONS = 1_000;
const MAX_WORKFLOW_PATH_CANDIDATES = 10;
const MIN_WORKFLOW_TARGET_SCORE = 4;

export function planWorkflowPath(
  steps: ExecutableCaseStep[],
  brain: SystemBrain,
  contextQuery = "",
  confirmedTargetPageModelId?: string
): WorkflowPathPlan {
  const confirmedTarget = confirmedTargetPageModelId
    ? brain.pages.find((page) => page.pageModelId === confirmedTargetPageModelId)
    : undefined;
  if (confirmedTargetPageModelId && !confirmedTarget) {
    return {
      ...emptyPlan("missing", steps),
      reason: "The confirmed page binding is not available in the current System Brain"
    };
  }
  const capturedEdges = brain.navigationEdges.filter(
    (
      edge
    ): edge is SystemBrainNavigationEdge & { toPageModelId: string } =>
      Boolean(edge.toPageModelId) &&
      brain.pages.some((page) => page.pageModelId === edge.fromPageModelId) &&
      brain.pages.some((page) => page.pageModelId === edge.toPageModelId)
  );
  if (brain.pages.length <= 1 || capturedEdges.length === 0) {
    return confirmedTarget
      ? {
          verdict: "not-required",
          startPageModelId: confirmedTarget.pageModelId,
          targetPageModelId: confirmedTarget.pageModelId,
          pageModelIds: [confirmedTarget.pageModelId],
          navigationSourceRefs: [],
          candidatePathCount: 1,
          candidatePaths: [
            {
              pageModelIds: [confirmedTarget.pageModelId],
              navigationLabels: [],
              sourceRefs: [`page-model:${confirmedTarget.pageModelId}`]
            }
          ],
          steps: pinStepsToPage(steps, confirmedTarget.pageModelId)
        }
      : emptyPlan("not-required", steps);
  }
  const targetSelection = confirmedTarget
    ? { verdict: "unique" as const, page: confirmedTarget, pageModelIds: [confirmedTarget.pageModelId] }
    : selectWorkflowTargetPage(steps, brain, contextQuery);
  if (targetSelection.verdict === "ambiguous") {
    return {
      ...emptyPlan("ambiguous", steps),
      reason: "System Brain has multiple equally relevant target pages",
      candidatePathCount: targetSelection.pageModelIds.length,
      candidatePaths: targetSelection.pageModelIds
        .slice(0, MAX_WORKFLOW_PATH_CANDIDATES)
        .map((pageId) => ({
          pageModelIds: [pageId],
          navigationLabels: [],
          sourceRefs: [`page-model:${pageId}`]
        }))
    };
  }
  if (!targetSelection.page) {
    return {
      ...emptyPlan("missing", steps),
      reason: "System Brain has no target page matching the executable case"
    };
  }

  const targetPageModelId = targetSelection.page.pageModelId;
  const graphNodes = new Set(
    capturedEdges.flatMap((edge) => [
      edge.fromPageModelId,
      edge.toPageModelId
    ])
  );
  if (!graphNodes.has(targetPageModelId)) {
    return missingPathPlan(steps, targetSelection.page);
  }

  const incoming = new Set(capturedEdges.map((edge) => edge.toPageModelId));
  const roots = [...graphNodes].filter((pageId) => !incoming.has(pageId));
  if (roots.includes(targetPageModelId)) {
    return {
      verdict: "not-required",
      startPageModelId: targetPageModelId,
      targetPageModelId,
      pageModelIds: [targetPageModelId],
      navigationSourceRefs: [],
      candidatePathCount: 1,
      candidatePaths: [
        {
          pageModelIds: [targetPageModelId],
          navigationLabels: [],
          sourceRefs: [`page-model:${targetPageModelId}`]
        }
      ],
      steps: pinStepsToPage(steps, targetPageModelId)
    };
  }

  const searches = roots.map((root) =>
    shortestNavigationPaths(root, targetPageModelId, capturedEdges)
  );
  const paths = searches.flatMap((search) => search.paths);
  if (searches.some((search) => search.budgetExhausted)) {
    return {
      ...emptyPlan("missing", steps),
      reason: `System Brain navigation path search exceeded the safety budget for target page ${targetSelection.page.name}`,
      targetPageModelId,
      candidatePathCount: paths.length,
      candidatePaths: paths
        .slice(0, MAX_WORKFLOW_PATH_CANDIDATES)
        .map(workflowPathCandidate)
    };
  }
  if (paths.length === 0) {
    return missingPathPlan(steps, targetSelection.page);
  }

  const shortestLength = Math.min(...paths.map((path) => path.length));
  const shortest = uniquePaths(
    paths.filter((path) => path.length === shortestLength)
  );
  const candidatePaths = shortest.map(workflowPathCandidate);
  if (shortest.length > 1) {
    return {
      ...emptyPlan("ambiguous", steps),
      reason: `System Brain has multiple equally short navigation paths to target page ${targetSelection.page.name}`,
      targetPageModelId,
      candidatePathCount: shortest.length,
      candidatePaths: candidatePaths.slice(0, MAX_WORKFLOW_PATH_CANDIDATES)
    };
  }

  const path = shortest[0];
  const pageModelIds = pathPageIds(path);
  const startPageModelId = pageModelIds[0];
  const navigationSourceRefs = [
    ...new Set(path.flatMap((edge) => edge.sourceRefs))
  ];
  return {
    verdict: "unique",
    startPageModelId,
    targetPageModelId,
    pageModelIds,
    navigationSourceRefs,
    candidatePathCount: 1,
    candidatePaths: candidatePaths.slice(0, 1),
    steps: compileNavigationSteps(
      steps,
      path,
      startPageModelId,
      targetPageModelId,
      brain
    )
  };
}

function emptyPlan(
  verdict: WorkflowPathPlan["verdict"],
  steps: ExecutableCaseStep[]
): WorkflowPathPlan {
  return {
    verdict,
    pageModelIds: [],
    navigationSourceRefs: [],
    candidatePathCount: 0,
    candidatePaths: [],
    steps
  };
}

function missingPathPlan(
  steps: ExecutableCaseStep[],
  targetPage: SystemBrainPage
): WorkflowPathPlan {
  return {
    ...emptyPlan("missing", steps),
    reason: `System Brain has no navigation path to target page ${targetPage.name}`,
    targetPageModelId: targetPage.pageModelId
  };
}

function pinStepsToPage(steps: ExecutableCaseStep[], pageModelId: string) {
  return steps.map((step) => ({
    ...step,
    pageModelId,
    sourceRefs: [
      ...new Set([...step.sourceRefs, `page-model:${pageModelId}`])
    ]
  }));
}

function selectWorkflowTargetPage(
  steps: ExecutableCaseStep[],
  brain: SystemBrain,
  contextQuery: string
):
  | { verdict: "unique"; page: SystemBrainPage; pageModelIds: string[] }
  | { verdict: "ambiguous"; page?: undefined; pageModelIds: string[] }
  | { verdict: "missing"; page?: undefined; pageModelIds: string[] } {
  const scored = brain.pages
    .map((page) => ({
      page,
      score: workflowTargetScore(page, steps, brain, contextQuery)
    }))
    .sort((left, right) => right.score - left.score);
  if (scored.length === 0 || scored[0].score < MIN_WORKFLOW_TARGET_SCORE) {
    return { verdict: "missing", pageModelIds: [] };
  }
  const tied = scored.filter((candidate) => candidate.score === scored[0].score);
  if (tied.length > 1) {
    return {
      verdict: "ambiguous",
      pageModelIds: tied.map((candidate) => candidate.page.pageModelId)
    };
  }
  return {
    verdict: "unique",
    page: scored[0].page,
    pageModelIds: [scored[0].page.pageModelId]
  };
}

function workflowTargetScore(
  page: SystemBrainPage,
  steps: ExecutableCaseStep[],
  brain: SystemBrain,
  contextQuery: string
) {
  let score =
    tokenOverlap(
      contextQuery.toLowerCase(),
      `${page.name} ${page.route}`.toLowerCase()
    ) * 2;
  for (const step of steps.filter(
    (candidate) => candidate.action !== "navigate" && candidate.action !== "click"
  )) {
    const query = `${step.instruction} ${step.targetSemantic} ${
      step.expected ?? ""
    }`.toLowerCase();
    if (step.action === "fill" || step.action === "select") {
      const role =
        step.action === "fill"
          ? /textbox|input|searchbox/i
          : /combobox|select|listbox|radio|checkbox/i;
      const compatible = page.locators.filter((locator) => role.test(locator.role));
      if (compatible.length > 0) score += 3;
      score += Math.max(
        0,
        ...compatible.map((locator) =>
          tokenOverlap(
            query,
            `${locator.name} ${locator.text} ${page.name}`.toLowerCase()
          )
        )
      );
    } else if (step.action === "assert") {
      score += Math.max(
        0,
        ...page.locators.map((locator) =>
          tokenOverlap(
            query,
            `${locator.name} ${locator.text} ${page.name}`.toLowerCase()
          )
        ),
        ...brain.stateTransitions
          .filter((transition) => transition.pageModelId === page.pageModelId)
          .map((transition) =>
            tokenOverlap(
              query,
              [
                transition.targetName,
                ...transition.visibleAdded,
                ...transition.visibleRemoved,
                ...transition.dialogAdded,
                ...transition.dialogRemoved
              ]
                .join(" ")
                .toLowerCase()
            )
          )
      );
    }
  }
  return score;
}

function shortestNavigationPaths(
  startPageModelId: string,
  targetPageModelId: string,
  edges: Array<SystemBrainNavigationEdge & { toPageModelId: string }>
) {
  const queue: Array<{
    pageModelId: string;
    path: Array<SystemBrainNavigationEdge & { toPageModelId: string }>;
    visited: Set<string>;
  }> = [
    {
      pageModelId: startPageModelId,
      path: [],
      visited: new Set([startPageModelId])
    }
  ];
  const results: Array<
    Array<SystemBrainNavigationEdge & { toPageModelId: string }>
  > = [];
  let shortestLength = Number.POSITIVE_INFINITY;
  let expansions = 0;
  while (queue.length > 0 && expansions < MAX_WORKFLOW_PATH_EXPANSIONS) {
    const current = queue.shift();
    if (
      !current ||
      current.path.length >=
        Math.min(shortestLength, MAX_WORKFLOW_PATH_DEPTH)
    ) {
      continue;
    }
    for (const edge of edges.filter(
      (candidate) => candidate.fromPageModelId === current.pageModelId
    )) {
      expansions += 1;
      if (expansions > MAX_WORKFLOW_PATH_EXPANSIONS) break;
      if (current.visited.has(edge.toPageModelId)) continue;
      const path = [...current.path, edge];
      if (edge.toPageModelId === targetPageModelId) {
        shortestLength = path.length;
        results.push(path);
        continue;
      }
      queue.push({
        pageModelId: edge.toPageModelId,
        path,
        visited: new Set([...current.visited, edge.toPageModelId])
      });
    }
  }
  return {
    paths: results.filter((path) => path.length === shortestLength),
    budgetExhausted:
      expansions > MAX_WORKFLOW_PATH_EXPANSIONS || queue.length > 0
  };
}

function uniquePaths(
  paths: Array<Array<SystemBrainNavigationEdge & { toPageModelId: string }>>
) {
  const unique = new Map<
    string,
    Array<SystemBrainNavigationEdge & { toPageModelId: string }>
  >();
  for (const path of paths) {
    unique.set(
      path
        .map(
          (edge) =>
            `${edge.fromPageModelId}\u0001${edge.toPageModelId}\u0001${edge.text}`
        )
        .join("\u0000"),
      path
    );
  }
  return [...unique.values()];
}

function pathPageIds(
  path: Array<SystemBrainNavigationEdge & { toPageModelId: string }>
) {
  return [path[0].fromPageModelId, ...path.map((edge) => edge.toPageModelId)];
}

function workflowPathCandidate(
  path: Array<SystemBrainNavigationEdge & { toPageModelId: string }>
): WorkflowPathCandidate {
  return {
    pageModelIds: pathPageIds(path),
    navigationLabels: path.map((edge) => edge.text),
    sourceRefs: [...new Set(path.flatMap((edge) => edge.sourceRefs))]
  };
}

function compileNavigationSteps(
  steps: ExecutableCaseStep[],
  path: Array<SystemBrainNavigationEdge & { toPageModelId: string }>,
  startPageModelId: string,
  targetPageModelId: string,
  brain: SystemBrain
) {
  const navigate = steps.find((step) => step.action === "navigate");
  const clicks = steps.filter((step) => step.action === "click");
  const usedClickIds = new Set<string>();
  const planned: ExecutableCaseStep[] = [
    navigate
      ? {
          ...navigate,
          pageModelId: startPageModelId,
          sourceRefs: [
            ...new Set([
              ...navigate.sourceRefs,
              `page-model:${startPageModelId}`
            ])
          ]
        }
      : {
          id: id("step"),
          order: 1,
          action: "navigate",
          instruction: "Open the observed workflow entry page",
          targetSemantic:
            brain.pages.find((page) => page.pageModelId === startPageModelId)
              ?.name ?? "workflow entry",
          pageModelId: startPageModelId,
          origin: "observed",
          sourceRefs: [`page-model:${startPageModelId}`]
        }
  ];

  for (const edge of path) {
    const matchingClick = clicks.find(
      (step) =>
        !usedClickIds.has(step.id) &&
        (tokenOverlap(
          `${step.instruction} ${step.targetSemantic}`.toLowerCase(),
          edge.text.toLowerCase()
        ) > 0 ||
          (/(?:new|create|新建|创建)/i.test(edge.text) &&
            /(?:new|create|新建|创建)/i.test(
              `${step.instruction} ${step.targetSemantic}`
            )))
    );
    if (matchingClick) usedClickIds.add(matchingClick.id);
    planned.push({
      ...(matchingClick ?? {
        id: id("step"),
        order: 0,
        action: "click" as const,
        instruction: `Follow observed navigation: ${edge.text}`,
        targetSemantic: edge.text,
        origin: "observed" as const,
        sourceRefs: []
      }),
      instruction: matchingClick?.instruction ?? `Follow observed navigation: ${edge.text}`,
      targetSemantic: edge.text,
      pageModelId: edge.fromPageModelId,
      origin: "observed",
      sourceRefs: [
        ...new Set([
          ...(matchingClick?.sourceRefs ?? []),
          ...edge.sourceRefs,
          `page-model:${edge.fromPageModelId}`,
          `page-model:${edge.toPageModelId}`
        ])
      ]
    });
  }

  planned.push(
    ...steps
      .filter(
        (step) =>
          step.action !== "navigate" &&
          !(step.action === "click" && usedClickIds.has(step.id))
      )
      .map((step) => ({
        ...step,
        pageModelId: targetPageModelId,
        sourceRefs: [
          ...new Set([...step.sourceRefs, `page-model:${targetPageModelId}`])
        ]
      }))
  );
  return planned.map((step, index) => ({ ...step, order: index + 1 }));
}

function tokenOverlap(left: string, right: string) {
  const tokens = new Set(
    left
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .filter((token) => token.length > 1)
  );
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
