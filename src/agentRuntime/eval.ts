import type { AgentRun, EvalResult } from "../domain/types.js";

type EvaluateInput = {
  agent: AgentRun["agent"];
  outputText: string;
  context: {
    systemId: string;
    approved: boolean;
    allowedFiles: string[];
  };
};

export function evaluateAgentOutput(input: EvaluateInput): EvalResult {
  const reasons: string[] = [];
  const requiredActions: string[] = [];

  if (input.agent === "planner" && looksLikeTestCode(input.outputText)) {
    reasons.push("Planner output must not generate test code");
    requiredActions.push("Regenerate planner output as structured scenarios only");
  }
  if (input.agent !== "planner" && !input.context.approved) {
    reasons.push("Code generation requires approved test case");
    requiredActions.push("Approve the test plan before running generator or healer");
  }
  if (containsSecret(input.outputText)) {
    reasons.push("Agent output contains secret-like content");
    requiredActions.push("Remove secrets and use redacted auth references");
  }
  if (input.agent === "healer" && deletesAssertions(input.outputText)) {
    reasons.push("Healer output appears to remove assertions");
    requiredActions.push("Create a Gap instead of weakening the test");
  }

  if (reasons.length > 0) {
    return {
      verdict: "blocked",
      score: 0,
      reasons,
      requiredActions,
      gaps: reasons.map((reason) => ({
        reason,
        severity: "high",
        sourceType: `${input.agent}-eval`,
        sourceId: input.context.systemId,
        owner: "brain-creator"
      }))
    };
  }

  return {
    verdict: "pass",
    score: 1,
    reasons: ["Rule-based eval passed"],
    requiredActions: [],
    gaps: []
  };
}

function looksLikeTestCode(value: string) {
  return /@playwright\/test|import\s+\{\s*test|test\s*\(/i.test(value);
}

function containsSecret(value: string) {
  return /Bearer\s+[A-Za-z0-9._-]{8,}|password\s*[:=]|token\s*[:=]/i.test(value);
}

function deletesAssertions(value: string) {
  return /remove(d)?\s+assert|delete(d)?\s+expect|skip\s+assert/i.test(value);
}
