import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createClaudeSubagentBridge } from "../src/agent/claudeBridge.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "../src/mcp/handlers.js";

const timeoutMs = Number(process.env.BRAIN_CREATOR_AGENT_TIMEOUT_MS ?? 300000);
const keepArtifacts = process.env.BRAIN_CREATOR_KEEP_LIVE_ARTIFACTS === "1";
const rootDir = process.cwd();
const dataDir = await mkdtemp(join(rootDir, ".brain-creator-test", "live-mcp-workflow-"));
const cleanupPaths: string[] = [dataDir];
const fixture = await startFixtureServer();

const agentBridge = createClaudeSubagentBridge({
  command: process.env.BRAIN_CREATOR_AGENT_COMMAND ?? "claude",
  baseArgs: parseArgs(process.env.BRAIN_CREATOR_AGENT_ARGS) ?? [
    "--print",
    "--permission-mode",
    "acceptEdits"
  ],
  timeoutMs
});

try {
  await mkdir(dataDir, { recursive: true });
  const context = createBrainCreatorMcpContext({
    dataFilePath: join(dataDir, "assets.json"),
    workDir: rootDir,
    agentBridge
  });
  const oneSentenceRequest =
    "Connect the Brain Creator MCP Live Demo system and generate a Playwright test that verifies the page shows Brain Creator MCP Live and Order total: 42.";
  console.log(`Running one-sentence Brain Creator MCP workflow: ${oneSentenceRequest}`);

  const system = dataOf(
    await handleBrainCreatorTool(context, "bc_create_system", {
      name: "Brain Creator MCP Live Demo",
      environment: "live-smoke",
      baseUrl: fixture.url,
      defaultLocale: "en-US",
      urlAllowlist: [fixture.url]
    })
  );
  cleanupPaths.push(
    join(rootDir, "tests", `seed-${system.id}.spec.ts`),
    join(rootDir, "specs", `${system.id}-plan.md`),
    join(rootDir, "specs", "_context", `${system.id}-prompt.md`)
  );
  const auth = dataOf(
    await handleBrainCreatorTool(context, "bc_create_auth", {
      projectId: system.id,
      env: "live-smoke",
      role: "qa-agent",
      loginMethod: "script",
      secrets: { note: "no real secret" }
    })
  );
  await handleBrainCreatorTool(context, "bc_verify_auth", { id: auth.id });
  await handleBrainCreatorTool(context, "bc_add_rule", {
    systemId: system.id,
    name: "Order total must be asserted",
    condition: "Generated scenarios and tests must assert Order total: 42",
    severity: "block"
  });

  const plan = dataOf(
    await handleBrainCreatorTool(context, "bc_generate_plan", {
      systemId: system.id,
      requirement: [
        "Verify Brain Creator MCP Live page renders and Order total: 42 is visible.",
        "Write exactly one Brain Creator parser scenario.",
        "Use this exact format:",
        "## Scenario: Live MCP order total",
        "Priority: critical",
        "- navigate: live demo page",
        "- assert: Brain Creator MCP Live => visible",
        "- assert: Order total: 42 => visible"
      ].join("\n")
    })
  );
  cleanupPaths.push(plan.specPath, plan.seedPath);
  assert(plan.testCase.scenarios.length > 0, "Planner produced no scenarios");
  assert(plan.agentRun.status === "succeeded", "Planner AgentRun did not succeed");
  console.log(`[bc_generate_plan] scenarios=${plan.testCase.scenarios.length}`);

  const scenario = {
    id: plan.testCase.scenarios[0].id,
    title: "Live MCP order total",
    priority: "critical",
    steps: [
      { action: "navigate", target: fixture.url },
      { action: "assert", target: "Brain Creator MCP Live", expected: "visible" },
      { action: "assert", target: "Order total: 42", expected: "visible" }
    ]
  };
  dataOf(
    await handleBrainCreatorTool(context, "bc_update_plan", {
      caseId: plan.testCase.id,
      scenarios: [scenario]
    })
  );

  const approved = dataOf(
    await handleBrainCreatorTool(context, "bc_approve_plan", {
      caseId: plan.testCase.id
    })
  );
  assert(approved.status === "approved", "Test case was not approved");

  const chain = dataOf(
    await handleBrainCreatorTool(context, "bc_run_chain", {
      caseId: plan.testCase.id
    })
  );
  cleanupPaths.push(chain.chainRun.specPath, chain.chainRun.testPath);
  assert(
    chain.generateRun.status === "succeeded",
    `Generator AgentRun did not succeed\n${JSON.stringify(chain.generateRun, null, 2)}`
  );
  if (chain.chainRun.status !== "succeeded") {
    const generated = await readFile(chain.chainRun.testPath, "utf8").catch((error) => String(error));
    throw new Error(`${JSON.stringify(chain.chainRun, null, 2)}\n\n${generated}`);
  }
  console.log(`[bc_run_chain] status=${chain.chainRun.status}`);

  const overview = dataOf(
    await handleBrainCreatorTool(context, "bc_artifact_overview", {
      systemId: system.id
    })
  );
  const specs = dataOf(await handleBrainCreatorTool(context, "bc_list_specs", { systemId: system.id }));
  const tests = dataOf(await handleBrainCreatorTool(context, "bc_list_tests", { systemId: system.id }));
  assert(overview.counts.specs >= 1, "No spec artifacts recorded");
  assert(overview.counts.tests >= 1, "No test artifacts recorded");
  assert(specs.length >= 1, "bc_list_specs returned no artifacts");
  assert(tests.length >= 1, "bc_list_tests returned no artifacts");

  console.log("Live MCP workflow smoke passed.");
  console.log(`System: ${system.id}`);
  console.log(`Case: ${plan.testCase.id}`);
  console.log(`Spec: ${chain.chainRun.specPath}`);
  console.log(`Test: ${chain.chainRun.testPath}`);
} finally {
  await stopFixtureServer(fixture.server);
  if (!keepArtifacts) {
    await Promise.all(cleanupPaths.map((path) => rm(path, { recursive: true, force: true })));
  }
}

function startFixtureServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><h1>Brain Creator MCP Live</h1><p>Order total: 42</p>");
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Fixture server did not expose a TCP port"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function stopFixtureServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
