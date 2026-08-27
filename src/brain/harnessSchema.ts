import type { BrainEvalResult } from "./types.js";

export type StructuredAgentName = "planner" | "generator" | "healer";

export type PlannerHarnessOutput = {
  version: 1;
  agent: "planner";
  status: "ready" | "needs-review" | "blocked";
  scenarios: Array<{
    id: string;
    title: string;
    requirementRefs: string[];
    steps: string[];
    sourceRefs: string[];
  }>;
  gaps: string[];
};

export type GeneratorHarnessOutput = {
  version: 1;
  agent: "generator";
  status: "generated" | "blocked";
  testPath: string;
  steps: Array<{ id: string; sourceRefs: string[] }>;
  assertions: Array<{ id: string; sourceRefs: string[] }>;
  sourceRefs: string[];
};

export type HealerHarnessOutput = {
  version: 1;
  agent: "healer";
  status: "healed" | "unresolved" | "blocked";
  targetTestPath: string;
  changedFiles: string[];
  removedAssertionIds: string[];
  failureRefs: string[];
  sourceRefs: string[];
  notes?: string;
};

export type StructuredAgentOutput =
  | PlannerHarnessOutput
  | GeneratorHarnessOutput
  | HealerHarnessOutput;

export type StructuredOutputValidation = {
  valid: boolean;
  errors: string[];
};

export type StructuredOutputEvalContext = {
  allowedFiles?: string[];
  text?: string;
};

export function validateStructuredAgentOutput(
  agent: StructuredAgentName,
  value: unknown
): StructuredOutputValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["Output must be an object"] };
  if (value.version !== 1) errors.push("Unsupported Harness output version");
  if (value.agent !== agent) errors.push(`Output agent must be ${agent}`);
  if (agent === "planner") validatePlanner(value, errors);
  if (agent === "generator") validateGenerator(value, errors);
  if (agent === "healer") validateHealer(value, errors);
  return { valid: errors.length === 0, errors };
}

export function evaluateStructuredAgentOutput(
  agent: StructuredAgentName,
  value: unknown,
  context: StructuredOutputEvalContext = {}
): BrainEvalResult {
  const validation = validateStructuredAgentOutput(agent, value);
  if (!validation.valid) return blocked(validation.errors);
  const rawOutput = value as StructuredAgentOutput;
  const reasons: string[] = [];
  const nextActions: string[] = [];
  const text = [context.text, JSON.stringify(rawOutput)].filter(Boolean).join("\n");
  if (hasSensitiveText(text)) {
    reasons.push("Structured output contains a credential-like value");
  }

  if (agent === "planner") {
    const output = value as PlannerHarnessOutput;
    if (output.scenarios.length === 0) reasons.push("Planner produced no scenarios");
    if (output.scenarios.some((scenario) => scenario.requirementRefs.length === 0 || scenario.sourceRefs.length === 0)) {
      reasons.push("Every planner scenario requires requirement and source references");
    }
    if (output.gaps.length > 0) nextActions.push("review-planner-gaps");
  }
  if (agent === "generator") {
    const output = value as GeneratorHarnessOutput;
    if (!isPathAllowed(output.testPath, context.allowedFiles ?? [])) {
      reasons.push("Generated test path is outside the Harness allowed file boundary");
    }
    if (output.steps.some((step) => step.sourceRefs.length === 0) || output.assertions.some((assertion) => assertion.sourceRefs.length === 0)) {
      reasons.push("Generated steps and assertions require evidence references");
    }
    if (output.status === "blocked") nextActions.push("review-generator-blocker");
  }
  if (agent === "healer") {
    const output = value as HealerHarnessOutput;
    if (!isPathAllowed(output.targetTestPath, context.allowedFiles ?? [])) {
      reasons.push("Healer target is outside the Harness allowed file boundary");
    }
    if (output.removedAssertionIds.length > 0) {
      reasons.push("Healer output removes assertions, which is forbidden");
    }
    if (output.status === "healed" && output.failureRefs.length === 0) {
      reasons.push("A healed result must reference the real failure");
    }
  }
  if (reasons.some((reason) => /credential|assertions|outside|requires evidence|no scenarios/i.test(reason))) {
    return blocked(reasons, nextActions);
  }
  const outputStatus = (value as StructuredAgentOutput).status;
  if (reasons.length > 0 || outputStatus === "needs-review" || outputStatus === "unresolved" || outputStatus === "blocked") {
    return {
      verdict: outputStatus === "blocked" ? "blocked" : "needs-review",
      score: 0.5,
      reasons,
      affectedAssetIds: [],
      evidenceRefs: outputSourceRefs(rawOutput),
      nextActions
    };
  }
  return {
    verdict: "pass",
    score: 1,
    reasons: [],
    affectedAssetIds: [],
    evidenceRefs: outputSourceRefs(rawOutput),
    nextActions
  };
}

export function plannerOutputFromResult(input: {
  status: "succeeded" | "failed";
  scenarios: Array<{ id: string; title: string; steps: Array<{ target: string; expected?: string }>; requirementRefs?: string[] }>;
  sourceRefs: string[];
  gaps?: string[];
}): PlannerHarnessOutput {
  return {
    version: 1,
    agent: "planner",
    status: input.status === "succeeded" ? "ready" : "blocked",
    scenarios: input.scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      requirementRefs: scenario.requirementRefs?.length ? scenario.requirementRefs : input.sourceRefs,
      steps: scenario.steps.map((step) => `${step.target}${step.expected ? ` -> ${step.expected}` : ""}`),
      sourceRefs: input.sourceRefs
    })),
    gaps: input.gaps ?? []
  };
}

function validatePlanner(value: Record<string, unknown>, errors: string[]) {
  if (!isStatus(value.status, ["ready", "needs-review", "blocked"])) errors.push("Planner status is invalid");
  if (!Array.isArray(value.scenarios)) errors.push("Planner scenarios must be an array");
  if (!Array.isArray(value.gaps)) errors.push("Planner gaps must be an array");
  forEachRecord(value.scenarios, (scenario, index) => {
    requireString(scenario.id, `Planner scenario ${index} id`, errors);
    requireString(scenario.title, `Planner scenario ${index} title`, errors);
    requireStringArray(scenario.requirementRefs, `Planner scenario ${index} requirementRefs`, errors);
    requireStringArray(scenario.steps, `Planner scenario ${index} steps`, errors);
    requireStringArray(scenario.sourceRefs, `Planner scenario ${index} sourceRefs`, errors);
  });
}

function validateGenerator(value: Record<string, unknown>, errors: string[]) {
  if (!isStatus(value.status, ["generated", "blocked"])) errors.push("Generator status is invalid");
  requireString(value.testPath, "Generator testPath", errors);
  requireStringArray(value.sourceRefs, "Generator sourceRefs", errors);
  if (!Array.isArray(value.steps)) errors.push("Generator steps must be an array");
  if (!Array.isArray(value.assertions)) errors.push("Generator assertions must be an array");
  forEachRecord(value.steps, (step, index) => {
    requireString(step.id, `Generator step ${index} id`, errors);
    requireStringArray(step.sourceRefs, `Generator step ${index} sourceRefs`, errors);
  });
  forEachRecord(value.assertions, (assertion, index) => {
    requireString(assertion.id, `Generator assertion ${index} id`, errors);
    requireStringArray(assertion.sourceRefs, `Generator assertion ${index} sourceRefs`, errors);
  });
}

function validateHealer(value: Record<string, unknown>, errors: string[]) {
  if (!isStatus(value.status, ["healed", "unresolved", "blocked"])) errors.push("Healer status is invalid");
  requireString(value.targetTestPath, "Healer targetTestPath", errors);
  requireStringArray(value.changedFiles, "Healer changedFiles", errors);
  requireStringArray(value.removedAssertionIds, "Healer removedAssertionIds", errors);
  requireStringArray(value.failureRefs, "Healer failureRefs", errors);
  requireStringArray(value.sourceRefs, "Healer sourceRefs", errors);
}

function blocked(reasons: string[], nextActions: string[] = []): BrainEvalResult {
  return {
    verdict: "blocked",
    score: 0,
    reasons,
    affectedAssetIds: [],
    evidenceRefs: [],
    nextActions: [...new Set(["review-harness-output", ...nextActions])]
  };
}

function outputSourceRefs(output: StructuredAgentOutput) {
  if (output.agent === "planner") return [...new Set(output.scenarios.flatMap((scenario) => scenario.sourceRefs))];
  return output.sourceRefs;
}

function isPathAllowed(value: string, allowedFiles: string[]) {
  if (allowedFiles.length === 0) return true;
  const normalized = value.replaceAll("\\", "/");
  return allowedFiles.some((allowed) => {
    const prefix = allowed.replaceAll("\\", "/").replace(/\/+$/u, "");
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

function hasSensitiveText(value: string) {
  return /(?:password|token|cookie|secret|authorization)\s*[:=]\s*[^\s,;}]+/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function forEachRecord(value: unknown, callback: (value: Record<string, unknown>, index: number) => void) {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (isRecord(item)) callback(item, index);
  });
}

function requireString(value: unknown, label: string, errors: string[]) {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${label} must be a non-empty string`);
}

function requireStringArray(value: unknown, label: string, errors: string[]) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    errors.push(`${label} must be an array of non-empty strings`);
  }
}

function isStatus(value: unknown, statuses: string[]): value is string {
  return typeof value === "string" && statuses.includes(value);
}
