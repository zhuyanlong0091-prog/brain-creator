import { randomUUID } from "node:crypto";
import { id } from "../shared/id.js";
import type {
  BrainEvalResult,
  BrainEvent,
  BrainSession,
  BrainTask,
  BrainTaskState,
  BrainTaskStatus,
  BrainName,
  BrainContextPack,
  HarnessBudget,
  HarnessPolicy
} from "./types.js";

export type HarnessStore = {
  brainTasks: BrainTask[];
  brainSessions: BrainSession[];
  brainEvents: BrainEvent[];
  persist(): void;
};

export type CreateBrainTaskInput = {
  brain: BrainName;
  operation: string;
  inputSummary: string;
  inputRefs?: string[];
  knowledgeProjectId?: string;
  systemId?: string;
  requirementSetId?: string;
  sessionId?: string;
  provider?: string;
  contextPack?: BrainContextPack;
  policy?: Partial<HarnessPolicy>;
  budget?: Partial<HarnessBudget>;
};

export type CreateBrainSessionInput = {
  knowledgeProjectId?: string;
  currentSystemId?: string;
  currentRequirementSetId?: string;
  provider?: string;
};

export type HarnessPolicyRequest = {
  files?: string[];
  urls?: string[];
  action?: string;
  writes?: number;
};

const defaultBudget: HarnessBudget = {
  maxAgentCalls: 5,
  maxHealAttempts: 2,
  maxWrites: 20,
  maxDurationMs: 300_000,
  maxContextChars: 50_000
};

const defaultPolicy: HarnessPolicy = {
  allowedFiles: [],
  allowedUrls: [],
  allowedActions: [],
  forbiddenActions: [],
  allowWrites: false,
  requireApproval: true
};

const transitions: Record<BrainTaskState, BrainTaskState[]> = {
  created: ["context-ready", "waiting-approval", "blocked", "cancelled"],
  "context-ready": ["waiting-approval", "waiting-provider", "executing", "blocked", "cancelled"],
  "waiting-approval": ["waiting-provider", "executing", "blocked", "cancelled"],
  "waiting-provider": ["executing", "blocked", "cancelled"],
  executing: ["evaluating", "healing", "blocked", "failed", "cancelled"],
  evaluating: ["completed", "healing", "waiting-approval", "blocked", "failed"],
  healing: ["executing", "evaluating", "blocked", "failed", "cancelled"],
  completed: [],
  blocked: [],
  failed: [],
  cancelled: []
};

export class HarnessRuntime {
  constructor(private readonly store: HarnessStore) {}

  createSession(input: CreateBrainSessionInput = {}) {
    const now = new Date().toISOString();
    const session: BrainSession = {
      id: id("brainSession"),
      knowledgeProjectId: input.knowledgeProjectId,
      currentSystemId: input.currentSystemId,
      currentRequirementSetId: input.currentRequirementSetId,
      state: "created",
      openBlockers: [],
      provider: input.provider,
      createdAt: now,
      updatedAt: now
    };
    this.store.brainSessions.push(session);
    this.store.persist();
    return session;
  }

  createTask(input: CreateBrainTaskInput) {
    const now = new Date().toISOString();
    const task: BrainTask = {
      id: id("brainTask"),
      brain: input.brain,
      operation: input.operation,
      knowledgeProjectId: input.knowledgeProjectId,
      systemId: input.systemId,
      requirementSetId: input.requirementSetId,
      sessionId: input.sessionId,
      state: "created",
      status: "pending",
      inputSummary: input.inputSummary,
      inputRefs: [...(input.inputRefs ?? [])],
      contextPack: input.contextPack
        ? { ...input.contextPack, taskId: "" }
        : undefined,
      outputRefs: [],
      provider: input.provider,
      policy: { ...defaultPolicy, ...(input.policy ?? {}) },
      budget: { ...defaultBudget, ...(input.budget ?? {}) },
      agentCalls: 0,
      healAttempts: 0,
      writeCount: 0,
      createdAt: now,
      updatedAt: now
    };
    if (task.sessionId && !this.store.brainSessions.some((session) => session.id === task.sessionId)) {
      throw new Error(`Brain session not found: ${task.sessionId}`);
    }
    if (task.contextPack) task.contextPack = { ...task.contextPack, taskId: task.id };
    this.store.brainTasks.push(task);
    this.appendEvent(task, "task-created", "started", "Brain task created", task.inputRefs);
    this.store.persist();
    return task;
  }

  startDeferredTask(input: CreateBrainTaskInput & { approved?: boolean }) {
    const task = this.createTask(input);
    this.transition(task.id, "context-ready");
    if (task.policy.requireApproval && input.approved !== true) {
      this.transition(task.id, "waiting-approval", "Harness approval is required before provider execution");
      return task;
    }
    this.transition(task.id, "waiting-provider", "Waiting for the declared provider to return output");
    this.recordAgentCall(task.id);
    return this.requireTask(task.id);
  }

  resumeDeferredTask(taskId: string, approved = false) {
    const task = this.requireTask(taskId);
    if (task.state === "waiting-approval") {
      if (!approved) throw new Error(`Harness approval required for task ${task.id}`);
      this.transition(task.id, "waiting-provider", "Harness approval granted; waiting for provider output");
      this.recordAgentCall(task.id);
      return this.requireTask(task.id);
    }
    if (task.state !== "waiting-provider") {
      throw new Error(`Brain task must be waiting-provider before resume; current state is ${task.state}`);
    }
    return this.transition(task.id, "executing", "Provider output received; resuming Harness evaluation");
  }

  completeDeferredTask(taskId: string, evaluation: BrainEvalResult, outputRefs: string[] = []) {
    const task = this.requireTask(taskId);
    if (task.state === "waiting-provider") this.resumeDeferredTask(taskId);
    const current = this.requireTask(taskId);
    if (current.state !== "executing" && current.state !== "evaluating") {
      throw new Error(`Brain task must be waiting-provider or executing before completion; current state is ${current.state}`);
    }
    if (current.state === "executing") this.transition(taskId, "evaluating");
    this.setOutputRefs(taskId, outputRefs);
    return this.applyEval(taskId, evaluation);
  }

  setOutputRefs(taskId: string, outputRefs: string[]) {
    const task = this.requireTask(taskId);
    task.outputRefs = [...new Set(outputRefs)];
    task.updatedAt = new Date().toISOString();
    this.store.persist();
    return task;
  }

  setContextPack(taskId: string, contextPack: BrainContextPack) {
    const task = this.requireTask(taskId);
    if (contextPack.estimatedChars > task.budget.maxContextChars) {
      const message = `Context pack exceeds Harness context budget (${contextPack.estimatedChars} > ${task.budget.maxContextChars})`;
      if (!["completed", "blocked", "failed", "cancelled"].includes(task.state)) {
        task.lastError = message;
        this.transition(task.id, "blocked", message);
      }
      throw new Error(message);
    }
    task.contextPack = { ...contextPack, taskId };
    task.updatedAt = new Date().toISOString();
    this.store.persist();
    return task;
  }

  transition(taskId: string, nextState: BrainTaskState, message?: string) {
    const task = this.requireTask(taskId);
    if (!transitions[task.state].includes(nextState)) {
      throw new Error(`Invalid Brain task transition: ${task.state} -> ${nextState}`);
    }
    task.state = nextState;
    task.status = statusFor(nextState);
    task.updatedAt = new Date().toISOString();
    if (nextState === "completed" || nextState === "blocked" || nextState === "failed" || nextState === "cancelled") {
      task.completedAt = task.updatedAt;
    }
    const session = task.sessionId
      ? this.store.brainSessions.find((candidate) => candidate.id === task.sessionId)
      : undefined;
    if (session) {
      session.state = nextState;
      session.activeTaskId = nextState === "completed" || nextState === "blocked" || nextState === "failed" || nextState === "cancelled"
        ? undefined
        : task.id;
      session.lastAction = message ?? `Brain task moved to ${nextState}`;
      session.openBlockers = nextState === "blocked" ? [message ?? "Brain task is blocked"] : [];
      session.updatedAt = task.updatedAt;
    }
    this.appendEvent(
      task,
      `task-${nextState}`,
      eventStatusFor(nextState),
      message ?? `Brain task moved to ${nextState}`,
      task.outputRefs
    );
    this.store.persist();
    return task;
  }

  recordAgentCall(taskId: string) {
    const task = this.requireTask(taskId);
    task.agentCalls += 1;
    if (task.agentCalls > task.budget.maxAgentCalls) {
      this.transition(task.id, "blocked", "Agent call budget exhausted");
      throw new Error("Agent call budget exhausted");
    }
    task.updatedAt = new Date().toISOString();
    this.store.persist();
    return task;
  }

  recordHealAttempt(taskId: string) {
    const task = this.requireTask(taskId);
    task.healAttempts += 1;
    if (task.healAttempts > task.budget.maxHealAttempts) {
      this.transition(task.id, "blocked", "Healer budget exhausted");
      throw new Error("Healer budget exhausted");
    }
    task.updatedAt = new Date().toISOString();
    this.store.persist();
    return task;
  }

  recordWrite(taskId: string) {
    const task = this.requireTask(taskId);
    if (!task.policy.allowWrites) {
      this.transition(task.id, "blocked", "Write operation is not allowed by the Harness policy");
      throw new Error("Write operation is not allowed by the Harness policy");
    }
    task.writeCount += 1;
    if (task.writeCount > task.budget.maxWrites) {
      this.transition(task.id, "blocked", "Write budget exhausted");
      throw new Error("Write budget exhausted");
    }
    task.updatedAt = new Date().toISOString();
    this.store.persist();
    return task;
  }

  applyEval(taskId: string, evaluation: BrainEvalResult) {
    const task = this.requireTask(taskId);
    if (task.state !== "evaluating") {
      throw new Error(`Brain task must be evaluating before applying Eval; current state is ${task.state}`);
    }
    task.eval = evaluation;
    task.updatedAt = new Date().toISOString();
    const nextState: BrainTaskState =
      evaluation.verdict === "pass"
        ? "completed"
        : evaluation.verdict === "retry"
          ? "healing"
          : evaluation.verdict === "needs-review"
            ? "waiting-approval"
            : "blocked";
    this.transition(task.id, nextState, `Eval verdict: ${evaluation.verdict}`);
    return this.requireTask(task.id);
  }

  getTask(taskId: string) {
    return this.store.brainTasks.find((task) => task.id === taskId);
  }

  listEvents(taskId?: string) {
    return this.store.brainEvents.filter((event) => !taskId || event.taskId === taskId);
  }

  private requireTask(taskId: string) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Brain task not found: ${taskId}`);
    return task;
  }

  private appendEvent(task: BrainTask, type: string, status: BrainEvent["status"], message: string, refs: string[]) {
    const taskEvents = this.store.brainEvents.filter((event) => event.taskId === task.id);
    this.store.brainEvents.push({
      id: id("brainEvent"),
      sequence: taskEvents.length + 1,
      sessionId: task.sessionId,
      taskId: task.id,
      brain: task.brain,
      type,
      status,
      message,
      traceId: randomUUID(),
      refs: [...new Set(refs)],
      createdAt: new Date().toISOString()
    });
  }
}

export function canTransition(from: BrainTaskState, to: BrainTaskState) {
  return transitions[from].includes(to);
}

export function checkHarnessPolicy(policy: HarnessPolicy, request: HarnessPolicyRequest) {
  const violations: string[] = [];
  if (!policy.allowWrites && (request.writes ?? 0) > 0) {
    violations.push("write operation is not allowed");
  }
  if (request.action && policy.forbiddenActions.includes(request.action)) {
    violations.push(`action is forbidden: ${request.action}`);
  }
  if (policy.allowedActions.length > 0 && request.action && !policy.allowedActions.includes(request.action)) {
    violations.push(`action is outside the allowlist: ${request.action}`);
  }
  if (policy.allowedFiles.length > 0) {
    for (const file of request.files ?? []) {
      if (!policy.allowedFiles.some((allowed) => isFileAllowed(file, allowed))) {
        violations.push(`file is outside the allowlist: ${file}`);
      }
    }
  }
  if (policy.allowedUrls.length > 0) {
    for (const url of request.urls ?? []) {
      if (!policy.allowedUrls.some((allowed) => isUrlAllowed(url, allowed))) {
        violations.push(`URL is outside the allowlist: ${url}`);
      }
    }
  }
  return { allowed: violations.length === 0, violations };
}

function statusFor(state: BrainTaskState): BrainTaskStatus {
  if (state === "created" || state === "context-ready" || state === "waiting-approval" || state === "waiting-provider") return "pending";
  if (state === "executing" || state === "evaluating" || state === "healing") return "running";
  if (state === "completed") return "succeeded";
  if (state === "cancelled") return "cancelled";
  return "failed";
}

function eventStatusFor(state: BrainTaskState): BrainEvent["status"] {
  if (state === "completed") return "passed";
  if (state === "blocked" || state === "failed" || state === "cancelled") return "blocked";
  if (state === "waiting-approval" || state === "waiting-provider") return "waiting";
  return state === "created" ? "started" : "running";
}

function isFileAllowed(value: string, allowed: string) {
  const normalizedValue = normalizeFile(value);
  const normalizedAllowed = normalizeFile(allowed);
  if (hasParentTraversal(value) || hasParentTraversal(allowed)) return false;
  return normalizedValue === normalizedAllowed || normalizedValue.startsWith(`${normalizedAllowed}/`);
}

function normalizeFile(value: string) {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/")
    .replace(/\/$/u, "");
}

function hasParentTraversal(value: string) {
  return value.replaceAll("\\", "/").split("/").some((part) => part === "..");
}

function isUrlAllowed(value: string, allowed: string) {
  try {
    const candidate = new URL(value);
    const boundary = new URL(allowed);
    if (candidate.origin !== boundary.origin) return false;
    const boundaryPath = boundary.pathname.replace(/\/$/u, "") || "/";
    return boundaryPath === "/" || candidate.pathname === boundaryPath || candidate.pathname.startsWith(`${boundaryPath}/`);
  } catch {
    return false;
  }
}
