import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutionFailureType,
  ActorJourneyConfig,
  ExecutionPlan,
  RequirementSuiteCaseOutcome,
  RequirementSuiteCaseRun,
  RequirementSuiteRun,
  StabilityPolicy,
  StabilitySchedule
} from "../domain/types.js";
import { id } from "../shared/id.js";
import { RunLedgerService } from "./runLedger.js";
import {
  reconcileRequirementCases,
  reconcileRequirementCoverage
} from "./requirementReconciliation.js";
import {
  claimStabilitySchedule,
  isStabilityScheduleDue,
  nextStabilitySchedule,
  releaseStabilityScheduleLease,
  renewStabilityScheduleLease
} from "./stabilityPolicy.js";

type CreateRequirementSuiteRunInput = {
  knowledgeProjectId: string;
  systemId: string;
  authProfileId?: string;
  operator?: string;
  provider?: string;
  sessionId?: string;
  actorJourney?: ActorJourneyConfig[];
  executionPlans?: ExecutionPlan[];
  cases?: Array<{
    executableCaseId: string;
    title: string;
    executionPlanId?: string;
  }>;
  continueOnBlocked: boolean;
  allowCreateTestData?: boolean;
  automaticTestData?: boolean;
  maxHealAttempts?: number;
  stabilityGroupId?: string;
  stabilityIteration?: number;
  stabilityTarget?: number;
  stabilityPolicy?: StabilityPolicy;
  requirementSetIds?: string[];
};

type CompleteRequirementSuiteCaseInput = RequirementSuiteCaseOutcome;

export class RequirementSuiteRunService {
  private readonly runLedger: RunLedgerService;

  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    runLedger?: RunLedgerService
  ) {
    this.runLedger = runLedger ?? new RunLedgerService(repository);
  }

  create(input: CreateRequirementSuiteRunInput): RequirementSuiteRun {
    const executionPlans = input.executionPlans ?? [];
    const cases =
      input.cases ??
      executionPlans.map((plan) => ({
        executableCaseId: plan.executableCaseId,
        title: plan.title,
        executionPlanId: plan.id
      }));
    if (cases.length === 0) {
      throw new Error("Requirement suite requires at least one executable case");
    }
    for (const plan of executionPlans) {
      if (
        plan.knowledgeProjectId !== input.knowledgeProjectId ||
        plan.systemId !== input.systemId
      ) {
        throw new Error("Execution plan belongs to another requirement suite");
      }
    }
    const executableCaseIds = cases.map((item) => item.executableCaseId);
    const executableCases = executableCaseIds.flatMap((caseId) => {
      const executableCase = this.repository.executableCases.find((item) => item.id === caseId);
      return executableCase ? [executableCase] : [];
    });
    const requirementSetIds = input.requirementSetIds && input.requirementSetIds.length > 0
      ? input.requirementSetIds
      : [
      ...new Set(executableCases.map((item) => item.requirementSetId))
    ];
    const knowledgeProject = this.repository.knowledgeProjects.find(
      (item) => item.id === input.knowledgeProjectId
    );
    const coverageSnapshot = knowledgeProject
      ? reconcileRequirementCoverage({
          knowledgeProject,
          systemId: input.systemId,
          requirementSets: this.repository.requirementSets,
          testIntents: this.repository.testIntents,
          cases: this.repository.executableCases,
          expectedRequirementSetIds: requirementSetIds
        })
      : undefined;
    const reconciliation = coverageSnapshot ?? reconcileRequirementCases({
      systemId: input.systemId,
      expectedRequirementSetIds: requirementSetIds,
      expectedCaseIds: executableCaseIds,
      cases: executableCases
    });
    const existing = this.repository.requirementSuiteRuns.find(
      (run) =>
        run.knowledgeProjectId === input.knowledgeProjectId &&
        run.systemId === input.systemId &&
        run.authProfileId === input.authProfileId &&
        !isTerminal(run.status) &&
        sameItems(
          run.caseRuns.map((item) => item.executableCaseId),
          executableCaseIds
        )
    );
    if (existing) return existing;

    const now = timestamp();
    const run: RequirementSuiteRun = {
      id: id("requirementSuiteRun"),
      knowledgeProjectId: input.knowledgeProjectId,
      systemId: input.systemId,
      authProfileId: input.authProfileId,
      operator: input.operator,
      provider: input.provider,
      sessionId: input.sessionId,
      actorJourney: input.actorJourney,
      status: "running",
      continueOnBlocked: input.continueOnBlocked,
      allowCreateTestData: Boolean(input.allowCreateTestData),
      automaticTestData: Boolean(input.automaticTestData),
      maxHealAttempts: input.maxHealAttempts,
      stabilityGroupId: input.stabilityGroupId,
      stabilityIteration: input.stabilityIteration,
      stabilityTarget: input.stabilityTarget,
      stabilityPolicy: input.stabilityPolicy,
      stabilitySchedule: stabilitySchedule(input.stabilityPolicy),
      requirementSetIds,
      reconciliation,
      ...(coverageSnapshot ? { coverageSnapshot } : {}),
      total: cases.length,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: cases.map((item, index) => ({
        executableCaseId: item.executableCaseId,
        executionPlanId: item.executionPlanId,
        title: item.title,
        order: index + 1,
        status: "queued",
        gapIds: [],
        attempts: []
      })),
      createdAt: now,
      updatedAt: now
    };
    this.repository.requirementSuiteRuns.push(run);
    this.repository.persist();
    this.record(run, {
      event: "suite-created",
      scope: "suite",
      stage: "suite",
      toStatus: run.status
    });
    return run;
  }

  get(runId: string): RequirementSuiteRun {
    const run = this.repository.requirementSuiteRuns.find(
      (item) => item.id === runId
    );
    if (!run) throw new Error("Requirement suite run not found");
    return run;
  }

  list(knowledgeProjectId: string): RequirementSuiteRun[] {
    return this.repository.requirementSuiteRuns.filter(
      (item) => item.knowledgeProjectId === knowledgeProjectId
    );
  }

  listDueStabilityRuns(
    knowledgeProjectId?: string,
    now = new Date()
  ): RequirementSuiteRun[] {
    return this.repository.requirementSuiteRuns.filter(
      (run) =>
        (!knowledgeProjectId || run.knowledgeProjectId === knowledgeProjectId) &&
        Boolean(run.stabilitySchedule && isStabilityScheduleDue(run.stabilitySchedule, now))
    );
  }

  claimScheduled(
    runId: string,
    input: { owner: string; leaseMs?: number },
    now = new Date()
  ): RequirementSuiteRun {
    const run = this.get(runId);
    if (!run.stabilitySchedule) {
      throw new Error("Requirement suite has no stability schedule");
    }
    run.stabilitySchedule = claimStabilitySchedule(
      run.stabilitySchedule,
      {
        owner: input.owner,
        leaseId: id("stabilityLease"),
        leaseMs: input.leaseMs ?? 300_000
      },
      now
    );
    run.updatedAt = now.toISOString();
    this.repository.persist();
    this.record(run, {
      event: "schedule-claimed",
      scope: "suite",
      stage: "suite",
      toStatus: run.status,
      message: `Stability schedule claimed by ${run.stabilitySchedule.leaseOwner}.`,
      references: {
        leaseId: run.stabilitySchedule.leaseId,
        leaseExpiresAt: run.stabilitySchedule.leaseExpiresAt
      }
    });
    return run;
  }

  renewScheduledLease(
    runId: string,
    input: { owner: string; leaseMs?: number },
    now = new Date()
  ): RequirementSuiteRun {
    const run = this.get(runId);
    if (!run.stabilitySchedule) {
      throw new Error("Requirement suite has no stability schedule");
    }
    run.stabilitySchedule = renewStabilityScheduleLease(
      run.stabilitySchedule,
      { owner: input.owner, leaseMs: input.leaseMs ?? 300_000 },
      now
    );
    run.updatedAt = now.toISOString();
    this.repository.persist();
    return run;
  }

  releaseScheduledLease(
    runId: string,
    input: { owner: string; nextRunAt?: string; lastError?: string },
    now = new Date()
  ): RequirementSuiteRun {
    const run = this.get(runId);
    if (!run.stabilitySchedule) {
      throw new Error("Requirement suite has no stability schedule");
    }
    run.stabilitySchedule = releaseStabilityScheduleLease(
      run.stabilitySchedule,
      input,
      now
    );
    run.updatedAt = now.toISOString();
    this.repository.persist();
    return run;
  }

  reconcile(runId: string) {
    const run = this.get(runId);
    const cases = run.caseRuns.flatMap((caseRun) => {
      const executableCase = this.repository.executableCases.find(
        (item) => item.id === caseRun.executableCaseId
      );
      return executableCase ? [executableCase] : [];
    });
    run.reconciliation = reconcileRequirementCases({
      systemId: run.systemId,
      expectedRequirementSetIds: run.requirementSetIds,
      expectedCaseIds: run.caseRuns.map((item) => item.executableCaseId),
      cases
    });
    const knowledgeProject = this.repository.knowledgeProjects.find(
      (item) => item.id === run.knowledgeProjectId
    );
    if (knowledgeProject) {
      run.coverageSnapshot = reconcileRequirementCoverage({
        knowledgeProject,
        systemId: run.systemId,
        requirementSets: this.repository.requirementSets,
        testIntents: this.repository.testIntents,
        cases: this.repository.executableCases,
        expectedRequirementSetIds: run.requirementSetIds
      });
      run.reconciliation = run.coverageSnapshot;
    }
    run.updatedAt = timestamp();
    this.repository.persist();
    return run.reconciliation;
  }

  authorizeTestDataCreation(runId: string): RequirementSuiteRun {
    const run = this.get(runId);
    if (!run.allowCreateTestData) {
      run.allowCreateTestData = true;
      run.updatedAt = timestamp();
      this.repository.persist();
    }
    return run;
  }

  beginNext(runId: string): {
    run: RequirementSuiteRun;
    caseRun?: RequirementSuiteCaseRun;
  } {
    const run = this.get(runId);
    const active = run.caseRuns.find(
      (item) =>
        item.status === "running" ||
        item.status === "waiting-for-test-data" ||
        item.status === "waiting-for-agent"
    );
    if (active) return { run, caseRun: active };
    if (
      run.status === "blocked" ||
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "cancelled"
    ) {
      return { run };
    }
    if (
      run.stabilitySchedule?.nextRunAt &&
      Date.parse(run.stabilitySchedule.nextRunAt) > Date.now()
    ) {
      return { run };
    }
    const next = run.caseRuns.find((item) => item.status === "queued");
    if (!next) {
      this.finish(run);
      return { run };
    }
    const now = timestamp();
    next.status = "running";
    next.startedAt ??= now;
    run.status = "running";
    run.currentExecutableCaseId = next.executableCaseId;
    run.updatedAt = now;
    this.repository.persist();
    this.record(run, {
      executableCaseId: next.executableCaseId,
      event: "case-started",
      scope: "case",
      stage: "suite",
      fromStatus: "queued",
      toStatus: next.status
    });
    return { run, caseRun: next };
  }

  markWaiting(
    runId: string,
    executableCaseId: string,
    input: {
      testCaseId: string;
      agentTaskId: string;
      executionEvidenceId: string;
    }
  ): RequirementSuiteRun {
    const run = this.get(runId);
    const caseRun = this.currentCase(run, executableCaseId);
    caseRun.status = "waiting-for-agent";
    caseRun.testCaseId = input.testCaseId;
    caseRun.agentTaskId = input.agentTaskId;
    caseRun.executionEvidenceId = input.executionEvidenceId;
    run.status = "waiting-for-agent";
    run.currentExecutableCaseId = executableCaseId;
    run.updatedAt = timestamp();
    this.repository.persist();
    this.record(run, {
      executableCaseId,
      event: "agent-task-requested",
      scope: "case",
      stage: "generator",
      fromStatus: "running",
      toStatus: caseRun.status,
      references: {
        agentTaskId: input.agentTaskId,
        executionEvidenceId: input.executionEvidenceId
      }
    });
    return run;
  }

  markWaitingForTestData(
    runId: string,
    executableCaseId: string,
    input: {
      taskId: string;
      phase: "prepare" | "cleanup";
      pendingOutcome?: RequirementSuiteCaseOutcome;
    }
  ): RequirementSuiteRun {
    const run = this.get(runId);
    const caseRun = this.currentCase(run, executableCaseId);
    caseRun.status = "waiting-for-test-data";
    caseRun.testDataTaskId = input.taskId;
    caseRun.testDataPhase = input.phase;
    caseRun.pendingOutcome = input.pendingOutcome;
    run.status = "waiting-for-test-data";
    run.currentExecutableCaseId = executableCaseId;
    run.updatedAt = timestamp();
    this.repository.persist();
    this.record(run, {
      executableCaseId,
      event: "test-data-task-requested",
      scope: "case",
      stage:
        input.phase === "cleanup"
          ? "test-data-cleanup"
          : "test-data-prepare",
      fromStatus: "running",
      toStatus: caseRun.status,
      references: { testDataTaskId: input.taskId }
    });
    return run;
  }

  completeTestDataTask(
    runId: string,
    executableCaseId: string
  ): RequirementSuiteRun {
    const run = this.get(runId);
    const caseRun = this.currentCase(run, executableCaseId);
    if (caseRun.status !== "waiting-for-test-data") {
      throw new Error("Requirement suite case is not waiting for test data");
    }
    const pendingOutcome = caseRun.pendingOutcome;
    const phase = caseRun.testDataPhase;
    const testDataTaskId = caseRun.testDataTaskId;
    caseRun.testDataTaskId = undefined;
    caseRun.testDataPhase = undefined;
    caseRun.pendingOutcome = undefined;
    this.record(run, {
      executableCaseId,
      event: "test-data-task-completed",
      scope: "case",
      stage:
        phase === "cleanup"
          ? "test-data-cleanup"
          : "test-data-prepare",
      fromStatus: "waiting-for-test-data",
      toStatus: pendingOutcome?.status ?? "running",
      references: { testDataTaskId }
    });
    if (pendingOutcome) {
      this.applyOutcome(run, caseRun, pendingOutcome);
    } else {
      caseRun.status = "running";
      run.status = "running";
      run.currentExecutableCaseId = executableCaseId;
      run.updatedAt = timestamp();
      this.repository.persist();
    }
    return run;
  }

  failTestDataTask(
    runId: string,
    executableCaseId: string,
    input: { gapIds: string[]; error: string }
  ): RequirementSuiteRun {
    const run = this.get(runId);
    const caseRun = this.currentCase(run, executableCaseId);
    if (caseRun.status !== "waiting-for-test-data") {
      throw new Error("Requirement suite case is not waiting for test data");
    }
    caseRun.status = "blocked";
    caseRun.gapIds = [...new Set([...caseRun.gapIds, ...input.gapIds])];
    caseRun.error = input.error;
    caseRun.completedAt = timestamp();
    run.status = "blocked";
    run.currentExecutableCaseId = executableCaseId;
    run.updatedAt = timestamp();
    this.recount(run);
    this.repository.persist();
    this.record(run, {
      executableCaseId,
      event: "test-data-task-failed",
      scope: "case",
      stage:
        caseRun.testDataPhase === "cleanup"
          ? "test-data-cleanup"
          : "test-data-prepare",
      fromStatus: "waiting-for-test-data",
      toStatus: caseRun.status,
      outcome: "blocked",
      failureType: "test_data_failure",
      message:
        caseRun.testDataPhase === "cleanup"
          ? "Test data cleanup failed"
          : "Test data preparation failed",
      references: {
        testDataTaskId: caseRun.testDataTaskId,
        gapIds: input.gapIds
      }
    });
    return run;
  }

  bindExecutionPlan(
    runId: string,
    executableCaseId: string,
    executionPlanId: string
  ): RequirementSuiteRun {
    const run = this.get(runId);
    const caseRun = this.currentCase(run, executableCaseId);
    caseRun.executionPlanId = executionPlanId;
    run.updatedAt = timestamp();
    this.repository.persist();
    this.record(run, {
      executableCaseId,
      event: "execution-plan-frozen",
      scope: "case",
      stage: "preflight",
      toStatus: caseRun.status,
      references: { executionPlanId }
    });
    return run;
  }

  enableAutomaticTestData(runId: string): RequirementSuiteRun {
    const run = this.get(runId);
    if (!run.automaticTestData) {
      run.automaticTestData = true;
      run.updatedAt = timestamp();
      this.repository.persist();
    }
    return run;
  }

  recordActorJourneyEvidence(
    runId: string,
    executableCaseId: string,
    evidencePath: string
  ) {
    const run = this.get(runId);
    const caseRun = this.caseById(run, executableCaseId);
    for (const actor of run.actorJourney ?? []) {
      this.record(run, {
        executableCaseId,
        event: "role-switched",
        scope: "case",
        stage: "execution",
        toStatus: caseRun.status,
        currentStep: actor.afterStepId,
        message: `Observed actor role ${actor.role}; evidence=${evidencePath}`
      });
    }
    return run;
  }

  completeCase(
    runId: string,
    executableCaseId: string,
    input: CompleteRequirementSuiteCaseInput
  ): RequirementSuiteRun {
    const run = this.get(runId);
    const caseRun = this.currentCase(run, executableCaseId);
    this.applyOutcome(run, caseRun, input);
    return run;
  }

  resume(
    runId: string,
    input: { continueOnBlocked: boolean }
  ): RequirementSuiteRun {
    const run = this.get(runId);
    if (run.status !== "blocked") return run;
    if (!input.continueOnBlocked) {
      throw new Error("Blocked requirement suite requires continueOnBlocked");
    }
    const blockedDataCase = run.caseRuns.find(
      (item) => item.status === "blocked" && Boolean(item.testDataPhase)
    );
    if (blockedDataCase) {
      blockedDataCase.status = "running";
      blockedDataCase.testDataTaskId = undefined;
      blockedDataCase.completedAt = undefined;
      run.continueOnBlocked = true;
      run.status = "running";
      run.currentExecutableCaseId = blockedDataCase.executableCaseId;
      run.updatedAt = timestamp();
      this.recount(run);
      this.repository.persist();
      this.record(run, {
        executableCaseId: blockedDataCase.executableCaseId,
        event: "suite-resumed",
        scope: "suite",
        stage:
          blockedDataCase.testDataPhase === "cleanup"
            ? "test-data-cleanup"
            : "test-data-prepare",
        fromStatus: "blocked",
        toStatus: run.status
      });
      return run;
    }
    if (!run.caseRuns.some((item) => item.status === "queued")) return run;
    run.continueOnBlocked = true;
    run.status = "running";
    run.currentExecutableCaseId = undefined;
    run.updatedAt = timestamp();
    this.repository.persist();
    this.record(run, {
      event: "suite-resumed",
      scope: "suite",
      stage: "suite",
      fromStatus: "blocked",
      toStatus: run.status
    });
    return run;
  }

  cancel(runId: string): RequirementSuiteRun {
    const run = this.get(runId);
    if (run.status === "cancelled") return run;
    if (run.status === "completed" || run.status === "failed") {
      throw new Error("Only unfinished requirement suites can be cancelled");
    }
    const now = timestamp();
    for (const caseRun of run.caseRuns) {
      if (caseRun.status === "blocked") {
        this.archiveAttempt(caseRun, now);
      }
      if (
        caseRun.status === "queued" ||
        caseRun.status === "running" ||
        caseRun.status === "waiting-for-test-data" ||
        caseRun.status === "waiting-for-agent" ||
        caseRun.status === "blocked"
      ) {
        caseRun.status = "cancelled";
        caseRun.completedAt = now;
      }
    }
    for (const task of this.repository.agentTasks) {
      if (
        task.status === "pending" &&
        task.chainContext?.requirementSuiteRunId === run.id
      ) {
        task.status = "cancelled";
        task.updatedAt = now;
      }
    }
    for (const task of this.repository.testDataTasks) {
      if (
        task.status === "pending" &&
        run.caseRuns.some((caseRun) => caseRun.testDataTaskId === task.id)
      ) {
        task.status = "cancelled";
        task.updatedAt = now;
      }
    }
    for (const evidence of this.repository.executionEvidence) {
      if (
        evidence.status === "running" &&
        run.caseRuns.some(
          (caseRun) => caseRun.executionEvidenceId === evidence.id
        )
      ) {
        evidence.status = "blocked";
        evidence.actualResult = "Requirement suite cancelled by user";
        evidence.completedAt = now;
      }
    }
    run.status = "cancelled";
    run.currentExecutableCaseId = undefined;
    run.completedAt = now;
    run.updatedAt = now;
    this.recount(run);
    this.repository.persist();
    this.record(run, {
      event: "suite-cancelled",
      scope: "suite",
      stage: "suite",
      toStatus: run.status,
      outcome: "cancelled",
      message: "Requirement suite cancelled by user"
    });
    return run;
  }

  retry(
    runId: string,
    executableCaseId: string
  ): RequirementSuiteRun {
    const run = this.get(runId);
    const caseRun = this.caseById(run, executableCaseId);
    if (caseRun.status !== "failed" && caseRun.status !== "blocked") {
      throw new Error(
        "Only failed or blocked requirement suite cases can be retried"
      );
    }
    if (caseRun.testDataPhase) {
      const phase = caseRun.testDataPhase;
      const previousTaskId = caseRun.testDataTaskId;
      const resumed = this.resume(runId, { continueOnBlocked: true });
      this.record(resumed, {
        executableCaseId,
        event: "case-retried",
        scope: "case",
        stage:
          phase === "cleanup"
            ? "test-data-cleanup"
            : "test-data-prepare",
        fromStatus: "blocked",
        toStatus: "running",
        references: { testDataTaskId: previousTaskId }
      });
      return resumed;
    }
    this.archiveAttempt(caseRun);
    caseRun.status = "queued";
    caseRun.executionPlanId = undefined;
    caseRun.testDataTaskId = undefined;
    caseRun.testDataPhase = undefined;
    caseRun.pendingOutcome = undefined;
    caseRun.testCaseId = undefined;
    caseRun.agentTaskId = undefined;
    caseRun.executionEvidenceId = undefined;
    caseRun.chainRunId = undefined;
    caseRun.diagnosisId = undefined;
    caseRun.bugReportId = undefined;
    caseRun.gapIds = [];
    caseRun.error = undefined;
    caseRun.startedAt = undefined;
    caseRun.completedAt = undefined;
    run.status = "running";
    run.currentExecutableCaseId = undefined;
    run.completedAt = undefined;
    run.updatedAt = timestamp();
    this.recount(run);
    this.repository.persist();
    this.record(run, {
      executableCaseId,
      event: "case-retried",
      scope: "case",
      stage: "suite",
      fromStatus: caseRun.attempts.at(-1)?.status,
      toStatus: caseRun.status
    });
    return run;
  }

  skip(
    runId: string,
    executableCaseId: string
  ): RequirementSuiteRun {
    const run = this.get(runId);
    const caseRun = this.caseById(run, executableCaseId);
    if (caseRun.status !== "blocked") {
      throw new Error("Only blocked requirement suite cases can be skipped");
    }
    const cleanupDue = this.repository.testDataLeases.some(
      (lease) =>
        lease.executableCaseId === executableCaseId &&
        lease.decision === "create" &&
        lease.cleanup !== "none" &&
        (lease.status === "active" || lease.status === "cleanup-failed")
    );
    if (cleanupDue) {
      throw new Error(
        "Created test data must be cleaned up before skipping this case"
      );
    }
    const now = timestamp();
    this.archiveAttempt(caseRun, now);
    caseRun.status = "skipped";
    caseRun.testDataTaskId = undefined;
    caseRun.testDataPhase = undefined;
    caseRun.pendingOutcome = undefined;
    caseRun.completedAt = now;
    run.currentExecutableCaseId = undefined;
    run.completedAt = undefined;
    this.recount(run);
    this.record(run, {
      executableCaseId,
      event: "case-skipped",
      scope: "case",
      stage: "suite",
      fromStatus: "blocked",
      toStatus: caseRun.status,
      outcome: "skipped",
      references: {
        gapIds: caseRun.attempts.at(-1)?.gapIds
      }
    });
    if (run.caseRuns.some((item) => item.status === "queued")) {
      run.status = "running";
      run.updatedAt = now;
      this.repository.persist();
    } else {
      this.finish(run, now);
    }
    return run;
  }

  private currentCase(
    run: RequirementSuiteRun,
    executableCaseId: string
  ): RequirementSuiteCaseRun {
    const caseRun = run.caseRuns.find(
      (item) => item.executableCaseId === executableCaseId
    );
    if (!caseRun) {
      throw new Error("Executable case is not part of the requirement suite");
    }
    if (
      caseRun.status !== "running" &&
      caseRun.status !== "waiting-for-test-data" &&
      caseRun.status !== "waiting-for-agent"
    ) {
      throw new Error("Requirement suite case is not active");
    }
    return caseRun;
  }

  private caseById(
    run: RequirementSuiteRun,
    executableCaseId: string
  ): RequirementSuiteCaseRun {
    const caseRun = run.caseRuns.find(
      (item) => item.executableCaseId === executableCaseId
    );
    if (!caseRun) {
      throw new Error("Executable case is not part of the requirement suite");
    }
    return caseRun;
  }

  private archiveAttempt(
    caseRun: RequirementSuiteCaseRun,
    archivedAt = timestamp()
  ) {
    if (caseRun.status !== "failed" && caseRun.status !== "blocked") {
      return;
    }
    caseRun.attempts.push({
      status: caseRun.status,
      executionPlanId: caseRun.executionPlanId,
      testCaseId: caseRun.testCaseId,
      agentTaskId: caseRun.agentTaskId,
      executionEvidenceId: caseRun.executionEvidenceId,
      chainRunId: caseRun.chainRunId,
      diagnosisId: caseRun.diagnosisId,
      bugReportId: caseRun.bugReportId,
      gapIds: [...caseRun.gapIds],
      error: caseRun.error,
      startedAt: caseRun.startedAt,
      completedAt: caseRun.completedAt,
      archivedAt
    });
  }

  private applyOutcome(
    run: RequirementSuiteRun,
    caseRun: RequirementSuiteCaseRun,
    input: RequirementSuiteCaseOutcome
  ) {
    const now = timestamp();
    caseRun.status = input.status;
    caseRun.chainRunId = input.chainRunId;
    caseRun.diagnosisId = input.diagnosisId;
    caseRun.bugReportId = input.bugReportId;
    caseRun.gapIds = [...new Set([...caseRun.gapIds, ...input.gapIds])];
    caseRun.error = input.error;
    caseRun.completedAt = now;
    caseRun.testDataTaskId = undefined;
    caseRun.testDataPhase = undefined;
    caseRun.pendingOutcome = undefined;
    run.currentExecutableCaseId = undefined;
    this.recount(run);
    if (input.diagnosisId) {
      this.record(run, {
        executableCaseId: caseRun.executableCaseId,
        event: "failure-diagnosed",
        scope: "case",
        stage: "execution",
        fromStatus: caseRun.agentTaskId ? "waiting-for-agent" : "running",
        toStatus: caseRun.status,
        outcome: input.status,
        failureType: input.failureType,
        message: "Terminal execution evidence was classified",
        references: {
          executionEvidenceId: caseRun.executionEvidenceId,
          chainRunId: input.chainRunId,
          diagnosisId: input.diagnosisId
        }
      });
    }
    this.record(run, {
      executableCaseId: caseRun.executableCaseId,
      event: "case-completed",
      scope: "case",
      stage: "execution",
      fromStatus:
        caseRun.agentTaskId
          ? "waiting-for-agent"
          : "running",
      toStatus: caseRun.status,
      outcome: input.status,
      failureType:
        input.failureType ?? defaultFailureType(input.status),
      message:
        input.status === "passed"
          ? undefined
          : "Requirement suite case did not complete successfully",
      references: {
        executionPlanId: caseRun.executionPlanId,
        agentTaskId: caseRun.agentTaskId,
        executionEvidenceId: caseRun.executionEvidenceId,
        chainRunId: input.chainRunId,
        diagnosisId: input.diagnosisId,
        bugReportId: input.bugReportId,
        gapIds: input.gapIds
      }
    });
    const queued = run.caseRuns.some((item) => item.status === "queued");
    if (input.status === "blocked" && !run.continueOnBlocked) {
      run.status = "blocked";
    } else if (queued) {
      run.status = "running";
    } else {
      this.finish(run, now);
    }
    run.updatedAt = now;
    this.repository.persist();
  }

  private record(
    run: RequirementSuiteRun,
    input: Omit<
      Parameters<RunLedgerService["append"]>[0],
      "knowledgeProjectId" | "systemId" | "requirementSuiteRunId"
    >
  ) {
    this.runLedger.append({
      knowledgeProjectId: run.knowledgeProjectId,
      systemId: run.systemId,
      requirementSuiteRunId: run.id,
      operator: run.operator,
      provider: run.provider,
      sessionId: run.sessionId,
      ...input
    });
  }

  private recount(run: RequirementSuiteRun) {
    run.total = run.caseRuns.length;
    run.passed = run.caseRuns.filter((item) => item.status === "passed").length;
    run.failed = run.caseRuns.filter((item) => item.status === "failed").length;
    run.blocked = run.caseRuns.filter(
      (item) => item.status === "blocked"
    ).length;
    run.skipped = run.caseRuns.filter(
      (item) => item.status === "skipped"
    ).length;
    run.cancelled = run.caseRuns.filter(
      (item) => item.status === "cancelled"
    ).length;
  }

  private finish(run: RequirementSuiteRun, now = timestamp()) {
    this.recount(run);
    run.status =
      run.blocked > 0
        ? "blocked"
        : run.failed > 0
          ? "failed"
          : "completed";
    run.currentExecutableCaseId = undefined;
    run.completedAt = now;
    if (run.stabilitySchedule) {
      run.stabilitySchedule = {
        ...run.stabilitySchedule,
        status: "completed",
        leaseId: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined
      };
    }
    run.updatedAt = now;
    this.repository.persist();
    this.record(run, {
      event: "suite-completed",
      scope: "suite",
      stage: "suite",
      toStatus: run.status,
      outcome:
        run.status === "completed"
          ? "passed"
          : run.status === "failed"
            ? "failed"
            : "blocked"
    });
    if (
      (run.status === "completed" || run.status === "failed") &&
      run.stabilityTarget &&
      (run.stabilityIteration ?? 1) < run.stabilityTarget
    ) {
      const next = this.createStabilityRun(run);
      run.stabilityNextRunId = next.id;
      run.updatedAt = timestamp();
      this.repository.persist();
    }
  }

  private createStabilityRun(previous: RequirementSuiteRun): RequirementSuiteRun {
    const nextIteration = (previous.stabilityIteration ?? 1) + 1;
    const next: RequirementSuiteRun = {
      id: id("requirementSuiteRun"),
      knowledgeProjectId: previous.knowledgeProjectId,
      systemId: previous.systemId,
      authProfileId: previous.authProfileId,
      operator: previous.operator,
      provider: previous.provider,
      sessionId: previous.sessionId,
      actorJourney: previous.actorJourney,
      status: "running",
      continueOnBlocked: previous.continueOnBlocked,
      allowCreateTestData: previous.allowCreateTestData,
      automaticTestData: previous.automaticTestData,
      maxHealAttempts: previous.maxHealAttempts,
      stabilityGroupId: previous.stabilityGroupId,
      stabilityIteration: nextIteration,
      stabilityTarget: previous.stabilityTarget,
      stabilityPolicy: previous.stabilityPolicy,
      stabilitySchedule: previous.stabilityPolicy
        ? nextStabilitySchedule(
            { status: "active", attemptCount: nextIteration },
            previous.stabilityPolicy,
            new Date()
          )
        : undefined,
      requirementSetIds: previous.requirementSetIds,
      reconciliation: previous.reconciliation,
      total: previous.caseRuns.length,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: previous.caseRuns.map((caseRun) => ({
        executableCaseId: caseRun.executableCaseId,
        executionPlanId: caseRun.executionPlanId,
        title: caseRun.title,
        order: caseRun.order,
        status: "queued",
        gapIds: [],
        attempts: []
      })),
      createdAt: timestamp(),
      updatedAt: timestamp()
    };
    this.repository.requirementSuiteRuns.push(next);
    this.repository.persist();
    this.record(next, {
      event: "suite-created",
      scope: "suite",
      stage: "suite",
      toStatus: next.status,
      message: `Stability iteration ${nextIteration}/${next.stabilityTarget}`
    });
    return next;
  }
}

function defaultFailureType(
  status: RequirementSuiteCaseOutcome["status"]
): ExecutionFailureType | undefined {
  if (status === "failed") return "assertion_failure";
  if (status === "blocked") return "unknown_failure";
  return undefined;
}

function sameItems(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function isTerminal(status: RequirementSuiteRun["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function timestamp() {
  return new Date().toISOString();
}

function stabilitySchedule(policy?: StabilityPolicy): StabilitySchedule | undefined {
  if (!policy) return undefined;
  return { status: "active", attemptCount: 1 };
}
