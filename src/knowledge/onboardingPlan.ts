import { createHash } from "node:crypto";
import type {
  OnboardingCoverageDimension,
  OnboardingCoverageItem,
  OnboardingCoverageStatus,
  OnboardingCoverageSummary,
  OnboardingPlan
} from "../brain/types.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ActorJourneyConfig,
  ExplorationPlan,
  ExplorationPlanAction,
  ExplorationTask,
  RequirementSet
} from "../domain/types.js";
import { id } from "../shared/id.js";
import type { StatefulExplorationPlanService } from "./statefulExplorationPlan.js";

type OnboardingKnowledgePort = {
  validateRequirementSetApproval(requirementSetId: string): RequirementSet;
  approveRequirementSet(requirementSetId: string, options?: { persist?: boolean }): RequirementSet;
  compileExecutableCases(testIntentId: string, systemId?: string): {
    executableCase: { id: string; explorationTaskIds?: string[] };
  };
};

export type CreateOnboardingPlanInput = {
  requirementSetId: string;
  systemId: string;
  actorJourney?: ActorJourneyConfig[];
  allowedRoutes?: string[];
  allowedActions?: Array<Omit<ExplorationPlanAction, "id">>;
  forbiddenActions?: string[];
  cleanupPolicy: OnboardingPlan["cleanupPolicy"];
  maxWrites?: number;
  maxDurationMs?: number;
};

export type CreateOnboardingPlanResult = {
  onboardingPlan: OnboardingPlan;
  explorationPlan: ExplorationPlan;
  explorationQuestions: ExplorationTask[];
  coverage: {
    summary: OnboardingCoverageSummary;
    items: OnboardingCoverageItem[];
    systemEvidenceRefs: string[];
    fingerprint: string;
  };
  reused: boolean;
  refreshed?: boolean;
  coverageChanged?: boolean;
  baselineChanged?: boolean;
};

type ExplorationQuestionDraft = {
  modelId?: string;
  testIntentId: string;
  kind: ExplorationTask["kind"];
  reason: string;
  query: string;
  requestedEvidence: string[];
  approvedEvidenceScope?: string[];
  sourceRefs: string[];
  role?: string;
  write: boolean;
  actions?: Array<{
    name: string;
    role?: string;
    write: boolean;
    sourceRefs: string[];
  }>;
};

export class OnboardingPlanService {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly knowledge: OnboardingKnowledgePort,
    private readonly explorationPlans: StatefulExplorationPlanService
  ) {}

  create(input: CreateOnboardingPlanInput): CreateOnboardingPlanResult {
    const requirementSet = this.requirementSet(input.requirementSetId);
    const project = this.repository.knowledgeProjects.find(
      (item) => item.id === requirementSet.knowledgeProjectId
    );
    if (!project) throw new Error("Knowledge project not found");
    if (project.status !== "active") {
      throw new Error("Onboarding requires an active knowledge project");
    }
    const system = this.repository.systemProfiles.find((item) => item.id === input.systemId);
    if (!system) throw new Error("Business system not found");
    if (system.status === "cancelled") {
      throw new Error("Onboarding cannot use a cancelled business system");
    }
    if (!project.systemIds.includes(system.id)) {
      throw new Error("Business system must be bound to the knowledge project before onboarding");
    }

    const baseline = baselineSnapshot(this.repository, requirementSet);
    const questions = requirementExplorationQuestions(this.repository, requirementSet.id);
    if (questions.length === 0) {
      throw new Error("Requirement analysis must produce TestIntents before onboarding");
    }
    const existing = this.repository.onboardingPlans.find(
      (plan) =>
        plan.requirementSetId === requirementSet.id &&
        plan.systemId === system.id
    );
    if (existing) {
      const explorationPlan = this.explorationPlans.get(existing.explorationPlanId);
      if (existing.status !== "draft") {
        const explorationQuestions = explorationTasksForPlan(this.repository, explorationPlan);
        const coverage = buildCoverage(
          this.repository,
          requirementSet,
          system.id,
          questions,
          explorationQuestions
        );
        return {
          onboardingPlan: {
            ...existing,
            coverageItems: coverage.items,
            coverageSummary: coverage.summary,
            systemEvidenceRefs: coverage.systemEvidenceRefs
          },
          explorationPlan,
          explorationQuestions,
          coverage,
          reused: true,
          baselineChanged:
            !sameStrings(existing.baselineAssetIds, baseline.assetIds) ||
            Boolean(existing.baselineFingerprint && existing.baselineFingerprint !== baseline.fingerprint)
        };
      }
      const priorCoverageFingerprint = existing.coverageFingerprint;
      const refreshed = this.refreshDraft(
        existing,
        explorationPlan,
        requirementSet,
        system.id,
        system.baseUrl,
        questions,
        input,
        baseline
      );
      const explorationQuestions = explorationTasksForPlan(this.repository, explorationPlan);
      const coverage = buildCoverage(
        this.repository,
        requirementSet,
        system.id,
        questions,
        explorationQuestions
      );
      const coverageChanged = priorCoverageFingerprint !== coverage.fingerprint;
      return {
        onboardingPlan: existing,
        explorationPlan,
        explorationQuestions,
        coverage,
        reused: true,
        refreshed,
        coverageChanged,
        baselineChanged: false
      };
    }
    const explorationQuestions = questions.map((question) =>
      this.upsertExplorationTask(requirementSet, system.id, question, baseline.fingerprint)
    );
    const allowedRoutes = unique(input.allowedRoutes?.length ? input.allowedRoutes : [system.baseUrl]);
    const actorJourney = input.actorJourney ?? [];
    const coverage = buildCoverage(
      this.repository,
      requirementSet,
      system.id,
      questions,
      explorationQuestions
    );
    const allowedActions = input.allowedActions?.length
      ? input.allowedActions
      : explorationActions(questions, allowedRoutes[0], actorJourney);
    const explorationPlan = this.explorationPlans.create({
      explorationTaskIds: explorationQuestions.map((task) => task.id),
      actorJourney,
      allowedRoutes,
      allowedActions,
      forbiddenActions: input.forbiddenActions,
      cleanupPolicy: input.cleanupPolicy,
      maxWrites: input.maxWrites ?? 20,
      maxDurationMs: input.maxDurationMs ?? 300_000
    });
    const onboardingPlan: OnboardingPlan = {
      id: id("onboardingPlan"),
      knowledgeProjectId: project.id,
      requirementSetId: requirementSet.id,
      systemId: system.id,
      requirementSummary: plainText(requirementSet.summary || requirementSet.title),
      baselineAssetIds: baseline.assetIds,
      baselineFingerprint: baseline.fingerprint,
      explorationPlanId: explorationPlan.id,
      unresolvedQuestions: unresolvedQuestions(this.repository, requirementSet),
      allowedRoutes: explorationPlan.allowedRoutes,
      allowedActions: explorationPlan.allowedActions.map((action) => action.name),
      forbiddenActions: explorationPlan.forbiddenActions,
      maxWrites: explorationPlan.maxWrites,
      maxDurationMs: explorationPlan.maxDurationMs,
      cleanupPolicy: explorationPlan.cleanupPolicy,
      status: "draft",
      coverageItems: coverage.items,
      coverageSummary: coverage.summary,
      systemEvidenceRefs: coverage.systemEvidenceRefs,
      coverageFingerprint: coverage.fingerprint,
      generatedAt: new Date().toISOString()
    };
    this.repository.onboardingPlans.push(onboardingPlan);
    this.repository.persist();
    return { onboardingPlan, explorationPlan, explorationQuestions, coverage, reused: false };
  }

  private refreshDraft(
    onboardingPlan: OnboardingPlan,
    explorationPlan: ExplorationPlan,
    requirementSet: RequirementSet,
    systemId: string,
    systemBaseUrl: string,
    questions: ExplorationQuestionDraft[],
    input: CreateOnboardingPlanInput,
    baseline: ReturnType<typeof baselineSnapshot>
  ) {
    if (explorationPlan.status !== "draft") {
      throw new Error(`Draft onboarding requires a draft exploration plan; found ${explorationPlan.status}`);
    }
    const explorationQuestions = questions.map((question) =>
      this.upsertExplorationTask(requirementSet, systemId, question, baseline.fingerprint)
    );
    const actorJourney = input.actorJourney ?? explorationPlan.actorJourney;
    const allowedRoutes = unique(
      input.allowedRoutes?.length
        ? input.allowedRoutes
        : explorationPlan.allowedRoutes.length
          ? explorationPlan.allowedRoutes
          : [systemBaseUrl]
    );
    const coverage = buildCoverage(
      this.repository,
      requirementSet,
      systemId,
      questions,
      explorationQuestions
    );
    const allowedActions = input.allowedActions?.length
      ? input.allowedActions
      : explorationActions(questions, allowedRoutes[0], actorJourney);
    validateDraftActions(allowedActions, actorJourney);

    const actionWithStableIds = stableExplorationActions(
      explorationPlan.allowedActions,
      allowedActions
    );
    const maxWrites = input.maxWrites ?? explorationPlan.maxWrites;
    const maxDurationMs = input.maxDurationMs ?? explorationPlan.maxDurationMs;
    if (!Number.isInteger(maxWrites) || maxWrites < 0 || maxWrites > 20) {
      throw new Error("Exploration maxWrites must be an integer from 0 to 20");
    }
    if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1_000 || maxDurationMs > 900_000) {
      throw new Error("Exploration maxDurationMs must be between 1000 and 900000");
    }
    if (maxWrites === 0 && actionWithStableIds.some((action) => action.write)) {
      throw new Error("Exploration maxWrites must permit the authorized write actions");
    }

    const forbiddenActions = input.forbiddenActions?.length
      ? unique([...explorationPlan.forbiddenActions, ...input.forbiddenActions])
      : explorationPlan.forbiddenActions;
    const now = new Date().toISOString();
    explorationPlan.explorationTaskIds = explorationQuestions.map((task) => task.id);
    explorationPlan.actorJourney = actorJourney;
    explorationPlan.allowedRoutes = allowedRoutes;
    explorationPlan.allowedActions = actionWithStableIds;
    explorationPlan.forbiddenActions = forbiddenActions;
    explorationPlan.maxWrites = maxWrites;
    explorationPlan.maxDurationMs = maxDurationMs;
    explorationPlan.idempotencyKey = explorationPlanFingerprint(explorationPlan);
    explorationPlan.updatedAt = now;

    onboardingPlan.requirementSummary = plainText(requirementSet.summary || requirementSet.title);
    onboardingPlan.baselineAssetIds = baseline.assetIds;
    onboardingPlan.baselineFingerprint = baseline.fingerprint;
    onboardingPlan.unresolvedQuestions = unresolvedQuestions(this.repository, requirementSet);
    onboardingPlan.allowedRoutes = allowedRoutes;
    onboardingPlan.allowedActions = actionWithStableIds.map((action) => action.name);
    onboardingPlan.forbiddenActions = forbiddenActions;
    onboardingPlan.maxWrites = maxWrites;
    onboardingPlan.maxDurationMs = maxDurationMs;
    onboardingPlan.cleanupPolicy = input.cleanupPolicy;
    onboardingPlan.coverageItems = coverage.items;
    onboardingPlan.coverageSummary = coverage.summary;
    onboardingPlan.systemEvidenceRefs = coverage.systemEvidenceRefs;
    onboardingPlan.coverageFingerprint = coverage.fingerprint;
    onboardingPlan.generatedAt = now;
    this.repository.persist();
    return true;
  }

  approve(input: {
    onboardingPlanId: string;
    note: string;
    approvedBy: string;
  }) {
    const onboardingPlan = this.get(input.onboardingPlanId);
    if (onboardingPlan.status === "approved") {
      return {
        onboardingPlan,
        requirementSet: this.requirementSet(onboardingPlan.requirementSetId),
        explorationPlan: this.explorationPlans.get(onboardingPlan.explorationPlanId)
      };
    }
    if (onboardingPlan.status !== "draft") {
      throw new Error(`Onboarding plan is ${onboardingPlan.status}`);
    }
    const requirementSet = this.assertBaselineCurrent(onboardingPlan);
    onboardingPlan.unresolvedQuestions = unresolvedQuestions(this.repository, requirementSet);
    if (onboardingPlan.unresolvedQuestions.length > 0) {
      throw new Error("Onboarding plan has unresolved requirement questions");
    }

    this.knowledge.validateRequirementSetApproval(onboardingPlan.requirementSetId);
    this.explorationPlans.validateApproval({
      planId: onboardingPlan.explorationPlanId,
      note: input.note,
      approvedBy: input.approvedBy
    });
    return this.repository.transaction(() => {
      const approvedRequirementSet = this.knowledge.approveRequirementSet(
        onboardingPlan.requirementSetId,
        { persist: false }
      );
      const explorationPlan = this.explorationPlans.approve({
        planId: onboardingPlan.explorationPlanId,
        note: input.note,
        approvedBy: input.approvedBy
      }, { persist: false });
      const approvedBaseline = baselineSnapshot(this.repository, approvedRequirementSet);
      onboardingPlan.baselineAssetIds = approvedBaseline.assetIds;
      onboardingPlan.baselineFingerprint = approvedBaseline.fingerprint;
      onboardingPlan.status = "approved";
      onboardingPlan.approvedBy = input.approvedBy.trim();
      onboardingPlan.approvedAt = new Date().toISOString();
      return { onboardingPlan, requirementSet: approvedRequirementSet, explorationPlan };
    });
  }

  start(onboardingPlanId: string) {
    const onboardingPlan = this.get(onboardingPlanId);
    if (onboardingPlan.status !== "approved") {
      throw new Error(`Onboarding plan is ${onboardingPlan.status}`);
    }
    this.assertBaselineCurrent(onboardingPlan);
    this.bindExecutableCases(onboardingPlan);
    const result = this.explorationPlans.start(onboardingPlan.explorationPlanId);
    if (result.status !== "needs-agent-execution") return result;
    return {
      ...result,
      onboardingPlan,
      workPackage: {
        ...result.workPackage,
        requirementQuestions: result.plan.explorationTaskIds.map((taskId) => {
          const task = this.repository.explorationTasks.find((item) => item.id === taskId);
          if (!task) throw new Error(`Onboarding exploration task not found: ${taskId}`);
          return {
            id: task.id,
            kind: task.kind,
            query: task.query,
            requestedEvidence: task.requestedEvidence,
            sourceRefs: task.sourceRefs
          };
        })
      }
    };
  }

  syncFromExploration(explorationPlanId: string) {
    const onboardingPlan = this.repository.onboardingPlans.find(
      (item) => item.explorationPlanId === explorationPlanId
    );
    if (!onboardingPlan) return undefined;
    const explorationPlan = this.explorationPlans.get(explorationPlanId);
    if (explorationPlan.status === "completed") onboardingPlan.status = "completed";
    if (explorationPlan.status === "blocked" || explorationPlan.status === "cancelled") {
      onboardingPlan.status = "blocked";
    }
    this.repository.persist();
    return onboardingPlan;
  }

  get(onboardingPlanId: string) {
    const plan = this.repository.onboardingPlans.find((item) => item.id === onboardingPlanId);
    if (!plan) throw new Error("Onboarding plan not found");
    return plan;
  }

  list(input: { systemId?: string; requirementSetId?: string } = {}) {
    return this.repository.onboardingPlans.filter(
      (plan) =>
        (!input.systemId || plan.systemId === input.systemId) &&
        (!input.requirementSetId || plan.requirementSetId === input.requirementSetId)
    );
  }

  private upsertExplorationTask(
    requirementSet: RequirementSet,
    systemId: string,
    question: ExplorationQuestionDraft,
    baselineFingerprint: string
  ) {
    const idempotencyKey = hash({
      requirementSetId: requirementSet.id,
      systemId,
      testIntentId: question.testIntentId,
      modelId: question.modelId,
      baselineFingerprint,
      kind: question.kind,
      query: question.query,
      sourceRefs: question.sourceRefs,
      approvedEvidenceScope: question.approvedEvidenceScope
    });
    const existing = this.repository.explorationTasks.find(
      (task) => task.idempotencyKey === idempotencyKey && task.status === "pending"
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    const task: ExplorationTask = {
      id: id("explorationTask"),
      knowledgeProjectId: requirementSet.knowledgeProjectId,
      requirementSetId: requirementSet.id,
      testIntentId: question.testIntentId,
      systemId,
      kind: question.kind,
      status: "pending",
      reason: question.reason,
      query: question.query,
      candidatePageModelIds: [],
      requestedEvidence: question.requestedEvidence,
      approvedEvidenceScope: question.approvedEvidenceScope,
      sourceRefs: question.sourceRefs,
      resultSourceRefs: [],
      idempotencyKey,
      createdAt: now,
      updatedAt: now
    };
    this.repository.explorationTasks.push(task);
    return task;
  }

  private requirementSet(requirementSetId: string) {
    const requirementSet = this.repository.requirementSets.find((item) => item.id === requirementSetId);
    if (!requirementSet) throw new Error("Requirement set not found");
    return requirementSet;
  }

  private assertBaselineCurrent(onboardingPlan: OnboardingPlan) {
    const requirementSet = this.requirementSet(onboardingPlan.requirementSetId);
    const currentBaseline = baselineSnapshot(this.repository, requirementSet);
    if (
      !sameStrings(onboardingPlan.baselineAssetIds, currentBaseline.assetIds) ||
      (onboardingPlan.baselineFingerprint &&
        onboardingPlan.baselineFingerprint !== currentBaseline.fingerprint)
    ) {
      throw new Error("Onboarding baseline changed; recreate the onboarding plan before continuing");
    }
    onboardingPlan.baselineFingerprint ??= currentBaseline.fingerprint;
    return requirementSet;
  }

  private bindExecutableCases(onboardingPlan: OnboardingPlan) {
    const explorationPlan = this.explorationPlans.get(onboardingPlan.explorationPlanId);
    const tasks = explorationPlan.explorationTaskIds.map((taskId) => {
      const task = this.repository.explorationTasks.find((item) => item.id === taskId);
      if (!task) throw new Error(`Onboarding exploration task not found: ${taskId}`);
      return task;
    });
    const caseIds = [...explorationPlan.executableCaseIds];
    for (const testIntentId of unique(tasks.map((task) => task.testIntentId))) {
      const existing = [...this.repository.executableCases].reverse().find((item) =>
        item.testIntentId === testIntentId &&
        item.systemId === onboardingPlan.systemId &&
        !["superseded", "stale"].includes(item.status)
      );
      const executableCase = existing ?? this.knowledge.compileExecutableCases(
        testIntentId,
        onboardingPlan.systemId
      ).executableCase;
      caseIds.push(executableCase.id);
      const approvedTasks = tasks.filter((item) => item.testIntentId === testIntentId);
      for (const compilerTaskId of executableCase.explorationTaskIds ?? []) {
        if (approvedTasks.some((task) => task.id === compilerTaskId)) continue;
        const compilerTask = this.repository.explorationTasks.find((item) => item.id === compilerTaskId);
        if (!compilerTask) throw new Error(`Compiler exploration task not found: ${compilerTaskId}`);
        const coveringTask = approvedTasks.find((approvedTask) =>
          includesAll(
            approvedTask.approvedEvidenceScope ?? approvedTask.requestedEvidence,
            compilerTask.requestedEvidence
          )
        );
        if (!coveringTask) {
          throw new Error(`Compiler exploration task is outside the approved onboarding scope: ${compilerTaskId}`);
        }
        if (compilerTask.status === "pending") {
          compilerTask.status = "cancelled";
          compilerTask.failureReason = `Covered by approved onboarding task ${coveringTask.id}`;
          compilerTask.updatedAt = new Date().toISOString();
          compilerTask.resolvedAt = compilerTask.updatedAt;
        }
      }
      for (const task of approvedTasks) {
        task.executableCaseId = executableCase.id;
      }
    }
    explorationPlan.executableCaseIds = unique(caseIds);
    this.repository.persist();
  }
}

type SystemEvidenceEntry = {
  ref: string;
  kind: "exploration" | "page" | "locator" | "probe" | "navigation" | "transition" | "snapshot" | "binding" | "observation";
  text: string;
};

function buildCoverage(
  repository: InMemoryBrainCreatorRepository,
  requirementSet: RequirementSet,
  systemId: string,
  questions: ExplorationQuestionDraft[],
  explorationQuestions: ExplorationTask[]
) {
  const evidence = systemEvidence(repository, requirementSet.knowledgeProjectId, requirementSet.id, systemId);
  const items: OnboardingCoverageItem[] = [];
  const modelQuestion = new Map(
    questions
      .filter((question) => question.modelId)
      .map((question) => [question.modelId!, question])
  );

  addCoverageItem(items, repository, requirementSet, systemId, explorationQuestions, evidence,
    "requirement", requirementSet.id, plainText(requirementSet.title),
    [requirementSet.sourceId], [requirementSet.id],
    requirementExplorationActions(questions), [], [], [], "需求版本需要绑定真实系统证据");

  for (const node of repository.knowledgeNodes.filter((item) => item.requirementSetId === requirementSet.id)) {
    addCoverageItem(items, repository, requirementSet, systemId, explorationQuestions, evidence,
      "knowledge", node.id, plainText(node.title), node.sourceRefs, [node.id], [], [], [], [],
      "知识节点需要在目标系统中完成语义绑定");
  }
  for (const model of repository.businessObjectModels.filter((item) => item.requirementSetId === requirementSet.id)) {
    addCoverageItem(items, repository, requirementSet, systemId, explorationQuestions, evidence,
      "business-object", model.id, plainText(model.name), model.sourceRefs, [model.id],
      model.fields.map((field) => `确认字段：${plainText(field)}`), model.actors, model.fields, model.states,
      "业务对象需要确认页面字段、生命周期和副作用");
  }
  for (const workflow of repository.workflowModels.filter((item) => item.requirementSetId === requirementSet.id)) {
    const question = modelQuestion.get(workflow.id);
    const actions = workflow.transitions.map((transition) => transition.trigger?.trim() || `${transition.from} -> ${transition.to}`);
    addCoverageItem(items, repository, requirementSet, systemId, explorationQuestions, evidence,
      "workflow", workflow.id, plainText(workflow.title), workflow.sourceRefs, [workflow.id],
      actions, workflow.actors, [], workflow.steps.map((step) => plainText(step.label)),
      "工作流必须验证入口、动作、分支、终态和副作用",
      question ? explorationQuestions.filter((task) => task.testIntentId === question.testIntentId).map((task) => task.id) : []);
  }
  for (const machine of repository.stateMachineModels.filter((item) => item.requirementSetId === requirementSet.id)) {
    addCoverageItem(items, repository, requirementSet, systemId, explorationQuestions, evidence,
      "state", machine.id, plainText(machine.title), machine.sourceRefs, [machine.id],
      machine.transitions.map((transition) => transition.trigger?.trim() || `${transition.from} -> ${transition.to}`),
      machine.transitions.map((transition) => transition.actor).filter((value): value is string => Boolean(value)),
      [], machine.states.map((state) => plainText(state.label)),
      "状态机必须验证合法转换、前置状态和终态",
      modelQuestion.get(machine.id)
        ? explorationQuestions.filter((task) => task.testIntentId === modelQuestion.get(machine.id)!.testIntentId).map((task) => task.id)
        : []);
  }
  for (const table of repository.decisionTableModels.filter((item) => item.requirementSetId === requirementSet.id)) {
    addCoverageItem(items, repository, requirementSet, systemId, explorationQuestions, evidence,
      "decision", table.id, plainText(table.title), table.sourceRefs, [table.id],
      table.rules.flatMap((rule) => rule.expectedActions.map((action) => plainText(action))), [], table.conditions,
      table.rules.flatMap((rule) => Object.values(rule.conditionValues)),
      "决策表必须验证条件组合和对应动作",
      modelQuestion.get(table.id)
        ? explorationQuestions.filter((task) => task.testIntentId === modelQuestion.get(table.id)!.testIntentId).map((task) => task.id)
        : []);
  }
  for (const scenario of repository.businessScenarios.filter((item) => item.requirementSetId === requirementSet.id)) {
    const scenarioIntentIds = scenario.testIntentIds ?? [];
    const scenarioTaskIds = explorationQuestions
      .filter((task) => scenarioIntentIds.includes(task.testIntentId))
      .map((task) => task.id);
    addCoverageItem(items, repository, requirementSet, systemId, explorationQuestions, evidence,
      "scenario", scenario.id, plainText(scenario.title), scenario.sourceRefs, [scenario.id],
      [plainText(scenario.objective)], scenario.actors, scenario.testDataNeeds, scenario.expectedBusinessOutcomes,
      "业务场景需要绑定流程、数据和可观察结果", scenarioTaskIds);
  }
  for (const intent of repository.testIntents.filter((item) => item.requirementSetId === requirementSet.id)) {
    const dataNeeds = [
      ...(intent.consumesEntityRefs ?? []),
      ...(intent.producesEntityRefs ?? [])
    ];
    addCoverageItem(items, repository, requirementSet, systemId, explorationQuestions, evidence,
      "test-intent", intent.id, plainText(intent.title), intent.requirementRefs, [intent.id],
      [plainText(intent.objective)], intent.actorJourney ?? [], dataNeeds, intent.expectedResults,
      "测试意图需要绑定页面、数据和断言证据");
  }

  const profiles = repository.testDataProfiles.filter((item) => item.requirementSetId === requirementSet.id);
  for (const profile of profiles) {
    addCoverageItem(items, repository, requirementSet, systemId, explorationQuestions, evidence,
      "test-data", profile.id, plainText(profile.name), profile.sourceRefs, [profile.id],
      ["lookup", "verify", profile.cleanup === "delete-created" ? "cleanup" : "retain"], [],
      [profile.entityReference ?? profile.field], profile.constraints,
      "测试数据策略已存在，但仍需验证目标系统是否可查找或创建");
  }
  const dataNeedsWithoutProfiles = repository.testIntents
    .filter((intent) => intent.requirementSetId === requirementSet.id)
    .flatMap((intent) => [...(intent.consumesEntityRefs ?? []), ...(intent.producesEntityRefs ?? [])])
    .filter((reference) => !profiles.some((profile) => profile.entityReference === reference));
  if (dataNeedsWithoutProfiles.length > 0) {
    addCoverageItem(items, repository, requirementSet, systemId, explorationQuestions, evidence,
      "test-data", `${requirementSet.id}:missing-data`, "待准备的业务测试数据", requirementSet.sourceId ? [requirementSet.sourceId] : [], [],
      ["lookup", "create", "verify", "cleanup"], [], unique(dataNeedsWithoutProfiles), [],
      "需求引用了尚未配置的业务实体数据");
  }

  const relevantSystemItems = evidence.entries.filter((entry) => entry.kind !== "exploration");
  if (relevantSystemItems.length === 0) {
    items.push({
      id: coverageId("system-observation", systemId),
      dimension: "system-observation",
      sourceAssetId: systemId,
      title: "目标系统尚无可用于本需求绑定的探索证据",
      requirementRefs: [requirementSet.sourceId],
      analysisRefs: [],
      systemEvidenceRefs: evidence.refs,
      explorationTaskIds: explorationQuestions.map((task) => task.id),
      plannedActions: ["在批准范围内探索目标系统入口、页面、控件、状态和业务副作用"],
      roles: [],
      dataNeeds: [],
      expectedOutcomes: ["形成可追溯的页面、动作和状态证据"],
      status: "needs-exploration",
      reason: "当前只有探索记录或没有系统证据，不能把需求预期当作系统已覆盖"
    });
  } else {
    const completed = repository.systemExplorations.some((exploration) =>
      exploration.knowledgeProjectId === requirementSet.knowledgeProjectId &&
      exploration.systemId === systemId &&
      exploration.status === "completed"
    );
    items.push({
      id: coverageId("system-observation", systemId),
      dimension: "system-observation",
      sourceAssetId: systemId,
      title: "目标系统探索证据",
      requirementRefs: [requirementSet.sourceId],
      analysisRefs: [],
      systemEvidenceRefs: evidence.refs,
      explorationTaskIds: explorationQuestions.map((task) => task.id),
      plannedActions: ["复核与当前需求相关的页面、导航、控件、状态和接口证据"],
      roles: [],
      dataNeeds: [],
      expectedOutcomes: ["确认需求语义与系统实现的对应关系"],
      status: completed ? "covered" : "needs-exploration",
      reason: completed ? undefined : "系统已有部分证据，但尚未完成与当前需求的全量对账"
    });
  }

  const summary = coverageSummary(items);
  return {
    items,
    summary,
    systemEvidenceRefs: evidence.refs,
    fingerprint: hash(canonical({
      requirementSetId: requirementSet.id,
      requirementFingerprint: requirementSet.contentHash,
      items: items.map(({ id, status, ...item }) => ({ id, ...item, status })),
      evidence: evidence.entries.map(({ ref, kind, text }) => ({ ref, kind, text }))
    }))
  };
}

function addCoverageItem(
  items: OnboardingCoverageItem[],
  repository: InMemoryBrainCreatorRepository,
  requirementSet: RequirementSet,
  systemId: string,
  tasks: ExplorationTask[],
  evidence: { refs: string[]; entries: SystemEvidenceEntry[] },
  dimension: OnboardingCoverageDimension,
  sourceAssetId: string,
  title: string,
  requirementRefs: string[],
  analysisRefs: string[],
  plannedActions: string[],
  roles: string[],
  dataNeeds: string[],
  expectedOutcomes: string[],
  defaultReason: string,
  taskIds: string[] = []
) {
  const relatedTasks = taskIds.length
    ? tasks.filter((task) => taskIds.includes(task.id))
    : relatedExplorationTasks(tasks, dimension, sourceAssetId);
  const relatedEvidence = matchingEvidence(evidence.entries, `${title} ${plannedActions.join(" ")} ${dataNeeds.join(" ")}`);
  const taskEvidence = relatedTasks.flatMap((task) => task.resultSourceRefs);
  const evidenceRefs = unique([...relatedEvidence.map((entry) => entry.ref), ...taskEvidence]);
  const blocked = repository.gaps.some((gap) =>
    gap.status === "open" &&
    (gap.sourceId === requirementSet.id || requirementRefs.some((sourceRef) => gap.sourceId === sourceRef))
  );
  const needsData = dimension === "test-data" && dataNeeds.length > 0 &&
    !repository.testDataProfiles.some((profile) => profile.id === sourceAssetId);
  const pending = relatedTasks.some((task) => task.status === "pending");
  const hasEvidence = evidenceRefs.length > 0;
  const status: OnboardingCoverageStatus = blocked
    ? "blocked"
    : needsData
      ? "needs-data"
      : pending || !hasEvidence
        ? "needs-exploration"
        : "covered";
  items.push({
    id: coverageId(dimension, sourceAssetId),
    dimension,
    sourceAssetId,
    title,
    requirementRefs: unique(requirementRefs),
    analysisRefs: unique(analysisRefs),
    systemEvidenceRefs: evidenceRefs,
    explorationTaskIds: relatedTasks.map((task) => task.id),
    plannedActions: unique(plannedActions),
    roles: unique(roles),
    dataNeeds: unique(dataNeeds),
    expectedOutcomes: unique(expectedOutcomes),
    status,
    reason: status === "covered" ? undefined : blocked ? "存在未解决的阻塞 Gap" : needsData ? "需要先准备业务实体数据" : defaultReason
  });
}

function relatedExplorationTasks(
  tasks: ExplorationTask[],
  dimension: OnboardingCoverageDimension,
  sourceAssetId: string
) {
  if (dimension === "test-intent") {
    return tasks.filter((task) => task.testIntentId === sourceAssetId);
  }
  return tasks.filter((task) =>
    task.query.includes(sourceAssetId) ||
    task.sourceRefs.some((sourceRef) => sourceRef.includes(sourceAssetId))
  );
}

function systemEvidence(
  repository: InMemoryBrainCreatorRepository,
  knowledgeProjectId: string,
  requirementSetId: string,
  systemId: string
) {
  const entries: SystemEvidenceEntry[] = [];
  const add = (ref: string, kind: SystemEvidenceEntry["kind"], text: string) => {
    entries.push({ ref, kind, text: plainText(text) });
  };
  const explorations = repository.systemExplorations.filter((item) =>
    item.knowledgeProjectId === knowledgeProjectId && item.systemId === systemId
  );
  for (const exploration of explorations) {
    add(`system-exploration:${exploration.id}`, "exploration",
      `${exploration.startUrl} ${exploration.status} ${exploration.scenario?.name ?? ""}`);
    for (const pageModelId of exploration.pageModelIds) {
      const page = repository.pageModels.find((item) => item.id === pageModelId);
      if (!page) continue;
      add(`page-model:${page.id}`, "page", `${page.name} ${page.route}`);
      for (const locator of repository.locatorPoints.filter((item) => item.pageModelId === page.id)) {
        add(`locator:${locator.id}`, "locator", `${locator.name} ${locator.role} ${locator.text}`);
      }
      for (const probe of repository.probeResults.filter((item) => item.pageModelId === page.id)) {
        add(`probe:${probe.id}`, "probe", `${probe.type} ${probe.result} ${probe.issues.join(" ")}`);
      }
    }
    for (const edge of exploration.navigationEdges) {
      add(`navigation:${exploration.id}:${edge.fromUrl}->${edge.toUrl}`, "navigation",
        `${edge.text} ${edge.fromUrl} ${edge.toUrl}`);
    }
    for (const transition of exploration.interactionTransitions) {
      add(`interaction:${transition.id}`, "transition",
        `${transition.targetName} ${transition.targetRole} ${transition.action} ${transition.inputValue ?? ""} ${transition.visibleAdded.join(" ")} ${transition.visibleRemoved.join(" ")}`);
    }
  }
  for (const snapshot of repository.systemBrainSnapshots.filter((item) =>
    item.knowledgeProjectId === knowledgeProjectId && item.systemId === systemId
  )) {
    add(`system-brain-snapshot:${snapshot.id}`, "snapshot", `${snapshot.status} revision ${snapshot.revision}`);
    for (const asset of snapshot.assets) {
      add(`system-brain:${snapshot.id}:${asset.semanticId}`, "snapshot", `${asset.label} ${asset.content}`);
    }
  }
  for (const binding of repository.semanticBindings.filter((item) =>
    item.requirementSetId === requirementSetId && item.systemId === systemId
  )) {
    add(`semantic-binding:${binding.id}`, "binding", `${binding.type} ${binding.expectedSemanticId} ${binding.observedSemanticId ?? ""}`);
  }
  for (const decision of repository.pageBindingDecisions.filter((item) =>
    item.requirementSetId === requirementSetId && item.systemId === systemId
  )) {
    add(`page-binding:${decision.id}`, "binding", `${decision.pageModelId} ${decision.role ?? ""} ${decision.note}`);
  }
  for (const identity of repository.systemPageIdentities.filter((item) => item.systemId === systemId)) {
    add(`page-identity:${identity.id}`, "page", `${identity.canonicalRoute} ${identity.semanticRole} revision ${identity.revision}`);
  }
  for (const node of repository.knowledgeNodes.filter((item) =>
    item.knowledgeProjectId === knowledgeProjectId && item.systemId === systemId && item.origin === "observed"
  )) {
    add(`system-observation:${node.id}`, "observation", `${node.title} ${node.content}`);
  }
  const deduped = [...new Map(entries.map((entry) => [entry.ref, entry])).values()];
  return { refs: deduped.map((entry) => entry.ref), entries: deduped };
}

function matchingEvidence(entries: SystemEvidenceEntry[], text: string) {
  const tokens = searchableTokens(text);
  if (tokens.length === 0) return [];
  return entries
    .map((entry) => ({ entry, score: overlap(tokens, searchableTokens(entry.text)) }))
    .filter((item) => item.score > 0 && item.entry.kind !== "exploration")
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map((item) => item.entry);
}

function coverageSummary(items: OnboardingCoverageItem[]): OnboardingCoverageSummary {
  const summary: OnboardingCoverageSummary = {
    total: items.length,
    covered: items.filter((item) => item.status === "covered").length,
    needsExploration: items.filter((item) => item.status === "needs-exploration").length,
    needsData: items.filter((item) => item.status === "needs-data").length,
    blocked: items.filter((item) => item.status === "blocked").length,
    overallStatus: "covered",
    byDimension: {},
    requirementAssetCount: items.filter((item) => item.dimension !== "system-observation").length,
    systemEvidenceCount: unique(items.flatMap((item) => item.systemEvidenceRefs)).length,
    unresolvedCount: items.filter((item) => item.status !== "covered").length
  };
  for (const item of items) {
    const dimension = summary.byDimension[item.dimension] ?? {
      total: 0,
      covered: 0,
      needsExploration: 0,
      needsData: 0,
      blocked: 0
    };
    dimension.total += 1;
    if (item.status === "covered") dimension.covered += 1;
    if (item.status === "needs-exploration") dimension.needsExploration += 1;
    if (item.status === "needs-data") dimension.needsData += 1;
    if (item.status === "blocked") dimension.blocked += 1;
    summary.byDimension[item.dimension] = dimension;
  }
  summary.overallStatus = summary.blocked > 0
    ? "blocked"
    : summary.needsData > 0
      ? "needs-data"
      : summary.needsExploration > 0
        ? "needs-exploration"
        : "covered";
  return summary;
}

function explorationActions(
  questions: ExplorationQuestionDraft[],
  route: string,
  actorJourney: ActorJourneyConfig[]
) {
  const actions: Array<Omit<ExplorationPlanAction, "id">> = [];
  for (const question of questions) {
    const questionActions = question.actions?.length ? question.actions : [{
      name: actionName(question),
      role: question.role,
      write: question.write,
      sourceRefs: question.sourceRefs
    }];
    for (const action of questionActions) {
      actions.push({
        name: action.name,
        route,
        role: authorizedRole(action.role, actorJourney),
        write: action.write,
        sourceRefs: action.sourceRefs
      });
    }
  }
  const bySignature = new Map<string, Omit<ExplorationPlanAction, "id">>();
  for (const action of actions) {
    const key = `${action.name}\u0000${action.route}\u0000${action.role ?? ""}`;
    const previous = bySignature.get(key);
    if (!previous || (!previous.write && action.write)) bySignature.set(key, action);
  }
  return [...bySignature.values()];
}

function stableExplorationActions(
  previous: ExplorationPlanAction[],
  actions: Array<Omit<ExplorationPlanAction, "id">>
) {
  const previousIds = new Map(previous.map((action) => [
    `${action.name}\u0000${action.route}\u0000${action.role ?? ""}`,
    action.id
  ]));
  return actions.map((action) => ({
    ...action,
    id: previousIds.get(`${action.name}\u0000${action.route}\u0000${action.role ?? ""}`) ?? id("explorationAction")
  }));
}

function validateDraftActions(
  actions: Array<Omit<ExplorationPlanAction, "id">>,
  actorJourney: ActorJourneyConfig[]
) {
  if (actions.some((action) => action.write) && actorJourney.length === 0) {
    throw new Error("Stateful write exploration requires an authenticated actor journey");
  }
  if (actorJourney.length > 1 && actions.some((action) => action.write && !action.role)) {
    throw new Error("Multi-actor stateful exploration actions must name an authorized role");
  }
}

function explorationPlanFingerprint(plan: ExplorationPlan) {
  return hash({
    tasks: [...plan.explorationTaskIds].sort(),
    actorJourney: plan.actorJourney,
    allowedRoutes: [...plan.allowedRoutes].sort(),
    actions: plan.allowedActions.map(({ id: _id, ...action }) => action),
    forbiddenActions: [...plan.forbiddenActions].sort(),
    cleanupPolicy: plan.cleanupPolicy,
    maxWrites: plan.maxWrites,
    maxDurationMs: plan.maxDurationMs
  });
}

function requirementExplorationActions(questions: ExplorationQuestionDraft[]) {
  return questions.flatMap((question) =>
    (question.actions?.length ? question.actions : [{ name: actionName(question), sourceRefs: question.sourceRefs, role: question.role, write: question.write }])
      .map((action) => action.name)
  );
}

function coverageId(dimension: OnboardingCoverageDimension, sourceAssetId: string) {
  return `onboarding-coverage:${dimension}:${sourceAssetId}`;
}

function searchableTokens(value: string) {
  return unique((plainText(value).toLocaleLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9:_/-]{2,}/g) ?? [])
    .filter((token) => !["确认", "验证", "需要", "系统", "页面", "字段", "场景", "要求"].includes(token)));
}

function overlap(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

function plainText(value: string) {
  return value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function requirementExplorationQuestions(
  repository: InMemoryBrainCreatorRepository,
  requirementSetId: string
): ExplorationQuestionDraft[] {
  const intents = repository.testIntents.filter((item) => item.requirementSetId === requirementSetId);
  const fallbackIntent = intents[0];
  if (!fallbackIntent) return [];
  const forModel = (modelId: string, sourceRefs: string[]) =>
    intents.find((intent) => intent.processModelRefs?.includes(modelId)) ??
    intents.find((intent) => intersects(intent.requirementRefs, sourceRefs)) ??
    fallbackIntent;
  const questions: ExplorationQuestionDraft[] = [];
  for (const workflow of repository.workflowModels.filter((item) => item.requirementSetId === requirementSetId)) {
    const intent = forModel(workflow.id, workflow.sourceRefs);
    questions.push({
      modelId: workflow.id,
      testIntentId: intent.id,
      kind: "navigation-path",
      reason: `System evidence is required for workflow ${workflow.title}`,
      query: `Find the entry, role, preconditions, actions, branches, end state, and side effects for workflow: ${workflow.title}`,
      requestedEvidence: ["entry page", "role", "precondition", "action sequence", "end state", "side effects"],
      sourceRefs: workflow.sourceRefs,
      role: workflow.actors[0],
      write: workflow.transitions.some((transition) => Boolean(transition.trigger || transition.sideEffects?.length)),
      actions: workflow.transitions.map((transition) => ({
        name: transition.trigger?.trim() || `${transition.from} -> ${transition.to}`,
        role: transition.actor,
        write: true,
        sourceRefs: transition.sourceRefs.length ? transition.sourceRefs : workflow.sourceRefs
      }))
    });
  }
  for (const machine of repository.stateMachineModels.filter((item) => item.requirementSetId === requirementSetId)) {
    const intent = forModel(machine.id, machine.sourceRefs);
    questions.push({
      modelId: machine.id,
      testIntentId: intent.id,
      kind: "state-action",
      reason: `System evidence is required for state model ${machine.title}`,
      query: `Observe each legal, forbidden, or unknown state transition, its role, trigger, preconditions, and side effects for state model: ${machine.title}`,
      requestedEvidence: ["before state", "trigger", "role", "after state", "forbidden behavior", "side effects"],
      sourceRefs: machine.sourceRefs,
      role: machine.transitions.find((transition) => transition.actor)?.actor,
      write: machine.transitions.some((transition) => transition.validity !== "forbidden"),
      actions: machine.transitions.map((transition) => ({
        name: transition.trigger?.trim() || `${transition.from} -> ${transition.to}`,
        role: transition.actor,
        write: true,
        sourceRefs: transition.sourceRefs.length ? transition.sourceRefs : machine.sourceRefs
      }))
    });
  }
  for (const table of repository.decisionTableModels.filter((item) => item.requirementSetId === requirementSetId)) {
    const intent = forModel(table.id, table.sourceRefs);
    questions.push({
      modelId: table.id,
      testIntentId: intent.id,
      kind: "state-action",
      reason: `System evidence is required for decision table ${table.title}`,
      query: `Observe how the system evaluates each decision condition and expected action for decision table: ${table.title}`,
      requestedEvidence: ["condition values", "selected action", "actual outcome", "network or state side effect"],
      sourceRefs: table.sourceRefs,
      write: table.rules.some((rule) => rule.expectedActions.some(isPotentialWriteAction)),
      actions: table.rules.flatMap((rule) => rule.expectedActions.map((action) => ({
        name: action,
        write: isPotentialWriteAction(action),
        sourceRefs: rule.sourceRefs.length ? rule.sourceRefs : table.sourceRefs
      })))
    });
  }
  questions.push(...intents.map((intent) => ({
      testIntentId: intent.id,
      kind: "locator-evidence" as const,
      reason: `System binding evidence is required for TestIntent ${intent.title}`,
      query: `Bind the navigation, state action, controls, role, data, and assertion evidence for scenario: ${intent.title}`,
      requestedEvidence: ["entry page", "controls", "role", "test data", "observable outcome"],
      approvedEvidenceScope: [
        "page model",
        "navigation edge",
        "confirmed page binding",
        "state transition",
        "triggering control",
        "before and after state",
        "locator point",
        "action binding",
        "assertion evidence"
      ],
      sourceRefs: intent.requirementRefs,
      role: intent.actorJourney?.[0],
      write: false
    })));
  return questions;
}

function explorationTasksForPlan(
  repository: InMemoryBrainCreatorRepository,
  plan: ExplorationPlan
) {
  return plan.explorationTaskIds.map((taskId) => {
    const task = repository.explorationTasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Onboarding exploration task not found: ${taskId}`);
    return task;
  });
}

function baselineSnapshot(
  repository: InMemoryBrainCreatorRepository,
  requirementSet: RequirementSet
) {
  const groups = [
    repository.knowledgeNodes.filter((item) => item.requirementSetId === requirementSet.id),
    repository.businessObjectModels.filter((item) => item.requirementSetId === requirementSet.id),
    repository.workflowModels.filter((item) => item.requirementSetId === requirementSet.id),
    repository.stateMachineModels.filter((item) => item.requirementSetId === requirementSet.id),
    repository.decisionTableModels.filter((item) => item.requirementSetId === requirementSet.id),
    repository.testIntents.filter((item) => item.requirementSetId === requirementSet.id)
  ];
  const assets = groups.flat().sort((left, right) => left.id.localeCompare(right.id));
  return {
    assetIds: unique(assets.map((item) => item.id)),
    fingerprint: hash(canonical({
      requirementSet: {
        id: requirementSet.id,
        version: requirementSet.version,
        contentHash: requirementSet.contentHash,
        title: requirementSet.title,
        summary: requirementSet.summary
      },
      assets
    }))
  };
}

function unresolvedQuestions(repository: InMemoryBrainCreatorRepository, requirementSet: RequirementSet) {
  return unique([
    ...(requirementSet.evaluationGate?.actions
      .filter((action) => action.status !== "confirmed")
      .map((action) => action.message) ?? []),
    ...repository.gaps
      .filter((gap) =>
        gap.sourceId === requirementSet.id &&
        gap.status === "open" &&
        ["requirement-clarification", "requirement-conflict"].includes(gap.sourceType)
      )
      .map((gap) => gap.reason)
  ]);
}

function actionName(question: ExplorationQuestionDraft) {
  const prefix = question.kind === "navigation-path" ? "Explore workflow" :
    question.kind === "state-action" ? "Exercise requirement behavior" : "Inspect requirement scenario";
  return `${prefix}: ${question.modelId ?? question.testIntentId}`;
}

function authorizedRole(role: string | undefined, actorJourney: ActorJourneyConfig[]) {
  if (role) return role;
  return actorJourney.length === 1 ? actorJourney[0].role : undefined;
}

function isPotentialWriteAction(value: string) {
  return /\b(?:save|delete|remove|approve|reject|submit|publish|create|add|confirm|send|pay|upload|import|enable|disable)\b|保存|删除|移除|审批|通过|驳回|拒绝|提交|发布|创建|新建|新增|确认|发送|支付|上传|导入|启用|停用/i.test(value);
}

function intersects(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function sameStrings(left: string[], right: string[]) {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

function includesAll(available: string[], required: string[]) {
  const normalized = new Set(available.map((value) => value.trim().toLocaleLowerCase()));
  return required.every((value) => normalized.has(value.trim().toLocaleLowerCase()));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => ![
        "createdAt",
        "updatedAt",
        "generatedAt",
        "approvedAt",
        "confirmedAt",
        "resolvedAt",
        "supersededById",
        "status"
      ].includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)])
  );
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
