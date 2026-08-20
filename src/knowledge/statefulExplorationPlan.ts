import { createHash } from "node:crypto";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ActorJourneyConfig,
  ExplorationActionEvidence,
  ExplorationPlan,
  ExplorationPlanAction
} from "../domain/types.js";
import { id } from "../shared/id.js";
import { isAllowedExplorationUrl } from "./systemExplorer.js";

type ExplorationKnowledgePort = {
  confirmExecutableCaseTestData(executableCaseId: string): unknown;
  refreshSystemBrain(projectId: string, systemId: string): Promise<unknown>;
  resolveExplorationTask(input: {
    taskId: string;
    outcome: "resolved" | "failed" | "cancelled";
    evidenceRefs?: string[];
    failureReason?: string;
  }): unknown;
};

type CreateExplorationPlanInput = {
  explorationTaskIds: string[];
  actorJourney?: ActorJourneyConfig[];
  allowedRoutes?: string[];
  allowedActions?: Array<Omit<ExplorationPlanAction, "id">>;
  forbiddenActions?: string[];
  cleanupPolicy: ExplorationPlan["cleanupPolicy"];
  maxWrites?: number;
  maxDurationMs?: number;
};

type SubmitExplorationResultInput = {
  planId: string;
  status: "succeeded" | "failed";
  durationMs: number;
  actionEvidence: ExplorationActionEvidence[];
  evidenceRefs: string[];
  pageModelIds: string[];
  systemExplorationIds: string[];
  trainingSessionIds: string[];
  cleanupStatus: "completed" | "not-required" | "failed";
  error?: string;
};

const DEFAULT_FORBIDDEN_ACTIONS = [
  "delete",
  "remove",
  "drop",
  "publish",
  "reset",
  "删除",
  "移除",
  "发布",
  "重置"
];

export class StatefulExplorationPlanService {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly knowledge: ExplorationKnowledgePort
  ) {}

  create(input: CreateExplorationPlanInput) {
    const tasks = unique(input.explorationTaskIds).map((taskId) => {
      const task = this.repository.explorationTasks.find((item) => item.id === taskId);
      if (!task) throw new Error(`Exploration task not found: ${taskId}`);
      if (task.status !== "pending") throw new Error(`Exploration task is ${task.status}: ${taskId}`);
      return task;
    });
    if (tasks.length === 0) throw new Error("At least one pending exploration task is required");
    const owner = tasks[0];
    if (tasks.some((task) =>
      task.knowledgeProjectId !== owner.knowledgeProjectId ||
      task.requirementSetId !== owner.requirementSetId ||
      task.systemId !== owner.systemId
    )) {
      throw new Error("Exploration tasks must belong to one requirement and business system");
    }

    const allowedRoutes = unique(input.allowedRoutes ?? []);
    const allowedActions = (input.allowedActions ?? []).map((action) => ({
      ...action,
      id: id("explorationAction"),
      name: required(action.name, "Exploration action name"),
      route: required(action.route, "Exploration action route"),
      sourceRefs: sourceRefs(action.sourceRefs, "Exploration action")
    }));
    if (allowedRoutes.length === 0) throw new Error("Exploration plan requires allowed routes");
    if (allowedActions.length === 0) throw new Error("Exploration plan requires allowed actions");
    const maxWrites = input.maxWrites ?? 10;
    const maxDurationMs = input.maxDurationMs ?? 300_000;
    if (!Number.isInteger(maxWrites) || maxWrites < 0 || maxWrites > 20) {
      throw new Error("Exploration maxWrites must be an integer from 0 to 20");
    }
    if (maxWrites === 0 && allowedActions.some((action) => action.write)) {
      throw new Error("Exploration maxWrites must permit the authorized write actions");
    }
    if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1_000 || maxDurationMs > 900_000) {
      throw new Error("Exploration maxDurationMs must be between 1000 and 900000");
    }

    const actorJourney = input.actorJourney ?? [];
    if (allowedActions.some((action) => action.write) && actorJourney.length === 0) {
      throw new Error("Stateful write exploration requires an authenticated actor journey");
    }
    if (actorJourney.length > 1) {
      const actorRoles = actorJourney.map((actor) => actor.role?.trim());
      if (actorRoles.some((role) => !role) || new Set(actorRoles).size !== actorRoles.length) {
        throw new Error("Multi-actor stateful exploration requires distinct authorized roles");
      }
      if (allowedActions.some((action) => action.write && !action.role)) {
        throw new Error("Multi-actor stateful exploration actions must name an authorized role");
      }
    }
    const executableCaseIds = unique(tasks.flatMap((task) =>
      task.executableCaseId ? [task.executableCaseId] : []
    ));
    const idempotencyKey = hash({
      tasks: tasks.map((task) => task.id).sort(),
      actorJourney,
      allowedRoutes: [...allowedRoutes].sort(),
      actions: allowedActions.map(({ id: _id, ...action }) => action),
      cleanupPolicy: input.cleanupPolicy,
      maxWrites,
      maxDurationMs
    });
    const existing = this.repository.explorationPlans.find((plan) =>
      plan.idempotencyKey === idempotencyKey && !["completed", "blocked", "cancelled"].includes(plan.status)
    );
    if (existing) return existing;

    const now = timestamp();
    const plan: ExplorationPlan = {
      id: id("explorationPlan"),
      knowledgeProjectId: owner.knowledgeProjectId,
      requirementSetId: owner.requirementSetId,
      systemId: owner.systemId,
      explorationTaskIds: tasks.map((task) => task.id),
      executableCaseIds,
      actorJourney,
      allowedRoutes,
      allowedActions,
      forbiddenActions: unique([...DEFAULT_FORBIDDEN_ACTIONS, ...(input.forbiddenActions ?? [])]),
      testDataLeaseIds: [],
      cleanupPolicy: input.cleanupPolicy,
      maxWrites,
      maxDurationMs,
      status: "draft",
      actionEvidence: [],
      evidenceRefs: [],
      systemExplorationIds: [],
      pageModelIds: [],
      trainingSessionIds: [],
      gapIds: [],
      idempotencyKey,
      createdAt: now,
      updatedAt: now
    };
    this.repository.explorationPlans.push(plan);
    this.repository.persist();
    return plan;
  }

  cancel(input: { planId: string; note: string }) {
    const plan = this.get(input.planId);
    if (plan.status === "cancelled") return plan;
    if (plan.status !== "draft" && plan.status !== "approved") {
      throw new Error(`Exploration plan is ${plan.status}`);
    }
    const note = required(input.note, "Exploration cancellation note");
    const now = timestamp();
    plan.status = "cancelled";
    plan.approvalNote = note;
    plan.updatedAt = now;
    for (const taskId of plan.explorationTaskIds) {
      const task = this.repository.explorationTasks.find((item) => item.id === taskId);
      if (task?.status === "pending") {
        this.knowledge.resolveExplorationTask({ taskId, outcome: "cancelled" });
      }
    }
    this.repository.persist();
    return plan;
  }

  approve(input: { planId: string; note: string; approvedBy: string }) {
    const plan = this.get(input.planId);
    if (plan.status === "approved") return plan;
    if (plan.status !== "draft") throw new Error(`Exploration plan is ${plan.status}`);
    const system = this.repository.systemProfiles.find((item) => item.id === plan.systemId);
    if (!system) throw new Error("Business system not found");
    if (!isSafeExplorationEnvironment(system.environment)) {
      throw new Error("Stateful exploration is limited to a test or staging environment");
    }
    const allowedUrls = unique([system.baseUrl, ...system.urlAllowlist]);
    for (const route of [...plan.allowedRoutes, ...plan.allowedActions.map((action) => action.route)]) {
      if (!isAllowedExplorationUrl(route, allowedUrls)) {
        throw new Error(`Exploration route is outside the business system allowlist: ${route}`);
      }
    }
    for (const actor of plan.actorJourney) {
      const auth = this.repository.authProfiles.find((item) => item.id === actor.authProfileId);
      if (
        !auth ||
        auth.projectId !== plan.systemId ||
        auth.status !== "succeeded" ||
        auth.env.trim().toLocaleLowerCase() !== system.environment.trim().toLocaleLowerCase() ||
        (!auth.lastVerifiedAt && !auth.verificationEvidence)
      ) {
        throw new Error(`Exploration role requires verified authentication: ${actor.role ?? actor.authProfileId}`);
      }
      if (actor.role?.trim() && auth.role.trim() !== actor.role.trim()) {
        throw new Error(`Exploration role does not match AuthProfile role: ${actor.role}`);
      }
    }
    for (const action of plan.allowedActions) {
      if (matchesForbidden(action.name, plan.forbiddenActions)) {
        throw new Error(`Exploration action is forbidden: ${action.name}`);
      }
      if (action.role && !plan.actorJourney.some((actor) => actor.role === action.role)) {
        throw new Error(`Exploration action role is not authorized: ${action.role}`);
      }
    }
    const note = required(input.note, "Exploration approval note");
    const approvedBy = required(input.approvedBy, "Exploration approver");
    for (const caseId of plan.executableCaseIds) {
      const executableCase = this.repository.executableCases.find((item) => item.id === caseId);
      if (executableCase?.dataPlan?.requiresConfirmation && !executableCase.dataPlan.confirmedAt) {
        this.knowledge.confirmExecutableCaseTestData(caseId);
      }
    }
    const now = timestamp();
    plan.status = "approved";
    plan.approvalNote = note;
    plan.approvedBy = approvedBy;
    plan.approvedAt = now;
    plan.updatedAt = now;
    this.repository.persist();
    return plan;
  }

  start(planId: string) {
    const plan = this.get(planId);
    if (plan.status !== "approved" && plan.status !== "running") {
      throw new Error(`Exploration plan is ${plan.status}`);
    }
    const unresolvedCases = plan.executableCaseIds.filter((caseId) => {
      const executableCase = this.repository.executableCases.find((item) => item.id === caseId);
      return !executableCase || Boolean(
        executableCase.dataPlan && executableCase.dataPlan.verdict !== "ready"
      );
    });
    if (unresolvedCases.length > 0) {
      return {
        status: "needs-data" as const,
        plan,
        executableCaseIds: unresolvedCases,
        nextAction: "prepare-test-data" as const
      };
    }
    plan.testDataLeaseIds = unique(this.repository.testDataLeases
      .filter((lease) => plan.executableCaseIds.includes(lease.executableCaseId) && lease.status === "active")
      .map((lease) => lease.id));
    plan.status = "running";
    plan.updatedAt = timestamp();
    this.repository.persist();
    return {
      status: "needs-agent-execution" as const,
      plan,
      workPackage: {
        planId: plan.id,
        systemId: plan.systemId,
        allowedRoutes: plan.allowedRoutes,
        allowedActions: plan.allowedActions,
        forbiddenActions: plan.forbiddenActions,
        actorJourney: plan.actorJourney,
        knowledgeProjectId: plan.knowledgeProjectId,
        requirementSetId: plan.requirementSetId,
        explorationTaskIds: plan.explorationTaskIds,
        executableCaseIds: plan.executableCaseIds,
        requestedEvidence: plan.explorationTaskIds.flatMap((taskId) =>
          this.repository.explorationTasks.find((item) => item.id === taskId)?.requestedEvidence ?? []
        ),
        testDataLeaseIds: plan.testDataLeaseIds,
        cleanupPolicy: plan.cleanupPolicy,
        maxWrites: plan.maxWrites,
        maxDurationMs: plan.maxDurationMs,
        evidenceRequirements: ["before-state", "after-state", "screenshot", "source-refs"],
        submitAction: "submit-exploration-result" as const
      }
    };
  }

  async submit(input: SubmitExplorationResultInput) {
    const plan = this.get(input.planId);
    if (plan.status === "completed") return { plan, resumed: [] };
    if (plan.status !== "running") throw new Error(`Exploration plan is ${plan.status}`);
    if (input.durationMs < 0 || input.durationMs > plan.maxDurationMs) {
      throw new Error("Exploration result exceeded the authorized duration");
    }
    if (input.actionEvidence.length === 0) {
      throw new Error("Exploration result requires authorized action evidence");
    }
    const evidence = input.actionEvidence.map((item) => this.validateActionEvidence(plan, item));
    this.validateActorJourneyOrder(plan, evidence);
    const writeCount = evidence.filter(({ action }) => action.write).length;
    if (writeCount > plan.maxWrites) {
      throw new Error("Exploration result exceeded the authorized write count");
    }
    const evidenceRefs = sourceRefs(input.evidenceRefs, "Exploration result");
    this.validateAssets(plan, input);
    plan.actionEvidence = input.actionEvidence;
    plan.evidenceRefs = evidenceRefs;
    plan.pageModelIds = unique(input.pageModelIds);
    plan.systemExplorationIds = unique(input.systemExplorationIds);
    plan.trainingSessionIds = unique(input.trainingSessionIds);

    if (input.status === "failed") {
      return this.block(plan, input.error?.trim() || "Authorized stateful exploration failed", evidenceRefs);
    }
    const activeCreatedLeases = this.repository.testDataLeases.filter((lease) =>
      plan.executableCaseIds.includes(lease.executableCaseId) &&
      lease.decision === "create" &&
      lease.status === "active"
    );
    if (
      plan.cleanupPolicy !== "retain-with-label" &&
      (input.cleanupStatus !== "completed" || activeCreatedLeases.length > 0)
    ) {
      return this.block(plan, "Exploration test data cleanup is incomplete", evidenceRefs);
    }

    const resumed = [];
    try {
      await this.knowledge.refreshSystemBrain(plan.knowledgeProjectId, plan.systemId);
      for (const taskId of plan.explorationTaskIds) {
        const task = this.repository.explorationTasks.find((item) => item.id === taskId);
        if (task?.status === "pending") {
          resumed.push(this.knowledge.resolveExplorationTask({
            taskId,
            outcome: "resolved",
            evidenceRefs
          }));
        }
      }
    } catch (error) {
      return this.block(
        plan,
        `System Brain refresh or compilation resume failed: ${error instanceof Error ? error.message : String(error)}`,
        evidenceRefs
      );
    }
    const now = timestamp();
    plan.status = "completed";
    plan.completedAt = now;
    plan.updatedAt = now;
    this.repository.persist();
    return { plan, resumed };
  }

  get(planId: string) {
    const plan = this.repository.explorationPlans.find((item) => item.id === planId);
    if (!plan) throw new Error("Exploration plan not found");
    return plan;
  }

  list(input: { systemId?: string; requirementSetId?: string; status?: ExplorationPlan["status"] } = {}) {
    return this.repository.explorationPlans.filter((plan) =>
      (!input.systemId || plan.systemId === input.systemId) &&
      (!input.requirementSetId || plan.requirementSetId === input.requirementSetId) &&
      (!input.status || plan.status === input.status)
    );
  }

  private validateActionEvidence(plan: ExplorationPlan, evidence: ExplorationActionEvidence) {
    const action = plan.allowedActions.find((item) => item.id === evidence.actionId);
    if (!action) throw new Error(`Action is not authorized by the exploration plan: ${evidence.actionId}`);
    if (
      action.name !== evidence.action ||
      action.route !== evidence.route ||
      action.role !== evidence.role ||
      !plan.allowedRoutes.some((route) => isAllowedExplorationUrl(evidence.route, [route]))
    ) {
      throw new Error(`Action evidence does not match the authorized exploration plan: ${evidence.actionId}`);
    }
    sourceRefs(evidence.sourceRefs, "Exploration action evidence");
    return { action, evidence };
  }

  private validateAssets(plan: ExplorationPlan, input: SubmitExplorationResultInput) {
    for (const pageId of unique(input.pageModelIds)) {
      const page = this.repository.pageModels.find((item) => item.id === pageId);
      if (!page || page.projectId !== plan.systemId) throw new Error(`Page evidence is outside the exploration system: ${pageId}`);
    }
    for (const explorationId of unique(input.systemExplorationIds)) {
      const exploration = this.repository.systemExplorations.find((item) => item.id === explorationId);
      if (!exploration || exploration.systemId !== plan.systemId) throw new Error(`System exploration evidence is outside the exploration system: ${explorationId}`);
    }
    for (const sessionId of unique(input.trainingSessionIds)) {
      const session = this.repository.trainingSessions.find((item) => item.id === sessionId);
      if (!session || session.projectId !== plan.systemId) throw new Error(`Training evidence is outside the exploration system: ${sessionId}`);
    }
  }

  private validateActorJourneyOrder(
    plan: ExplorationPlan,
    evidence: Array<{ action: ExplorationPlanAction; evidence: ExplorationActionEvidence }>
  ) {
    if (plan.actorJourney.length < 2) return;
    const actorOrder = new Map(
      plan.actorJourney.map((actor, index) => [actor.role?.trim(), index])
    );
    let lastOrder = -1;
    for (const item of evidence) {
      const role = item.evidence.role?.trim();
      const order = role ? actorOrder.get(role) : undefined;
      if (order === undefined) {
        throw new Error("Exploration evidence role is not part of the authorized actor journey");
      }
      if (order < lastOrder) {
        throw new Error("Exploration evidence violates actor journey order");
      }
      lastOrder = order;
    }
  }

  private block(plan: ExplorationPlan, reason: string, evidenceRefs: string[]) {
    const now = timestamp();
    const gap = {
      id: id("gap"),
      projectId: plan.systemId,
      sourceType: "stateful-exploration",
      sourceId: plan.id,
      reason,
      severity: "high" as const,
      owner: "unassigned",
      status: "open" as const,
      createdAt: now,
      updatedAt: now
    };
    this.repository.gaps.push(gap);
    plan.status = "blocked";
    plan.evidenceRefs = evidenceRefs;
    plan.gapIds = unique([...plan.gapIds, gap.id]);
    plan.updatedAt = now;
    this.repository.persist();
    return { plan, gap, resumed: [] };
  }
}

function matchesForbidden(value: string, forbidden: string[]) {
  const normalized = value.toLocaleLowerCase();
  return forbidden.some((item) => normalized.includes(item.trim().toLocaleLowerCase()));
}

function isSafeExplorationEnvironment(environment: string) {
  return /^(?:test|testing|qa|staging|stage|uat|dev|development|sandbox|local|测试|预发|开发)$/i
    .test(environment.trim());
}

function sourceRefs(values: string[], label: string) {
  const refs = unique(values.map((value) => value.trim()).filter(Boolean));
  if (refs.length === 0) throw new Error(`${label} requires source evidence`);
  return refs;
}

function required(value: string, label: string) {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function timestamp() {
  return new Date().toISOString();
}
