import { createHash } from "node:crypto";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  AuthProfile,
  ActorJourneyStep,
  ActorJourneyConfig,
  ExecutableCase,
  ExecutionDataBinding,
  ExecutionPlan,
  ExecutionPlanDraft,
  ExecutionPreflightCheck,
  TestDataLease
} from "../domain/types.js";
import { id } from "../shared/id.js";
import { buildContextPack } from "./retriever.js";

type PrepareExecutionInput = {
  knowledgeProjectId: string;
  systemId: string;
  executableCaseId: string;
  authProfileId?: string;
  actorJourney?: ActorJourneyConfig[];
  confirm: boolean;
};

export type ExecutionPreflightResult = {
  status: "preview" | "ready" | "needs-confirmation" | "blocked";
  persisted: boolean;
  draft: ExecutionPlanDraft;
  executionPlan?: ExecutionPlan;
};

export type ExecutionPlanValidationResult = {
  status: "valid" | "stale" | "blocked";
  valid: boolean;
  executionPlan: ExecutionPlan;
  currentSnapshotHash: string;
  reasons: string[];
  draft: ExecutionPlanDraft;
};

export class ExecutionPreflightService {
  constructor(private readonly repository: InMemoryBrainCreatorRepository) {}

  prepare(input: PrepareExecutionInput): ExecutionPreflightResult {
    const executableCase = this.resolveCase(input);
    const draft = this.buildDraft(
      executableCase,
      input.systemId,
      input.authProfileId,
      input.actorJourney
    );
    if (!input.confirm) {
      return { status: "preview", persisted: false, draft };
    }
    if (draft.verdict !== "ready") {
      return {
        status: draft.verdict,
        persisted: false,
        draft
      };
    }
    const existing = this.repository.executionPlans.find(
      (item) =>
        item.executableCaseId === executableCase.id &&
        item.systemId === input.systemId &&
        item.snapshotHash === draft.snapshotHash
    );
    if (existing) {
      return {
        status: "ready",
        persisted: true,
        draft,
        executionPlan: existing
      };
    }
    const confirmedAt = timestamp();
    const executionPlan: ExecutionPlan = {
      ...clone(draft),
      id: id("executionPlan"),
      verdict: "ready",
      confirmedAt
    };
    this.repository.executionPlans.push(executionPlan);
    this.repository.persist();
    return {
      status: "ready",
      persisted: true,
      draft,
      executionPlan
    };
  }

  validatePlan(executionPlanId: string): ExecutionPlanValidationResult {
    const executionPlan = this.repository.executionPlans.find(
      (item) => item.id === executionPlanId
    );
    if (!executionPlan) throw new Error("Execution plan not found");
    const executableCase = this.resolveCase({
      knowledgeProjectId: executionPlan.knowledgeProjectId,
      systemId: executionPlan.systemId,
      executableCaseId: executionPlan.executableCaseId,
      authProfileId: executionPlan.auth?.profileId,
      confirm: false
    });
    const draft = this.buildDraft(
      executableCase,
      executionPlan.systemId,
      executionPlan.auth?.profileId,
      executionPlan.actorJourney
    );
    if (draft.verdict !== "ready") {
      return {
        status: "blocked",
        valid: false,
        executionPlan,
        currentSnapshotHash: draft.snapshotHash,
        reasons:
          draft.blockers.length > 0
            ? draft.blockers
            : draft.checks
                .filter((item) => item.status === "action-required")
                .map((item) => item.message),
        draft
      };
    }
    if (draft.snapshotHash !== executionPlan.snapshotHash) {
      return {
        status: "stale",
        valid: false,
        executionPlan,
        currentSnapshotHash: draft.snapshotHash,
        reasons: [
          "Execution plan snapshot no longer matches the current requirement, system, case, context, auth, or test data."
        ],
        draft
      };
    }
    return {
      status: "valid",
      valid: true,
      executionPlan,
      currentSnapshotHash: draft.snapshotHash,
      reasons: [],
      draft
    };
  }

  private resolveCase(input: PrepareExecutionInput) {
    const project = this.repository.knowledgeProjects.find(
      (item) => item.id === input.knowledgeProjectId
    );
    if (!project) throw new Error("Knowledge project not found");
    if (!project.systemIds.includes(input.systemId)) {
      throw new Error("Business system is not bound to the knowledge project");
    }
    const system = this.repository.systemProfiles.find(
      (item) => item.id === input.systemId
    );
    if (!system) throw new Error("Business system not found");
    const executableCase = this.repository.executableCases.find(
      (item) =>
        item.id === input.executableCaseId &&
        item.knowledgeProjectId === input.knowledgeProjectId
    );
    if (!executableCase) throw new Error("Executable case not found");
    if (executableCase.systemId && executableCase.systemId !== input.systemId) {
      throw new Error("Executable case belongs to another business system");
    }
    return executableCase;
  }

  private buildDraft(
    executableCase: ExecutableCase,
    systemId: string,
    authProfileId?: string,
    actorJourneyInput?: PrepareExecutionInput["actorJourney"] | ActorJourneyStep[]
  ): ExecutionPlanDraft {
    const requirementSet = this.repository.requirementSets.find(
      (item) => item.id === executableCase.requirementSetId
    );
    const system = this.repository.systemProfiles.find(
      (item) => item.id === systemId
    )!;
    const openGaps = this.repository.gaps.filter(
      (gap) =>
        executableCase.gapIds.includes(gap.id) &&
        gap.status === "open"
    );
    const pendingTasks = this.repository.testDataTasks.filter(
      (task) =>
        task.executableCaseId === executableCase.id &&
        task.status === "pending"
    );
    const terminalEvidence = this.repository.executionEvidence.some(
      (evidence) =>
        evidence.executableCaseId === executableCase.id &&
        evidence.status !== "running"
    );
    const cleanupDue = terminalEvidence
      ? this.repository.testDataLeases.filter(
          (lease) =>
            lease.executableCaseId === executableCase.id &&
            lease.systemId === systemId &&
            lease.decision === "create" &&
            lease.cleanup !== "none" &&
            (lease.status === "active" || lease.status === "cleanup-failed")
        )
      : [];
    const actorJourneyResolution = this.resolveActorJourney(
      executableCase,
      systemId,
      actorJourneyInput
    );
    const selectedAuthProfileId =
      authProfileId ?? actorJourneyResolution.steps[0]?.authProfileId;
    const authProfile = selectedAuthProfileId
      ? this.repository.authProfiles.find((item) => item.id === selectedAuthProfileId)
      : undefined;
    const checks: ExecutionPreflightCheck[] = [
      check(
        "requirement",
        requirementSet?.status === "approved" ? "pass" : "blocked",
        requirementSet?.status === "approved"
          ? "Requirement baseline is approved."
          : "Requirement baseline must be approved before execution.",
        [`requirement-set:${executableCase.requirementSetId}`]
      ),
      check(
        "system",
        system.status === "succeeded" ? "pass" : "blocked",
        system.status === "succeeded"
          ? "Bound business system is active."
          : "Bound business system is not active.",
        [`system:${system.id}`]
      ),
      check(
        "executable-case",
        executableCase.status === "ready" ? "pass" : "blocked",
        executableCase.status === "ready"
          ? "Executable case is ready."
          : `Executable case is ${executableCase.status}.`,
        [`executable-case:${executableCase.id}`]
      ),
      check(
        "open-gaps",
        openGaps.length === 0 ? "pass" : "blocked",
        openGaps.length === 0
          ? "Executable case has no open Gap."
          : `Executable case has ${openGaps.length} open Gap(s).`,
        openGaps.map((gap) => `gap:${gap.id}`)
      ),
      this.pathCheck(executableCase),
      this.stateCheck(executableCase),
      check(
        "test-data-tasks",
        pendingTasks.length === 0 ? "pass" : "blocked",
        pendingTasks.length === 0
          ? "No test-data task is pending."
          : `${pendingTasks.length} test-data task(s) must finish before execution.`,
        pendingTasks.map((task) => `test-data-task:${task.id}`)
      ),
      this.dataCheck(executableCase, systemId),
      check(
        "test-data-cleanup",
        cleanupDue.length === 0 ? "pass" : "blocked",
        cleanupDue.length === 0
          ? "No prior created data requires cleanup."
          : `${cleanupDue.length} created data lease(s) must be cleaned before rerun.`,
        cleanupDue.map((lease) => `test-data-lease:${lease.id}`)
      ),
      this.authCheck(systemId, selectedAuthProfileId, authProfile),
      actorJourneyResolution.check
    ];
    const dataBindings = this.dataBindings(executableCase, systemId);
    const retrievedContextPack = buildContextPack(this.repository, {
      knowledgeProjectId: executableCase.knowledgeProjectId,
      query: [
        executableCase.title,
        ...executableCase.steps.map(
          (step) =>
            `${step.action} ${step.instruction} ${step.targetSemantic}`
        )
      ].join("\n"),
      purpose: "generator",
      maxChars: 20_000
    });
    const contextPack = {
      ...retrievedContextPack,
      purpose: "generator" as const
    };
    const blockers = checks
      .filter((item) => item.status === "blocked")
      .map((item) => item.message);
    const actionRequired = checks.some(
      (item) => item.status === "action-required"
    );
    const verdict =
      blockers.length > 0
        ? "blocked"
        : actionRequired
          ? "needs-confirmation"
          : "ready";
    const sourceRefs = unique([
      ...executableCase.steps.flatMap((step) => step.sourceRefs),
      ...(executableCase.pathPlan?.navigationSourceRefs ?? []),
      ...(executableCase.statePlan?.transitionSourceRefs ?? []),
      ...(executableCase.dataPlan?.sourceRefs ?? []),
      ...dataBindings.flatMap((binding) => binding.sourceRefs),
      ...checks.flatMap((item) => item.sourceRefs)
    ]);
    const snapshot = {
      knowledgeProjectId: executableCase.knowledgeProjectId,
      requirementSet: requirementSet
        ? {
            id: requirementSet.id,
            contentHash: requirementSet.contentHash,
            status: requirementSet.status
          }
        : undefined,
      system: {
        id: system.id,
        environment: system.environment,
        baseUrl: system.baseUrl,
        status: system.status
      },
      executableCase: executableCaseSnapshot(executableCase, systemId),
      contextPack,
      actorJourney: actorJourneyResolution.steps.length
        ? actorJourneyResolution.steps
        : undefined,
      auth: authProfile
        ? {
            id: authProfile.id,
            projectId: authProfile.projectId,
            role: authProfile.role,
            method: authProfile.loginMethod,
            status: authProfile.status,
            verifiedAt: authProfile.lastVerifiedAt
          }
        : undefined,
      leases: dataBindings
        .flatMap((binding) =>
          binding.leaseId
            ? this.repository.testDataLeases.filter(
                (lease) => lease.id === binding.leaseId
              )
            : []
        )
        .map(safeLeaseSnapshot),
      openGapIds: openGaps.map((gap) => gap.id),
      pendingTaskIds: pendingTasks.map((task) => task.id),
      cleanupLeaseIds: cleanupDue.map((lease) => lease.id)
    };
    return {
      knowledgeProjectId: executableCase.knowledgeProjectId,
      requirementSetId: executableCase.requirementSetId,
      systemId,
      executableCaseId: executableCase.id,
      title: executableCase.title,
      preconditions: clone(executableCase.preconditions),
      auth:
        authProfile?.status === "succeeded"
          ? {
              profileId: authProfile.id,
              role: authProfile.role,
              method: authProfile.loginMethod,
              verifiedAt: authProfile.lastVerifiedAt
          }
        : undefined,
      actorJourney: actorJourneyResolution.steps.length
        ? actorJourneyResolution.steps
        : undefined,
      steps: clone(executableCase.steps),
      pathPlan: clone(executableCase.pathPlan),
      statePlan: clone(executableCase.statePlan),
      dataBindings,
      contextPack,
      checks,
      verdict,
      blockers,
      sourceRefs,
      snapshotHash: createHash("sha256")
        .update(stableStringify(snapshot))
        .digest("hex"),
      generatedAt: timestamp()
    };
  }

  private resolveActorJourney(
    executableCase: ExecutableCase,
    systemId: string,
    input: PrepareExecutionInput["actorJourney"] | ActorJourneyStep[] | undefined
  ) {
    if (!input || input.length === 0) {
      return {
        steps: [] as ActorJourneyStep[],
        check: check(
          "actor-journey",
          "pass",
          "No multi-role journey was requested; execution uses one auth profile.",
          []
        )
      };
    }
    const validStepIds = new Set(executableCase.steps.map((step) => step.id));
    const errors: string[] = [];
    const steps = input.map((item, index) => {
      const profile = this.repository.authProfiles.find(
        (candidate) => candidate.id === item.authProfileId
      );
      const role = (item.role ?? profile?.role ?? "").trim();
      const sourceRefs = unique([
        ...(item.sourceRefs ?? []),
        `auth-profile:${item.authProfileId}`
      ]);
      if (!profile) {
        errors.push(`Actor journey profile ${item.authProfileId} was not found.`);
      } else if (profile.projectId !== systemId) {
        errors.push(
          `Actor journey profile ${item.authProfileId} belongs to another business system.`
        );
      } else if (profile.status !== "succeeded") {
        errors.push(`Actor journey profile ${item.authProfileId} is not verified.`);
      }
      if (!role) errors.push(`Actor journey entry ${index + 1} must declare a role.`);
      if (item.afterStepId && !validStepIds.has(item.afterStepId)) {
        errors.push(
          `Actor journey entry ${index + 1} references unknown step ${item.afterStepId}.`
        );
      }
      return {
        id: `actor-journey:${executableCase.id}:${index + 1}:${item.authProfileId}`,
        order: index + 1,
        role,
        authProfileId: item.authProfileId,
        ...(item.afterStepId ? { afterStepId: item.afterStepId } : {}),
        sourceRefs
      } satisfies ActorJourneyStep;
    });
    return {
      steps,
      check: check(
        "actor-journey",
        errors.length > 0 ? "blocked" : "pass",
        errors.length > 0
          ? errors.join(" ")
          : `Actor journey is ready for ${steps.length} role(s); every transition has a verified AuthProfile.`,
        unique(steps.flatMap((step) => step.sourceRefs))
      )
    };
  }

  private pathCheck(executableCase: ExecutableCase) {
    const verdict = executableCase.pathPlan?.verdict;
    const passed = !verdict || verdict === "not-required" || verdict === "unique";
    return check(
      "workflow-path",
      passed ? "pass" : "blocked",
      passed
        ? "Workflow path is executable."
        : `Workflow path is ${verdict}.`,
      executableCase.pathPlan?.navigationSourceRefs ?? []
    );
  }

  private stateCheck(executableCase: ExecutableCase) {
    const verdict = executableCase.statePlan?.verdict;
    const passed = !verdict || verdict === "not-required" || verdict === "unique";
    return check(
      "state-actions",
      passed ? "pass" : "blocked",
      passed
        ? "State actions are executable."
        : `State action plan is ${verdict}.`,
      executableCase.statePlan?.transitionSourceRefs ?? []
    );
  }

  private dataCheck(
    executableCase: ExecutableCase,
    systemId: string
  ): ExecutionPreflightCheck {
    const plan = executableCase.dataPlan;
    if (!plan || plan.verdict === "not-required") {
      return check("test-data", "pass", "No planned test data is required.", []);
    }
    if (plan.verdict === "blocked") {
      return check(
        "test-data",
        "blocked",
        plan.reasons.join("; ") || "Test data plan is blocked.",
        plan.sourceRefs
      );
    }
    if (
      (plan.requiresConfirmation && !plan.confirmedAt) ||
      plan.operations.some((operation) => operation.status === "proposed")
    ) {
      return check(
        "test-data",
        "action-required",
        "Proposed test data must be confirmed before execution.",
        plan.sourceRefs
      );
    }
    const invalid = plan.operations.find(
      (operation) =>
        operation.status !== "ready" ||
        ((operation.decision === "reuse" || operation.decision === "create") &&
          !this.activeLease(
            executableCase,
            systemId,
            operation.profileId,
            operation.reference
          )) ||
        ((operation.decision === "use-fixed" || operation.decision === "generate") &&
          !operation.value) ||
        (operation.decision === "resolve-secret" && !operation.secretRef)
    );
    return check(
      "test-data",
      invalid ? "blocked" : "pass",
      invalid
        ? invalid.decision === "reuse" || invalid.decision === "create"
          ? `Test data field ${invalid.field} requires an active data lease.`
          : `Test data field ${invalid.field} is not executable.`
        : "Test data bindings are executable.",
      plan.sourceRefs
    );
  }

  private dataBindings(
    executableCase: ExecutableCase,
    systemId: string
  ): ExecutionDataBinding[] {
    return (executableCase.dataPlan?.operations ?? []).map((operation) => {
      const lease =
        operation.decision === "reuse" || operation.decision === "create"
          ? this.activeLease(
              executableCase,
              systemId,
              operation.profileId,
              operation.reference
            )
          : undefined;
      return {
        profileId: operation.profileId,
        field: operation.field,
        decision: operation.decision,
        value:
          operation.decision === "resolve-secret"
            ? undefined
            : operation.value,
        reference: operation.reference,
        secretRef: operation.secretRef,
        leaseId: lease?.id,
        cleanup: operation.cleanup,
        sourceRefs: unique([
          ...operation.sourceRefs,
          ...(lease?.sourceRefs ?? [])
        ])
      };
    });
  }

  private activeLease(
    executableCase: ExecutableCase,
    systemId: string,
    profileId: string,
    reference?: string
  ) {
    return this.repository.testDataLeases.find(
      (lease) =>
        lease.knowledgeProjectId === executableCase.knowledgeProjectId &&
        lease.systemId === systemId &&
        lease.executableCaseId === executableCase.id &&
        lease.profileId === profileId &&
        lease.reference === reference &&
        lease.status === "active"
    );
  }

  private authCheck(
    systemId: string,
    authProfileId: string | undefined,
    authProfile: AuthProfile | undefined
  ) {
    if (!authProfileId) {
      return check(
        "auth",
        "pass",
        "No explicit auth profile was selected; execution uses public or host-managed authentication.",
        []
      );
    }
    if (!authProfile || authProfile.projectId !== systemId) {
      return check(
        "auth",
        "blocked",
        "Selected auth profile does not belong to the business system.",
        [`auth-profile:${authProfileId}`]
      );
    }
    return check(
      "auth",
      authProfile.status === "succeeded" ? "pass" : "blocked",
      authProfile.status === "succeeded"
        ? "Selected auth profile is verified."
        : "Selected auth profile must be verified before execution.",
      [`auth-profile:${authProfile.id}`]
    );
  }
}

function check(
  idValue: ExecutionPreflightCheck["id"],
  status: ExecutionPreflightCheck["status"],
  message: string,
  sourceRefs: string[]
): ExecutionPreflightCheck {
  return { id: idValue, status, message, sourceRefs: unique(sourceRefs) };
}

function safeLeaseSnapshot(lease: TestDataLease) {
  return {
    id: lease.id,
    systemId: lease.systemId,
    executableCaseId: lease.executableCaseId,
    profileId: lease.profileId,
    decision: lease.decision,
    reference: lease.reference,
    cleanup: lease.cleanup,
    status: lease.status,
    sourceRefs: lease.sourceRefs,
    updatedAt: lease.updatedAt
  };
}

function executableCaseSnapshot(
  executableCase: ExecutableCase,
  systemId: string
) {
  const {
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...snapshot
  } = executableCase;
  return clone({ ...snapshot, systemId });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function clone<T>(value: T): T {
  return value === undefined
    ? value
    : JSON.parse(JSON.stringify(value)) as T;
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function timestamp() {
  return new Date().toISOString();
}
