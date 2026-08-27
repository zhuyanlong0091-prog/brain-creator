import { describe, expect, it, vi } from "vitest";
import { HarnessRuntime, type HarnessStore } from "../brain/harness.js";
import { runInHarness } from "./harnessAdapter.js";

function store(): HarnessStore {
  return { brainTasks: [], brainSessions: [], brainEvents: [], persist: vi.fn() };
}

describe("runInHarness", () => {
  it("does not execute an unapproved task", async () => {
    const runtime = new HarnessRuntime(store());
    const execute = vi.fn(async () => "should-not-run");

    await expect(runInHarness({
      runtime,
      task: { brain: "testcase", operation: "compile", inputSummary: "Compile case" },
      execute,
      evaluate: () => passEval()
    })).rejects.toThrow(/approval required/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("records the agent lifecycle and applies the structured Eval", async () => {
    const repository = store();
    const runtime = new HarnessRuntime(repository);
    const execution = await runInHarness({
      runtime,
      approved: true,
      task: {
        brain: "testexecution",
        operation: "run-case",
        inputSummary: "Run case",
        policy: { allowWrites: true }
      },
      execute: async () => ({ status: "succeeded" }),
      evaluate: () => passEval()
    });

    expect(repository.brainTasks).toEqual([
      expect.objectContaining({ id: execution.taskId, state: "completed", status: "succeeded" })
    ]);
    expect(repository.brainEvents.map((event) => event.type)).toEqual([
      "task-created",
      "task-context-ready",
      "task-executing",
      "task-evaluating",
      "task-completed"
    ]);
  });

  it("marks an execution error as failed and preserves the error message", async () => {
    const repository = store();
    const runtime = new HarnessRuntime(repository);

    await expect(runInHarness({
      runtime,
      approved: true,
      task: { brain: "system", operation: "explore", inputSummary: "Explore system" },
      execute: async () => {
        throw new Error("fixture navigation failed");
      },
      evaluate: () => passEval()
    })).rejects.toThrow("fixture navigation failed");

    expect(repository.brainTasks[0]).toEqual(expect.objectContaining({
      state: "failed",
      status: "failed"
    }));
    expect(repository.brainEvents.at(-1)?.message).toContain("fixture navigation failed");
  });

  it("does not complete a task when the structured agent output fails Eval", async () => {
    const repository = store();
    const runtime = new HarnessRuntime(repository);

    const result = await runInHarness({
      runtime,
      approved: true,
      agent: "generator",
      task: {
        brain: "testcase",
        operation: "generate",
        inputSummary: "Generate a test",
        policy: { allowWrites: true, allowedFiles: ["tests/generated/"] }
      },
      execute: async () => ({ status: "generated" }),
      structuredOutput: async () => ({
        version: 1,
        agent: "generator",
        status: "generated",
        testPath: "src/business-code.ts",
        steps: [{ id: "step-1", sourceRefs: ["page:orders"] }],
        assertions: [{ id: "assert-1", sourceRefs: ["requirement:order"] }],
        sourceRefs: ["requirement:order"]
      }),
      evaluate: () => passEval()
    });

    expect(repository.brainTasks.find((task) => task.id === result.taskId)).toEqual(expect.objectContaining({
      state: "blocked",
      status: "failed",
      eval: expect.objectContaining({ verdict: "blocked" })
    }));
  });

  it("blocks a task when its declared duration budget is exceeded", async () => {
    const repository = store();
    const runtime = new HarnessRuntime(repository);
    await expect(runInHarness({
      runtime,
      approved: true,
      task: {
        brain: "testexecution",
        operation: "run-long-case",
        inputSummary: "Long case",
        budget: { maxDurationMs: 5 }
      },
      execute: () => new Promise((resolve) => setTimeout(() => resolve("late"), 30)),
      evaluate: () => passEval()
    })).rejects.toThrow(/timed out/);
    expect(repository.brainTasks[0]).toEqual(expect.objectContaining({ state: "blocked", status: "failed" }));
  });

  it("can enforce the Eval gate before the caller writes downstream assets", async () => {
    const repository = store();
    const runtime = new HarnessRuntime(repository);

    await expect(runInHarness({
      runtime,
      approved: true,
      enforceEvaluation: true,
      agent: "generator",
      task: {
        brain: "testcase",
        operation: "generate",
        inputSummary: "Generate a test",
        policy: { allowWrites: true, allowedFiles: ["tests/generated/"] }
      },
      execute: async () => ({ status: "generated" }),
      structuredOutput: async () => ({
        version: 1,
        agent: "generator",
        status: "generated",
        testPath: "src/business-code.ts",
        steps: [],
        assertions: [],
        sourceRefs: ["case:1"]
      }),
      evaluate: () => passEval()
    })).rejects.toThrow(/Harness Eval blocked/);

    expect(repository.brainTasks[0]).toEqual(expect.objectContaining({
      state: "blocked",
      eval: expect.objectContaining({ verdict: "blocked" })
    }));
  });

  it("evaluates generator and healer outputs together", async () => {
    const repository = store();
    const runtime = new HarnessRuntime(repository);
    const result = await runInHarness({
      runtime,
      approved: true,
      task: {
        brain: "testexecution",
        operation: "run-chain",
        inputSummary: "Run chain",
        policy: { allowWrites: true, allowedFiles: ["tests/generated/"] }
      },
      execute: async () => "done",
      structuredOutputs: () => [
        {
          agent: "generator" as const,
          output: {
            version: 1,
            agent: "generator",
            status: "generated",
            testPath: "tests/generated/orders.spec.ts",
            steps: [{ id: "step-1", sourceRefs: ["case:1"] }],
            assertions: [{ id: "assert-1", sourceRefs: ["case:1"] }],
            sourceRefs: ["case:1"]
          }
        },
        {
          agent: "healer" as const,
          output: {
            version: 1,
            agent: "healer",
            status: "healed",
            targetTestPath: "tests/generated/orders.spec.ts",
            changedFiles: ["tests/generated/orders.spec.ts"],
            removedAssertionIds: ["assert-1"],
            failureRefs: ["reporter:1"],
            sourceRefs: ["reporter:1"]
          }
        }
      ],
      evaluate: () => passEval()
    });
    expect(repository.brainTasks.find((task) => task.id === result.taskId)?.eval).toEqual(expect.objectContaining({
      verdict: "blocked"
    }));
  });
});

function passEval() {
  return {
    verdict: "pass" as const,
    score: 1,
    reasons: [],
    affectedAssetIds: [],
    evidenceRefs: [],
    nextActions: []
  };
}
