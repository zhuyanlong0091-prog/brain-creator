import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createClaudeSubagentBridge } from "../src/agent/claudeBridge.js";
import { extractMarkdown, extractTypeScript } from "../src/agent/liveSmokeOutput.js";
import { spawnCommand } from "../src/agent/orchestrator.js";
import type { AgentBridgeInput } from "../src/agent/orchestrator.js";

const timeoutMs = Number(process.env.BRAIN_CREATOR_AGENT_TIMEOUT_MS ?? 300000);
const keepArtifacts = process.env.BRAIN_CREATOR_KEEP_LIVE_ARTIFACTS === "1";
const generatedRoot = join(process.cwd(), "tests", "generated");
await mkdir(generatedRoot, { recursive: true });
const workDir = await mkdtemp(join(generatedRoot, "live-agent-"));
const specsDir = join(workDir, "specs");
const testsDir = join(workDir, "tests", "generated");
await mkdir(specsDir, { recursive: true });
await mkdir(testsDir, { recursive: true });

const bridge = createClaudeSubagentBridge({
  command: process.env.BRAIN_CREATOR_AGENT_COMMAND,
  baseArgs: parseArgs(process.env.BRAIN_CREATOR_AGENT_ARGS) ?? [
    "--print",
    "--permission-mode",
    "acceptEdits"
  ],
  timeoutMs
});

try {
  console.log(`Running live Agent artifact smoke in ${workDir}`);
  const specPath = join(specsDir, "live-planner-artifact.md");
  const plannerOutput = await runLiveAgent({
    agent: "planner",
    inputSummary:
      "Live artifact smoke. Return the Markdown content in stdout only. Do not ask permission. Do not create or edit files. Include the exact text 'Brain Creator Live Planner Artifact' and one scenario that validates 'Order total: 42'."
  });
  await writeFile(specPath, extractMarkdown(plannerOutput), "utf8");
  const specContent = await readFile(specPath, "utf8");
  assertIncludes(specContent, "Brain Creator Live Planner Artifact", "planner spec marker");

  const generatedTestPath = join(testsDir, "live-generator.spec.ts");
  const generatorOutput = await runCodeAgent({
    agent: "generator",
    inputSummary: [
      "Live artifact smoke. Return only a complete TypeScript Playwright test file.",
      "Return the TypeScript content in stdout only. Do not ask permission. Do not create or edit files.",
      "Do not return an outline, explanation, checklist, or markdown prose.",
      "The first non-empty line must be: import { test, expect } from '@playwright/test';",
      "The test must import { test, expect } from '@playwright/test'.",
      "The test must navigate to data:text/html,<h1>Brain Creator Live</h1><p>Order total: 42</p>.",
      "The test must assert that 'Brain Creator Live' and 'Order total: 42' are visible.",
      "",
      "Planner spec:",
      specContent
    ].join("\n")
  });
  await writeFile(generatedTestPath, generatorOutput, "utf8");
  await runPlaywright(generatedTestPath, "generator Playwright test");

  const brokenTestPath = join(testsDir, "live-healer.spec.ts");
  await writeFile(
    brokenTestPath,
    [
      "import { test, expect } from '@playwright/test';",
      "",
      "test('Brain Creator healer repairs controlled failure', async ({ page }) => {",
      "  await page.goto('data:text/html,<h1>Brain Creator Live</h1><p>Order total: 42</p>');",
      "  await expect(page.getByText('Missing Total')).toBeVisible();",
      "});",
      ""
    ].join("\n"),
    "utf8"
  );
  const healerOutput = await runCodeAgent({
    agent: "healer",
    inputSummary: [
      "Live artifact smoke. Return only a complete repaired TypeScript Playwright test file.",
      "Return the repaired TypeScript content in stdout only. Do not ask permission. Do not create or edit files.",
      "Do not return an outline, explanation, checklist, or markdown prose.",
      "The first non-empty line must be: import { test, expect } from '@playwright/test';",
      "The original test fails because it asserts 'Missing Total'.",
      "Repair the assertion to validate the visible text 'Order total: 42'.",
      "",
      "Failing test source:",
      await readFile(brokenTestPath, "utf8")
    ].join("\n")
  });
  await writeFile(brokenTestPath, healerOutput, "utf8");
  await runPlaywright(brokenTestPath, "healer repaired Playwright test");

  console.log("Live Agent artifact smoke passed.");
  console.log(`Spec: ${specPath}`);
  console.log(`Generated test: ${generatedTestPath}`);
  console.log(`Healed test: ${brokenTestPath}`);
} finally {
  if (!keepArtifacts) {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function runLiveAgent(input: Pick<AgentBridgeInput, "agent" | "inputSummary">) {
  const result = await bridge({
    systemId: "live-agent-artifact-smoke",
    agent: input.agent,
    inputSummary: input.inputSummary,
    args: [],
    outputPaths: [],
    cwd: process.cwd(),
    timeoutMs
  });
  const output = [result.stdout, result.stderr].map((entry) => entry.trim()).filter(Boolean).join("\n");
  console.log(`[${input.agent}] exit=${result.exitCode}`);
  if (result.exitCode !== 0) {
    throw new Error(output || `Live ${input.agent} agent failed`);
  }
  return output;
}

async function runCodeAgent(input: Pick<AgentBridgeInput, "agent" | "inputSummary">) {
  let output = await runLiveAgent(input);
  try {
    return extractTypeScript(output);
  } catch (firstError) {
    output = await runLiveAgent({
      agent: input.agent,
      inputSummary: [
        "Your previous response was not a raw TypeScript Playwright test file.",
        "Return only code. The first line must be:",
        "import { test, expect } from '@playwright/test';",
        "The test must assert 'Order total: 42'.",
        "",
        "Original task:",
        input.inputSummary,
        "",
        "Previous invalid response:",
        firstError instanceof Error ? firstError.message : String(firstError)
      ].join("\n")
    });
    return extractTypeScript(output);
  }
}

async function runPlaywright(testPath: string, label: string) {
  const testRunPath = relative(process.cwd(), testPath).replace(/\\/g, "/");
  const result = await spawnCommand("npx", ["playwright", "test", testRunPath], {
    cwd: process.cwd(),
    timeoutMs
  });
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed\n${result.stdout}\n${result.stderr}`);
  }
  console.log(`[playwright] ${label} passed`);
}

function assertIncludes(content: string, expected: string, label: string) {
  if (!content.includes(expected)) {
    throw new Error(`Missing ${label}: ${expected}\n${content}`);
  }
}

function parseArgs(raw: string | undefined) {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed;
    }
  } catch {
    // Fall back to whitespace splitting for simple local shells.
  }
  return raw.split(/\s+/).filter(Boolean);
}
