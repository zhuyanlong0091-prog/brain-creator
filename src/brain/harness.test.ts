import { describe, expect, it, vi } from "vitest";
import { HarnessRuntime, canTransition, checkHarnessPolicy, type HarnessStore } from "./harness.js";

function store(): HarnessStore {
  return { brainTasks: [], brainSessions: [], brainEvents: [], persist: vi.fn() };
}

describe("HarnessRuntime", () => {
  it("enforces deterministic task transitions and records ordered events", () => {
    const repository = store();
    const runtime = new HarnessRuntime(repository);
    const session = runtime.createSession({ currentSystemId: "system-a", provider: "host-agent" });
    const task = runtime.createTask({ brain: "testexecution", operation: "run-case", inputSummary: "Run case", sessionId: session.id });

    runtime.transition(task.id, "context-ready");
    runtime.transition(task.id, "executing");
    runtime.transition(task.id, "evaluating");
    runtime.applyEval(task.id, {
      verdict: "pass",
      score: 1,
      reasons: [],
      affectedAssetIds: [],
      evidenceRefs: ["execution:run-1"],
      nextActions: []
    });

    expect(runtime.getTask(task.id)?.state).toBe("completed");
    expect(repository.brainSessions[0].activeTaskId).toBeUndefined();
    expect(runtime.listEvents(task.id).map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(canTransition("completed", "executing")).toBe(false);
  });

  it("blocks writes and healer calls when the declared budget or policy is exceeded", () => {
    const repository = store();
    const runtime = new HarnessRuntime(repository);
    const task = runtime.createTask({
      brain: "testcase",
      operation: "compile",
      inputSummary: "Compile",
      policy: { allowWrites: false },
      budget: { maxHealAttempts: 0 }
    });
    runtime.transition(task.id, "context-ready");
    expect(() => runtime.recordWrite(task.id)).toThrow(/not allowed/);
    expect(runtime.getTask(task.id)?.state).toBe("blocked");
  });

  it("does not allow Eval to mutate a task before the evaluating state", () => {
    const repository = store();
    const runtime = new HarnessRuntime(repository);
    const task = runtime.createTask({ brain: "requirement", operation: "analyze", inputSummary: "Analyze" });
    expect(() => runtime.applyEval(task.id, {
      verdict: "pass",
      score: 1,
      reasons: [],
      affectedAssetIds: [],
      evidenceRefs: [],
      nextActions: []
    })).toThrow(/must be evaluating/);
    expect(repository.brainTasks[0].eval).toBeUndefined();
  });

  it("rejects actions, files, URLs, and writes outside the declared policy", () => {
    const result = checkHarnessPolicy({
      allowedFiles: [".brain-creator/runs/run-1"],
      allowedUrls: ["https://orders.example.test"],
      allowedActions: ["read"],
      forbiddenActions: ["approve"],
      allowWrites: false,
      requireApproval: true
    }, {
      files: ["tests/generated/test.spec.ts"],
      urls: ["https://other.example.test"],
      action: "approve",
      writes: 1
    });

    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(5);
  });

  it("keeps deferred provider work in the same Brain task lifecycle", () => {
    const repository = store();
    const runtime = new HarnessRuntime(repository);
    const session = runtime.createSession({ currentSystemId: "system-a", provider: "host-agent" });
    const task = runtime.startDeferredTask({
      brain: "testexecution",
      operation: "run-case",
      inputSummary: "Run case with host agent",
      sessionId: session.id,
      contextPack: {
        taskId: "pending",
        purpose: "testexecution",
        summary: "Current case context",
        references: [{ ref: "case:1", kind: "execution" }],
        content: "case context",
        estimatedChars: 12,
        truncated: false
      },
      approved: true
    });

    expect(task.state).toBe("waiting-provider");
    expect(task.status).toBe("pending");
    expect(task.contextPack?.summary).toBe("Current case context");
    expect(task.contextPack?.taskId).toBe(task.id);

    const completed = runtime.completeDeferredTask(task.id, {
      verdict: "pass",
      score: 1,
      reasons: [],
      affectedAssetIds: [],
      evidenceRefs: ["execution:run-1"],
      nextActions: []
    }, ["artifact:report.json"]);

    expect(completed).toEqual(expect.objectContaining({ state: "completed", status: "succeeded" }));
    expect(completed.outputRefs).toEqual(["artifact:report.json"]);
    expect(repository.brainEvents.map((event) => event.type)).toEqual([
      "task-created",
      "task-context-ready",
      "task-waiting-provider",
      "task-executing",
      "task-evaluating",
      "task-completed"
    ]);
  });

  it("does not let deferred provider work bypass approval", () => {
    const repository = store();
    const runtime = new HarnessRuntime(repository);
    const task = runtime.startDeferredTask({
      brain: "requirement",
      operation: "generate-plan",
      inputSummary: "Generate plan"
    });

    expect(task.state).toBe("waiting-approval");
    expect(() => runtime.completeDeferredTask(task.id, {
      verdict: "pass",
      score: 1,
      reasons: [],
      affectedAssetIds: [],
      evidenceRefs: [],
      nextActions: []
    })).toThrow(/waiting-provider/);

    runtime.resumeDeferredTask(task.id, true);
    expect(runtime.getTask(task.id)?.state).toBe("waiting-provider");
  });

  it("rejects path traversal and lookalike origins in policy boundaries", () => {
    const result = checkHarnessPolicy({
      allowedFiles: [".brain-creator/runs/run-1"],
      allowedUrls: ["https://orders.example.test"],
      allowedActions: [],
      forbiddenActions: [],
      allowWrites: true,
      requireApproval: false
    }, {
      files: [".brain-creator/runs/run-1/../secrets.json"],
      urls: ["https://orders.example.test.evil/steal"],
      writes: 0
    });

    expect(result.allowed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.stringContaining("file is outside"),
      expect.stringContaining("URL is outside")
    ]));
  });

  it("blocks a context pack that exceeds the task budget", () => {
    const repository = store();
    const runtime = new HarnessRuntime(repository);
    const task = runtime.createTask({
      brain: "requirement",
      operation: "analyze",
      inputSummary: "Analyze requirement",
      budget: { maxContextChars: 5 }
    });

    expect(() => runtime.setContextPack(task.id, {
      taskId: "ignored",
      purpose: "requirement",
      summary: "Too large",
      references: [],
      content: "123456",
      estimatedChars: 6,
      truncated: false
    })).toThrow(/context budget/i);
    expect(runtime.getTask(task.id)).toEqual(expect.objectContaining({
      state: "blocked",
      status: "failed",
      lastError: expect.stringMatching(/context budget/i)
    }));
    expect(repository.brainEvents.at(-1)?.message).toMatch(/context budget/i);
  });
});
