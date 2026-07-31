import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutionPlan,
  RequirementSuiteCaseOutcome,
  RequirementSuiteCaseRun,
  RequirementSuiteRun
} from "../domain/types.js";
import { id } from "../shared/id.js";

type CreateRequirementSuiteRunInput = {
  knowledgeProjectId: string;
  systemId: string;
  authProfileId?: string;
  executionPlans?: ExecutionPlan[];
  cases?: Array<{
    executableCaseId: string;
    title: string;
    executionPlanId?: string;
  }>;
  continueOnBlocked: boolean;
  allowCreateTestData?: boolean;
  maxHealAttempts?: number;
};

type CompleteRequirementSuiteCaseInput = RequirementSuiteCaseOutcome;

export class RequirementSuiteRunService {
  constructor(private readonly repository: InMemoryBrainCreatorRepository) {}

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
      status: "running",
      continueOnBlocked: input.continueOnBlocked,
      allowCreateTestData: Boolean(input.allowCreateTestData),
      maxHealAttempts: input.maxHealAttempts,
      total: cases.length,
      passed: 0,
      failed: 0,
      blocked: 0,
      caseRuns: cases.map((item, index) => ({
        executableCaseId: item.executableCaseId,
        executionPlanId: item.executionPlanId,
        title: item.title,
        order: index + 1,
        status: "queued",
        gapIds: []
      })),
      createdAt: now,
      updatedAt: now
    };
    this.repository.requirementSuiteRuns.push(run);
    this.repository.persist();
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
    caseRun.testDataTaskId = undefined;
    caseRun.testDataPhase = undefined;
    caseRun.pendingOutcome = undefined;
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
      return run;
    }
    if (!run.caseRuns.some((item) => item.status === "queued")) return run;
    run.continueOnBlocked = true;
    run.status = "running";
    run.currentExecutableCaseId = undefined;
    run.updatedAt = timestamp();
    this.repository.persist();
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

  private applyOutcome(
    run: RequirementSuiteRun,
    caseRun: RequirementSuiteCaseRun,
    input: RequirementSuiteCaseOutcome
  ) {
    const now = timestamp();
    caseRun.status = input.status;
    caseRun.chainRunId = input.chainRunId;
    caseRun.bugReportId = input.bugReportId;
    caseRun.gapIds = [...new Set([...caseRun.gapIds, ...input.gapIds])];
    caseRun.error = input.error;
    caseRun.completedAt = now;
    caseRun.testDataTaskId = undefined;
    caseRun.testDataPhase = undefined;
    caseRun.pendingOutcome = undefined;
    run.currentExecutableCaseId = undefined;
    this.recount(run);
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

  private recount(run: RequirementSuiteRun) {
    run.total = run.caseRuns.length;
    run.passed = run.caseRuns.filter((item) => item.status === "passed").length;
    run.failed = run.caseRuns.filter((item) => item.status === "failed").length;
    run.blocked = run.caseRuns.filter(
      (item) => item.status === "blocked"
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
    run.updatedAt = now;
    this.repository.persist();
  }
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
