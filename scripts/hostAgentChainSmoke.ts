import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createConfiguredAgentBridge } from "../src/agent/bridgeProvider.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "../src/mcp/handlers.js";

const workDir = await mkdtemp(join(tmpdir(), "brain-host-agent-chain-"));
let testCaseId = "";

try {
  const context = createBrainCreatorMcpContext({
    dataFilePath: join(workDir, "assets.json"),
    workDir,
    agentBridge: createConfiguredAgentBridge({
      env: { BRAIN_CREATOR_AGENT_PROVIDER: "host-agent" }
    }),
    runner: async (command, args) => {
      assert(command === "npx", `Expected Playwright runner command to be npx, got ${command}`);
      assert(args.join(" ") === `playwright test tests/generated/${testCaseId}.spec.ts`, "Unexpected Playwright args");
      return { exitCode: 0, stdout: "host-agent smoke playwright passed", stderr: "" };
    }
  });

  const system = dataOf(
    await handleBrainCreatorTool(context, "bc_create_system", {
      name: "Host Agent Smoke",
      environment: "local",
      baseUrl: "https://host-agent.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://host-agent.example.test"]
    })
  );
  await handleBrainCreatorTool(context, "bc_create_auth", {
    projectId: system.id,
    env: "local",
    role: "qa-agent",
    loginMethod: "token",
    secrets: { token: "redacted-smoke-token" }
  });

  const draftCase = context.service.createTestCase({
    systemId: system.id,
    requirement: "Verify host-agent task handoff can generate and submit a deterministic test.",
    scenarios: [
      {
        id: "scenario_1",
        title: "Host-agent checkout smoke",
        priority: "critical",
        steps: [{ action: "assert", target: "Host Agent Smoke", expected: "visible" }]
      }
    ],
    newTerms: [],
    ruleCheckResult: { passed: true, checks: [] }
  });
  const testCase = context.service.approveTestCase(draftCase.id);
  testCaseId = testCase.id;

  const taskPackage = dataOf(
    await handleBrainCreatorTool(context, "bc_run_chain", {
      caseId: testCase.id
    })
  );

  assert(taskPackage.status === "needs_agent_execution", "bc_run_chain did not return host-agent handoff status");
  assert(taskPackage.mode === "host-agent", "bc_run_chain did not use host-agent mode");
  assert(taskPackage.stage === "generator", "Expected generator stage");
  assert(taskPackage.task.agent === "generator", "Expected generator task package");
  assert(taskPackage.submitTool === "bc_submit_agent_output", "Expected bc_submit_agent_output submit tool");
  assert(context.service.listChainRuns(system.id).length === 0, "Chain run should not exist before agent submission");
  assert((await readFile(taskPackage.promptPath, "utf8")).includes("bc_submit_agent_output"), "Prompt missing submit instructions");

  await writeFile(
    taskPackage.testPath,
    [
      "import { test, expect } from '@playwright/test';",
      "",
      "test('host-agent checkout smoke', async ({ page }) => {",
      "  await page.goto('https://host-agent.example.test');",
      "  await expect(page.getByText('Host Agent Smoke')).toBeVisible();",
      "});",
      ""
    ].join("\n"),
    "utf8"
  );

  const submitted = dataOf(
    await handleBrainCreatorTool(context, "bc_submit_agent_output", {
      taskId: taskPackage.task.id,
      status: "succeeded",
      stdout: "host agent wrote generated test",
      stderr: "",
      outputPaths: [taskPackage.testPath]
    })
  );

  assert(submitted.agentRun.status === "succeeded", "AgentRun was not recorded as succeeded");
  assert(submitted.testResult.exitCode === 0, "Submitted test did not pass deterministic runner");
  assert(submitted.chainRun.status === "succeeded", "Chain run was not marked succeeded");
  assert(submitted.chainRun.generateRunId === submitted.agentRun.id, "Chain run did not link generator AgentRun");
  assert(context.service.getTestCase(testCase.id).status === "passed", "Approved case was not marked passed");
  assert(context.service.listGaps({ projectId: system.id, status: "open" }).length === 0, "Smoke should not create gaps");

  console.log("Host-agent chain smoke passed.");
  console.log(`System: ${system.id}`);
  console.log(`Case: ${testCase.id}`);
  console.log(`Task: ${taskPackage.task.id}`);
  console.log(`Spec: ${submitted.chainRun.specPath}`);
  console.log(`Test: ${submitted.chainRun.testPath}`);
} finally {
  if (process.env.BRAIN_CREATOR_KEEP_HOST_AGENT_SMOKE_ARTIFACTS !== "1") {
    await rm(workDir, { recursive: true, force: true });
  }
}

function dataOf(result: CallToolResult): any {
  if (result.isError) {
    throw new Error(textContent(result.content?.[0]) || "Brain Creator tool failed");
  }
  return JSON.parse(textContent(result.content[0]) || "{}").data;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function textContent(content: CallToolResult["content"][number] | undefined) {
  return content?.type === "text" ? content.text : "";
}
