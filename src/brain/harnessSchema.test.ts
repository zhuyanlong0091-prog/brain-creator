import { describe, expect, it } from "vitest";
import {
  evaluateStructuredAgentOutput,
  validateStructuredAgentOutput,
  type GeneratorHarnessOutput,
  type HealerHarnessOutput,
  type PlannerHarnessOutput
} from "./harnessSchema.js";

describe("unified Planner Generator Healer Harness schema", () => {
  it("validates a planner output and preserves requirement provenance", () => {
    const output: PlannerHarnessOutput = {
      version: 1,
      agent: "planner",
      status: "ready",
      scenarios: [{
        id: "scenario-1",
        title: "Create order",
        requirementRefs: ["clause:order-create"],
        steps: ["Open orders", "Create an order"],
        sourceRefs: ["clause:order-create"]
      }],
      gaps: []
    };

    expect(validateStructuredAgentOutput("planner", output)).toEqual({ valid: true, errors: [] });
    expect(evaluateStructuredAgentOutput("planner", output)).toEqual(expect.objectContaining({
      verdict: "pass",
      score: 1
    }));
  });

  it("blocks generator output that escapes the declared file boundary", () => {
    const output: GeneratorHarnessOutput = {
      version: 1,
      agent: "generator",
      status: "generated",
      testPath: "src/production.ts",
      steps: [{ id: "step-1", sourceRefs: ["page:orders"] }],
      assertions: [{ id: "assert-1", sourceRefs: ["clause:order-create"] }],
      sourceRefs: ["clause:order-create"]
    };

    const evaluation = evaluateStructuredAgentOutput("generator", output, {
      allowedFiles: ["tests/generated/"],
      text: JSON.stringify(output)
    });
    expect(evaluation.verdict).toBe("blocked");
    expect(evaluation.reasons.join(" ")).toMatch(/allowed file|boundary/i);
  });

  it("blocks a healer that removes assertions or hides sensitive output", () => {
    const output: HealerHarnessOutput = {
      version: 1,
      agent: "healer",
      status: "healed",
      targetTestPath: "tests/generated/orders.spec.ts",
      changedFiles: ["tests/generated/orders.spec.ts"],
      removedAssertionIds: ["assert-1"],
      failureRefs: ["reporter:failure-1"],
      sourceRefs: ["reporter:failure-1"],
      notes: "password=secret-token"
    };

    const evaluation = evaluateStructuredAgentOutput("healer", output, {
      allowedFiles: ["tests/generated/"],
      text: JSON.stringify(output)
    });
    expect(evaluation.verdict).toBe("blocked");
    expect(evaluation.reasons.join(" ")).toMatch(/assertion|secret/i);
  });

  it("scans the structured output even when an input summary is supplied", () => {
    const output: GeneratorHarnessOutput = {
      version: 1,
      agent: "generator",
      status: "generated",
      testPath: "tests/generated/orders.spec.ts",
      steps: [{ id: "step-1", sourceRefs: ["page:orders"] }],
      assertions: [{ id: "assert-1", sourceRefs: ["clause:order-create"] }],
      sourceRefs: ["clause:order-create"]
    };

    const evaluation = evaluateStructuredAgentOutput("generator", {
      ...output,
      sourceRefs: ["token=raw-secret"]
    }, { text: "Generate an order test" });

    expect(evaluation.verdict).toBe("blocked");
    expect(evaluation.reasons.join(" ")).toMatch(/credential/i);
  });
});
