import { createHash } from "node:crypto";
import type { OnboardingPlan } from "../brain/types.js";
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
  reused: boolean;
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
    const existing = this.repository.onboardingPlans.find(
      (plan) =>
        plan.requirementSetId === requirementSet.id &&
        plan.systemId === system.id
    );
    if (existing) {
      const explorationPlan = this.explorationPlans.get(existing.explorationPlanId);
      const explorationQuestions = explorationTasksForPlan(this.repository, explorationPlan);
      return {
        onboardingPlan: existing,
        explorationPlan,
        explorationQuestions,
        reused: true,
        baselineChanged:
          !sameStrings(existing.baselineAssetIds, baseline.assetIds) ||
          Boolean(existing.baselineFingerprint && existing.baselineFingerprint !== baseline.fingerprint)
      };
    }
    const questions = requirementExplorationQuestions(this.repository, requirementSet.id);
    if (questions.length === 0) {
      throw new Error("Requirement analysis must produce TestIntents before onboarding");
    }
    const explorationQuestions = questions.map((question) =>
      this.upsertExplorationTask(requirementSet, system.id, question, baseline.fingerprint)
    );
    const allowedRoutes = unique(input.allowedRoutes?.length ? input.allowedRoutes : [system.baseUrl]);
    const actorJourney = input.actorJourney ?? [];
    const allowedActions = input.allowedActions?.length
      ? input.allowedActions
      : questions.flatMap((question) => {
          const actions = question.actions?.length ? question.actions : [{
            name: actionName(question),
            role: question.role,
            write: question.write,
            sourceRefs: question.sourceRefs
          }];
          return actions.map((action) => ({
            ...action,
            route: allowedRoutes[0],
            role: authorizedRole(action.role, actorJourney)
          }));
        });
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
      requirementSummary: requirementSet.summary || requirementSet.title,
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
      status: "draft"
    };
    this.repository.onboardingPlans.push(onboardingPlan);
    this.repository.persist();
    return { onboardingPlan, explorationPlan, explorationQuestions, reused: false };
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
