import { describe, expect, it } from "vitest";
import { evaluateAgentOutput } from "./eval.js";

describe("evaluateAgentOutput", () => {
  it("blocks planner output that appears to generate code before approval", () => {
    expect(
      evaluateAgentOutput({
        agent: "planner",
        outputText: "```ts\nimport { test } from '@playwright/test';\n```",
        context: { systemId: "system_1", approved: false, allowedFiles: [] }
      })
    ).toEqual(
      expect.objectContaining({
        verdict: "blocked",
        reasons: expect.arrayContaining(["Planner output must not generate test code"])
      })
    );
  });

  it("blocks generator output that includes a secret-like token", () => {
    expect(
      evaluateAgentOutput({
        agent: "generator",
        outputText: "const token = 'Bearer abc.def.ghi';",
        context: { systemId: "system_1", approved: true, allowedFiles: ["tests/generated/a.spec.ts"] }
      }).verdict
    ).toBe("blocked");
  });
});
