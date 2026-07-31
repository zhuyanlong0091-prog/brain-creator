import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutionPlan,
  RequirementSuiteCaseRun,
  RequirementSuiteRun
} from "../domain/types.js";
import { id } from "../shared/id.js";

type CreateRequirementSuiteRunInput = {
  knowledgeProjectId: string;
  systemId: string;
  authProfileId?: string;
  executionPlans: ExecutionPlan[];
  continueOnBlocked: boolean;
};

type CompleteRequirementSuiteCaseInput = {
  status: "passed" | "failed" | "blocked";
  chainRunId?: string;
  bugReportId?: string;
  gapIds: string[];
  error?: string;
};

export class RequirementSuiteRunService {
  constructor(private readonly repository: InMemoryBrainCreatorRepository) {}

  create(input: CreateRequirementSuiteRunInput): RequirementSuiteRun {
    if (input.executionPlans.length === 0) {
      throw new Error("Requirement suite requires at least one execution plan");
    }
    for (const plan of input.executionPlans) {
      if (
        plan.knowledgeProjectId !== input.knowledgeProjectId ||
        plan.systemId !== input.systemId
      ) {
        throw new Error("Execution plan belongs to another requirement suite");
      }
    }
    const planIds = input.executionPlans.map((plan) => plan.id);
    const existing = this.repository.requirementSuiteRuns.find(
      (run) =>
        run.knowledgeProjectId === input.knowledgeProjectId &&
        run.systemId === input.systemId &&
        run.authProfileId === input.authProfileId &&
        !isTerminal(run.status) &&
        sameItems(
          run.caseRuns.map((item) => item.executionPlanId),
          planIds
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
      total: input.executionPlans.length,
      passed: 0,
      failed: 0,
      blocked: 0,
      caseRuns: input.executionPlans.map((plan, index) => ({
        executableCaseId: plan.executableCaseId,
        executionPlanId: plan.id,
        title: plan.title,
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

  beginNext(runId: string): {
    run: RequirementSuiteRun;
    caseRun?: RequirementSuiteCaseRun;
  } {
    const run = this.get(runId);
    const active = run.caseRuns.find(
      (item) =>
        item.status === "running" || item.status === "waiting-for-agent"
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

  completeCase(
    runId: string,
    executableCaseId: string,
    input: CompleteRequirementSuiteCaseInput
  ): RequirementSuiteRun {
    const run = this.get(runId);
    const caseRun = this.currentCase(run, executableCaseId);
    const now = timestamp();
    caseRun.status = input.status;
    caseRun.chainRunId = input.chainRunId;
    caseRun.bugReportId = input.bugReportId;
    caseRun.gapIds = [...new Set(input.gapIds)];
    caseRun.error = input.error;
    caseRun.completedAt = now;
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
      caseRun.status !== "waiting-for-agent"
    ) {
      throw new Error("Requirement suite case is not active");
    }
    return caseRun;
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
