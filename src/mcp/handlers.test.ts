import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("handleBrainCreatorTool", () => {
  it("uses the configured Brain Creator workspace when creating MCP context", async () => {
    const previousWorkspace = process.env.BRAIN_CREATOR_WORKSPACE;
    const workDir = await tempDir();
    process.env.BRAIN_CREATOR_WORKSPACE = workDir;
    try {
      const context = createBrainCreatorMcpContext();

      expect(context.workDir).toBe(workDir);
    } finally {
      restoreEnv("BRAIN_CREATOR_WORKSPACE", previousWorkspace);
    }
  });

  it("stores MCP assets under the configured Brain Creator workspace by default", async () => {
    const previousWorkspace = process.env.BRAIN_CREATOR_WORKSPACE;
    const previousDataFile = process.env.BRAIN_CREATOR_DATA_FILE;
    const workDir = await tempDir();
    process.env.BRAIN_CREATOR_WORKSPACE = workDir;
    delete process.env.BRAIN_CREATOR_DATA_FILE;
    try {
      const context = createBrainCreatorMcpContext();
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Orders Console",
        environment: "staging",
        baseUrl: "https://shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://shop.example.test"]
      });

      const persisted = JSON.parse(
        await readFile(join(workDir, ".brain-creator", "local-assets.json"), "utf8")
      );
      expect(persisted.systemProfiles).toEqual([
        expect.objectContaining({ name: "Orders Console" })
      ]);
    } finally {
      restoreEnv("BRAIN_CREATOR_WORKSPACE", previousWorkspace);
      restoreEnv("BRAIN_CREATOR_DATA_FILE", previousDataFile);
    }
  });

  it("creates systems, auth, rules, and searchable assets through MCP results", async () => {
    const context = createBrainCreatorMcpContext({ dataFilePath: join(await tempDir(), "assets.json") });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Orders Console",
        environment: "staging",
        baseUrl: "https://shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://shop.example.test"]
      })
    );
    const auth = dataOf(
      await handleBrainCreatorTool(context, "bc_create_auth", {
        projectId: system.id,
        env: "staging",
        role: "qa-admin",
        loginMethod: "token",
        secrets: { token: "secret-token" }
      })
    );
    const rule = dataOf(
      await handleBrainCreatorTool(context, "bc_add_rule", {
        systemId: system.id,
        name: "Payment amount rule",
        condition: "必须校验订单金额",
        severity: "block"
      })
    );
    const assets = dataOf(
      await handleBrainCreatorTool(context, "bc_search_assets", {
        projectId: system.id,
        query: "payment"
      })
    );
    const deletedRule = dataOf(
      await handleBrainCreatorTool(context, "bc_delete_rule", {
        systemId: system.id,
        ruleId: rule.id
      })
    );

    expect(system.name).toBe("Orders Console");
    expect(auth.encryptedSecrets.token).toBe("[REDACTED]");
    expect(rule.id).toMatch(/^rule_/);
    expect(assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "business-rule",
          label: "Payment amount rule"
        })
      ])
    );
    expect(deletedRule).toEqual(expect.objectContaining({ id: rule.id }));
    expect(context.service.listBusinessRules(system.id)).toEqual([]);
  });

  it("lists auth profiles without exposing secrets and generates local seed metadata", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Orders Console",
        environment: "staging",
        baseUrl: "https://shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://shop.example.test"]
      })
    );
    const otherSystem = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Billing Console",
        environment: "staging",
        baseUrl: "https://billing.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://billing.example.test"]
      })
    );
    const auth = dataOf(
      await handleBrainCreatorTool(context, "bc_create_auth", {
        projectId: system.id,
        env: "staging",
        role: "qa-admin",
        loginMethod: "token",
        secrets: { token: "secret-token" }
      })
    );
    await handleBrainCreatorTool(context, "bc_create_auth", {
      projectId: otherSystem.id,
      env: "staging",
      role: "auditor",
      loginMethod: "cookie",
      secrets: { cookie: "other-secret" }
    });
    await handleBrainCreatorTool(context, "bc_verify_auth", {
      id: auth.id
    });

    const authProfiles = dataOf(
      await handleBrainCreatorTool(context, "bc_list_auth", {
        systemId: system.id
      })
    );
    const seed = dataOf(
      await handleBrainCreatorTool(context, "bc_generate_seed", {
        systemId: system.id,
        authProfileId: auth.id
      })
    );

    const seedContent = await readFile(seed.seedPath, "utf8");
    expect(authProfiles).toEqual([
      expect.objectContaining({
        id: auth.id,
        projectId: system.id,
        encryptedSecrets: { token: "[REDACTED]" },
        status: "succeeded"
      })
    ]);
    expect(JSON.stringify(authProfiles)).not.toContain("secret-token");
    expect(seed).toEqual(
      expect.objectContaining({
        seedPath: expect.stringContaining(`seed-${system.id}.spec.ts`),
        loginMethod: "token",
        secretKeys: ["token"]
      })
    );
    expect(JSON.stringify(seed)).not.toContain("secret-token");
    expect(seedContent).toContain("secret-token");
  });

  it("generates a draft plan and stores an approved test case", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      runner: async (_command, args) => {
        const outputIndex = args.indexOf("--output");
        if (outputIndex >= 0) {
          await writeFile(
            args[outputIndex + 1],
            [
              "## Scenario: 购买机器人",
              "Priority: critical",
              "Rule: rule_1",
              "- navigate: 商品列表",
              "- assert: 订单金额 => 金额正确"
            ].join("\n"),
            "utf8"
          );
        }
        return { exitCode: 0, stdout: "ok", stderr: "" };
      }
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Orders Console",
        environment: "staging",
        baseUrl: "https://shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://shop.example.test"]
      })
    );
    await handleBrainCreatorTool(context, "bc_create_auth", {
      projectId: system.id,
      env: "staging",
      role: "qa-admin",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });
    await handleBrainCreatorTool(context, "bc_add_rule", {
      systemId: system.id,
      name: "Payment amount rule",
      condition: "必须校验订单金额",
      severity: "block"
    });

    const draft = dataOf(
      await handleBrainCreatorTool(context, "bc_generate_plan", {
        systemId: system.id,
        requirement: "测试购买机器人"
      })
    );
    const approved = dataOf(
      await handleBrainCreatorTool(context, "bc_approve_plan", {
        caseId: draft.testCase.id
      })
    );

    expect(draft.testCase.status).toBe("draft");
    expect(draft.testCase.scenarios[0].title).toBe("购买机器人");
    expect(draft.agentRun.status).toBe("succeeded");
    expect(approved.status).toBe("approved");
  });

  it("updates a draft test plan through MCP before approval", async () => {
    const context = createBrainCreatorMcpContext({ dataFilePath: join(await tempDir(), "assets.json") });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Orders Console",
        environment: "staging",
        baseUrl: "https://shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://shop.example.test"]
      })
    );
    const testCase = context.service.createTestCase({
      systemId: system.id,
      requirement: "Plan robot purchase",
      scenarios: [],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });

    const updated = dataOf(
      await handleBrainCreatorTool(context, "bc_update_plan", {
        caseId: testCase.id,
        scenarios: [
          {
            id: "scenario_1",
            title: "Validate robot checkout",
            priority: "critical",
            businessRuleRef: "rule_1",
            steps: [
              { action: "navigate", target: "Product list" },
              { action: "click", target: "Robot product" },
              { action: "assert", target: "Order amount", expected: "Matches product price" }
            ]
          }
        ]
      })
    );

    expect(updated.scenarios).toEqual([
      expect.objectContaining({
        id: "scenario_1",
        title: "Validate robot checkout",
        priority: "critical",
        businessRuleRef: "rule_1",
        steps: expect.arrayContaining([
          expect.objectContaining({ action: "assert", target: "Order amount" })
        ])
      })
    ]);
  });

  it("adds, lists, and batch confirms glossary terms through MCP", async () => {
    const context = createBrainCreatorMcpContext({ dataFilePath: join(await tempDir(), "assets.json") });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Orders Console",
        environment: "staging",
        baseUrl: "https://shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://shop.example.test"]
      })
    );
    const manualTerm = dataOf(
      await handleBrainCreatorTool(context, "bc_add_term", {
        projectId: system.id,
        key: "order.submit",
        zhCN: "Submit order",
        enUS: "Submit order",
        aliases: ["checkout"],
        pageScope: "/orders"
      })
    );
    const testCase = context.service.createTestCase({
      systemId: system.id,
      requirement: "Plan robot purchase",
      scenarios: [],
      newTerms: [
        {
          id: "term_candidate_1",
          projectId: system.id,
          key: "product.robot",
          zhCN: "Robot product",
          enUS: "Robot product",
          aliases: ["robot"],
          pageScope: "/products",
          createdAt: "2026-05-29T00:00:00.000Z",
          updatedAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      ruleCheckResult: { passed: true, checks: [] }
    });

    const confirmed = dataOf(
      await handleBrainCreatorTool(context, "bc_batch_confirm_terms", {
        caseId: testCase.id,
        confirmTermIds: ["term_candidate_1"],
        ignoreTermIds: []
      })
    );
    const terms = dataOf(
      await handleBrainCreatorTool(context, "bc_list_terms", {
        projectId: system.id,
        query: "robot"
      })
    );

    expect(manualTerm.key).toBe("order.submit");
    expect(confirmed.confirmedTerms).toEqual([
      expect.objectContaining({ key: "product.robot" })
    ]);
    expect(terms).toEqual([expect.objectContaining({ key: "product.robot" })]);
  });

  it("updates and deletes glossary terms through MCP", async () => {
    const context = createBrainCreatorMcpContext({ dataFilePath: join(await tempDir(), "assets.json") });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Orders Console",
        environment: "staging",
        baseUrl: "https://shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://shop.example.test"]
      })
    );
    const term = dataOf(
      await handleBrainCreatorTool(context, "bc_add_term", {
        projectId: system.id,
        key: "order.submit",
        zhCN: "Submit order",
        enUS: "Submit order",
        aliases: ["checkout"],
        pageScope: "/orders"
      })
    );

    const updated = dataOf(
      await handleBrainCreatorTool(context, "bc_update_term", {
        projectId: system.id,
        termId: term.id,
        key: "checkout.submit",
        zhCN: "Submit checkout",
        enUS: "Submit checkout",
        aliases: ["place order"],
        pageScope: "/checkout"
      })
    );
    const deleted = dataOf(
      await handleBrainCreatorTool(context, "bc_delete_term", {
        projectId: system.id,
        termId: term.id
      })
    );

    expect(updated).toEqual(expect.objectContaining({ key: "checkout.submit" }));
    expect(deleted).toEqual(expect.objectContaining({ id: term.id }));
  });

  it("runs an approved chain and records chain output through MCP", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      runner: async (_command, args) => {
        const outputIndex = args.indexOf("--output");
        if (outputIndex >= 0) {
          await writeFile(args[outputIndex + 1], "import { test } from '@playwright/test';", "utf8");
        }
        return { exitCode: 0, stdout: args.join(" "), stderr: "" };
      }
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Orders Console",
        environment: "staging",
        baseUrl: "https://shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://shop.example.test"]
      })
    );
    await handleBrainCreatorTool(context, "bc_create_auth", {
      projectId: system.id,
      env: "staging",
      role: "qa-admin",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });
    const testCase = context.service.createTestCase({
      systemId: system.id,
      requirement: "测试购买机器人",
      scenarios: [
        {
          id: "scenario_1",
          title: "购买机器人",
          priority: "critical",
          steps: [{ action: "assert", target: "订单金额", expected: "金额正确" }]
        }
      ],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    context.service.approveTestCase(testCase.id);

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_run_chain", {
        caseId: testCase.id
      })
    );
    const chainRuns = dataOf(
      await handleBrainCreatorTool(context, "bc_list_chain_runs", {
        systemId: system.id
      })
    );
    const specs = dataOf(
      await handleBrainCreatorTool(context, "bc_list_specs", {
        systemId: system.id
      })
    );
    const tests = dataOf(
      await handleBrainCreatorTool(context, "bc_list_tests", {
        systemId: system.id
      })
    );
    const specContent = dataOf(
      await handleBrainCreatorTool(context, "bc_read_spec", {
        systemId: system.id,
        path: result.chainRun.specPath
      })
    );
    const testContent = dataOf(
      await handleBrainCreatorTool(context, "bc_read_test", {
        systemId: system.id,
        path: result.chainRun.testPath
      })
    );
    const overview = dataOf(
      await handleBrainCreatorTool(context, "bc_artifact_overview", {
        systemId: system.id
      })
    );

    expect(result.chainRun.status).toBe("succeeded");
    expect(chainRuns).toEqual([expect.objectContaining({ id: result.chainRun.id })]);
    expect(specs).toEqual([
      expect.objectContaining({ type: "test-spec", path: result.chainRun.specPath })
    ]);
    expect(tests).toEqual([
      expect.objectContaining({ type: "test-file", path: result.chainRun.testPath })
    ]);
    expect(specContent).toEqual(
      expect.objectContaining({
        type: "test-spec",
        path: result.chainRun.specPath,
        content: expect.stringContaining("## Scenario")
      })
    );
    expect(testContent).toEqual(
      expect.objectContaining({
        type: "test-file",
        path: result.chainRun.testPath,
        content: expect.stringContaining("@playwright/test")
      })
    );
    expect(overview).toEqual(
      expect.objectContaining({
        systemId: system.id,
        counts: { specs: 1, tests: 1 },
        latestSpec: expect.objectContaining({ snippet: expect.stringContaining("## Scenario") }),
        latestTest: expect.objectContaining({ snippet: expect.stringContaining("@playwright/test") })
      })
    );
    expect(context.service.listChainRuns(system.id)).toEqual([
      expect.objectContaining({ id: result.chainRun.id })
    ]);
    expect(context.service.listAgentRuns(system.id)).toEqual([
      expect.objectContaining({ agent: "generator" })
    ]);
  });

  it("rejects artifact reads outside the workspace even when the path is recorded", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Orders Console",
        environment: "staging",
        baseUrl: "https://shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://shop.example.test"]
      })
    );
    context.service.recordAgentRun({
      id: "agent_outside",
      systemId: system.id,
      agent: "planner",
      status: "succeeded",
      inputSummary: "Unsafe path",
      outputPaths: [join(workDir, "..", "outside.md")],
      duration: 1,
      logs: [],
      createdAt: "2026-05-29T00:00:00.000Z"
    });

    const result = await handleBrainCreatorTool(context, "bc_read_spec", {
      systemId: system.id,
      path: join(workDir, "..", "outside.md")
    });

    expect(result.isError).toBe(true);
    expect(errorOf(result)).toContain("Artifact path must stay inside workspace");
  });

  it("runs a single agent and records the agent run through MCP", async () => {
    const calls: string[][] = [];
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(await tempDir(), "assets.json"),
      runner: async (_command, args) => {
        calls.push(args);
        return { exitCode: 0, stdout: "planner ok", stderr: "" };
      }
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Orders Console",
        environment: "staging",
        baseUrl: "https://shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://shop.example.test"]
      })
    );

    const run = dataOf(
      await handleBrainCreatorTool(context, "bc_run_agent", {
        systemId: system.id,
        agent: "planner",
        inputSummary: "Explore robot purchase",
        args: ["--prompt", "specs/_context/system-prompt.md"],
        outputPaths: ["specs/robot.md"]
      })
    );
    const agentRuns = dataOf(
      await handleBrainCreatorTool(context, "bc_list_agent_runs", {
        systemId: system.id
      })
    );

    expect(calls).toEqual([
      ["playwright", "agent", "planner", "--prompt", "specs/_context/system-prompt.md"]
    ]);
    expect(run).toEqual(
      expect.objectContaining({
        systemId: system.id,
        agent: "planner",
        status: "succeeded",
        inputSummary: "Explore robot purchase"
      })
    );
    expect(context.service.listAgentRuns(system.id)).toEqual([
      expect.objectContaining({ id: run.id, agent: "planner" })
    ]);
    expect(agentRuns).toEqual([expect.objectContaining({ id: run.id, agent: "planner" })]);
  });

  it("records a failed single agent run when no bridge is configured", async () => {
    const context = createBrainCreatorMcpContext({ dataFilePath: join(await tempDir(), "assets.json") });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Orders Console",
        environment: "staging",
        baseUrl: "https://shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://shop.example.test"]
      })
    );

    const run = dataOf(
      await handleBrainCreatorTool(context, "bc_run_agent", {
        systemId: system.id,
        agent: "planner",
        inputSummary: "Explore robot purchase",
        args: [],
        outputPaths: []
      })
    );

    expect(run.status).toBe("failed");
    expect(run.error).toContain("Claude subagent bridge required");
    expect(context.service.listAgentRuns(system.id)).toEqual([
      expect.objectContaining({ id: run.id, status: "failed" })
    ]);
  });

  it("uses a configured Claude subprocess bridge from environment variables", async () => {
    const workDir = await tempDir();
    const scriptPath = join(workDir, "claude-fixture.mjs");
    const transcriptPath = join(workDir, "claude-transcript.txt");
    await writeFile(
      scriptPath,
      [
        "import { writeFile } from 'node:fs/promises';",
        "let stdin = '';",
        "for await (const chunk of process.stdin) stdin += chunk.toString();",
        `await writeFile(${JSON.stringify(transcriptPath)}, stdin, 'utf8');`,
        "console.log('claude bridge ok');"
      ].join("\n"),
      "utf8"
    );
    const previousCommand = process.env.BRAIN_CREATOR_AGENT_COMMAND;
    const previousArgs = process.env.BRAIN_CREATOR_AGENT_ARGS;
    process.env.BRAIN_CREATOR_AGENT_COMMAND = process.execPath;
    process.env.BRAIN_CREATOR_AGENT_ARGS = JSON.stringify([scriptPath]);
    try {
      const context = createBrainCreatorMcpContext({
        dataFilePath: join(workDir, "assets.json"),
        workDir
      });
      const system = dataOf(
        await handleBrainCreatorTool(context, "bc_create_system", {
          name: "Orders Console",
          environment: "staging",
          baseUrl: "https://shop.example.test",
          defaultLocale: "zh-CN",
          urlAllowlist: ["https://shop.example.test"]
        })
      );

      const run = dataOf(
        await handleBrainCreatorTool(context, "bc_run_agent", {
          systemId: system.id,
          agent: "planner",
          inputSummary: "Plan robot checkout",
          args: ["--output", "specs/robot.md"],
          outputPaths: ["specs/robot.md"]
        })
      );

      expect(run.status).toBe("succeeded");
      expect(run.logs).toEqual(["claude bridge ok"]);
      expect(await readFile(transcriptPath, "utf8")).toContain("#playwright-test-planner");
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_COMMAND", previousCommand);
      restoreEnv("BRAIN_CREATOR_AGENT_ARGS", previousArgs);
    }
  });

  it("lists test cases, lists gaps, and resolves a gap through MCP", async () => {
    const context = createBrainCreatorMcpContext({ dataFilePath: join(await tempDir(), "assets.json") });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Orders Console",
        environment: "staging",
        baseUrl: "https://shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://shop.example.test"]
      })
    );
    const testCase = context.service.createTestCase({
      systemId: system.id,
      requirement: "Plan robot purchase",
      scenarios: [],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    const session = context.service.createTrainingSession({
      projectId: system.id,
      pageModelId: "page_1"
    });
    const failed = context.service.failTrainingSession(session.id, "No API requests captured");

    const cases = dataOf(
      await handleBrainCreatorTool(context, "bc_list_cases", {
        systemId: system.id
      })
    );
    const gaps = dataOf(
      await handleBrainCreatorTool(context, "bc_list_gaps", {
        projectId: system.id,
        status: "open"
      })
    );
    const resolved = dataOf(
      await handleBrainCreatorTool(context, "bc_resolve_gap", {
        projectId: system.id,
        gapId: failed.gap.id
      })
    );

    expect(cases).toEqual([expect.objectContaining({ id: testCase.id })]);
    expect(gaps).toEqual([expect.objectContaining({ id: failed.gap.id, status: "open" })]);
    expect(resolved.status).toBe("resolved");
  });

  it("records and resumes a user-interrupted manual auth flow through MCP", async () => {
    const context = createBrainCreatorMcpContext({ dataFilePath: join(await tempDir(), "assets.json") });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Google Gmail Login",
        environment: "external-first-run",
        baseUrl: "https://workspace.google.com/intl/zh-CN/gmail/",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://accounts.google.com/", "https://mail.google.com/"]
      })
    );
    const auth = dataOf(
      await handleBrainCreatorTool(context, "bc_create_auth", {
        projectId: system.id,
        env: "external-first-run",
        role: "manual-user",
        loginMethod: "script",
        secrets: { mode: "manual-browser-login-required" }
      })
    );
    const testCase = context.service.createTestCase({
      systemId: system.id,
      requirement: "首次 Gmail 登录验证",
      scenarios: [],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    const checkpoint = dataOf(
      await handleBrainCreatorTool(context, "bc_create_auth_checkpoint", {
        systemId: system.id,
        authProfileId: auth.id,
        testCaseId: testCase.id,
        reason: "Manual Google authentication required",
        resumeInstruction: "Resume after Inbox is visible"
      })
    );
    const preflightGap = dataOf(
      await handleBrainCreatorTool(context, "bc_report_gap", {
        projectId: system.id,
        sourceType: "external-preflight",
        sourceId: system.id,
        reason: "net::ERR_CONNECTION_CLOSED",
        severity: "high",
        owner: "qa"
      })
    );
    const cancelled = dataOf(
      await handleBrainCreatorTool(context, "bc_cancel_plan", {
        caseId: testCase.id,
        reason: "User closed the login page"
      })
    );
    const blockedResume = errorOf(
      await handleBrainCreatorTool(context, "bc_resume_plan", {
        caseId: testCase.id
      })
    );
    await handleBrainCreatorTool(context, "bc_complete_auth_checkpoint", {
      checkpointId: checkpoint.id
    });
    const resumed = dataOf(
      await handleBrainCreatorTool(context, "bc_resume_plan", {
        caseId: testCase.id
      })
    );

    expect(preflightGap.sourceType).toBe("external-preflight");
    expect(cancelled.testCase.status).toBe("cancelled");
    expect(blockedResume).toContain("Manual auth checkpoints");
    expect(resumed.testCase.status).toBe("draft");
  });

  it("resumes a session with aggregated system state and bridge preflight", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      agentBridge: async ({ agent, inputSummary }) => {
        // bridge 存活（即使返回 planner 错误，preflight 也只看是否响应）
        return { exitCode: 2, stdout: "", stderr: `unknown subagent ${agent}: ${inputSummary}` };
      }
    });

    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Resume Test Shop",
        environment: "staging",
        baseUrl: "https://resume-shop.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://resume-shop.example.test"]
      })
    );

    await handleBrainCreatorTool(context, "bc_add_rule", {
      systemId: system.id,
      name: "订单金额必须可见",
      condition: "订单金额必须显示在页面上",
      severity: "block"
    });
    await handleBrainCreatorTool(context, "bc_add_term", {
      projectId: system.id,
      key: "order.amount",
      zhCN: "订单金额",
      enUS: "Order Amount",
      aliases: ["金额"],
      pageScope: "/"
    });

    const resume = dataOf(
      await handleBrainCreatorTool(context, "bc_session_resume", {
        systemId: system.id
      })
    );

    // system
    expect(resume.system.id).toBe(system.id);
    expect(resume.system.name).toBe("Resume Test Shop");

    // auth
    expect(resume.auth.profiles).toEqual([]);

    // rules
    expect(resume.rules).toEqual([
      expect.objectContaining({ name: "订单金额必须可见" })
    ]);

    // terms
    expect(resume.terms).toEqual([
      expect.objectContaining({ zhCN: "订单金额" })
    ]);

    // cases
    expect(resume.cases).toEqual({ total: 0, byStatus: { draft: 0, approved: 0, generating: 0, passed: 0, failed: 0, cancelled: 0 } });

    // bridge
    expect(resume.bridge.ok).toBe(true);
    expect(resume.bridge.checkedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}/));

    // next action — 无鉴权优先
    expect(resume.nextAction).toContain("complete_onboarding");

    // 无 bridge 时的 next action
    const noBridgeContext = createBrainCreatorMcpContext({ workDir });
    const resumeNoBridge = dataOf(
      await handleBrainCreatorTool(noBridgeContext, "bc_session_resume", {
        systemId: system.id
      })
    );
    expect(resumeNoBridge.bridge.ok).toBe(false);
    expect(resumeNoBridge.bridge.error).toContain("BRAIN_CREATOR_AGENT_COMMAND");
  });

  it("isolates bc_session_resume per system", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({ workDir });

    const systemA = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "System A",
        environment: "qa",
        baseUrl: "https://a.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: []
      })
    );
    const systemB = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "System B",
        environment: "qa",
        baseUrl: "https://b.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: []
      })
    );

    await handleBrainCreatorTool(context, "bc_add_rule", {
      systemId: systemA.id,
      name: "Rule A Only",
      condition: "Only in A",
      severity: "block"
    });

    const resumeA = dataOf(
      await handleBrainCreatorTool(context, "bc_session_resume", { systemId: systemA.id })
    );
    const resumeB = dataOf(
      await handleBrainCreatorTool(context, "bc_session_resume", { systemId: systemB.id })
    );

    expect(resumeA.rules).toHaveLength(1);
    expect(resumeA.rules[0].name).toBe("Rule A Only");
    expect(resumeB.rules).toHaveLength(0);
    expect(resumeA.system.id).not.toBe(resumeB.system.id);
  });

  it("runs bc_full_workflow: approve + chain in a single call", async () => {
    const workDir = await tempDir();
    const bridgeCalls: string[][] = [];
    const context = createBrainCreatorMcpContext({
      workDir,
      agentBridge: async ({ agent, args }) => {
        bridgeCalls.push([agent, ...args]);
        const outputIdx = args.indexOf("--output");
        const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : "";
        if (agent === "planner" && outputPath) {
          await writeFile(
            outputPath,
            [
              "## Scenario: 一键工作流测试",
              "Priority: critical",
              "- navigate: 首页",
              "- assert: 标题 => 订单管理"
            ].join("\n"),
            "utf8"
          );
        }
        if (agent === "generator" && outputPath) {
          await writeFile(outputPath, "// generated test", "utf8");
        }
        return { exitCode: 0, stdout: `${agent} ok`, stderr: "" };
      },
      runner: async (_command, args) => {
        bridgeCalls.push(args);
        return { exitCode: 0, stdout: "test passed", stderr: "" };
      }
    });

    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Full Workflow Shop",
        environment: "staging",
        baseUrl: "https://fullworkflow.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://fullworkflow.example.test"]
      })
    );

    // 创建鉴权（bc_generate_plan 依赖）
    const authProfile = dataOf(
      await handleBrainCreatorTool(context, "bc_create_auth", {
        projectId: system.id,
        env: "staging",
        role: "qa",
        loginMethod: "token",
        secrets: { token: "test-token" }
      })
    );
    await handleBrainCreatorTool(context, "bc_verify_auth", {
      id: authProfile.id
    });

    // 生成计划
    const plan = dataOf(
      await handleBrainCreatorTool(context, "bc_generate_plan", {
        systemId: system.id,
        requirement: "测试一键工作流"
      })
    );

    // draft 状态
    expect(plan.testCase.status).toBe("draft");

    // bc_full_workflow：审批 + 执行一次完成
    const workflow = dataOf(
      await handleBrainCreatorTool(context, "bc_full_workflow", {
        caseId: plan.testCase.id
      })
    );

    expect(workflow.chainRun.status).toBe("succeeded");
    expect(workflow.chainRun.testCaseId).toBe(plan.testCase.id);

    // 确认用例状态已变为 passed
    const cases = dataOf(
      await handleBrainCreatorTool(context, "bc_list_cases", { systemId: system.id })
    );
    expect(cases[0].status).toBe("passed");
  });

  it("exposes facade status and configure entries for agents", async () => {
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(await tempDir(), "assets.json"),
      agentBridge: async () => ({ exitCode: 1, stdout: "", stderr: "preflight response" })
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "system",
        name: "HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );
    await handleBrainCreatorTool(context, "bc_configure", {
      target: "auth",
      systemId: system.id,
      env: "test",
      role: "qa",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });

    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        systemId: system.id
      })
    );

    expect(status.system.name).toBe("HRMS");
    expect(status.auth.profiles).toHaveLength(1);
    expect(status.bridge.ok).toBe(true);
    expect(status.facadeNextAction).toBe("configure_or_generate_plan");
    expect(JSON.stringify(status)).not.toContain("secret-token");
  });

  it("previews a case source suite without executing before confirmation", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture());
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );

    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        confirm: false
      })
    );

    expect(preview.status).toBe("preview");
    expect(preview.summary.total).toBe(2);
    expect(preview.summary.priorityStats).toEqual({ P0: 1, P1: 1 });
    expect(preview.requiresConfirmation).toBe(true);
    expect(context.service.listCaseSuiteRuns(system.id)).toEqual([]);
  });

  it("executes a confirmed case source suite and records suite run results", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: async ({ agent, args }) => {
        const outputIndex = args.indexOf("--output");
        if (agent === "generator" && outputIndex >= 0) {
          await writeFile(args[outputIndex + 1], "import { test } from '@playwright/test';", "utf8");
        }
        return { exitCode: 0, stdout: `${agent} ok`, stderr: "" };
      },
      runner: async () => ({ exitCode: 0, stdout: "passed", stderr: "" })
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture());
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );
    await handleBrainCreatorTool(context, "bc_create_auth", {
      projectId: system.id,
      env: "test",
      role: "qa",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        confirm: true
      })
    );
    const suiteRuns = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "suite-run",
        systemId: system.id
      })
    );

    expect(result.status).toBe("completed");
    expect(result.suiteRun).toEqual(
      expect.objectContaining({ total: 2, passed: 2, failed: 0, blocked: 0 })
    );
    expect(suiteRuns).toEqual([expect.objectContaining({ id: result.suiteRun.id })]);
  });

  it("resumes an existing case source suite by rerunning only unfinished cases", async () => {
    const workDir = await tempDir();
    let runCount = 0;
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: async ({ agent, args }) => {
        const outputIndex = args.indexOf("--output");
        if (agent === "generator" && outputIndex >= 0) {
          await writeFile(args[outputIndex + 1], "import { test } from '@playwright/test';", "utf8");
        }
        return { exitCode: 0, stdout: `${agent} ok`, stderr: "" };
      },
      runner: async () => {
        runCount += 1;
        return runCount === 2
          ? { exitCode: 1, stdout: "", stderr: "TC-002 failed" }
          : { exitCode: 0, stdout: "passed", stderr: "" };
      }
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture());
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );
    await handleBrainCreatorTool(context, "bc_create_auth", {
      projectId: system.id,
      env: "test",
      role: "qa",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });

    const firstRun = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        confirm: true,
        maxHealAttempts: 0
      })
    );
    const resumed = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        suiteId: firstRun.suite.id,
        confirm: true,
        maxHealAttempts: 0
      })
    );

    expect(firstRun.suiteRun).toEqual(
      expect.objectContaining({ total: 2, passed: 1, failed: 1 })
    );
    expect(resumed.suite.id).toBe(firstRun.suite.id);
    expect(resumed.suiteRun).toEqual(expect.objectContaining({ total: 1, passed: 1 }));
    expect(resumed.suiteRun.caseResults).toEqual([
      expect.objectContaining({ caseNo: "TC-002", status: "passed" })
    ]);
    expect(runCount).toBe(3);
  });

  it("continues the latest unfinished case source suite without repeating source details", async () => {
    const workDir = await tempDir();
    let runCount = 0;
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: async ({ agent, args }) => {
        const outputIndex = args.indexOf("--output");
        if (agent === "generator" && outputIndex >= 0) {
          await writeFile(args[outputIndex + 1], "import { test } from '@playwright/test';", "utf8");
        }
        return { exitCode: 0, stdout: `${agent} ok`, stderr: "" };
      },
      runner: async () => {
        runCount += 1;
        return runCount === 2
          ? { exitCode: 1, stdout: "", stderr: "TC-002 failed" }
          : { exitCode: 0, stdout: "passed", stderr: "" };
      }
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture());
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );
    await handleBrainCreatorTool(context, "bc_create_auth", {
      projectId: system.id,
      env: "test",
      role: "qa",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });

    const firstRun = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        confirm: true,
        maxHealAttempts: 0
      })
    );
    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        systemId: system.id
      })
    );
    const continued = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        resume: true,
        confirm: true,
        maxHealAttempts: 0
      })
    );

    expect(status.facadeNextAction).toBe("continue_case_source_suite");
    expect(status.suites.unfinished).toEqual([
      expect.objectContaining({
        suiteId: firstRun.suite.id,
        source,
        remainingCaseNos: ["TC-002"],
        nextCaseNo: "TC-002"
      })
    ]);
    expect(continued.suite.id).toBe(firstRun.suite.id);
    expect(continued.suiteRun.caseResults).toEqual([
      expect.objectContaining({ caseNo: "TC-002", status: "passed" })
    ]);
    expect(runCount).toBe(3);
  });

  it("creates BugReport assets when a confirmed document case fails expectations", async () => {
    const workDir = await tempDir();
    let shouldFail = true;
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: async ({ agent, args }) => {
        const outputIndex = args.indexOf("--output");
        if (agent === "generator" && outputIndex >= 0) {
          await writeFile(args[outputIndex + 1], "import { test } from '@playwright/test';", "utf8");
        }
        return { exitCode: 0, stdout: `${agent} ok`, stderr: "" };
      },
      runner: async () =>
        shouldFail
          ? { exitCode: 1, stdout: "", stderr: "expected result was not visible" }
          : { exitCode: 0, stdout: "fixed", stderr: "" }
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture([["TC-001", "创建招聘需求", "招聘需求", "用户已登录", "1. 点击新增", "创建成功", "", "P0", "", "", ""]]));
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );
    await handleBrainCreatorTool(context, "bc_create_auth", {
      projectId: system.id,
      env: "test",
      role: "qa",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        confirm: true,
        maxHealAttempts: 0
      })
    );
    const bugReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "bug",
        systemId: system.id,
        status: "open"
      })
    );
    const bugs = bugReview.bugs;

    expect(result.status).toBe("failed");
    expect(result.suiteRun.failed).toBe(1);
    expect(bugReview.summary).toEqual(
      expect.objectContaining({ total: 1, open: 1, retestPassed: 0 })
    );
    expect(bugReview.reportMarkdown).toContain("## BugReport Summary");
    expect(bugReview.reportMarkdown).toContain("TC-001 创建招聘需求");
    expect(bugReview.reportMarkdown).toContain("Expected: 创建成功");
    expect(bugReview.reportMarkdown).toContain("Actual: expected result was not visible");
    expect(bugs).toEqual([
      expect.objectContaining({
        caseNo: "TC-001",
        caseTitle: "创建招聘需求",
        actualResult: expect.stringContaining("expected result was not visible"),
        status: "open"
      })
    ]);

    shouldFail = false;
    const regression = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "bug-regression",
        systemId: system.id,
        bugIds: [bugs[0].id],
        maxHealAttempts: 0
      })
    );
    const retestedBugReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "bug",
        systemId: system.id
      })
    );
    const retestedBugs = retestedBugReview.bugs;

    expect(regression.status).toBe("completed");
    expect(regression.passed).toBe(1);
    expect(retestedBugReview.summary).toEqual(
      expect.objectContaining({ total: 1, open: 0, retestPassed: 1 })
    );
    expect(retestedBugs).toEqual([
      expect.objectContaining({
        id: bugs[0].id,
        status: "retest-passed"
      })
    ]);
  });

  it("rejects bc_full_workflow for non-draft cases", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({ workDir });

    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Reject Workflow Shop",
        environment: "staging",
        baseUrl: "https://reject.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://reject.example.test"]
      })
    );

    // 创建一个已审批的用例（模拟）
    const ctx = context.service;
    const testCase = ctx.createTestCase({
      systemId: system.id,
      requirement: "already approved",
      scenarios: [{ id: "s1", title: "X", priority: "medium", steps: [] }],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    ctx.approveTestCase(testCase.id);

    // 已审批的用例不能再走 bc_full_workflow
    const error = errorOf(
      await handleBrainCreatorTool(context, "bc_full_workflow", {
        caseId: testCase.id
      })
    );
    expect(error).toContain("Only draft test cases can be approved");
  });
});

function dataOf(result: CallToolResult) {
  const firstContent = result.content[0];
  if (firstContent.type !== "text") {
    throw new Error("Expected text result");
  }
  return JSON.parse(firstContent.text).data;
}

function errorOf(result: CallToolResult) {
  const firstContent = result.content[0];
  if (firstContent.type !== "text") {
    throw new Error("Expected text result");
  }
  return JSON.parse(firstContent.text).errors.join("\n");
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-mcp-"));
  tempDirs.push(dir);
  return dir;
}

function createXlsxFixture(
  caseRows: string[][] = [
    [
      "TC-001",
      "创建招聘需求",
      "招聘需求",
      "用户已登录 HRMS",
      "1. 打开招聘需求页面\n2. 点击新增",
      "招聘需求创建成功",
      "",
      "P0",
      "未执行",
      "",
      ""
    ],
    [
      "TC-002",
      "发起 offer",
      "Offer",
      "候选人已通过面试",
      "1. 进入候选人详情\n2. 点击发起 offer",
      "Offer 审批流启动",
      "",
      "P1",
      "未执行",
      "",
      ""
    ]
  ]
) {
  const rows = [
    [
      "用例编号",
      "用例标题",
      "所属模块",
      "前置条件",
      "操作步骤",
      "预期结果",
      "实际结果",
      "优先级",
      "用例状态",
      "BugID",
      "备注"
    ],
    ...caseRows
  ];
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypesXml(), "utf8"));
  zip.addFile("_rels/.rels", Buffer.from(rootRelsXml(), "utf8"));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml(), "utf8"));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRelsXml(), "utf8"));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml(rows), "utf8"));
  return zip.toBuffer();
}

function sheetXml(rows: string[][]) {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    "<sheetData>",
    ...rows.map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map(
          (value, columnIndex) =>
            `<c r="${columnName(columnIndex)}${rowNumber}" t="inlineStr"><is><t>${escapeXml(
              value
            )}</t></is></c>`
        )
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    }),
    "</sheetData>",
    "</worksheet>"
  ].join("");
}

function workbookXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<sheets><sheet name="测试用例" sheetId="1" r:id="rId1"/></sheets>',
    "</workbook>"
  ].join("");
}

function workbookRelsXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"',
    ' Target="worksheets/sheet1.xml"/>',
    "</Relationships>"
  ].join("");
}

function rootRelsXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"',
    ' Target="xl/workbook.xml"/>',
    "</Relationships>"
  ].join("");
}

function contentTypesXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml"',
    ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/worksheets/sheet1.xml"',
    ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    "</Types>"
  ].join("");
}

function columnName(index: number) {
  let value = "";
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) {
    value = String.fromCharCode(((current - 1) % 26) + 65) + value;
  }
  return value;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
