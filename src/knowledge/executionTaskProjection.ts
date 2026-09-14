import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  AgentTask,
  CaseSuite,
  CaseSuiteRun,
  ExecutableCase,
  RequirementSuiteRun,
  TestDataTask
} from "../domain/types.js";
import type { BrainTask } from "../brain/types.js";
import { recoverExecutionState } from "./executionRecovery.js";

export type UnifiedExecutionTaskKind =
  | "requirement-suite"
  | "document-suite"
  | "agent-task"
  | "test-data-task"
  | "brain-task";

export type UnifiedExecutionTask = {
  id: string;
  kind: UnifiedExecutionTaskKind;
  sourceId: string;
  systemId: string;
  knowledgeProjectId?: string;
  requirementSetId?: string;
  parentId?: string;
  status: string;
  stage: string;
  currentCaseId?: string;
  currentCaseTitle?: string;
  currentStepId?: string;
  currentStepTitle?: string;
  currentPageUrl?: string;
  roles: string[];
  entityReferences: string[];
  waitReason?: string;
  pendingAction?: {
    actionKey: string;
    phase: "sent" | "reconciliation-required";
    stepId?: string;
    actionSemantic?: string;
    entityReference?: string;
    postcondition?: string;
    evidenceRefs: string[];
    nextAction: "reconcile-action";
  };
  nextAction: string;
  possiblyStalled: boolean;
  relatedTaskIds: string[];
  lastSequence?: number;
  updatedAt: string;
};

export type ExecutionTaskProjection = {
  active?: UnifiedExecutionTask;
  tasks: UnifiedExecutionTask[];
  waiting: number;
  blocked: number;
  possiblyStalled: number;
};

type ProjectionOptions = {
  systemId?: string;
  knowledgeProjectId?: string;
  nowMs?: number;
};

const activeRequirementStatuses = new Set<RequirementSuiteRun["status"]>([
  "running",
  "waiting-for-test-data",
  "waiting-for-agent",
  "blocked"
]);
const activeDocumentStatuses = new Set<CaseSuite["status"]>([
  "running",
  "waiting-for-agent",
  "blocked"
]);

export function projectExecutionTasks(
  repository: InMemoryBrainCreatorRepository,
  options: ProjectionOptions = {}
): ExecutionTaskProjection {
  const tasks: UnifiedExecutionTask[] = [];
  const relatedTaskIds = new Set<string>();

  for (const run of repository.requirementSuiteRuns) {
    if (!matchesScope(run.systemId, run.knowledgeProjectId, options)) continue;
    if (!activeRequirementStatuses.has(run.status)) continue;
    const projection = projectRequirementSuite(repository, run, options.nowMs);
    tasks.push(projection.task);
    projection.relatedTaskIds.forEach((taskId) => relatedTaskIds.add(taskId));
  }

  const activeDocumentSuiteIds = new Set(
    repository.caseSuiteRuns
      .filter((run) => run.status === "running")
      .map((run) => run.suiteId)
  );
  for (const suite of repository.caseSuites) {
    if (!matchesSystemAndProject(repository, suite.systemId, options)) continue;
    if (!activeDocumentStatuses.has(suite.status) && !activeDocumentSuiteIds.has(suite.id)) continue;
    const projection = projectDocumentSuite(repository, suite, options.nowMs);
    tasks.push(projection.task);
    projection.relatedTaskIds.forEach((taskId) => relatedTaskIds.add(taskId));
  }

  for (const task of repository.agentTasks) {
    if (!matchesScope(task.systemId, task.chainContext?.knowledgeProjectId, options)) continue;
    if (task.status !== "pending" || relatedTaskIds.has(task.id)) continue;
    tasks.push(projectAgentTask(task));
  }

  for (const task of repository.testDataTasks) {
    if (!matchesScope(task.systemId, task.knowledgeProjectId, options)) continue;
    if (task.status !== "pending" || relatedTaskIds.has(task.id)) continue;
    tasks.push(projectTestDataTask(task));
  }

  for (const task of repository.brainTasks) {
    if (!matchesScope(task.systemId, task.knowledgeProjectId, options)) continue;
    if (!isActiveBrainTask(task) || relatedTaskIds.has(task.id)) continue;
    tasks.push(projectBrainTask(task));
  }

  tasks.sort(compareTasks);
  const active = tasks[0];
  return {
    ...(active ? { active } : {}),
    tasks,
    waiting: tasks.filter((task) => task.status.startsWith("waiting") || task.status === "pending").length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
    possiblyStalled: tasks.filter((task) => task.possiblyStalled).length
  };
}

function projectRequirementSuite(
  repository: InMemoryBrainCreatorRepository,
  run: RequirementSuiteRun,
  nowMs?: number
) {
  const recovery = recoverExecutionState(repository, run.id, nowMs);
  const caseRun = run.currentExecutableCaseId
    ? run.caseRuns.find((item) => item.executableCaseId === run.currentExecutableCaseId)
    : undefined;
  const executableCase = run.currentExecutableCaseId
    ? repository.executableCases.find((item) => item.id === run.currentExecutableCaseId)
    : undefined;
  const agentTasks = repository.agentTasks.filter(
    (task) => task.status === "pending" &&
      task.systemId === run.systemId &&
      (!task.chainContext?.knowledgeProjectId ||
        task.chainContext.knowledgeProjectId === run.knowledgeProjectId) &&
      task.chainContext?.requirementSuiteRunId === run.id
  );
  const dataTasks = repository.testDataTasks.filter(
    (task) => task.status === "pending" &&
      task.systemId === run.systemId &&
      task.knowledgeProjectId === run.knowledgeProjectId &&
      task.executableCaseId === caseRun?.executableCaseId &&
      caseRun?.testDataTaskId === task.id
  );
  const related = [...agentTasks.map((task) => task.id), ...dataTasks.map((task) => task.id)];
  const roles = [
    ...(run.actorJourney ?? []).flatMap((journey) => journey.role ? [journey.role] : []),
    ...agentTasks.flatMap((task) => task.chainContext?.actorJourneyRoles ?? [])
  ];
  const authCheckpoint = repository.authCheckpoints.find(
    (checkpoint) => checkpoint.status === "awaiting-user" &&
      checkpoint.systemId === run.systemId &&
      (!run.authProfileId || checkpoint.authProfileId === run.authProfileId) &&
      (!caseRun?.testCaseId || !checkpoint.testCaseId || checkpoint.testCaseId === caseRun.testCaseId)
  );
  const entityReferences = unique([
    ...entityReferencesFor(executableCase),
    ...dataTasks.flatMap((task) => task.entityReference ? [task.entityReference] : [])
  ]);
  const effectiveStatus = run.status === "blocked"
    ? "blocked"
    : recovery.pendingAction
      ? "waiting"
    : recovery.status === "waiting"
      ? "waiting"
      : authCheckpoint
        ? "waiting-for-auth"
        : run.status;
  const nextAction = effectiveStatus === "blocked"
    ? "review-and-resume"
    : recovery.pendingAction
      ? recovery.pendingAction.nextAction
    : dataTasks.length > 0
      ? "complete-test-data"
      : agentTasks.length > 0
        ? "submit-agent-output"
        : authCheckpoint
          ? "complete-auth-checkpoint"
          : recovery.status === "waiting"
            ? recovery.nextAction
            : nextActionForSuite(run.status);
  return {
    task: {
      id: run.id,
      kind: "requirement-suite" as const,
      sourceId: run.id,
      systemId: run.systemId,
      knowledgeProjectId: run.knowledgeProjectId,
      status: effectiveStatus,
      requirementSetId: run.requirementSetIds?.[0],
      stage: recovery.currentStepId ? "execution" : "suite",
      currentCaseId: recovery.currentCaseId,
      currentCaseTitle: recovery.currentCaseTitle ?? caseRun?.title,
      currentStepId: recovery.currentStepId,
      currentStepTitle: recovery.currentStepTitle,
      currentPageUrl: recovery.currentPageUrl,
      roles: unique(roles),
      entityReferences,
      ...(recovery.pendingAction ? { pendingAction: recovery.pendingAction } : {}),
      waitReason: recovery.pendingAction
        ? "A write action was sent but its result was not confirmed. Query the postcondition before retrying."
        : recovery.waitReason ?? authCheckpoint?.reason ?? waitReasonFor(effectiveStatus),
      nextAction,
      possiblyStalled: recovery.possiblyStalled,
      relatedTaskIds: related,
      lastSequence: recovery.lastSequence,
      updatedAt: maxTimestamp(run.updatedAt, recovery.updatedAt)
    } satisfies UnifiedExecutionTask,
    relatedTaskIds: related
  };
}

function projectDocumentSuite(
  repository: InMemoryBrainCreatorRepository,
  suite: CaseSuite,
  nowMs?: number
) {
  const recovery = recoverExecutionState(repository, suite.id, nowMs);
  const latestRun = repository.caseSuiteRuns
    .filter((run) => run.suiteId === suite.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const agentTasks = repository.agentTasks.filter(
    (task) => task.status === "pending" &&
      task.systemId === suite.systemId &&
      task.suiteContext?.suiteId === suite.id
  );
  const related = agentTasks.map((task) => task.id);
  const roles = agentTasks.flatMap((task) => task.chainContext?.actorJourneyRoles ?? []);
  const effectiveStatus = recovery.status === "waiting" ? "waiting" : suite.status;
  const actionStatus = recovery.pendingAction ? "waiting" : effectiveStatus;
  const task: UnifiedExecutionTask = {
    id: suite.id,
    kind: "document-suite",
    sourceId: suite.id,
    systemId: suite.systemId,
    status: actionStatus,
    stage: recovery.currentStepId ? "execution" : "suite",
    currentCaseId: recovery.currentCaseId,
    currentCaseTitle: recovery.currentCaseTitle ?? latestCaseTitle(latestRun),
    currentStepId: recovery.currentStepId,
    currentStepTitle: recovery.currentStepTitle,
    currentPageUrl: recovery.currentPageUrl,
    roles: unique(roles),
    entityReferences: [],
    ...(recovery.pendingAction ? { pendingAction: recovery.pendingAction } : {}),
    waitReason: recovery.pendingAction
      ? "A write action was sent but its result was not confirmed. Query the postcondition before retrying."
      : recovery.waitReason ?? waitReasonFor(effectiveStatus),
    nextAction: effectiveStatus === "blocked"
      ? "review-and-resume"
      : recovery.pendingAction
        ? recovery.pendingAction.nextAction
      : agentTasks.length > 0
        ? "submit-agent-output"
      : recovery.status === "waiting"
        ? recovery.nextAction
        : nextActionForSuite(suite.status),
    possiblyStalled: recovery.possiblyStalled,
    relatedTaskIds: related,
    lastSequence: recovery.lastSequence,
    updatedAt: maxTimestamp(suite.updatedAt, recovery.updatedAt)
  };
  return { task, relatedTaskIds: related };
}

function projectAgentTask(task: AgentTask): UnifiedExecutionTask {
  const requirementSuiteRunId = task.chainContext?.requirementSuiteRunId;
  const caseId = task.chainContext?.executableCaseId;
  return {
    id: task.id,
    kind: "agent-task",
    sourceId: task.id,
    systemId: task.systemId,
    knowledgeProjectId: task.chainContext?.knowledgeProjectId,
    parentId: requirementSuiteRunId,
    status: task.status,
    stage: task.agent,
    currentCaseId: caseId,
    currentCaseTitle: task.suiteContext?.title,
    roles: unique(task.chainContext?.actorJourneyRoles ?? []),
    entityReferences: [],
    waitReason: "Waiting for the host agent to submit the task result",
    nextAction: "submit-agent-output",
    possiblyStalled: false,
    relatedTaskIds: [],
    updatedAt: task.updatedAt
  };
}

function projectTestDataTask(task: TestDataTask): UnifiedExecutionTask {
  return {
    id: task.id,
    kind: "test-data-task",
    sourceId: task.id,
    systemId: task.systemId,
    knowledgeProjectId: task.knowledgeProjectId,
    status: task.status,
    stage: task.action === "cleanup" ? "test-data-cleanup" : "test-data-prepare",
    currentCaseId: task.executableCaseId,
    roles: [],
    entityReferences: task.entityReference ? [task.entityReference] : [],
    waitReason: "Waiting for test data lookup or creation",
    nextAction: "complete-test-data",
    possiblyStalled: false,
    relatedTaskIds: [],
    updatedAt: task.updatedAt
  };
}

function projectBrainTask(task: BrainTask): UnifiedExecutionTask {
  const waiting = task.state.startsWith("waiting");
  return {
    id: task.id,
    kind: "brain-task",
    sourceId: task.id,
    systemId: task.systemId ?? "",
    knowledgeProjectId: task.knowledgeProjectId,
    requirementSetId: task.requirementSetId,
    status: task.status,
    stage: task.state,
    roles: [],
    entityReferences: [],
    ...(waiting ? { waitReason: task.lastError ?? `Brain task is ${task.state}` } : {}),
    nextAction: waiting ? "resume-brain-task" : "review-brain-task",
    possiblyStalled: false,
    relatedTaskIds: [],
    updatedAt: task.updatedAt
  };
}

function entityReferencesFor(executableCase?: ExecutableCase) {
  if (!executableCase) return [];
  const fromPlan = executableCase.dataPlan?.operations.flatMap((operation) =>
    operation.entityReference ? [operation.entityReference] : []
  ) ?? [];
  return unique([...(executableCase.entityReferenceRequirements ?? []), ...fromPlan]);
}

function latestCaseTitle(run?: CaseSuiteRun) {
  return run?.caseResults.find((result) => result.status === "waiting-for-agent")?.title ??
    run?.caseResults.find((result) => result.status !== "passed")?.title;
}

function matchesScope(
  systemId: string | undefined,
  knowledgeProjectId: string | undefined,
  options: ProjectionOptions
) {
  return (!options.systemId || systemId === options.systemId) &&
    (!options.knowledgeProjectId || knowledgeProjectId === options.knowledgeProjectId);
}

function matchesSystemAndProject(
  repository: InMemoryBrainCreatorRepository,
  systemId: string,
  options: ProjectionOptions
) {
  if (options.systemId && systemId !== options.systemId) return false;
  if (!options.knowledgeProjectId) return true;
  return repository.knowledgeProjects.some(
    (project) => project.id === options.knowledgeProjectId && project.systemIds.includes(systemId)
  );
}

function isActiveBrainTask(task: BrainTask) {
  return task.status === "pending" || task.status === "running";
}

function nextActionForSuite(status: string) {
  if (status === "waiting-for-test-data") return "complete-test-data";
  if (status === "waiting-for-agent") return "submit-agent-output";
  if (status === "blocked") return "review-and-resume";
  if (status === "running") return "continue-run";
  return "review-result";
}

function waitReasonFor(status: string) {
  if (status === "waiting-for-test-data") return "Waiting for test data preparation";
  if (status === "waiting-for-agent") return "Waiting for host agent output";
  if (status === "blocked") return "The run is blocked and needs review";
  if (status === "waiting-for-auth") return "Waiting for the user to complete authentication";
  return undefined;
}

function compareTasks(left: UnifiedExecutionTask, right: UnifiedExecutionTask) {
  return taskPriority(left) - taskPriority(right) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.id.localeCompare(right.id);
}

function taskPriority(task: UnifiedExecutionTask) {
  if (task.status === "waiting-for-test-data") return 0;
  if (task.status === "waiting-for-agent") return 1;
  if (task.status === "waiting-for-auth") return 1;
  if (task.status === "waiting") return 1;
  if (task.status === "blocked") return 2;
  if (task.status === "running") return 3;
  if (task.status === "pending") return 4;
  return 5;
}

function maxTimestamp(...values: string[]) {
  return values.sort((left, right) => right.localeCompare(left))[0];
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
