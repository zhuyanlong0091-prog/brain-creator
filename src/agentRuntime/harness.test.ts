import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { plannerPolicy, runAgentHarness } from "./harness.js";
import type { AgentBridge } from "../agent/orchestrator.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runAgentHarness", () => {
  it("writes an evidence bundle for agent execution", async () => {
    const workDir = await tempDir();
    const contextPath = join(workDir, "context.json");
    await writeFile(contextPath, JSON.stringify({ systemId: "system_1" }), "utf8");
    const bridge: AgentBridge = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ scenarios: [] }),
      stderr: ""
    });

    const result = await runAgentHarness(
      {
        runId: "run_1",
        systemId: "system_1",
        agent: "planner",
        contextPackPath: contextPath,
        workingDir: workDir,
        allowedFiles: ["specs/plan.md"],
        timeoutMs: 1000,
        policy: plannerPolicy,
        outputPaths: ["specs/plan.md"]
      },
      bridge
    );

    expect(result.status).toBe("succeeded");
    await expect(readFile(result.structuredOutputPath, "utf8")).resolves.toContain("scenarios");
    await expect(readFile(result.evalPath, "utf8")).resolves.toContain("Rule-based eval passed");
    await expect(readFile(result.ledgerPath, "utf8")).resolves.toContain("run_1");
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-harness-"));
  tempDirs.push(dir);
  return dir;
}
