import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createClaudeSubagentBridge } from "../src/agent/claudeBridge.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "../src/mcp/handlers.js";

const timeoutMs = Number(process.env.BRAIN_CREATOR_AGENT_TIMEOUT_MS ?? 300000);
const keepArtifacts = process.env.BRAIN_CREATOR_KEEP_LIVE_ARTIFACTS === "1";
const rootDir = process.cwd();
const dataDir = await mkdtemp(
  join(rootDir, ".brain-creator-test", "live-session-resume-")
);
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

  // ── Phase 1: Create system + auth ──────────────────────────────
  console.log("Phase 1: 创建系统和鉴权");

  const system = dataOf(
    await handleBrainCreatorTool(context, "bc_create_system", {
      name: "Session Resume E2E Smoke",
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

  // ── Phase 2: bc_session_resume — full snapshot + bridge preflight ──
  console.log("Phase 2: bc_session_resume (首次快照)");

  const resume1 = dataOf(
    await handleBrainCreatorTool(context, "bc_session_resume", {
      systemId: system.id
    })
  );

  // 验证快照聚合正确
  assert(resume1.system.id === system.id, "system id mismatch");
  assert(resume1.auth.profiles.length === 1, "auth profiles not aggregated");
  assert(resume1.auth.profiles[0].id === auth.id, "auth profile id mismatch");
  assert(resume1.auth.checkpoints.length === 0, "unexpected checkpoints");
  assert(resume1.rules.length === 1, "rules not aggregated");
  assert(resume1.rules[0].name === "Order total must be asserted", "rule name mismatch");
  assert(resume1.cases.total === 0, "cases should be 0 before plan generation");
  assert(resume1.cases.byStatus.draft === 0, "draft cases should be 0");
  assert(resume1.artifacts.specs === 0, "specs should be 0");
  assert(resume1.artifacts.tests === 0, "tests should be 0");
  assert(resume1.openGaps.length === 0, "unexpected open gaps");
  assert(resume1.recentRuns.agentRuns.length === 0, "unexpected agentRuns");
  assert(resume1.recentRuns.chainRuns.length === 0, "unexpected chainRuns");

  // 验证 bridge preflight 结果
  assert(typeof resume1.bridge.ok === "boolean", "bridge.ok must be boolean");
  assert(typeof resume1.bridge.checkedAt === "string", "bridge.checkedAt missing");
  if (!resume1.bridge.ok) {
    console.log(`  ⚠ bridge not ok: ${resume1.bridge.error}`);
    console.log("  (smoke continues — bridge preflight reporting works)");
  } else {
    console.log("  ✓ bridge preflight ok");
  }

  // 验证 nextAction 决策
  assert(
    resume1.nextAction === "generate_plan" || resume1.nextAction === "configure_bridge",
    `unexpected nextAction: ${resume1.nextAction}`
  );
  console.log(`  nextAction: ${resume1.nextAction}`);

  // ── Phase 3: bc_generate_plan — bridge preflight + plan draft ──
  console.log("Phase 3: bc_generate_plan");

  if (!resume1.bridge.ok) {
    // bridge 不可用时 bc_generate_plan 应立即返回错误（≤5s），不进入 120s 超时
    console.log("  bridge 不可用，验证 bc_generate_plan 快速失败...");
    const planError = errorOf(
      await handleBrainCreatorTool(context, "bc_generate_plan", {
        systemId: system.id,
        requirement: "Verify the fixture page renders with Order total: 42."
      })
    );
    assert(
      planError.includes("bridge") || planError.includes("BRAIN_CREATOR_AGENT_COMMAND"),
      `expected bridge error, got: ${planError}`
    );
    console.log(`  ✓ bc_generate_plan 快速失败: ${planError.slice(0, 80)}`);
    console.log("Session resume workflow smoke passed (bridge preflight path verified).");
    // bridge 不可用时无法继续后续步骤
    process.exit(0);
  }

  const plan = dataOf(
    await handleBrainCreatorTool(context, "bc_generate_plan", {
      systemId: system.id,
      requirement: [
        "Verify the Session Resume E2E fixture page renders and Order total: 42 is visible.",
        "Write exactly one Brain Creator parser scenario.",
        "Use this exact format:",
        "## Scenario: Session Resume E2E order total",
        "Priority: critical",
        "- navigate: live demo page",
        "- assert: Session Resume E2E => visible",
        "- assert: Order total: 42 => visible"
      ].join("\n")
    })
  );
  cleanupPaths.push(plan.specPath, plan.seedPath);
  assert(plan.testCase.scenarios.length > 0, "Planner produced no scenarios");
  assert(plan.agentRun.status === "succeeded", "Planner AgentRun did not succeed");
  console.log(`  scenarios=${plan.testCase.scenarios.length}`);

  // ── Phase 4: bc_session_resume — mid-workflow snapshot ──
  console.log("Phase 4: bc_session_resume (计划生成后)");

  const resume2 = dataOf(
    await handleBrainCreatorTool(context, "bc_session_resume", {
      systemId: system.id
    })
  );

  assert(resume2.cases.total === 1, "case not tracked after plan generation");
  assert(resume2.cases.byStatus.draft === 1, "case should be draft");
  assert(resume2.recentRuns.agentRuns.length >= 1, "agentRun not recorded");
  assert(
    resume2.nextAction === "generate_plan",
    `nextAction should still be generate_plan for a draft case, got: ${resume2.nextAction}`
  );
  console.log(`  cases: ${resume2.cases.total} (draft=${resume2.cases.byStatus.draft})`);

  // ── Phase 5: bc_full_workflow — approve + execute ──
  console.log("Phase 5: bc_full_workflow");

  // Update to a clean single scenario first
  const scenario = {
    id: plan.testCase.scenarios[0].id,
    title: "Session Resume E2E order total",
    priority: "critical" as const,
    steps: [
      { action: "navigate" as const, target: fixture.url },
      { action: "assert" as const, target: "Session Resume E2E", expected: "visible" },
      { action: "assert" as const, target: "Order total: 42", expected: "visible" }
    ]
  };
  dataOf(
    await handleBrainCreatorTool(context, "bc_update_plan", {
      caseId: plan.testCase.id,
      scenarios: [scenario]
    })
  );

  const workflow = dataOf(
    await handleBrainCreatorTool(context, "bc_full_workflow", {
      caseId: plan.testCase.id
    })
  );
  cleanupPaths.push(workflow.chainRun.specPath, workflow.chainRun.testPath);
  assert(
    workflow.chainRun.status === "succeeded",
    `ChainRun did not succeed: ${JSON.stringify(workflow.chainRun, null, 2)}`
  );
  assert(
    workflow.generateRun.status === "succeeded",
    `Generator AgentRun did not succeed: ${JSON.stringify(workflow.generateRun, null, 2)}`
  );
  console.log(`  chainRun: ${workflow.chainRun.status}`);
  console.log(`  spec: ${workflow.chainRun.specPath}`);
  console.log(`  test: ${workflow.chainRun.testPath}`);

  // ── Phase 6: bc_session_resume — final snapshot ──
  console.log("Phase 6: bc_session_resume (最终快照)");

  const resume3 = dataOf(
    await handleBrainCreatorTool(context, "bc_session_resume", {
      systemId: system.id
    })
  );

  assert(resume3.cases.total === 1, "case count mismatch");
  assert(
    resume3.cases.byStatus.passed >= 1 || resume3.cases.byStatus.failed >= 1,
    `case should be passed or failed after chain, got: ${JSON.stringify(resume3.cases.byStatus)}`
  );
  assert(resume3.artifacts.specs >= 1, "spec artifact not recorded");
  assert(resume3.artifacts.tests >= 1, "test artifact not recorded");
  assert(resume3.recentRuns.chainRuns.length >= 1, "chainRun not recorded");
  console.log(`  cases: ${resume3.cases.total} (byStatus: ${JSON.stringify(resume3.cases.byStatus)})`);
  console.log(`  artifacts: specs=${resume3.artifacts.specs} tests=${resume3.artifacts.tests}`);
  console.log(`  nextAction: ${resume3.nextAction}`);

  console.log("\nLive Session Resume workflow smoke passed.");
  console.log(`System: ${system.id}`);
  console.log(`Case: ${plan.testCase.id}`);
  console.log(`Spec: ${workflow.chainRun.specPath}`);
  console.log(`Test: ${workflow.chainRun.testPath}`);
} finally {
  await stopFixtureServer(fixture.server);
  if (!keepArtifacts) {
    await Promise.all(
      cleanupPaths.map((path) => rm(path, { recursive: true, force: true }))
    );
  }
}

// ── helpers ──────────────────────────────────────────────────────

function startFixtureServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><h1>Session Resume E2E</h1><p>Order total: 42</p>"
    );
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

function errorOf(result: CallToolResult) {
  const firstContent = result.content[0];
  if (firstContent.type !== "text") {
    throw new Error("Expected text result");
  }
  const parsed = JSON.parse(firstContent.text);
  if (parsed.success) {
    throw new Error("Expected error but call succeeded");
  }
  return parsed.errors.join("\n");
}

function parseArgs(raw: string | undefined) {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string")
    ) {
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
