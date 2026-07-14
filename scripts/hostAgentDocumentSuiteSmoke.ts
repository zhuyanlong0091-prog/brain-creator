import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { AddressInfo } from "node:net";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createConfiguredAgentBridge } from "../src/agent/bridgeProvider.js";
import { spawnCommand } from "../src/agent/orchestrator.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "../src/mcp/handlers.js";

const temporaryDir = await mkdtemp(join(tmpdir(), "brain-host-agent-suite-"));
const generatedPaths = new Set<string>();
let authStateDir: string | undefined;
const server = createServer((request, response) => {
  if (!request.headers.cookie?.includes("fixture_session=ready")) {
    response.writeHead(401, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body><h1>Login required</h1></body></html>");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html lang="en">
  <body>
    <h1>Recruitment Console</h1>
    <button id="create-requisition">Create requisition</button>
    <p id="requisition-result" hidden>Draft created</p>
    <label>Candidate name <input id="candidate-name" /></label>
    <button id="send-offer">Send offer</button>
    <p id="offer-result" hidden>Offer sent</p>
    <script>
      document.querySelector('#create-requisition').addEventListener('click', () => {
        document.querySelector('#requisition-result').hidden = false;
      });
      document.querySelector('#send-offer').addEventListener('click', () => {
        const name = document.querySelector('#candidate-name').value;
        document.querySelector('#offer-result').textContent = 'Offer sent to ' + name;
        document.querySelector('#offer-result').hidden = false;
      });
    </script>
  </body>
</html>`);
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${address.port}`;
const sourcePath = join(temporaryDir, "recruitment-cases.md");

try {
  await writeFile(
    sourcePath,
    [
      "| 用例编号 | 用例标题 | 所属模块 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| TC-001 | 创建招聘需求 | 招聘需求 | 打开招聘控制台 | 点击 Create requisition | 显示 Draft created | P0 |",
      "| TC-002 | 发送 Offer | Offer | 打开招聘控制台 | 输入候选人名称并点击 Send offer | 显示 Offer sent to Alice | P1 |"
    ].join("\n"),
    "utf8"
  );

  const context = createBrainCreatorMcpContext({
    dataFilePath: join(temporaryDir, "assets.json"),
    workDir: process.cwd(),
    agentBridge: createConfiguredAgentBridge({
      env: { BRAIN_CREATOR_AGENT_PROVIDER: "host-agent" }
    }),
    runner: (command, args, options) =>
      spawnCommand(command, [...args, "--output", join(temporaryDir, "playwright-results")], {
        ...options,
        timeoutMs: 120_000
      })
  });

  const system = dataOf(
    await handleBrainCreatorTool(context, "bc_configure", {
      target: "system",
      name: "Recruitment Fixture",
      environment: "local",
      baseUrl,
      defaultLocale: "zh-CN",
      urlAllowlist: [baseUrl]
    })
  );
  authStateDir = join(process.cwd(), ".brain-creator", "auth", system.id);
  const storageStatePath = join(authStateDir, "storage-state.json");
  await mkdir(authStateDir, { recursive: true });
  await writeFile(
    storageStatePath,
    JSON.stringify({
      cookies: [
        {
          name: "fixture_session",
          value: "ready",
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax"
        }
      ],
      origins: []
    }),
    "utf8"
  );
  await handleBrainCreatorTool(context, "bc_configure", {
    target: "auth",
    systemId: system.id,
    env: "local",
    role: "qa-agent",
    loginMethod: "script",
    secrets: {
      storageStatePath: relative(process.cwd(), storageStatePath).replace(/\\/g, "/")
    }
  });

  const preview = dataOf(
    await handleBrainCreatorTool(context, "bc_run", {
      mode: "case-source-suite",
      systemId: system.id,
      source: sourcePath,
      confirm: false
    })
  );
  assert(preview.status === "preview", "Document suite did not stop for confirmation");
  assert(preview.summary.total === 2, "Document suite preview did not parse both cases");

  let handoff = dataOf(
    await handleBrainCreatorTool(context, "bc_run", {
      mode: "case-source-suite",
      systemId: system.id,
      source: sourcePath,
      confirm: true
    })
  );
  const executedCases: string[] = [];

  while (handoff.status === "needs_agent_execution") {
    assert(
      handoff.stage === "generator",
      `Unexpected host-agent stage ${handoff.stage}: ${JSON.stringify(handoff.testResult ?? {})}`
    );
    assert(handoff.currentCase?.caseNo, "Host-agent handoff did not identify the document case");
    collectGeneratedPaths(handoff);
    const prompt = await readFile(handoff.promptPath, "utf8");
    assert(prompt.includes("bc_submit_agent_output"), "Host-agent prompt is missing submit instructions");
    await writeGeneratedTest(
      handoff.testPath,
      handoff.seedPath,
      handoff.currentCase.caseNo
    );
    executedCases.push(handoff.currentCase.caseNo);
    handoff = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: handoff.task.id,
        status: "succeeded",
        stdout: `Codex host agent generated ${handoff.currentCase.caseNo}`,
        stderr: "",
        outputPaths: [handoff.testPath]
      })
    );
  }

  assert(handoff.status === "completed", `Suite did not complete: ${handoff.status}`);
  assert(executedCases.join(",") === "TC-001,TC-002", "Suite did not execute cases in document order");
  assert(handoff.testResult?.exitCode === 0, "Final real Playwright run did not pass");
  const suiteRuns = context.service.listCaseSuiteRuns(system.id);
  assert(suiteRuns.length === 2, "Each document case should have one persisted suite run");
  assert(suiteRuns.every((run) => run.status === "completed"), "A persisted suite run did not pass");
  assert(context.service.listChainRuns(system.id).length === 2, "Both cases need a ChainRun");
  assert(context.service.listGaps({ projectId: system.id, status: "open" }).length === 0, "Smoke created an unexpected Gap");

  console.log("Host-agent document suite smoke passed.");
  console.log(`Fixture: ${baseUrl}`);
  console.log(`Cases: ${executedCases.join(", ")}`);
  console.log("Browser: real Playwright Chromium");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const path of generatedPaths) {
    await rm(path, { force: true });
  }
  for (const path of [...generatedPaths].map((item) => dirname(item))) {
    if (path.includes(join(".brain-creator", "runs"))) {
      await rm(path, { recursive: true, force: true });
    }
  }
  if (authStateDir) {
    await rm(authStateDir, { recursive: true, force: true });
  }
  await rm(temporaryDir, { recursive: true, force: true });
}

async function writeGeneratedTest(testPath: string, seedPath: string, caseNo: string) {
  const steps =
    caseNo === "TC-001"
      ? [
          "  await page.getByRole('button', { name: 'Create requisition' }).click();",
          "  await expect(page.getByText('Draft created')).toBeVisible();"
        ]
      : [
          "  await page.getByLabel('Candidate name').fill('Alice');",
          "  await page.getByRole('button', { name: 'Send offer' }).click();",
          "  await expect(page.getByText('Offer sent to Alice')).toBeVisible();"
        ];
  await writeFile(
    testPath,
    [
      `import { test, expect } from ${JSON.stringify(importSpecifier(testPath, seedPath))};`,
      "",
      `test('${caseNo} from document suite', async ({ page }) => {`,
      "  await expect(page.getByRole('heading', { name: 'Recruitment Console' })).toBeVisible();",
      ...steps,
      "});",
      ""
    ].join("\n"),
    "utf8"
  );
}

function importSpecifier(testPath: string, seedPath: string) {
  const withoutExtension = seedPath.replace(/\.ts$/, "");
  const specifier = relative(dirname(testPath), withoutExtension).replace(/\\/g, "/");
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

function collectGeneratedPaths(handoff: Record<string, any>) {
  for (const path of [
    handoff.promptPath,
    handoff.contextPath,
    handoff.specPath,
    handoff.seedPath,
    handoff.testPath
  ]) {
    if (typeof path === "string") {
      generatedPaths.add(path);
    }
  }
}

function dataOf(result: CallToolResult): any {
  if (result.isError) {
    throw new Error(textContent(result.content?.[0]) || "Brain Creator tool failed");
  }
  return JSON.parse(textContent(result.content[0]) || "{}").data;
}

function textContent(content: CallToolResult["content"][number] | undefined) {
  return content?.type === "text" ? content.text : "";
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
