import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

const tempDirs: string[] = [];
const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Brain Creator real local agent chain", () => {
  it("runs planner, generator, Playwright, artifact preview, and multi-system isolation", async () => {
    const workDir = process.cwd();
    const dataDir = await tempDir();
    const bridgeScript = join(dataDir, "claude-bridge-fixture.mjs");
    await writeFile(bridgeScript, bridgeFixtureSource(), "utf8");
    const previousCommand = process.env.BRAIN_CREATOR_AGENT_COMMAND;
    const previousArgs = process.env.BRAIN_CREATOR_AGENT_ARGS;
    process.env.BRAIN_CREATOR_AGENT_COMMAND = process.execPath;
    process.env.BRAIN_CREATOR_AGENT_ARGS = JSON.stringify([bridgeScript]);

    try {
      const context = createBrainCreatorMcpContext({
        dataFilePath: join(dataDir, ".brain-creator", "assets.json"),
        workDir
      });
      const systemA = dataOf(
        await handleBrainCreatorTool(context, "bc_create_system", {
          name: "Robot Shop",
          environment: "local",
          baseUrl: "https://robot.example.test",
          defaultLocale: "zh-CN",
          urlAllowlist: ["https://robot.example.test"]
        })
      );
      const systemB = dataOf(
        await handleBrainCreatorTool(context, "bc_create_system", {
          name: "Billing Console",
          environment: "local",
          baseUrl: "https://billing.example.test",
          defaultLocale: "zh-CN",
          urlAllowlist: ["https://billing.example.test"]
        })
      );
      const auth = dataOf(
        await handleBrainCreatorTool(context, "bc_create_auth", {
          projectId: systemA.id,
          env: "local",
          role: "qa-admin",
          loginMethod: "token",
          secrets: { token: "secret-token" }
        })
      );
      await handleBrainCreatorTool(context, "bc_verify_auth", { id: auth.id });
      await handleBrainCreatorTool(context, "bc_add_rule", {
        systemId: systemA.id,
        name: "Robot payment amount",
        condition: "Order amount must be visible",
        severity: "block"
      });

      const draft = dataOf(
        await handleBrainCreatorTool(context, "bc_generate_plan", {
          systemId: systemA.id,
          requirement: "Verify robot checkout amount is visible"
        })
      );
      cleanupPaths.push(draft.specPath, draft.seedPath, join(workDir, "tests", `seed-${systemA.id}.spec.ts`));
      await handleBrainCreatorTool(context, "bc_approve_plan", {
        caseId: draft.testCase.id
      });
      const result = dataOf(
        await handleBrainCreatorTool(context, "bc_run_chain", {
          caseId: draft.testCase.id
        })
      );
      cleanupPaths.push(result.chainRun.specPath, result.chainRun.testPath);
      const specsA = dataOf(await handleBrainCreatorTool(context, "bc_list_specs", { systemId: systemA.id }));
      const testsA = dataOf(await handleBrainCreatorTool(context, "bc_list_tests", { systemId: systemA.id }));
      const specsB = dataOf(await handleBrainCreatorTool(context, "bc_list_specs", { systemId: systemB.id }));
      const testsB = dataOf(await handleBrainCreatorTool(context, "bc_list_tests", { systemId: systemB.id }));
      const specPreview = dataOf(
        await handleBrainCreatorTool(context, "bc_read_spec", {
          systemId: systemA.id,
          path: result.chainRun.specPath
        })
      );
      const testPreview = dataOf(
        await handleBrainCreatorTool(context, "bc_read_test", {
          systemId: systemA.id,
          path: result.chainRun.testPath
        })
      );
      const overview = dataOf(
        await handleBrainCreatorTool(context, "bc_artifact_overview", {
          systemId: systemA.id
        })
      );

      expect(draft.agentRun.status).toBe("succeeded");
      if (result.chainRun.status !== "succeeded") {
        const generatedTest = await readFile(result.chainRun.testPath, "utf8").catch((error) =>
          String(error)
        );
        throw new Error(`${JSON.stringify(result.chainRun, null, 2)}\n\n${generatedTest}`);
      }
      expect(result.chainRun.status).toBe("succeeded");
      expect(result.healerRuns).toEqual([]);
      expect(specsA).toEqual(expect.arrayContaining([expect.objectContaining({ path: result.chainRun.specPath })]));
      expect(testsA).toEqual([expect.objectContaining({ path: result.chainRun.testPath })]);
      expect(specsB).toEqual([]);
      expect(testsB).toEqual([]);
      expect(specPreview.content).toContain("Robot checkout");
      expect(testPreview.content).toContain("Robot Shop");
      expect(overview).toEqual(
        expect.objectContaining({
          counts: { specs: specsA.length, tests: testsA.length },
          latestSpec: expect.objectContaining({ snippet: expect.stringContaining("Robot checkout") }),
          latestTest: expect.objectContaining({ snippet: expect.stringContaining("Robot Shop") })
        })
      );
      expect(await readFile(result.chainRun.testPath, "utf8")).toContain("@playwright/test");
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_COMMAND", previousCommand);
      restoreEnv("BRAIN_CREATOR_AGENT_ARGS", previousArgs);
    }
  });
});

function bridgeFixtureSource() {
  return [
    "import { mkdir, writeFile } from 'node:fs/promises';",
    "import { dirname } from 'node:path';",
    "let stdin = '';",
    "for await (const chunk of process.stdin) stdin += chunk.toString();",
    "const output = stdin.match(/--output\\s+([^\\n]+)/)?.[1]?.trim();",
    "if (!output) { console.error('missing output path'); process.exit(2); }",
    "await mkdir(dirname(output), { recursive: true });",
    "if (stdin.includes('#playwright-test-planner')) {",
    "  await writeFile(output, ['## Scenario: Robot checkout', 'Priority: critical', 'Rule: rule_1', '- navigate: Robot Shop', '- assert: Order amount => visible'].join('\\n'), 'utf8');",
    "  console.log('planner wrote spec');",
    "} else if (stdin.includes('#playwright-test-generator')) {",
    "  await writeFile(output, `import { test, expect } from '@playwright/test';\\n\\ntest('Robot checkout amount is visible', async ({ page }) => {\\n  await page.goto('data:text/html,<h1>Robot Shop</h1><p>Order amount: 99</p>');\\n  await expect(page.getByText('Robot Shop')).toBeVisible();\\n  await expect(page.getByText('Order amount: 99')).toBeVisible();\\n});\\n`, 'utf8');",
    "  console.log('generator wrote test');",
    "} else if (stdin.includes('#playwright-test-healer')) {",
    "  console.log('healer noop');",
    "} else {",
    "  console.error('unknown subagent'); process.exit(3);",
    "}"
  ].join("\n");
}

function dataOf(result: CallToolResult) {
  const firstContent = result.content[0];
  if (firstContent.type !== "text") {
    throw new Error("Expected text result");
  }
  const parsed = JSON.parse(firstContent.text);
  if (!parsed.success) {
    throw new Error(parsed.errors.join("\n"));
  }
  return parsed.data;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function tempDir() {
  const baseDir = join(process.cwd(), ".brain-creator-test");
  await mkdir(baseDir, { recursive: true });
  const dir = await mkdtemp(join(baseDir, "real-flow-"));
  tempDirs.push(dir);
  return dir;
}
