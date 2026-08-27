import type { CreateBrainTaskInput, HarnessRuntime } from "../brain/harness.js";
import {
  evaluateStructuredAgentOutput,
  type StructuredAgentName
} from "../brain/harnessSchema.js";
import type { BrainEvalResult } from "../brain/types.js";

export type HarnessExecutionResult<T> = {
  taskId: string;
  result: T;
  evaluation: BrainEvalResult;
};

export async function runInHarness<T>(input: {
  runtime: HarnessRuntime;
  task: CreateBrainTaskInput;
  approved?: boolean;
  execute: () => Promise<T>;
  evaluate: (result: T) => BrainEvalResult;
  agent?: StructuredAgentName;
  structuredOutput?: (result: T) => unknown | Promise<unknown>;
  structuredOutputs?: (result: T) => Array<{
    agent: StructuredAgentName;
    output: unknown;
  }> | Promise<Array<{ agent: StructuredAgentName; output: unknown }>>;
  enforceEvaluation?: boolean;
}): Promise<HarnessExecutionResult<T>> {
  const task = input.runtime.createTask(input.task);
  input.runtime.transition(task.id, "context-ready");
  if (task.policy.requireApproval && input.approved !== true) {
    input.runtime.transition(task.id, "waiting-approval", "Harness approval is required before execution");
    throw new Error(`Harness approval required for task ${task.id}`);
  }

  input.runtime.transition(task.id, "executing");
  try {
    input.runtime.recordAgentCall(task.id);
    const result = await withTimeout(input.execute(), task.budget.maxDurationMs);
    input.runtime.transition(task.id, "evaluating");
    const baseEvaluation = input.evaluate(result);
    const structuredEvaluations = input.structuredOutputs
      ? await input.structuredOutputs(result)
      : input.agent && input.structuredOutput
        ? [{ agent: input.agent, output: await input.structuredOutput(result) }]
        : [];
    const structuredEvaluation = structuredEvaluations.reduce<BrainEvalResult | undefined>(
      (current, item) => mergeEvaluations(
        current ?? passEvaluation(),
        evaluateStructuredAgentOutput(item.agent, item.output, {
          allowedFiles: task.policy.allowedFiles,
          text: task.inputSummary
        })
      ),
      undefined
    );
    const evaluation = mergeEvaluations(baseEvaluation, structuredEvaluation);
    input.runtime.applyEval(task.id, evaluation);
    if (input.enforceEvaluation && evaluation.verdict !== "pass") {
      throw new Error(
        `Harness Eval ${evaluation.verdict} for task ${task.id}: ${evaluation.reasons.join("; ") || "review required"}`
      );
    }
    return { taskId: task.id, result, evaluation };
  } catch (error) {
    const current = input.runtime.getTask(task.id);
    if (current && ["executing", "evaluating", "healing"].includes(current.state)) {
      const message = error instanceof Error ? error.message : String(error);
      input.runtime.transition(
        task.id,
        message.startsWith("Harness task timed out") ? "blocked" : "failed",
        message
      );
    }
    throw error;
  }
}

function passEvaluation(): BrainEvalResult {
  return {
    verdict: "pass",
    score: 1,
    reasons: [],
    affectedAssetIds: [],
    evidenceRefs: [],
    nextActions: []
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Harness task timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function mergeEvaluations(
  base: BrainEvalResult,
  structured: BrainEvalResult | undefined
): BrainEvalResult {
  if (!structured || structured.verdict === "pass") return base;
  if (base.verdict === "blocked") return base;
  return {
    verdict: structured.verdict,
    score: Math.min(base.score, structured.score),
    reasons: [...new Set([...base.reasons, ...structured.reasons])],
    affectedAssetIds: [...new Set([...base.affectedAssetIds, ...structured.affectedAssetIds])],
    evidenceRefs: [...new Set([...base.evidenceRefs, ...structured.evidenceRefs])],
    nextActions: [...new Set([...base.nextActions, ...structured.nextActions])]
  };
}
