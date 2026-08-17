import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutableCase,
  ExecutableCaseDataOperation,
  Gap,
  TestDataLease,
  TestDataTask
} from "../domain/types.js";
import { id } from "../shared/id.js";
import type { KnowledgeService } from "./service.js";

type PrepareInput = {
  knowledgeProjectId: string;
  systemId: string;
  executableCaseId: string;
  confirm: boolean;
  allowCreate?: boolean;
  automatic?: boolean;
  phase?: "prepare" | "cleanup";
};

type SubmitInput = {
  taskId: string;
  status: "succeeded" | "failed";
  decision?: "reuse" | "create";
  reference?: string;
  value?: string;
  sourceRefs: string[];
  error?: string;
};

type PrepareOperation = {
  profileId: string;
  field: string;
  lookupQuery?: string;
  cleanup: TestDataTask["cleanup"];
  allowedDecisions: Array<"reuse" | "create">;
  constraints: string[];
  sourceRefs: string[];
};

export type TestDataPrepareResult = {
  status: "preview" | "needs-agent-execution" | "ready";
  operations: PrepareOperation[];
  task?: TestDataTask;
  autoResolvedProfileIds?: string[];
};

export type TestDataSubmitResult = {
  task: TestDataTask;
  executableCase: ExecutableCase;
  lease?: TestDataLease;
  gap?: Gap;
};

export class TestDataProviderService {
  constructor(
    private readonly repository: InMemoryBrainCreatorRepository,
    private readonly knowledgeService: KnowledgeService,
    private readonly runtimeDir: string
  ) {}

  async prepare(input: PrepareInput): Promise<TestDataPrepareResult> {
    const executableCase = this.getCase(input);
    this.releaseReusableLeasesAfterExecution(executableCase);
    const cleanupLease = this.findCleanupLease(executableCase);
    if (cleanupLease) {
      const operation: PrepareOperation = {
        profileId: cleanupLease.profileId,
        field: this.findField(executableCase, cleanupLease.profileId),
        cleanup: cleanupLease.cleanup,
        allowedDecisions: [],
        constraints: [],
        sourceRefs: cleanupLease.sourceRefs
      };
      if (!input.confirm) {
        return { status: "preview", operations: [operation] };
      }
      const task = await this.createOrReuseTask({
        executableCase,
        operation,
        action: "cleanup",
        allowCreate: false,
        leaseId: cleanupLease.id
      });
      return { status: "needs-agent-execution", operations: [operation], task };
    }
    if (input.phase === "cleanup") {
      return { status: "ready", operations: [] };
    }

    if (
      input.automatic &&
      input.confirm &&
      executableCase.dataPlan?.requiresConfirmation &&
      !executableCase.dataPlan.confirmedAt
    ) {
      throw new Error("Test data plan must be confirmed before automatic resolution");
    }
    const autoResolvedProfileIds = input.automatic && input.confirm
      ? this.resolveDeterministicOperations(executableCase)
      : [];
    const operations = this.unresolvedOperations(executableCase).map((operation) =>
      this.prepareOperation(operation, Boolean(input.allowCreate))
    );
    if (operations.length === 0) {
      return {
        status: "ready",
        operations: [],
        ...(autoResolvedProfileIds.length > 0
          ? { autoResolvedProfileIds }
          : {})
      };
    }
    if (!input.confirm) {
      return { status: "preview", operations };
    }
    if (
      input.allowCreate &&
      operations.some((operation) => operation.cleanup === "none")
    ) {
      throw new Error(
        "Creating test data requires an explicit cleanup policy before task dispatch"
      );
    }

    const next = this.nextOperation(executableCase, operations);
    const task = await this.createOrReuseTask({
      executableCase,
      operation: next,
      action: "lookup-or-create",
      allowCreate: Boolean(input.allowCreate)
    });
    return {
      status: "needs-agent-execution",
      operations,
      task,
      ...(autoResolvedProfileIds.length > 0
        ? { autoResolvedProfileIds }
        : {})
    };
  }

  submit(input: SubmitInput): TestDataSubmitResult {
    const task = this.repository.testDataTasks.find((item) => item.id === input.taskId);
    if (!task) throw new Error("Test data task not found");
    const executableCase = this.repository.executableCases.find(
      (item) => item.id === task.executableCaseId
    );
    if (!executableCase) throw new Error("Executable case not found");
    if (task.status === "submitted") {
      return {
        task,
        executableCase,
        lease: task.leaseId
          ? this.repository.testDataLeases.find((item) => item.id === task.leaseId)
          : undefined
      };
    }
    if (task.status !== "pending") {
      throw new Error(`Test data task is ${task.status}`);
    }

    const sourceRefs = cleanSourceRefs(input.sourceRefs);
    if (input.status === "failed") {
      const reason = input.error?.trim() || "Host agent could not complete the test data task";
      task.status = "failed";
      task.error = reason;
      task.outputSourceRefs = sourceRefs;
      task.updatedAt = timestamp();
      if (task.action === "cleanup" && task.leaseId) {
        const lease = this.getLease(task.leaseId);
        lease.status = "cleanup-failed";
        lease.updatedAt = task.updatedAt;
        const gap = this.createGap(
          executableCase,
          task,
          `Test data cleanup failed: ${reason}`,
          "test-data-cleanup"
        );
        this.repository.persist();
        return { task, executableCase, lease, gap };
      }
      executableCase.status = "blocked";
      executableCase.updatedAt = task.updatedAt;
      const gap = this.createGap(
        executableCase,
        task,
        `Test data preparation failed: ${reason}`,
        "test-data-provider"
      );
      this.repository.persist();
      return { task, executableCase, gap };
    }

    if (sourceRefs.length === 0) {
      throw new Error("Successful test data task requires source evidence");
    }
    if (task.action === "cleanup") {
      if (!task.leaseId) throw new Error("Cleanup task has no data lease");
      const lease = this.getLease(task.leaseId);
      const now = timestamp();
      lease.status = "released";
      lease.releasedAt = now;
      lease.updatedAt = now;
      lease.sourceRefs = unique([...lease.sourceRefs, ...sourceRefs]);
      this.completeTask(task, sourceRefs, now);
      this.resolveCleanupGaps(lease.id, now);
      this.repository.persist();
      return { task, executableCase, lease };
    }

    if (input.decision !== "reuse" && input.decision !== "create") {
      throw new Error("Data preparation result requires reuse or create decision");
    }
    if (!input.reference?.trim()) {
      throw new Error(`${input.decision} result requires a data reference`);
    }
    if (input.decision === "create" && !task.allowCreate) {
      throw new Error("Creating test data is not allowed for this task");
    }
    if (input.decision === "create" && task.cleanup === "none") {
      throw new Error("Created test data requires an explicit cleanup policy");
    }

    const resolved = this.knowledgeService.resolveExecutableCaseTestData({
      executableCaseId: executableCase.id,
      resolutions: [{
        profileId: task.profileId,
        decision: input.decision,
        reference: input.reference.trim(),
        value: input.value?.trim() || undefined
      }]
    });
    const now = timestamp();
    this.resolveProviderGaps(task, now);
    this.refreshCaseStatus(resolved.executableCase, now);
    const lease = this.createOrReuseLease({
      task,
      decision: input.decision,
      reference: input.reference.trim(),
      value: input.value?.trim() || undefined,
      sourceRefs,
      now
    });
    task.leaseId = lease.id;
    this.completeTask(task, sourceRefs, now);
    this.repository.persist();
    return { task, executableCase: resolved.executableCase, lease };
  }

  private getCase(input: PrepareInput) {
    const project = this.repository.knowledgeProjects.find(
      (item) => item.id === input.knowledgeProjectId
    );
    if (!project) throw new Error("Knowledge project not found");
    if (!project.systemIds.includes(input.systemId)) {
      throw new Error("Business system is not bound to the knowledge project");
    }
    const executableCase = this.repository.executableCases.find(
      (item) =>
        item.id === input.executableCaseId &&
        item.knowledgeProjectId === input.knowledgeProjectId
    );
    if (!executableCase) throw new Error("Executable case not found");
    if (executableCase.systemId !== input.systemId) {
      throw new Error("Executable case belongs to another business system");
    }
    return executableCase;
  }

  private unresolvedOperations(executableCase: ExecutableCase) {
    if (!executableCase.dataPlan) return [];
    return executableCase.dataPlan.operations.filter(
      (operation) =>
        (operation.decision === "lookup" &&
          operation.status === "needs-resolution") ||
        ((operation.decision === "reuse" || operation.decision === "create") &&
          !this.repository.testDataLeases.some(
            (lease) =>
              lease.knowledgeProjectId === executableCase.knowledgeProjectId &&
              lease.systemId === executableCase.systemId &&
              lease.executableCaseId === executableCase.id &&
              lease.profileId === operation.profileId &&
              lease.reference === operation.reference &&
              lease.status === "active"
          ))
    );
  }

  private resolveDeterministicOperations(executableCase: ExecutableCase) {
    const operations = executableCase.dataPlan?.operations.filter(
      (operation) =>
        (operation.strategy === "generated" || operation.strategy === "unique") &&
        operation.decision === "generate" &&
        operation.status === "proposed" &&
        Boolean(operation.value?.trim())
    ) ?? [];
    if (operations.length === 0) return [];
    this.knowledgeService.resolveExecutableCaseTestData({
      executableCaseId: executableCase.id,
      resolutions: operations.map((operation) => ({
        profileId: operation.profileId,
        decision: "use-value" as const,
        value: operation.value
      }))
    });
    return operations.map((operation) => operation.profileId);
  }

  private prepareOperation(
    operation: ExecutableCaseDataOperation,
    allowCreate: boolean
  ): PrepareOperation {
    return {
      profileId: operation.profileId,
      field: operation.field,
      lookupQuery: operation.lookupQuery,
      cleanup: operation.cleanup,
      allowedDecisions:
        allowCreate && operation.cleanup !== "none"
          ? ["reuse", "create"]
          : ["reuse"],
      constraints: operation.constraints,
      sourceRefs: operation.sourceRefs
    };
  }

  private nextOperation(executableCase: ExecutableCase, operations: PrepareOperation[]) {
    const order = executableCase.dataPlan?.dependencyOrder ?? [];
    return [...operations].sort(
      (left, right) =>
        order.indexOf(left.profileId) - order.indexOf(right.profileId)
    )[0];
  }

  private async createOrReuseTask(input: {
    executableCase: ExecutableCase;
    operation: PrepareOperation;
    action: TestDataTask["action"];
    allowCreate: boolean;
    leaseId?: string;
  }) {
    const idempotencyKey = [
      input.executableCase.systemId,
      input.executableCase.id,
      input.operation.profileId,
      input.action,
      input.leaseId ?? "none"
    ].join(":");
    const existing = this.repository.testDataTasks.find(
      (item) => item.idempotencyKey === idempotencyKey && item.status === "pending"
    );
    if (existing) return existing;

    const taskId = id("testDataTask");
    const taskDir = join(this.runtimeDir, "test-data", taskId);
    const contextPath = join(taskDir, "input.context.json");
    const promptPath = join(taskDir, "input.prompt.md");
    const now = timestamp();
    const task: TestDataTask = {
      id: taskId,
      knowledgeProjectId: input.executableCase.knowledgeProjectId,
      systemId: input.executableCase.systemId!,
      executableCaseId: input.executableCase.id,
      profileId: input.operation.profileId,
      field: input.operation.field,
      action: input.action,
      status: "pending",
      idempotencyKey,
      allowCreate: input.allowCreate,
      cleanup: input.operation.cleanup,
      lookupQuery: input.operation.lookupQuery,
      leaseId: input.leaseId,
      contextPath,
      promptPath,
      sourceRefs: input.operation.sourceRefs,
      outputSourceRefs: [],
      createdAt: now,
      updatedAt: now
    };
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      contextPath,
      JSON.stringify({
        taskId,
        systemId: task.systemId,
        executableCaseId: task.executableCaseId,
        action: task.action,
        field: task.field,
        lookupQuery: task.lookupQuery,
        allowedDecisions: input.operation.allowedDecisions,
        cleanup: task.cleanup,
        constraints: input.operation.constraints,
        lease: task.leaseId
          ? this.repository.testDataLeases.find((item) => item.id === task.leaseId)
          : undefined,
        sourceRefs: task.sourceRefs
      }, null, 2),
      "utf8"
    );
    await writeFile(promptPath, this.taskPrompt(task, input.operation), "utf8");
    this.repository.testDataTasks.push(task);
    this.repository.persist();
    return task;
  }

  private taskPrompt(task: TestDataTask, operation: PrepareOperation) {
    if (task.action === "cleanup") {
      return [
        "# Test Data Cleanup Task",
        "",
        `Clean up the data lease for field "${task.field}" using policy "${task.cleanup}".`,
        "Do not modify unrelated business data.",
        "Return source evidence that proves the cleanup result."
      ].join("\n");
    }
    return [
      "# Test Data Preparation Task",
      "",
      `Find data for field "${task.field}" in the bound business system.`,
      `Lookup query: ${task.lookupQuery ?? "(not specified)"}`,
      `Allowed decisions: ${operation.allowedDecisions.join(", ")}`,
      "Prefer reusing an existing matching record.",
      "Do not create data unless lookup cannot satisfy the request and create is explicitly allowed.",
      `If data is created, preserve evidence and apply cleanup policy "${task.cleanup}".`,
      "Do not expose secrets in the result."
    ].join("\n");
  }

  private createOrReuseLease(input: {
    task: TestDataTask;
    decision: "reuse" | "create";
    reference: string;
    value?: string;
    sourceRefs: string[];
    now: string;
  }) {
    const existing = this.repository.testDataLeases.find(
      (item) =>
        item.taskId === input.task.id &&
        item.profileId === input.task.profileId &&
        item.reference === input.reference
    );
    if (existing) return existing;
    const lease: TestDataLease = {
      id: id("testDataLease"),
      knowledgeProjectId: input.task.knowledgeProjectId,
      systemId: input.task.systemId,
      executableCaseId: input.task.executableCaseId,
      profileId: input.task.profileId,
      taskId: input.task.id,
      decision: input.decision,
      reference: input.reference,
      value: input.value,
      cleanup: input.decision === "create" ? input.task.cleanup : "none",
      status: "active",
      sourceRefs: input.sourceRefs,
      createdAt: input.now,
      updatedAt: input.now
    };
    this.repository.testDataLeases.push(lease);
    return lease;
  }

  private findCleanupLease(executableCase: ExecutableCase) {
    if (!this.hasTerminalEvidence(executableCase.id)) return undefined;
    return this.repository.testDataLeases.find(
      (lease) =>
        lease.executableCaseId === executableCase.id &&
        lease.decision === "create" &&
        lease.cleanup !== "none" &&
        (lease.status === "active" || lease.status === "cleanup-failed")
    );
  }

  private releaseReusableLeasesAfterExecution(executableCase: ExecutableCase) {
    if (!this.hasTerminalEvidence(executableCase.id)) return;
    const now = timestamp();
    let changed = false;
    for (const lease of this.repository.testDataLeases) {
      if (
        lease.executableCaseId === executableCase.id &&
        lease.decision === "reuse" &&
        lease.status === "active"
      ) {
        lease.status = "released";
        lease.releasedAt = now;
        lease.updatedAt = now;
        changed = true;
      }
    }
    if (changed) this.repository.persist();
  }

  private hasTerminalEvidence(executableCaseId: string) {
    return this.repository.executionEvidence.some(
      (evidence) =>
        evidence.executableCaseId === executableCaseId &&
        evidence.status !== "running"
    );
  }

  private findField(executableCase: ExecutableCase, profileId: string) {
    return executableCase.dataPlan?.operations.find(
      (operation) => operation.profileId === profileId
    )?.field ?? profileId;
  }

  private getLease(leaseId: string) {
    const lease = this.repository.testDataLeases.find((item) => item.id === leaseId);
    if (!lease) throw new Error("Test data lease not found");
    return lease;
  }

  private completeTask(task: TestDataTask, sourceRefs: string[], now: string) {
    task.status = "submitted";
    task.outputSourceRefs = sourceRefs;
    task.submittedAt = now;
    task.updatedAt = now;
  }

  private resolveCleanupGaps(leaseId: string, now: string) {
    const cleanupTaskIds = new Set(
      this.repository.testDataTasks
        .filter((item) => item.action === "cleanup" && item.leaseId === leaseId)
        .map((item) => item.id)
    );
    for (const gap of this.repository.gaps) {
      if (
        gap.sourceType === "test-data-cleanup" &&
        gap.status === "open" &&
        cleanupTaskIds.has(gap.sourceId)
      ) {
        gap.status = "resolved";
        gap.updatedAt = now;
      }
    }
  }

  private resolveProviderGaps(task: TestDataTask, now: string) {
    const relatedTaskIds = new Set(
      this.repository.testDataTasks
        .filter(
          (item) =>
            item.action === "lookup-or-create" &&
            item.executableCaseId === task.executableCaseId &&
            item.profileId === task.profileId
        )
        .map((item) => item.id)
    );
    for (const gap of this.repository.gaps) {
      if (
        gap.sourceType === "test-data-provider" &&
        gap.status === "open" &&
        relatedTaskIds.has(gap.sourceId)
      ) {
        gap.status = "resolved";
        gap.updatedAt = now;
      }
    }
  }

  private refreshCaseStatus(executableCase: ExecutableCase, now: string) {
    if (executableCase.dataPlan?.verdict !== "ready") return;
    const hasOpenGap = executableCase.gapIds.some((gapId) =>
      this.repository.gaps.some(
        (gap) => gap.id === gapId && gap.status === "open"
      )
    );
    executableCase.status = hasOpenGap ? "blocked" : "ready";
    executableCase.updatedAt = now;
    const intent = this.repository.testIntents.find(
      (item) => item.id === executableCase.testIntentId
    );
    if (intent) {
      intent.status = hasOpenGap ? "blocked" : "compiled";
      intent.updatedAt = now;
    }
  }

  private createGap(
    executableCase: ExecutableCase,
    task: TestDataTask,
    reason: string,
    sourceType: string
  ) {
    const now = timestamp();
    const gap: Gap = {
      id: id("gap"),
      projectId: task.knowledgeProjectId,
      sourceType,
      sourceId: task.id,
      reason,
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: now,
      updatedAt: now
    };
    this.repository.gaps.push(gap);
    executableCase.gapIds = unique([...executableCase.gapIds, gap.id]);
    executableCase.updatedAt = now;
    return gap;
  }
}

function cleanSourceRefs(sourceRefs: string[]) {
  return unique(sourceRefs.map((item) => item.trim()).filter(Boolean));
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function timestamp() {
  return new Date().toISOString();
}
