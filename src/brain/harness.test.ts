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
});
