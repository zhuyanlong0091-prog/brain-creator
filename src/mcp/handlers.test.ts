import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
