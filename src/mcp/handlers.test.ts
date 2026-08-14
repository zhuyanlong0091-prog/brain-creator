import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { parseCaseSource } from "../caseSource/parser.js";
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
        await readFile(
          join(workDir, ".brain-creator", "store", "collections", "systemProfiles.json"),
          "utf8"
        )
      );
      expect(persisted).toEqual([
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
    expect(seedContent).not.toContain("secret-token");
    expect(seedContent).toContain("BRAIN_CREATOR_AUTH_TOKEN");
  });

  it("prefers the latest verified auth profile when generating a seed", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Protected HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );
    await handleBrainCreatorTool(context, "bc_create_auth", {
      projectId: system.id,
      env: "test",
      role: "legacy",
      loginMethod: "token",
      secrets: { token: "stale-token" }
    });
    const storageDir = join(workDir, ".brain-creator", "auth", system.id);
    const storageStatePath = join(storageDir, "storage-state.json");
    await mkdir(storageDir, { recursive: true });
    await writeFile(storageStatePath, JSON.stringify({ cookies: [], origins: [] }), "utf8");
    const verified = dataOf(
      await handleBrainCreatorTool(context, "bc_create_auth", {
        projectId: system.id,
        env: "test",
        role: "qa",
        loginMethod: "script",
        secrets: {
          storageStatePath: `.brain-creator/auth/${system.id}/storage-state.json`
        }
      })
    );
    await handleBrainCreatorTool(context, "bc_verify_auth", { id: verified.id });

    const seed = dataOf(
      await handleBrainCreatorTool(context, "bc_generate_seed", { systemId: system.id })
    );

    expect(seed).toEqual(
      expect.objectContaining({ loginMethod: "script", authState: "storage-state" })
    );
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

  it("hands planner work to the current host agent and creates the draft after submission", async () => {
    const workDir = await tempDir();
    const hostBridge = Object.assign(
      async () => ({ exitCode: 1, stdout: "", stderr: "host-agent handoff" }),
      {
        provider: "host-agent",
        preflight: async () => ({ ok: true })
      }
    );
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: hostBridge
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

    const taskPackage = dataOf(
      await handleBrainCreatorTool(context, "bc_generate_plan", {
        systemId: system.id,
        requirement: "Validate the checkout total"
      })
    );

    expect(taskPackage.status).toBe("needs_agent_execution");
    expect(taskPackage.stage).toBe("planner");
    expect(taskPackage.task).toEqual(
      expect.objectContaining({ agent: "planner", status: "pending", systemId: system.id })
    );
    expect(context.service.listTestCases(system.id)).toEqual([]);

    await writeFile(
      taskPackage.specPath,
      [
        "## Scenario: Validate checkout total",
        "Priority: critical",
        "- navigate: Checkout",
        "- assert: Order total => Matches item total"
      ].join("\n"),
      "utf8"
    );
    const submitted = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: taskPackage.task.id,
        status: "succeeded",
        stdout: "planner completed",
        stderr: "",
        outputPaths: [taskPackage.specPath]
      })
    );

    expect(submitted.status).toBe("plan_ready");
    expect(submitted.testCase).toEqual(
      expect.objectContaining({
        systemId: system.id,
        requirement: "Validate the checkout total",
        status: "draft"
      })
    );
    expect(submitted.testCase.scenarios).toEqual([
      expect.objectContaining({ title: "Validate checkout total", priority: "critical" })
    ]);
  });

  it("creates a Gap when a successful host-agent planner submission has no spec output", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: Object.assign(async () => ({ exitCode: 1, stdout: "", stderr: "handoff" }), {
        provider: "host-agent",
        preflight: async () => ({ ok: true })
      })
    });
    const system = context.service.createSystemProfile({
      name: "Missing Planner Output",
      environment: "local",
      baseUrl: "https://planner.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://planner.example.test"]
    });
    context.service.createAuthProfile({
      projectId: system.id,
      env: "local",
      role: "qa",
      loginMethod: "token",
      secrets: { token: "secret" }
    });
    const taskPackage = dataOf(
      await handleBrainCreatorTool(context, "bc_generate_plan", {
        systemId: system.id,
        requirement: "Generate a plan without writing its output"
      })
    );

    const submitted = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: taskPackage.task.id,
        status: "succeeded",
        stdout: "planner claimed success",
        stderr: "",
        outputPaths: [taskPackage.specPath]
      })
    );

    expect(submitted.status).toBe("blocked");
    expect(submitted.gap).toEqual(
      expect.objectContaining({
        sourceType: "host-agent-planner",
        sourceId: taskPackage.task.id,
        reason: expect.stringContaining("did not create")
      })
    );
    expect(context.service.listTestCases(system.id)).toEqual([]);
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
    const artifactReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "artifact",
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
    expect(artifactReview.reviewSummary).toEqual(
      expect.objectContaining({
        title: "Artifact Review",
        status: "ready",
        nextAction: "read_artifacts",
        evidencePaths: [result.chainRun.specPath, result.chainRun.testPath]
      })
    );
    expect(artifactReview.reviewMarkdown).toContain("# Artifact Review");
    expect(artifactReview.reviewMarkdown).toContain("- Status: ready");
    expect(artifactReview.reviewMarkdown).toContain("- Next action: read_artifacts");
    expect(artifactReview.reviewSummary.metrics).toEqual({ specs: 1, tests: 1 });
    expect(artifactReview.reviewSummary.userMessage).toContain("1 specs");
    expect(context.service.listChainRuns(system.id)).toEqual([
      expect.objectContaining({ id: result.chainRun.id })
    ]);
    expect(context.service.listAgentRuns(system.id)).toEqual([
      expect.objectContaining({ agent: "generator" })
    ]);
  });

  it("returns a host-agent task package instead of running the chain subprocess", async () => {
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "host-agent";
    try {
      const workDir = await tempDir();
      const context = createBrainCreatorMcpContext({
        dataFilePath: join(workDir, "assets.json"),
        workDir
      });
      context.runner = async () => ({ exitCode: 0, stdout: "playwright passed", stderr: "" });
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
        requirement: "Generate host-agent checkout test",
        scenarios: [
          {
            id: "scenario_1",
            title: "Checkout",
            priority: "critical",
            steps: [{ action: "assert", target: "Order total", expected: "visible" }]
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

      expect(result.status).toBe("needs_agent_execution");
      expect(result.mode).toBe("host-agent");
      expect(result.task).toEqual(
        expect.objectContaining({
          agent: "generator",
          systemId: system.id,
          status: "pending"
        })
      );
      expect(await readFile(result.promptPath, "utf8")).toContain("Generate host-agent checkout test");
      expect(context.service.listChainRuns(system.id)).toEqual([]);
      expect(context.service.listAgentRuns(system.id)).toEqual([]);
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_PROVIDER", previousProvider);
    }
  });

  it("records a chain run when a host-agent chain task is submitted", async () => {
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "host-agent";
    try {
      const workDir = await tempDir();
      const context = createBrainCreatorMcpContext({
        dataFilePath: join(workDir, "assets.json"),
        workDir
      });
      context.runner = async () => ({ exitCode: 0, stdout: "playwright passed", stderr: "" });
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
        requirement: "Generate host-agent checkout test",
        scenarios: [
          {
            id: "scenario_1",
            title: "Checkout",
            priority: "critical",
            steps: [{ action: "assert", target: "Order total", expected: "visible" }]
          }
        ],
        newTerms: [],
        ruleCheckResult: { passed: true, checks: [] }
      });
      context.service.approveTestCase(testCase.id);
      const taskPackage = dataOf(
        await handleBrainCreatorTool(context, "bc_run_chain", {
          caseId: testCase.id
        })
      );
      await writeFile(taskPackage.testPath, "import { test, expect } from '../seed';\n", "utf8");

      const submitted = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: taskPackage.task.id,
          status: "succeeded",
          stdout: "generated test secret-token",
          stderr: "",
          outputPaths: [taskPackage.testPath]
        })
      );

      expect(submitted.chainRun).toEqual(
        expect.objectContaining({
          systemId: system.id,
          testCaseId: testCase.id,
          status: "succeeded",
          generateRunId: submitted.agentRun.id,
          specPath: taskPackage.specPath,
          testPath: taskPackage.testPath
        })
      );
      expect(submitted.agentRun.logs.join("\n")).not.toContain("secret-token");
      expect(submitted.agentRun.logs.join("\n")).toContain("[REDACTED]");
      expect(context.service.getTestCase(testCase.id).status).toBe("passed");
      expect(context.service.listChainRuns(system.id)).toEqual([
        expect.objectContaining({ id: submitted.chainRun.id })
      ]);
      expect(context.service.listAgentRuns(system.id)).toEqual([
        expect.objectContaining({ id: submitted.agentRun.id, agent: "generator" })
      ]);
      expect(context.service.listTestFiles(system.id)).toEqual([
        expect.objectContaining({ path: taskPackage.testPath, testCaseId: testCase.id })
      ]);
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_PROVIDER", previousProvider);
    }
  });

  it("runs Playwright after a host-agent generator task is submitted", async () => {
    const workDir = await tempDir();
    const hostBridge = Object.assign(
      async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "host-agent handoff"
      }),
      {
        provider: "host-agent",
        preflight: async () => ({ ok: true })
      }
    );
    const calls: string[][] = [];
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: hostBridge,
      runner: async (command, args) => {
        calls.push([command, ...args]);
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            stats: { duration: 12, expected: 1, unexpected: 0, skipped: 0 },
            suites: [{
              specs: [{
                id: "host-assertion",
                title: "Host assertion",
                tests: [{ results: [{ status: "passed" }] }]
              }]
            }]
          }),
          stderr: ""
        };
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
      requirement: "Generate host-agent checkout test",
      scenarios: [
        {
          id: "scenario_1",
          title: "Checkout",
          priority: "critical",
          steps: [{ action: "assert", target: "Order total", expected: "visible" }]
        }
      ],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    context.service.approveTestCase(testCase.id);
    const taskPackage = dataOf(
      await handleBrainCreatorTool(context, "bc_run_chain", {
        caseId: testCase.id
      })
    );
    await writeFile(taskPackage.testPath, "import { test, expect } from '../seed';\n", "utf8");

    const submitted = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: taskPackage.task.id,
        status: "succeeded",
        stdout: "generated test",
        stderr: "",
        outputPaths: [taskPackage.testPath]
      })
    );

    expect(calls).toEqual([
      [
        "npx",
        "playwright",
        "test",
        `tests/generated/${testCase.id}.spec.ts`,
        "--workers=1",
        "--reporter=json",
        "--trace=on"
      ]
    ]);
    expect(submitted.testResult).toEqual(
      expect.objectContaining({
        exitCode: 0,
        structuredReporter: expect.objectContaining({ status: "passed", total: 1 }),
        reporterPath: expect.stringContaining("playwright-report.json")
      })
    );
    expect(
      await readFile(submitted.testResult.reporterPath, "utf8")
    ).toContain('"status": "passed"');
    expect(submitted.chainRun).toEqual(
      expect.objectContaining({ status: "succeeded", testCaseId: testCase.id })
    );
  });

  it("does not complete a host-agent chain when Reporter says blocked", async () => {
    const workDir = await tempDir();
    const hostBridge = Object.assign(
      async () => ({ exitCode: 1, stdout: "", stderr: "host-agent handoff" }),
      { provider: "host-agent", preflight: async () => ({ ok: true }) }
    );
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: hostBridge,
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          stats: { duration: 5, expected: 0, unexpected: 0, skipped: 1 },
          suites: [{ specs: [{ title: "blocked", tests: [{ results: [{ status: "skipped" }] }] }] }]
        }),
        stderr: ""
      })
    });
    const system = dataOf(await handleBrainCreatorTool(context, "bc_create_system", {
      name: "Blocked host system",
      environment: "test",
      baseUrl: "https://blocked.example.test",
      defaultLocale: "en-US",
      urlAllowlist: []
    }));
    await handleBrainCreatorTool(context, "bc_create_auth", {
      projectId: system.id,
      env: "test",
      role: "qa",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });
    const testCase = context.service.createTestCase({
      systemId: system.id,
      requirement: "Blocked host case",
      scenarios: [{ id: "blocked-scenario", title: "Blocked", priority: "critical", steps: [] }],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    context.service.approveTestCase(testCase.id);
    const taskPackage = dataOf(await handleBrainCreatorTool(context, "bc_run_chain", {
      caseId: testCase.id,
      maxHealAttempts: 0
    }));
    await writeFile(taskPackage.testPath, "import { test } from '../seed';\n", "utf8");

    const result = dataOf(await handleBrainCreatorTool(context, "bc_submit_agent_output", {
      taskId: taskPackage.task.id,
      status: "succeeded",
      stdout: "generated",
      stderr: "",
      outputPaths: [taskPackage.testPath]
    }));

    expect(result.chainRun.status).toBe("failed");
    expect(result.testResult.structuredReporter.status).toBe("blocked");
    expect(context.service.getTestCase(testCase.id).status).toBe("failed");
  });

  it("returns a healer task when the Playwright process throws after a host-agent generator submit", async () => {
    const workDir = await tempDir();
    const hostBridge = Object.assign(
      async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "host-agent handoff"
      }),
      {
        provider: "host-agent",
        preflight: async () => ({ ok: true })
      }
    );
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: hostBridge,
      runner: async () => {
        throw new Error("playwright process unavailable");
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
      requirement: "Generate host-agent checkout test",
      scenarios: [
        {
          id: "scenario_1",
          title: "Checkout",
          priority: "critical",
          steps: [{ action: "assert", target: "Order total", expected: "visible" }]
        }
      ],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    context.service.approveTestCase(testCase.id);
    const taskPackage = dataOf(
      await handleBrainCreatorTool(context, "bc_run_chain", {
        caseId: testCase.id
      })
    );
    await writeFile(taskPackage.testPath, "import { test, expect } from '../seed';\n", "utf8");

    const submitted = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: taskPackage.task.id,
        status: "succeeded",
        stdout: "generated test",
        stderr: "",
        outputPaths: [taskPackage.testPath]
      })
    );

    expect(submitted.status).toBe("needs_agent_execution");
    expect(submitted.stage).toBe("healer");
    expect(submitted.task).toEqual(
      expect.objectContaining({
        agent: "healer",
        systemId: system.id,
        status: "pending",
        args: expect.arrayContaining(["--seed", taskPackage.seedPath]),
        chainContext: expect.objectContaining({ seedPath: taskPackage.seedPath })
      })
    );
    expect(submitted.chainRun).toEqual(
      expect.objectContaining({
        status: "partial",
        testCaseId: testCase.id,
        generateRunId: submitted.agentRun.id,
        gaps: []
      })
    );
    expect(submitted.testResult).toEqual(
      expect.objectContaining({ exitCode: 1, stderr: "playwright process unavailable" })
    );
    expect(await readFile(submitted.promptPath, "utf8")).toContain("playwright process unavailable");
    expect(context.service.listAgentTasks(system.id)).toEqual([
      expect.objectContaining({ id: taskPackage.task.id, status: "submitted" }),
      expect.objectContaining({ id: submitted.task.id, agent: "healer", status: "pending" })
    ]);
  });

  it("does not create a host-agent healer task when maxHealAttempts is zero", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: Object.assign(async () => ({ exitCode: 1, stdout: "", stderr: "handoff" }), {
        provider: "host-agent",
        preflight: async () => ({ ok: true })
      }),
      runner: async () => ({ exitCode: 1, stdout: "", stderr: "assertion failed" })
    });
    const system = context.service.createSystemProfile({
      name: "No Heal System",
      environment: "local",
      baseUrl: "https://no-heal.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://no-heal.example.test"]
    });
    context.service.createAuthProfile({
      projectId: system.id,
      env: "local",
      role: "qa",
      loginMethod: "token",
      secrets: { token: "secret" }
    });
    const testCase = context.service.createTestCase({
      systemId: system.id,
      requirement: "Do not heal this failure",
      scenarios: [
        {
          id: "scenario_no_heal",
          title: "No heal",
          priority: "medium",
          steps: [{ action: "assert", target: "Result", expected: "visible" }]
        }
      ],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    context.service.approveTestCase(testCase.id);
    const taskPackage = dataOf(
      await handleBrainCreatorTool(context, "bc_run_chain", {
        caseId: testCase.id,
        maxHealAttempts: 0
      })
    );
    await writeFile(taskPackage.testPath, "import { test } from '@playwright/test';\n", "utf8");

    const submitted = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: taskPackage.task.id,
        status: "succeeded",
        stdout: "generated",
        stderr: "",
        outputPaths: [taskPackage.testPath]
      })
    );

    expect(submitted.chainRun.status).toBe("failed");
    expect(submitted.chainRun.gaps).toHaveLength(1);
    expect(context.service.listAgentTasks(system.id)).toEqual([
      expect.objectContaining({ id: taskPackage.task.id, status: "submitted" })
    ]);
  });

  it("keeps a host-agent task pending when generated step evidence is missing", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: Object.assign(async () => ({ exitCode: 1, stdout: "", stderr: "handoff" }), {
        provider: "host-agent",
        preflight: async () => ({ ok: true })
      })
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Evidence System",
        environment: "local",
        baseUrl: "https://evidence.example.test",
        defaultLocale: "en-US",
        urlAllowlist: ["https://evidence.example.test"]
      })
    );
    await handleBrainCreatorTool(context, "bc_create_auth", {
      projectId: system.id,
      env: "local",
      role: "qa",
      loginMethod: "token",
      secrets: { token: "secret" }
    });
    const testCase = context.service.createTestCase({
      systemId: system.id,
      requirement: "Validate evidence instrumentation",
      scenarios: [
        {
          id: "scenario_evidence",
          title: "Evidence",
          priority: "high",
          steps: [{ action: "assert", target: "Ready", expected: "visible" }]
        }
      ],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    context.service.approveTestCase(testCase.id);
    const taskPackage = dataOf(
      await handleBrainCreatorTool(context, "bc_run_chain", { caseId: testCase.id })
    );
    context.repository.agentTasks.find((task) => task.id === taskPackage.task.id)!.chainContext = {
      ...taskPackage.task.chainContext,
      requiredStepIds: ["step-ready"]
    };
    await writeFile(taskPackage.testPath, "import { test, expect } from '../seed';\n", "utf8");

    const rejected = await handleBrainCreatorTool(context, "bc_submit_agent_output", {
      taskId: taskPackage.task.id,
      status: "succeeded",
      stdout: "generated test",
      outputPaths: [taskPackage.testPath]
    });

    expect(errorOf(rejected)).toContain("missing bc.step instrumentation");
    expect(context.repository.agentTasks).toEqual([
      expect.objectContaining({ id: taskPackage.task.id, status: "pending" })
    ]);
    expect(context.repository.agentRuns).toHaveLength(0);

    await writeFile(
      taskPackage.testPath,
      "import { test, expect } from '../seed';\nawait bc.step(\"step-ready\", page, action);\nconst config = { password: \"do-not-export-this\" };\n",
      "utf8"
    );
    const secretRejected = await handleBrainCreatorTool(context, "bc_submit_agent_output", {
      taskId: taskPackage.task.id,
      status: "succeeded",
      stdout: "generated test",
      outputPaths: [taskPackage.testPath]
    });
    expect(errorOf(secretRejected)).toContain("pattern:sensitive-field-literal");
    expect(context.repository.agentTasks).toEqual([
      expect.objectContaining({ id: taskPackage.task.id, status: "pending" })
    ]);
  });

  it("reruns Playwright and records a healed chain when a host-agent healer task is submitted", async () => {
    const workDir = await tempDir();
    const hostBridge = Object.assign(
      async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "host-agent handoff"
      }),
      {
        provider: "host-agent",
        preflight: async () => ({ ok: true })
      }
    );
    const calls: string[][] = [];
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: hostBridge,
      runner: async (command, args) => {
        calls.push([command, ...args]);
        return calls.length === 1
          ? { exitCode: 1, stdout: "", stderr: "expected amount missing" }
          : {
              exitCode: 0,
              stdout: JSON.stringify({
                stats: { duration: 13, expected: 1, unexpected: 0, skipped: 0 },
                suites: [{ specs: [{ title: "healed", tests: [{ results: [{ status: "passed" }] }] }] }]
              }),
              stderr: ""
            };
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
      requirement: "Generate host-agent checkout test",
      scenarios: [
        {
          id: "scenario_1",
          title: "Checkout",
          priority: "critical",
          steps: [{ action: "assert", target: "Order total", expected: "visible" }]
        }
      ],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    context.service.approveTestCase(testCase.id);
    const taskPackage = dataOf(
      await handleBrainCreatorTool(context, "bc_run_chain", {
        caseId: testCase.id
      })
    );
    await writeFile(taskPackage.testPath, "import { test, expect } from '../seed';\n", "utf8");
    const needsHealing = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: taskPackage.task.id,
        status: "succeeded",
        stdout: "generated test",
        stderr: "",
        outputPaths: [taskPackage.testPath]
      })
    );

    const healed = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: needsHealing.task.id,
        status: "succeeded",
        stdout: "healed test",
        stderr: "",
        outputPaths: [taskPackage.testPath]
      })
    );

    expect(calls).toEqual([
      [
        "npx",
        "playwright",
        "test",
        `tests/generated/${testCase.id}.spec.ts`,
        "--workers=1",
        "--reporter=json",
        "--trace=on"
      ],
      [
        "npx",
        "playwright",
        "test",
        `tests/generated/${testCase.id}.spec.ts`,
        "--workers=1",
        "--reporter=json",
        "--trace=on"
      ]
    ]);
    expect(healed.testResult).toEqual(
      expect.objectContaining({
        exitCode: 0,
        structuredReporter: expect.objectContaining({ status: "passed" }),
        reporterPath: expect.stringContaining("playwright-report.json")
      })
    );
    expect(healed.chainRun).toEqual(
      expect.objectContaining({
        status: "succeeded",
        testCaseId: testCase.id,
        generateRunId: needsHealing.chainRun.generateRunId,
        healRunId: healed.agentRun.id
      })
    );
    expect(context.service.getTestCase(testCase.id).status).toBe("passed");
  });

  it("records a standard gap when a host-agent healer submit still fails Playwright", async () => {
    const workDir = await tempDir();
    const hostBridge = Object.assign(
      async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "host-agent handoff"
      }),
      {
        provider: "host-agent",
        preflight: async () => ({ ok: true })
      }
    );
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: hostBridge,
      runner: async () => ({ exitCode: 1, stdout: "", stderr: "still missing amount" })
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
      requirement: "Generate host-agent checkout test",
      scenarios: [
        {
          id: "scenario_1",
          title: "Checkout",
          priority: "critical",
          steps: [{ action: "assert", target: "Order total", expected: "visible" }]
        }
      ],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    context.service.approveTestCase(testCase.id);
    const taskPackage = dataOf(
      await handleBrainCreatorTool(context, "bc_run_chain", {
        caseId: testCase.id
      })
    );
    await writeFile(taskPackage.testPath, "import { test, expect } from '../seed';\n", "utf8");
    const needsHealing = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: taskPackage.task.id,
        status: "succeeded",
        stdout: "generated test",
        stderr: "",
        outputPaths: [taskPackage.testPath]
      })
    );

    const healed = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: needsHealing.task.id,
        status: "succeeded",
        stdout: "healed test",
        stderr: "",
        outputPaths: [taskPackage.testPath]
      })
    );

    expect(healed.chainRun).toEqual(
      expect.objectContaining({
        status: "failed",
        testCaseId: testCase.id,
        healRunId: healed.agentRun.id,
        gaps: [
          expect.objectContaining({
            sourceType: "host-agent-healer",
            sourceId: needsHealing.task.id,
            reason: expect.stringContaining("still missing amount")
          })
        ]
      })
    );
    expect(context.service.getTestCase(testCase.id).status).toBe("failed");
    expect(context.service.listGaps({ projectId: system.id, status: "open" })).toEqual([
      expect.objectContaining({ sourceType: "host-agent-healer" })
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
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "disabled";
    try {
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
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_PROVIDER", previousProvider);
    }
  });

  it("prepares and submits a host-agent task without starting a subprocess", async () => {
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

    const prepared = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare_agent_task", {
        systemId: system.id,
        agent: "generator",
        inputSummary: "Generate checkout test",
        args: ["--spec", "specs/case.md", "--output", "tests/generated/case.spec.ts"],
        outputPaths: ["tests/generated/case.spec.ts"]
      })
    );

    expect(prepared.status).toBe("needs_agent_execution");
    expect(prepared.submitTool).toBe("bc_submit_agent_output");
    expect(prepared.task).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^agentTask_/),
        systemId: system.id,
        agent: "generator",
        status: "pending"
      })
    );
    expect(await readFile(prepared.promptPath, "utf8")).toContain("Generate checkout test");
    expect(JSON.parse(await readFile(prepared.contextPath, "utf8"))).toEqual(
      expect.objectContaining({
        systemId: system.id,
        agent: "generator",
        outputPaths: ["tests/generated/case.spec.ts"]
      })
    );

    const submitted = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: prepared.task.id,
        status: "succeeded",
        stdout: "host agent wrote test",
        stderr: "",
        outputPaths: ["tests/generated/case.spec.ts"]
      })
    );

    expect(submitted.task.status).toBe("submitted");
    expect(submitted.agentRun).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^agent_/),
        systemId: system.id,
        agent: "generator",
        status: "succeeded",
        logs: ["host agent wrote test"]
      })
    );
    expect(context.service.listAgentRuns(system.id)).toEqual([
      expect.objectContaining({ id: submitted.agentRun.id, status: "succeeded" })
    ]);
    expect(
      errorOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: prepared.task.id,
          status: "succeeded",
          stdout: "duplicate",
          stderr: ""
        })
      )
    ).toContain("already submitted");
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
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "disabled";
    try {
      const noBridgeContext = createBrainCreatorMcpContext({ workDir });
      const resumeNoBridge = dataOf(
        await handleBrainCreatorTool(noBridgeContext, "bc_session_resume", {
          systemId: system.id
        })
      );
      expect(resumeNoBridge.bridge.ok).toBe(false);
      expect(resumeNoBridge.bridge.error).toContain("BRAIN_CREATOR_AGENT_COMMAND");
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_PROVIDER", previousProvider);
    }
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
    expect(status.userSummary).toEqual(
      expect.objectContaining({
        systemName: "HRMS",
        readiness: "ready",
        nextAction: "configure_or_generate_plan",
        nextCommand: `/bc run "<path>"`,
        nextStep: "Add a requirement or preview a test case document suite."
      })
    );
    expect(status.userSummary.counts).toEqual(
      expect.objectContaining({
        authProfiles: 1,
        openBugs: 0,
        openGaps: 0,
        unfinishedSuites: 0
      })
    );
    expect(status.statusMarkdown).toContain("# Brain Creator Status: HRMS");
    expect(status.statusMarkdown).toContain("- Readiness: ready");
    expect(status.statusMarkdown).toContain("- Auth profiles: 1");
    expect(status.statusMarkdown).toContain("- Open bugs: 0");
    expect(status.statusMarkdown).toContain("- Open gaps: 0");
    expect(status.statusMarkdown).toContain("- Unfinished suites: 0");
    expect(status.statusMarkdown).toContain("Next: Add a requirement or preview a test case document suite.");
    expect(status.statusMarkdown).toContain("Command: `/bc run \"<path>\"`");
    expect(status.quickCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "/bc status" }),
        expect.objectContaining({ command: `/bc run "<path>"` })
      ])
    );
    expect(status.toolGuidance).toEqual(
      expect.objectContaining({
        defaultLayer: "facade",
        nextFacadeTool: "bc_run",
        internalToolsPolicy:
          "Use fine-grained bc_* tools only for debugging, audit, or unsupported facade details."
      })
    );
    expect(status.toolGuidance.primaryTools.map((tool: { name: string }) => tool.name)).toEqual([
      "bc_command",
      "bc_status",
      "bc_configure",
      "bc_run",
      "bc_review"
    ]);
    expect(JSON.stringify(status)).not.toContain("secret-token");
  });

  it("returns a compact system picker when bc_status has no system context", async () => {
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(await tempDir(), "assets.json")
    });
    const firstHrms = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "HRMS",
        environment: "test",
        baseUrl: "https://hrms-one.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms-one.example.test"]
      })
    );
    const secondHrms = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "HRMS",
        environment: "test",
        baseUrl: "https://hrms-two.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms-two.example.test"]
      })
    );
    await handleBrainCreatorTool(context, "bc_create_system", {
      name: "CRM Console",
      environment: "staging",
      baseUrl: "https://crm.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://crm.example.test"]
    });

    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {}));

    expect(status.status).toBe("needs_system_selection");
    expect(status.systemOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "HRMS",
          environment: "test",
          instanceCount: 2,
          systemIds: [firstHrms.id, secondHrms.id]
        }),
        expect.objectContaining({
          name: "CRM Console",
          environment: "staging",
          instanceCount: 1
        })
      ])
    );
    expect(status.selectionMarkdown).toContain("HRMS (test) - 2 instances");
    expect(status.selectionMarkdown).toContain("Ask the Agent to choose a specific instance");
    expect(status.selectionMarkdown).toContain(
      '/bc status --system "CRM Console" --env "staging"'
    );
    expect(status.selectionMarkdown).not.toContain(firstHrms.id);
    expect(status.selectionMarkdown).not.toContain(secondHrms.id);
    expect(status.nextAction).toBe("select_system");
  });

  it("routes context-free /bc status to the system picker", async () => {
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(await tempDir(), "assets.json")
    });
    await handleBrainCreatorTool(context, "bc_create_system", {
      name: "HRMS",
      environment: "test",
      baseUrl: "https://hrms.example.test",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://hrms.example.test"]
    });
    await handleBrainCreatorTool(context, "bc_create_system", {
      name: "CRM Console",
      environment: "staging",
      baseUrl: "https://crm.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://crm.example.test"]
    });

    const command = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        command: "/bc status"
      })
    );

    expect(command.tool).toBe("bc_status");
    expect(command.result.status).toBe("needs_system_selection");
    expect(command.result.systemOptions).toHaveLength(2);
  });

  it("guides system configuration when context-free status has no systems", async () => {
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(await tempDir(), "assets.json")
    });

    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        command: "/bc status"
      })
    );

    expect(status.result.status).toBe("no_systems");
    expect(status.result.nextAction).toBe("configure_system");
    expect(status.result.toolGuidance.nextFacadeTool).toBe("bc_configure");
    expect(context.service.listSystemProfiles()).toHaveLength(0);
  });

  it("parses minimal /bc commands into facade tool executions", async () => {
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

    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        systemId: system.id,
        command: "/bc status"
      })
    );
    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        systemId: system.id,
        command: `/bc run "${source}"`
      })
    );
    await handleBrainCreatorTool(context, "bc_run", {
      mode: "case-source-suite",
      systemId: system.id,
      source,
      confirm: true,
      maxHealAttempts: 0
    });
    const continued = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        systemId: system.id,
        command: "/bc continue"
      })
    );
    const regression = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        systemId: system.id,
        command: "/bc regress bugs"
      })
    );
    const filteredRegression = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        systemId: system.id,
        command: "/bc regress bugs --bug bug_123,bug_456 --module Recruiting --priority P0"
      })
    );

    expect(status.tool).toBe("bc_status");
    expect(status.result.system.name).toBe("HRMS");
    expect(preview.tool).toBe("bc_run");
    expect(preview.toolInput).toEqual(
      expect.objectContaining({
        mode: "case-source-suite",
        systemId: system.id,
        source,
        confirm: false
      })
    );
    expect(preview.result.status).toBe("preview");
    expect(continued.toolInput).toEqual(
      expect.objectContaining({ mode: "case-source-suite", resume: true, confirm: true })
    );
    expect(continued.result.suiteRun.caseResults).toEqual([
      expect.objectContaining({ caseNo: "TC-002", status: "passed" })
    ]);
    expect(regression.tool).toBe("bc_run");
    expect(regression.toolInput).toEqual(
      expect.objectContaining({ mode: "bug-regression", systemId: system.id })
    );
    expect(filteredRegression.toolInput).toEqual(
      expect.objectContaining({
        mode: "bug-regression",
        systemId: system.id,
        bugIds: ["bug_123", "bug_456"],
        modules: ["Recruiting"],
        priorities: ["P0"]
      })
    );
  });

  it("reports an awaiting auth checkpoint as a blocked facade state", async () => {
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(await tempDir(), "assets.json"),
      agentBridge: Object.assign(
        async () => ({ exitCode: 1, stdout: "", stderr: "bridge unavailable" }),
        {
          provider: "disabled",
          preflight: async () => ({ ok: false, error: "bridge unavailable" })
        }
      )
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "system",
        name: "Protected HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );
    const auth = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "auth",
        systemId: system.id,
        env: "test",
        role: "qa",
        loginMethod: "script",
        secrets: {}
      })
    );
    await handleBrainCreatorTool(context, "bc_configure", {
      target: "checkpoint",
      systemId: system.id,
      authProfileId: auth.id,
      reason: "Manual login required",
      resumeInstruction: "Complete login in the isolated browser"
    });

    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", { systemId: system.id })
    );

    expect(status.facadeNextAction).toBe("complete_auth_checkpoint");
    expect(status.userSummary).toEqual(
      expect.objectContaining({
        readiness: "blocked",
        nextAction: "complete_auth_checkpoint",
        nextStep: "Complete the pending manual authentication checkpoint."
      })
    );
    expect(status.userSummary.counts.awaitingAuthCheckpoints).toBe(1);
    expect(status.statusMarkdown).toContain("- Awaiting auth checkpoints: 1");
  });

  it("parses /bc run filters and review aliases", async () => {
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

    const filteredPreview = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        systemId: system.id,
        command: `/bc run "${source}" --case TC-001,TC-002 --module 招聘需求 --priority P1`
      })
    );
    const bugs = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        systemId: system.id,
        command: "/bc bugs"
      })
    );
    const reviewBugs = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        systemId: system.id,
        command: "/bc review bugs"
      })
    );
    const gaps = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        systemId: system.id,
        command: "/bc gaps"
      })
    );
    const filteredGaps = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        systemId: system.id,
        command: "/bc gaps --failure-type locator_failure"
      })
    );
    const filteredBugs = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        systemId: system.id,
        command: "/bc bugs --failure-type assertion_failure"
      })
    );
    const filteredSuiteReview = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        systemId: system.id,
        command: "/bc review suite --failure-type assertion_failure,network_failure"
      })
    );

    expect(filteredPreview.tool).toBe("bc_run");
    expect(filteredPreview.toolInput).toEqual(
      expect.objectContaining({
        mode: "case-source-suite",
        source,
        caseNos: ["TC-001", "TC-002"],
        modules: ["招聘需求"],
        priorities: ["P1"],
        confirm: false
      })
    );
    expect(filteredPreview.result.selection.filters).toEqual({
      caseNos: ["TC-001", "TC-002"],
      modules: ["招聘需求"],
      priorities: ["P1"]
    });
    expect(bugs.toolInput).toEqual(expect.objectContaining({ target: "bug", systemId: system.id }));
    expect(reviewBugs.toolInput).toEqual(expect.objectContaining({ target: "bug", systemId: system.id }));
    expect(gaps.toolInput).toEqual(expect.objectContaining({ target: "gap", systemId: system.id }));
    expect(filteredGaps.toolInput).toEqual(
      expect.objectContaining({
        target: "gap",
        systemId: system.id,
        failureTypes: ["locator_failure"]
      })
    );
    expect(filteredBugs.toolInput).toEqual(
      expect.objectContaining({
        target: "bug",
        systemId: system.id,
        failureTypes: ["assertion_failure"]
      })
    );
    expect(filteredSuiteReview.toolInput).toEqual(
      expect.objectContaining({
        target: "suite-run",
        systemId: system.id,
        failureTypes: ["assertion_failure", "network_failure"]
      })
    );
  });

  it("returns read-only /bc help without requiring a selected system", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir
    });

    const help = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        command: "/bc help"
      })
    );
    const systems = dataOf(await handleBrainCreatorTool(context, "bc_list_systems", {}));

    expect(help).toEqual(
      expect.objectContaining({
        command: "/bc help",
        action: "help",
        userMessage: expect.stringContaining("Brain Creator shortcuts")
      })
    );
    expect(help.helpMarkdown).toContain("/bc status");
    expect(help.helpMarkdown).toContain('/bc run "<path>"');
    expect(help.helpMarkdown).toContain("/bc continue");
    expect(help.helpMarkdown).toContain("/bc bugs");
    expect(help.helpMarkdown).toContain("/bc gaps");
    expect(help.helpMarkdown).toContain("/bc review suite");
    expect(help.helpMarkdown).toContain("/bc regress bugs");
    expect(help.helpMarkdown).toContain("--case");
    expect(help.helpMarkdown).toContain("--module");
    expect(help.helpMarkdown).toContain("--priority");
    expect(help.helpMarkdown).toContain("--failure-type");
    expect(help.shortcuts.map((shortcut: { command: string }) => shortcut.command)).toEqual(
      expect.arrayContaining(["/bc status", "/bc continue", "/bc bugs", "/bc gaps"])
    );
    expect(systems).toEqual([]);
  });

  it("resolves optional system context for /bc help and rejects unsupported help flags", async () => {
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(await tempDir(), "assets.json")
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "HRMS",
        environment: "staging",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );

    const help = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        command: "/bc help --system HRMS"
      })
    );
    const invalid = await handleBrainCreatorTool(context, "bc_command", {
      command: "/bc help --unknown"
    });

    expect(help.action).toBe("help");
    expect(help.systemResolution).toEqual(
      expect.objectContaining({ systemId: system.id, matchedBy: "name" })
    );
    expect(invalid.isError).toBe(true);
    expect(errorOf(invalid)).toContain("Unsupported /bc help option: --unknown");
  });

  it("resolves facade status and commands by system name when systemId is omitted", async () => {
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(await tempDir(), "assets.json")
    });
    await handleBrainCreatorTool(context, "bc_create_system", {
      name: "CRM Console",
      environment: "staging",
      baseUrl: "https://crm.example.test",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://crm.example.test"]
    });
    const hrms = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );

    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        systemName: "hrms"
      })
    );
    const commandStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        command: "/bc status --system HRMS"
      })
    );

    expect(status.system.id).toBe(hrms.id);
    expect(status.systemResolution).toEqual(
      expect.objectContaining({ systemId: hrms.id, matchedBy: "name" })
    );
    expect(commandStatus.toolInput).toEqual(expect.objectContaining({ systemId: hrms.id }));
    expect(commandStatus.result.system.id).toBe(hrms.id);
  });

  it("does not guess when system name resolution is ambiguous", async () => {
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(await tempDir(), "assets.json")
    });
    await handleBrainCreatorTool(context, "bc_create_system", {
      name: "HRMS",
      environment: "test",
      baseUrl: "https://hrms-test.example.test",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://hrms-test.example.test"]
    });
    await handleBrainCreatorTool(context, "bc_create_system", {
      name: "HRMS",
      environment: "staging",
      baseUrl: "https://hrms-staging.example.test",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://hrms-staging.example.test"]
    });

    const ambiguous = await handleBrainCreatorTool(context, "bc_command", {
      command: "/bc status --system HRMS"
    });
    const resolved = dataOf(
      await handleBrainCreatorTool(context, "bc_command", {
        command: "/bc status --system HRMS --env staging"
      })
    );

    expect(ambiguous.isError).toBe(true);
    expect(errorOf(ambiguous)).toContain("Multiple Brain Creator systems match");
    expect(errorOf(ambiguous)).toContain("staging");
    expect(resolved.result.system.environment).toBe("staging");
  });

  it("resolves bc_run and bc_review by system name", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture());
    const crm = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "CRM Console",
        environment: "staging",
        baseUrl: "https://crm.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://crm.example.test"]
      })
    );
    const hrms = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );
    context.service.createTestCase({
      systemId: crm.id,
      requirement: "CRM lead flow",
      scenarios: [],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    const hrmsCase = context.service.createTestCase({
      systemId: hrms.id,
      requirement: "HRMS offer flow",
      scenarios: [],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });

    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemName: "hrms",
        source,
        confirm: false
      })
    );
    const cases = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "case",
        systemName: "HRMS"
      })
    );

    expect(preview.source.systemId).toBe(hrms.id);
    expect(preview.systemResolution).toEqual(
      expect.objectContaining({ systemId: hrms.id, matchedBy: "name" })
    );
    expect(cases.items).toEqual([expect.objectContaining({ id: hrmsCase.id, systemId: hrms.id })]);
    expect(cases.systemResolution).toEqual(
      expect.objectContaining({ systemId: hrms.id, matchedBy: "name" })
    );
  });

  it("scopes coverage review to the requested system", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir
    });
    const project = await context.knowledgeService.createProject({
      name: "System-scoped coverage",
      key: "system-scoped-coverage",
      defaultLocale: "en-US"
    });
    const first = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "System A",
        environment: "test",
        baseUrl: "https://a.example.test",
        defaultLocale: "en-US",
        urlAllowlist: []
      })
    );
    const second = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "System B",
        environment: "test",
        baseUrl: "https://b.example.test",
        defaultLocale: "en-US",
        urlAllowlist: []
      })
    );
    context.knowledgeService.bindSystem(project.id, first.id);
    context.knowledgeService.bindSystem(project.id, second.id);
    const ingested = await context.knowledgeService.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "System scoped requirement",
        content: "Users submit a request.",
        blocks: [{ type: "paragraph", text: "Users submit a request." }],
        attachments: [],
        source: "system-scoped.md",
        sourceType: "local-file",
        contentHash: "system-scoped-hash",
        warnings: []
      }
    });
    const design = await context.knowledgeService.generateTestDesign(ingested.requirementSet.id);
    context.knowledgeService.approveRequirementSet(ingested.requirementSet.id);
    const executable = context.knowledgeService.compileExecutableCases(
      design.testIntents[0].id,
      first.id
    ).executableCase;
    const evidence = context.knowledgeService.createExecutionEvidence({
      projectId: project.id,
      systemId: first.id,
      executableCaseId: executable.id,
      testCaseId: "test-system-scoped",
      contextPackPath: "context.json"
    });
    await context.knowledgeService.completeExecutionEvidence(evidence.id, {
      status: "blocked",
      artifactPaths: [],
      tracePaths: []
    });

    const scoped = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "coverage",
        knowledgeProjectId: project.id,
        systemId: second.id
      })
    );
    expect(scoped.systemId).toBe(second.id);
    expect(scoped.executionLedger.counts).toEqual({ "not-selected": 1 });
    const all = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "coverage",
        knowledgeProjectId: project.id
      })
    );
    expect(all.executionLedger.counts).toEqual({ blocked: 1 });
  });

  it("previews natural-language entrypoints as facade calls without executing", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture());
    await handleBrainCreatorTool(context, "bc_create_system", {
      name: "CRM Console",
      environment: "staging",
      baseUrl: "https://crm.example.test",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://crm.example.test"]
    });
    const hrms = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );

    const executeDocument = dataOf(
      await handleBrainCreatorTool(context, "bc_intent_preview", {
        request: `执行 HRMS 的这个 Excel: ${source}`
      })
    );
    const reviewBugs = dataOf(
      await handleBrainCreatorTool(context, "bc_intent_preview", {
        request: "查看 HRMS open bug"
      })
    );
    const continueSuite = dataOf(
      await handleBrainCreatorTool(context, "bc_intent_preview", {
        request: "继续 HRMS 未完成套件"
      })
    );
    const filteredDocument = dataOf(
      await handleBrainCreatorTool(context, "bc_intent_preview", {
        request: `执行 HRMS 的这个 Excel: ${source} 只跑模块 招聘需求 优先级 P0 用例 TC-001,TC-002`
      })
    );
    const regressBugs = dataOf(
      await handleBrainCreatorTool(context, "bc_intent_preview", {
        request: "回归 HRMS open bug"
      })
    );
    const filteredBugRegression = dataOf(
      await handleBrainCreatorTool(context, "bc_intent_preview", {
        request: "回归 HRMS Recruiting 模块 P0 bug bug_manual123"
      })
    );

    expect(executeDocument).toEqual(
      expect.objectContaining({
        intent: "case-source-suite-preview",
        tool: "bc_run",
        requiresConfirmation: true
      })
    );
    expect(executeDocument.toolInput).toEqual(
      expect.objectContaining({
        mode: "case-source-suite",
        systemId: hrms.id,
        source,
        confirm: false
      })
    );
    expect(reviewBugs.toolInput).toEqual(
      expect.objectContaining({ target: "bug", systemId: hrms.id, status: "open" })
    );
    expect(continueSuite.toolInput).toEqual(
      expect.objectContaining({
        mode: "case-source-suite",
        systemId: hrms.id,
        resume: true,
        confirm: true
      })
    );
    expect(filteredDocument.toolInput).toEqual(
      expect.objectContaining({
        mode: "case-source-suite",
        systemId: hrms.id,
        source,
        caseNos: ["TC-001", "TC-002"],
        modules: ["招聘需求"],
        priorities: ["P0"],
        confirm: false
      })
    );
    expect(regressBugs).toEqual(
      expect.objectContaining({
        intent: "regress-open-bugs",
        tool: "bc_run",
        requiresConfirmation: false
      })
    );
    expect(regressBugs.toolInput).toEqual(
      expect.objectContaining({ mode: "bug-regression", systemId: hrms.id })
    );
    expect(filteredBugRegression.toolInput).toEqual(
      expect.objectContaining({
        mode: "bug-regression",
        systemId: hrms.id,
        bugIds: ["bug_manual123"],
        modules: ["Recruiting"],
        priorities: ["P0"]
      })
    );
    expect(context.service.listCaseSources(hrms.id)).toEqual([]);
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

  it("blocks a confirmed document suite while manual authentication is pending", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: Object.assign(
        async () => ({ exitCode: 1, stdout: "", stderr: "bridge unavailable" }),
        {
          provider: "disabled",
          preflight: async () => ({ ok: false, error: "bridge unavailable" })
        }
      ),
      runner: async () => {
        throw new Error("runner must not execute while authentication is pending");
      }
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture());
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Protected HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );
    const auth = dataOf(
      await handleBrainCreatorTool(context, "bc_create_auth", {
        projectId: system.id,
        env: "test",
        role: "qa",
        loginMethod: "script",
        secrets: {}
      })
    );
    await handleBrainCreatorTool(context, "bc_create_auth_checkpoint", {
      systemId: system.id,
      authProfileId: auth.id,
      reason: "Manual login required",
      resumeInstruction: "Complete login before running the suite"
    });

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        confirm: true
      })
    );

    expect(result.status).toBe("blocked");
    expect(result.gap.reason).toContain("Manual authentication checkpoint");
    expect(context.service.listCaseSuiteRuns(system.id)).toEqual([]);
  });

  it("creates an auth checkpoint before generation when stored browser auth has expired", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: Object.assign(
        async () => ({ exitCode: 0, stdout: "host agent", stderr: "" }),
        {
          provider: "host-agent" as const,
          preflight: async () => ({ ok: true })
        }
      ),
      authStateVerifier: async () => ({
        status: "expired",
        finalUrl: "https://sso.example.test/login",
        reason: "Stored browser authentication redirected to a login page."
      })
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture());
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Protected HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );
    const auth = dataOf(
      await handleBrainCreatorTool(context, "bc_create_auth", {
        projectId: system.id,
        env: "test",
        role: "qa",
        loginMethod: "script",
        secrets: { storageStatePath: ".brain-creator/auth/system/storage-state.json" }
      })
    );
    await handleBrainCreatorTool(context, "bc_verify_auth", { id: auth.id });

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        confirm: true
      })
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "blocked",
        authState: expect.objectContaining({ status: "expired" }),
        authCheckpoint: expect.objectContaining({ status: "awaiting-user" }),
        gap: expect.objectContaining({
          sourceType: "case-source-suite-auth",
          reason: expect.stringContaining("redirected to a login page")
        })
      })
    );
    expect(context.service.listAgentTasks(system.id)).toEqual([]);
    expect(context.service.listCaseSuites(system.id)).toEqual([]);
  });

  it("returns suite auth refresh evidence after a host-provided refresh", async () => {
    const workDir = await tempDir();
    let verificationCount = 0;
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      agentBridge: Object.assign(
        async () => ({ exitCode: 0, stdout: "host agent", stderr: "" }),
        {
          provider: "host-agent" as const,
          preflight: async () => ({ ok: true })
        }
      ),
      authStateVerifier: async () => {
        verificationCount += 1;
        return verificationCount === 1
          ? { status: "expired" as const, reason: "Short-lived session expired." }
          : { status: "valid" as const, finalUrl: "https://hrms.example.test/dashboard" };
      },
      authStateRefresher: async () => ({
        storageStatePath: ".brain-creator/auth/refreshed.json",
        provider: "host-refresh"
      })
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture());
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_create_system", {
        name: "Refreshable HRMS",
        environment: "test",
        baseUrl: "https://hrms.example.test",
        defaultLocale: "zh-CN",
        urlAllowlist: ["https://hrms.example.test"]
      })
    );
    const auth = dataOf(
      await handleBrainCreatorTool(context, "bc_create_auth", {
        projectId: system.id,
        env: "test",
        role: "qa",
        loginMethod: "script",
        secrets: { storageStatePath: ".brain-creator/auth/storage.json" }
      })
    );
    await handleBrainCreatorTool(context, "bc_verify_auth", { id: auth.id });

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        confirm: true
      })
    );

    expect(result.authState).toEqual(expect.objectContaining({
      status: "valid",
      authRefresh: { attempted: true, provider: "host-refresh" }
    }));
  });

  it("bounds nested bc_status history while preserving counts", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const system = dataOf(await handleBrainCreatorTool(context, "bc_configure", {
      target: "system",
      name: "Bounded status",
      environment: "test",
      baseUrl: "https://bounded.example.test",
      urlAllowlist: ["https://bounded.example.test"]
    }));
    for (let index = 0; index < 15; index += 1) {
      context.repository.agentTasks.push({
        id: `task-${index}`,
        systemId: system.id,
        agent: "generator",
        status: "pending",
        inputSummary: `task-${index}`,
        args: [],
        outputPaths: [],
        promptPath: "prompt.md",
        contextPath: "context.json",
        submitTool: "bc_submit_agent_output",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {
      systemId: system.id,
      responseMode: "full"
    }));

    expect(status.agentTasks.pending).toHaveLength(10);
    expect(status.agentTasks.pendingTruncated).toBe(true);
    expect(status.userSummary.counts.pendingAgentTasks).toBe(15);
  });

  it("rejects document-suite auth storage outside the Brain Creator workspace", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, "assets.json"),
      workDir,
      authStateVerifier: async () => ({ status: "valid", finalUrl: "https://hrms.example.test" })
    });
    const system = dataOf(await handleBrainCreatorTool(context, "bc_create_system", {
      name: "Protected HRMS",
      environment: "test",
      baseUrl: "https://hrms.example.test",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://hrms.example.test"]
    }));
    await handleBrainCreatorTool(context, "bc_create_auth", {
      projectId: system.id,
      env: "test",
      role: "qa",
      loginMethod: "script",
      secrets: { storageStatePath: "..\\outside-storage-state.json" }
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture());
    await expect(
      handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        confirm: true
      })
    ).resolves.toEqual(expect.objectContaining({ isError: true }));
  });

  it("filters document case suites by case number, module, and priority", async () => {
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
    await writeFile(
      source,
      createXlsxFixture([
        ["TC-001", "创建招聘需求", "招聘需求", "用户已登录", "1. 点击新增", "创建成功", "", "P0", "", "", ""],
        ["TC-002", "发起 offer", "Offer", "候选人已通过面试", "1. 发起 offer", "Offer 启动", "", "P1", "", "", ""],
        ["TC-003", "审核招聘需求", "招聘需求", "主管待审批", "1. 点击通过", "审核通过", "", "P1", "", "", ""]
      ])
    );
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

    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        modules: ["招聘需求"],
        priorities: ["P1"],
        confirm: false
      })
    );
    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        caseNos: ["TC-002", "TC-003"],
        modules: ["招聘需求"],
        confirm: true
      })
    );

    expect(preview.summary.total).toBe(1);
    expect(preview.selection).toEqual(
      expect.objectContaining({
        totalAvailable: 3,
        selected: 1,
        selectedCaseNos: ["TC-003"]
      })
    );
    expect(result.suite.selectedCaseNos).toEqual(["TC-003"]);
    expect(result.suiteRun.caseResults).toEqual([
      expect.objectContaining({ caseNo: "TC-003", status: "passed" })
    ]);
    expect(result.progress).toEqual(
      expect.objectContaining({
        selected: 1,
        attempted: 1,
        passed: 1,
        remaining: 0
      })
    );
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
    const ledger = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "run-ledger",
        systemId: system.id,
        id: result.suite.id
      })
    );
    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        systemId: system.id
      })
    );

    expect(result.status).toBe("completed");
    expect(result.suiteRun).toEqual(
      expect.objectContaining({ total: 2, passed: 2, failed: 0, blocked: 0 })
    );
    expect(suiteRuns.runs).toEqual([expect.objectContaining({ id: result.suiteRun.id })]);
    expect(suiteRuns.summary).toEqual(
      expect.objectContaining({ totalRuns: 1, totalCases: 2, passed: 2, failed: 0, blocked: 0 })
    );
    expect(suiteRuns.runLedger.summaries).toEqual([
      expect.objectContaining({
        runType: "document-suite",
        runId: result.suite.id,
        currentStatus: "completed",
        outcomes: { passed: 2 }
      })
    ]);
    expect(ledger.entries.map((entry: { event: string }) => entry.event)).toEqual([
      "suite-created",
      "case-started",
      "case-completed",
      "case-started",
      "case-completed",
      "suite-completed"
    ]);
    expect(status.documentRunLedger).toEqual(expect.objectContaining({ total: 6 }));
    expect(status.documentRunLedger.activeSummary).toBeUndefined();
  });

  it("reviews suite runs with failed cases, bug links, and markdown report", async () => {
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
      runner: async () => ({ exitCode: 1, stdout: "", stderr: "suite assertion failed" })
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
    const runResult = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        confirm: true,
        maxHealAttempts: 0
      })
    );

    const review = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "suite-run",
        systemId: system.id
      })
    );

    expect(review.summary).toEqual(
      expect.objectContaining({
        totalRuns: 1,
        totalCases: 1,
        failed: 1,
        bugReports: 1,
        latestStatus: "failed"
      })
    );
    expect(review.failedCases).toEqual([
      expect.objectContaining({
        suiteRunId: runResult.suiteRun.id,
        caseNo: "TC-001",
        bugReportId: expect.any(String)
      })
    ]);
    expect(review.bugReports).toEqual([
      expect.objectContaining({ caseNo: "TC-001", status: "open" })
    ]);
    expect(review.reportMarkdown).toContain("## Suite Run Summary");
    expect(review.reportMarkdown).toContain("Failed: 1");
    expect(review.reportMarkdown).toContain("TC-001 创建招聘需求");
    expect(review.nextAction).toBe("review_bugs");
  });

  it("adds unified review summaries for agent-facing suite, bug, and gap reviews", async () => {
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
      runner: async () => ({ exitCode: 1, stdout: "", stderr: "expected banner missing" })
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture([["TC-009", "Create job request", "Recruiting", "Logged in", "1. Click New", "Created", "", "P0", "", "", ""]]));
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
    const run = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        source,
        confirm: true,
        maxHealAttempts: 0
      })
    );
    const gap = dataOf(
      await handleBrainCreatorTool(context, "bc_report_gap", {
        projectId: system.id,
        sourceType: "manual",
        sourceId: "gap-source",
        reason: "Need stable selector evidence",
        severity: "medium",
        owner: "qa"
      })
    );
    await handleBrainCreatorTool(context, "bc_report_gap", {
      projectId: system.id,
      sourceType: "external-preflight",
      sourceId: "auth-gap",
      reason: "403 Forbidden before login",
      severity: "high",
      owner: "qa"
    });
    await handleBrainCreatorTool(context, "bc_report_gap", {
      projectId: system.id,
      sourceType: "external-preflight",
      sourceId: "network-gap",
      reason: "net::ERR_CONNECTION_CLOSED",
      severity: "high",
      owner: "qa"
    });

    const suiteReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "suite-run",
        systemId: system.id
      })
    );
    const bugReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "bug",
        systemId: system.id,
        status: "open"
      })
    );
    const gapReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "gap",
        systemId: system.id,
        status: "open"
      })
    );
    const assertionBugReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "bug",
        systemId: system.id,
        status: "open",
        failureTypes: ["assertion_failure"]
      })
    );
    const authBugReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "bug",
        systemId: system.id,
        status: "open",
        failureTypes: ["auth_failure"]
      })
    );
    const locatorGapReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "gap",
        systemId: system.id,
        status: "open",
        failureTypes: ["locator_failure"]
      })
    );
    const filteredSuiteReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "suite-run",
        systemId: system.id,
        failureTypes: ["assertion_failure"]
      })
    );

    expect(suiteReview.reviewSummary).toEqual(
      expect.objectContaining({
        title: "Suite Run Review",
        status: "failed",
        nextAction: "review_bugs",
        evidencePaths: run.suiteRun.artifactPaths
      })
    );
    expect(suiteReview.reviewSummary.metrics).toEqual(
      expect.objectContaining({
        totalCases: 1,
        failed: 1,
        bugReports: 1,
        gaps: 0,
        failureClassification: {
          businessBugs: 1,
          evidenceGaps: 0,
          failedCases: 1,
          blockedCases: 0,
          byType: {
            assertion_failure: 1
          }
        }
      })
    );
    expect(suiteReview.reviewSummary.userMessage).toContain("1 business bug");
    expect(suiteReview.reviewSummary.userMessage).toContain("0 evidence gaps");
    expect(suiteReview.reviewMarkdown).toContain("# Suite Run Review");
    expect(suiteReview.reviewMarkdown).toContain("- Status: failed");
    expect(suiteReview.reviewMarkdown).toContain("businessBugs");
    expect(suiteReview.reviewMarkdown).toContain("assertion_failure");
    expect(suiteReview.reviewMarkdown).toContain("- Next action: review_bugs");
    expect(bugReview.reviewSummary).toEqual(
      expect.objectContaining({
        title: "Bug Review",
        status: "action_required",
        nextAction: "run_bug_regression"
      })
    );
    expect(bugReview.reviewSummary.metrics).toEqual(
      expect.objectContaining({
        open: 1,
        byFailureType: {
          assertion_failure: 1
        }
      })
    );
    expect(bugReview.reviewSummary.evidencePaths).toEqual(run.suiteRun.artifactPaths);
    expect(bugReview.reviewMarkdown).toContain("# Bug Review");
    expect(bugReview.reviewMarkdown).toContain("- Status: action_required");
    expect(bugReview.reviewMarkdown).toContain("- Next action: run_bug_regression");
    expect(gapReview.reviewSummary).toEqual(
      expect.objectContaining({
        title: "Gap Review",
        status: "action_required",
        nextAction: "resolve_gaps"
      })
    );
    expect(gapReview.reviewSummary.metrics).toEqual(
      expect.objectContaining({
        open: 3,
        byFailureType: {
          auth_failure: 1,
          locator_failure: 1,
          network_failure: 1
        }
      })
    );
    expect(gapReview.reviewMarkdown).toContain("# Gap Review");
    expect(gapReview.reviewMarkdown).toContain("- Status: action_required");
    expect(gapReview.reviewMarkdown).toContain("- Next action: resolve_gaps");
    expect(gapReview.reviewMarkdown).toContain("auth_failure");
    expect(gapReview.reviewMarkdown).toContain("locator_failure");
    expect(gapReview.reviewMarkdown).toContain("network_failure");
    expect(gapReview.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: gap.id })]));
    expect(assertionBugReview.bugs).toEqual([
      expect.objectContaining({ caseNo: "TC-009" })
    ]);
    expect(authBugReview.bugs).toEqual([]);
    expect(authBugReview.reviewSummary.metrics).toEqual(
      expect.objectContaining({ total: 0, byFailureType: {} })
    );
    expect(locatorGapReview.items).toEqual([
      expect.objectContaining({ id: gap.id, reason: "Need stable selector evidence" })
    ]);
    expect(locatorGapReview.reviewSummary.metrics).toEqual(
      expect.objectContaining({
        open: 1,
        byFailureType: { locator_failure: 1 }
      })
    );
    expect(filteredSuiteReview.failedCases).toEqual([
      expect.objectContaining({ caseNo: "TC-009", bugReportId: expect.any(String) })
    ]);
    expect(filteredSuiteReview.reviewSummary.metrics.failureClassification.byType).toEqual({
      assertion_failure: 1
    });
  });

  it("does not write document case results back without explicit write-back confirmation", async () => {
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
        writeBack: true,
        confirm: true
      })
    );
    const reparsed = await parseCaseSource(source);

    expect(result.writeBack).toEqual(
      expect.objectContaining({ status: "requires_confirmation", updatedRows: 0 })
    );
    expect(reparsed.cases.map((item) => item.status)).toEqual(["未执行", "未执行"]);
    expect(reparsed.cases.map((item) => item.actualResult)).toEqual([undefined, undefined]);
  });

  it("writes confirmed xlsx document case results back to actual result, status, and BugID columns", async () => {
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
      runner: async () => ({ exitCode: 1, stdout: "", stderr: "expected result was not visible" })
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(source, createXlsxFixture([["TC-001", "创建招聘需求", "招聘需求", "用户已登录", "1. 点击新增", "创建成功", "", "P0", "未执行", "", ""]]));
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
        writeBack: true,
        confirmWriteBack: true,
        confirm: true,
        maxHealAttempts: 0
      })
    );
    const reparsed = await parseCaseSource(source);
    const backupPath = result.writeBack.backupPath;
    const backup = await parseCaseSource(backupPath);

    await expect(access(backupPath)).resolves.toBeUndefined();
    expect(result.writeBack).toEqual(
      expect.objectContaining({ status: "written", updatedRows: 1, backupPath: expect.any(String) })
    );
    expect(backup.cases[0]).toEqual(
      expect.objectContaining({
        actualResult: undefined,
        status: "未执行",
        bugId: undefined
      })
    );
    expect(reparsed.cases[0]).toEqual(
      expect.objectContaining({
        actualResult: expect.stringContaining("expected result was not visible"),
        status: "失败",
        bugId: result.bugs[0].id
      })
    );
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
          ? {
              exitCode: 1,
              stdout: "",
              stderr: "Expected offer to be sent, actual offer remained draft"
            }
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

  it("continues a host-agent case source suite one task at a time until completion", async () => {
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "host-agent";
    try {
      const workDir = await tempDir();
      const context = createBrainCreatorMcpContext({
        dataFilePath: join(workDir, "assets.json"),
        workDir
      });
      context.runner = async () => ({ exitCode: 0, stdout: "playwright passed", stderr: "" });
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
          confirm: true
        })
      );
      const firstTask = firstRun.task;
      await writeFile(firstTask.outputPaths[0], "import { test, expect } from '../seed';\n", "utf8");
      const firstSubmitted = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: firstTask.id,
          status: "succeeded",
          stdout: "TC-001 generated",
          stderr: "",
          outputPaths: firstTask.outputPaths
        })
      );
      await writeFile(
        firstSubmitted.task.outputPaths[0],
        "import { test, expect } from '../seed';\n",
        "utf8"
      );
      const completed = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: firstSubmitted.task.id,
          status: "succeeded",
          stdout: "TC-002 generated",
          stderr: "",
          outputPaths: firstSubmitted.task.outputPaths
        })
      );

      expect(firstRun).toEqual(
        expect.objectContaining({
          status: "needs_agent_execution",
          stage: "generator",
          currentCase: expect.objectContaining({ caseNo: "TC-001", status: "waiting-for-agent" }),
          suite: expect.objectContaining({ status: "waiting-for-agent" })
        })
      );
      expect(firstSubmitted).toEqual(
        expect.objectContaining({
          status: "needs_agent_execution",
          stage: "generator",
          currentCase: expect.objectContaining({ caseNo: "TC-002", status: "waiting-for-agent" }),
          suiteRun: expect.objectContaining({ total: 1, passed: 1, blocked: 0 })
        })
      );
      expect(completed).toEqual(
        expect.objectContaining({
          status: "completed",
          suite: expect.objectContaining({ id: firstRun.suite.id, status: "completed" }),
          suiteRun: expect.objectContaining({ total: 1, passed: 1, blocked: 0 })
        })
      );
      expect(context.service.listCaseSuiteRuns(system.id)).toHaveLength(2);
      const ledger = dataOf(
        await handleBrainCreatorTool(context, "bc_review", {
          target: "run-ledger",
          systemId: system.id,
          id: firstRun.suite.id
        })
      );
      expect(ledger.summaries).toEqual([
        expect.objectContaining({
          runType: "document-suite",
          currentStatus: "completed",
          outcomes: { passed: 2 }
        })
      ]);
      expect(ledger.entries.map((entry: { event: string }) => entry.event)).toEqual([
        "suite-created",
        "case-started",
        "agent-task-requested",
        "case-completed",
        "case-started",
        "agent-task-requested",
        "case-completed",
        "suite-completed"
      ]);
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_PROVIDER", previousProvider);
    }
  });

  it("blocks with a Gap when the host agent reports missing required test data", async () => {
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "host-agent";
    try {
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
          confirm: true
        })
      );
      const blocked = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: firstRun.task.id,
          status: "failed",
          stdout: "",
          stderr:
            "Required test data is unavailable: HC-A-001 is absent, so the expected staffing fields cannot be verified."
        })
      );

      expect(blocked).toEqual(
        expect.objectContaining({
          status: "blocked",
          suite: expect.objectContaining({ id: firstRun.suite.id, status: "blocked" }),
          suiteRun: expect.objectContaining({ status: "blocked", failed: 0, blocked: 1 })
        })
      );
      expect(context.service.listBugReports({ systemId: system.id })).toHaveLength(0);
      expect(context.service.listGaps({ projectId: system.id, status: "open" })).toEqual([
        expect.objectContaining({ reason: expect.stringContaining("Required test data is unavailable") })
      ]);
      expect(
        context.service.listAgentTasks(system.id).filter((task) => task.status === "pending")
      ).toHaveLength(0);
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_PROVIDER", previousProvider);
    }
  });

  it("blocks the suite with a Gap when a host-agent healer finds missing environment configuration", async () => {
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "host-agent";
    try {
      const workDir = await tempDir();
      const context = createBrainCreatorMcpContext({
        dataFilePath: join(workDir, "assets.json"),
        workDir
      });
      let runCount = 0;
      context.runner = async () => {
        runCount += 1;
        return {
          exitCode: 1,
          stdout:
            `process definition key is not configured (attempt ${runCount})\n` +
            "Expected: 200\nReceived: 500",
          stderr: ""
        };
      };
      const source = join(workDir, "cases.xlsx");
      await writeFile(source, createXlsxFixture([["TC-001", "创建招聘需求", "招聘需求", "用户已登录", "1. 点击新增", "创建成功", "", "P0", "未执行", "", ""]]));
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
          confirm: true
        })
      );
      const generatorTask = context.service.listAgentTasks(system.id)[0];
      await writeFile(generatorTask.outputPaths[0], "import { test, expect } from '../seed';\n", "utf8");
      const needsHealing = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: generatorTask.id,
          status: "succeeded",
          stdout: "generated test",
          stderr: "",
          outputPaths: generatorTask.outputPaths
        })
      );
      const healed = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: needsHealing.task.id,
          status: "succeeded",
          stdout: "healed test",
          stderr: "",
          outputPaths: generatorTask.outputPaths
        })
      );
      const status = dataOf(
        await handleBrainCreatorTool(context, "bc_status", { systemId: system.id })
      );

      expect(firstRun).toEqual(
        expect.objectContaining({
          status: "needs_agent_execution",
          currentCase: expect.objectContaining({ caseNo: "TC-001", status: "waiting-for-agent" })
        })
      );
      expect(healed.suiteRun).toEqual(
        expect.objectContaining({
          suiteId: firstRun.suite.id,
          status: "blocked",
          total: 1,
          failed: 0,
          blocked: 1
        })
      );
      expect(healed.suiteRun.caseResults).toEqual([
        expect.objectContaining({
          caseNo: "TC-001",
          status: "blocked",
          error: expect.stringContaining("process definition key is not configured"),
          gapIds: [healed.chainRun.gaps[0].id]
        })
      ]);
      expect(context.service.listCaseSuites(system.id)[0]).toEqual(
        expect.objectContaining({ id: firstRun.suite.id, status: "blocked" })
      );
      expect(status.facadeNextAction).toBe("review_gaps");
      expect(status.userSummary.nextStep).toBe("Review open gaps before claiming the system is ready.");
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_PROVIDER", previousProvider);
    }
  });

  it("continues after a blocked host-agent case only when the suite explicitly allows it", async () => {
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "host-agent";
    try {
      const workDir = await tempDir();
      const context = createBrainCreatorMcpContext({
        dataFilePath: join(workDir, "assets.json"),
        workDir
      });
      let runCount = 0;
      context.runner = async () => {
        runCount += 1;
        return runCount <= 2
          ? {
              exitCode: 1,
              stdout: "missing environment configuration: required fixture data is unavailable",
              stderr: ""
            }
          : { exitCode: 0, stdout: "playwright passed", stderr: "" };
      };
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
          confirm: true
        })
      );
      const optedInRun = dataOf(
        await handleBrainCreatorTool(context, "bc_run", {
          mode: "case-source-suite",
          systemId: system.id,
          source,
          suiteId: firstRun.suite.id,
          confirm: true,
          continueOnBlocked: true
        })
      );
      expect(optedInRun.task.id).toBe(firstRun.task.id);
      await writeFile(
        optedInRun.task.outputPaths[0],
        "import { test, expect } from '../seed';\n",
        "utf8"
      );
      const needsHealing = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: optedInRun.task.id,
          status: "succeeded",
          stdout: "TC-001 generated",
          stderr: "",
          outputPaths: optedInRun.task.outputPaths
        })
      );
      const nextCase = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: needsHealing.task.id,
          status: "succeeded",
          stdout: "TC-001 cannot be healed without environment data",
          stderr: "",
          outputPaths: needsHealing.task.outputPaths
        })
      );

      expect(nextCase).toEqual(
        expect.objectContaining({
          status: "needs_agent_execution",
          stage: "generator",
          currentCase: expect.objectContaining({ caseNo: "TC-002", status: "waiting-for-agent" }),
          suiteRun: expect.objectContaining({ status: "blocked", blocked: 1 })
        })
      );
      await writeFile(
        nextCase.task.outputPaths[0],
        "import { test, expect } from '../seed';\n",
        "utf8"
      );
      const completed = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: nextCase.task.id,
          status: "succeeded",
          stdout: "TC-002 generated",
          stderr: "",
          outputPaths: nextCase.task.outputPaths
        })
      );

      expect(completed).toEqual(
        expect.objectContaining({
          status: "blocked",
          suite: expect.objectContaining({ id: firstRun.suite.id, status: "blocked" }),
          suiteRun: expect.objectContaining({ status: "completed", passed: 1, blocked: 0 })
        })
      );
      expect(context.service.getCaseSuite(firstRun.suite.id)).toEqual(
        expect.objectContaining({ continueOnBlocked: true })
      );
      expect(context.service.listCaseSuiteRuns(system.id)).toEqual([
        expect.objectContaining({ status: "blocked", blocked: 1 }),
        expect.objectContaining({ status: "completed", passed: 1 })
      ]);
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_PROVIDER", previousProvider);
    }
  });

  it("reports failed, waiting, and pending suite cases without pointing nextCaseNo at an attempted failure", async () => {
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "host-agent";
    try {
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
          confirm: true
        })
      );
      context.runner = async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "expected result was not visible"
      });
      await writeFile(firstRun.task.outputPaths[0], "import { test } from '@playwright/test';\n", "utf8");
      const needsHealing = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: firstRun.task.id,
          status: "succeeded",
          stdout: "generated",
          stderr: "",
          outputPaths: firstRun.task.outputPaths
        })
      );
      const nextCase = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: needsHealing.task.id,
          status: "succeeded",
          stdout: "healed",
          stderr: "",
          outputPaths: needsHealing.task.outputPaths
        })
      );
      await handleBrainCreatorTool(context, "bc_report_gap", {
        projectId: system.id,
        sourceType: "historical",
        sourceId: "older-gap",
        reason: "An older evidence gap still needs review.",
        severity: "medium",
        owner: "qa"
      });
      const status = dataOf(
        await handleBrainCreatorTool(context, "bc_status", { systemId: system.id })
      );

      expect(status.userSummary.readiness).toBe("action-required");
      expect(status.facadeNextAction).toBe("continue_case_source_suite");
      expect(status.userSummary.nextCommand).toBe("/bc continue");
      expect(status.userSummary.activeSuite).toEqual({
        suiteId: firstRun.suite.id,
        status: "waiting-for-agent",
        totalCases: 2,
        attempted: 1,
        passed: 0,
        failed: 1,
        blocked: 0,
        waiting: 1,
        pending: 0,
        nextCaseNo: "TC-002",
        activeTask: {
          taskId: nextCase.task.id,
          caseNo: "TC-002",
          title: nextCase.task.suiteContext.title
        }
      });
      expect(status.statusMarkdown).toContain(`Active suite progress: 0/2 passed; next TC-002`);
      expect(status.suites.unfinished).toEqual([
        expect.objectContaining({
          suiteId: firstRun.suite.id,
          passedCaseNos: [],
          failedCaseNos: ["TC-001"],
          blockedCaseNos: [],
          waitingCaseNos: ["TC-002"],
          pendingCaseNos: [],
          remainingCaseNos: ["TC-001", "TC-002"],
          nextCaseNo: "TC-002",
          activeTask: expect.objectContaining({
            taskId: nextCase.task.id,
            agent: "generator",
            caseNo: "TC-002"
          })
        })
      ]);
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_PROVIDER", previousProvider);
    }
  });

  it("records generated test implementation failures as Gaps instead of product bugs", async () => {
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "host-agent";
    try {
      const workDir = await tempDir();
      const context = createBrainCreatorMcpContext({
        dataFilePath: join(workDir, "assets.json"),
        workDir
      });
      const source = join(workDir, "cases.xlsx");
      await writeFile(
        source,
        createXlsxFixture([
          [
            "TC-001",
            "Filter recruitment requests",
            "Recruitment",
            "User is signed in",
            "1. Select occupied = No",
            "Only unoccupied requests are visible",
            "",
            "P0",
            "Not run",
            "",
            ""
          ]
        ])
      );
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
          confirm: true
        })
      );
      context.runner = async () => ({
        exitCode: 1,
        stdout: "",
        stderr: [
          "Error: expect(locator).toHaveText(expected) failed",
          "Locator: locator('tbody tr').nth(16).locator('td').nth(22)",
          "Expected: \"否\"",
          "Error: element(s) not found"
        ].join("\n")
      });
      await writeFile(firstRun.task.outputPaths[0], "import { test } from '@playwright/test';\n", "utf8");
      const needsHealing = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: firstRun.task.id,
          status: "succeeded",
          stdout: "generated",
          stderr: "",
          outputPaths: firstRun.task.outputPaths
        })
      );
      const blocked = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: needsHealing.task.id,
          status: "succeeded",
          stdout: "healed",
          stderr: "",
          outputPaths: needsHealing.task.outputPaths
        })
      );

      expect(blocked).toEqual(
        expect.objectContaining({
          status: "blocked",
          suiteRun: expect.objectContaining({ status: "blocked", failed: 0, blocked: 1 })
        })
      );
      expect(context.service.listBugReports({ systemId: system.id })).toEqual([]);
      expect(context.repository.executionDiagnoses).toEqual([
        expect.objectContaining({
          caseSourceId: firstRun.source.id,
          caseSuiteId: firstRun.suite.id,
          caseNo: "TC-001",
          verdict: "automation_gap",
          failureType: "locator_failure"
        })
      ]);
      expect(blocked.suiteRun.caseResults).toEqual([
        expect.objectContaining({
          caseNo: "TC-001",
          status: "blocked",
          diagnosisId: context.repository.executionDiagnoses[0].id
        })
      ]);
      expect(context.service.listGaps({ projectId: system.id, status: "open" })).toEqual([
        expect.objectContaining({
          sourceType: "host-agent-healer",
          reason: expect.stringContaining("element(s) not found")
        })
      ]);
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_PROVIDER", previousProvider);
    }
  });

  it("creates a BugReport when a host-agent healer still fails a document expectation", async () => {
    const previousProvider = process.env.BRAIN_CREATOR_AGENT_PROVIDER;
    process.env.BRAIN_CREATOR_AGENT_PROVIDER = "host-agent";
    try {
      const workDir = await tempDir();
      const context = createBrainCreatorMcpContext({
        dataFilePath: join(workDir, "assets.json"),
        workDir
      });
      let runCount = 0;
      let hostFailureReason = "expected result was not visible";
      context.runner = async () => {
        runCount += 1;
        return { exitCode: 1, stdout: "", stderr: hostFailureReason };
      };
      const source = join(workDir, "cases.xlsx");
      await writeFile(
        source,
        createXlsxFixture([
          [
            "TC-001",
            "Create recruitment request",
            "Recruitment",
            "User is signed in",
            "1. Click New",
            "Created successfully",
            "",
            "P0",
            "Not run",
            "",
            ""
          ]
        ])
      );
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
          confirm: true
        })
      );
      const generatorTask = context.service.listAgentTasks(system.id)[0];
      await writeFile(generatorTask.outputPaths[0], "import { test, expect } from '@playwright/test';\n", "utf8");
      const needsHealing = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: generatorTask.id,
          status: "succeeded",
          stdout: "generated test",
          stderr: "",
          outputPaths: generatorTask.outputPaths
        })
      );
      const healed = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: needsHealing.task.id,
          status: "succeeded",
          stdout: "healed test",
          stderr: "",
          outputPaths: generatorTask.outputPaths
        })
      );
      const bugReview = dataOf(
        await handleBrainCreatorTool(context, "bc_review", {
          target: "bug",
          systemId: system.id,
          status: "open"
        })
      );

      expect(firstRun).toEqual(
        expect.objectContaining({
          status: "needs_agent_execution",
          currentCase: expect.objectContaining({ caseNo: "TC-001", status: "waiting-for-agent" })
        })
      );
      expect(healed.suiteRun).toEqual(
        expect.objectContaining({
          suiteId: firstRun.suite.id,
          status: "failed",
          total: 1,
          failed: 1,
          blocked: 0,
          bugReportIds: [bugReview.bugs[0].id],
          gapIds: []
        })
      );
      expect(healed.suiteRun.caseResults).toEqual([
        expect.objectContaining({
          caseNo: "TC-001",
          status: "failed",
          bugReportId: bugReview.bugs[0].id,
          gapIds: [],
          error: expect.stringContaining("expected result was not visible")
        })
      ]);
      expect(bugReview.bugs).toEqual([
        expect.objectContaining({
          caseNo: "TC-001",
          caseTitle: "Create recruitment request",
          expectedResult: "Created successfully",
          actualResult: expect.stringContaining("expected result was not visible"),
          diagnosisId: context.repository.executionDiagnoses[0].id,
          status: "open"
        })
      ]);
      expect(context.repository.executionDiagnoses).toEqual([
        expect.objectContaining({
          caseSourceId: firstRun.source.id,
          caseSuiteId: firstRun.suite.id,
          caseNo: "TC-001",
          verdict: "product_bug",
          bugReportId: bugReview.bugs[0].id
        })
      ]);
      expect(context.service.listGaps({ projectId: system.id, status: "open" })).toEqual([]);

      const secondBug = context.service.createBugReport({
        systemId: system.id,
        sourceId: firstRun.source.id,
        caseNo: "TC-001",
        caseTitle: "Create recruitment request follow-up",
        module: "Recruitment",
        priority: "P1",
        expectedResult: "Created successfully",
        actualResult: "Expected created, actual pending",
        reproductionSteps: ["Click New"],
        evidencePaths: [],
        gapIds: []
      });
      const regressionStart = dataOf(
        await handleBrainCreatorTool(context, "bc_run", {
          mode: "bug-regression",
          systemId: system.id,
          bugIds: [bugReview.bugs[0].id, secondBug.id],
          maxHealAttempts: 1
        })
      );
      await writeFile(
        regressionStart.task.outputPaths[0],
        "import { test, expect } from '@playwright/test';\n",
        "utf8"
      );
      const regressionHealing = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: regressionStart.task.id,
          status: "succeeded",
          stdout: "generated regression test",
          stderr: "",
          outputPaths: regressionStart.task.outputPaths
        })
      );
      const regressionFailed = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: regressionHealing.task.id,
          status: "succeeded",
          stdout: "healed regression test",
          stderr: "",
          outputPaths: regressionHealing.task.outputPaths
        })
      );

      expect(regressionStart).toEqual(
        expect.objectContaining({
          mode: "bug-regression",
          status: "needs_agent_execution",
          currentBug: expect.objectContaining({ id: bugReview.bugs[0].id })
        })
      );
      expect(regressionFailed).toEqual(
        expect.objectContaining({
          mode: "bug-regression",
          status: "needs_agent_execution",
          currentBug: expect.objectContaining({ id: secondBug.id }),
          completedRegression: expect.objectContaining({
            status: "failed",
            result: expect.objectContaining({
              caseNo: "TC-001",
              status: "failed",
              bugReportId: bugReview.bugs[0].id,
              diagnosisId: expect.any(String),
              gapIds: []
            }),
            bug: expect.objectContaining({
              id: bugReview.bugs[0].id,
              status: "retest-failed"
            }),
            executionDiagnosis: expect.objectContaining({
              verdict: "product_bug",
              bugReportId: bugReview.bugs[0].id
            })
          }),
        })
      );

      hostFailureReason = "SyntaxError in generated regression test";
      await writeFile(
        regressionFailed.task.outputPaths[0],
        "import { test } from '@playwright/test';\n",
        "utf8"
      );
      const technicalNeedsHealing = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: regressionFailed.task.id,
          status: "succeeded",
          stdout: "generated regression test",
          stderr: "",
          outputPaths: regressionFailed.task.outputPaths
        })
      );
      const technicalBlocked = dataOf(
        await handleBrainCreatorTool(context, "bc_submit_agent_output", {
          taskId: technicalNeedsHealing.task.id,
          status: "succeeded",
          stdout: "healed regression test",
          stderr: "",
          outputPaths: technicalNeedsHealing.task.outputPaths
        })
      );

      expect(technicalBlocked).toEqual(
        expect.objectContaining({
          mode: "bug-regression",
          status: "blocked",
          result: expect.objectContaining({
            status: "blocked",
            bugReportId: secondBug.id,
            gapIds: [expect.any(String)]
          }),
          bug: expect.objectContaining({
            id: secondBug.id,
            status: "open"
          }),
          executionDiagnosis: expect.objectContaining({
            verdict: "automation_gap",
            failureType: "automation_failure",
            bugReportId: secondBug.id
          })
        })
      );
    } finally {
      restoreEnv("BRAIN_CREATOR_AGENT_PROVIDER", previousProvider);
    }
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
    expect(status.userSummary.nextCommand).toBe("/bc continue");
    expect(status.quickCommands).toEqual(
      expect.arrayContaining([expect.objectContaining({ command: "/bc continue" })])
    );
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
    let failureReason: string | undefined = "expected result was not visible";
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
        failureReason
          ? { exitCode: 1, stdout: "", stderr: failureReason }
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
    expect(result.suiteRun.caseResults).toEqual([
      expect.objectContaining({
        caseNo: "TC-001",
        status: "failed",
        diagnosisId: context.repository.executionDiagnoses[0].id
      })
    ]);
    expect(context.repository.executionDiagnoses[0]).toEqual(
      expect.objectContaining({
        caseSourceId: result.source.id,
        caseSuiteId: result.suite.id,
        caseNo: "TC-001",
        verdict: "product_bug",
        bugReportId: bugs[0].id
      })
    );

    failureReason = "SyntaxError in generated regression test";
    const blockedRegression = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "bug-regression",
        systemId: system.id,
        bugIds: [bugs[0].id],
        maxHealAttempts: 0
      })
    );
    const blockedBugReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "bug",
        systemId: system.id
      })
    );
    const diagnosisStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        systemId: system.id
      })
    );
    const diagnosisReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "execution-diagnosis",
        systemId: system.id,
        failureTypes: ["automation_failure"]
      })
    );

    expect(blockedRegression).toEqual(
      expect.objectContaining({
        status: "blocked",
        passed: 0,
        failed: 0,
        blocked: 1,
        results: [
          expect.objectContaining({
            caseNo: "TC-001",
            status: "blocked",
            bugReportId: bugs[0].id,
            diagnosisId: expect.any(String)
          })
        ]
      })
    );
    expect(blockedBugReview.bugs).toEqual([
      expect.objectContaining({ id: bugs[0].id, status: "open" })
    ]);
    expect(context.repository.executionDiagnoses.at(-1)).toEqual(
      expect.objectContaining({
        verdict: "automation_gap",
        failureType: "automation_failure",
        gapIds: blockedRegression.results[0].gapIds
      })
    );
    expect(diagnosisStatus.executionDiagnoses).toEqual(
      expect.objectContaining({
        total: 2,
        routing: expect.objectContaining({
          bugEligible: 1,
          gapRouted: 1
        })
      })
    );
    expect(diagnosisReview).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          total: 2,
          routing: expect.objectContaining({
            bugEligible: 1,
            gapRouted: 1
          })
        }),
        items: [
          expect.objectContaining({
            verdict: "automation_gap",
            failureType: "automation_failure"
          })
        ]
      })
    );

    failureReason = undefined;
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

  it("summarizes default bug regression candidates and results", async () => {
    const workDir = await tempDir();
    let regressionRun = false;
    let retestCount = 0;
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
        if (!regressionRun) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: "Expected documented result, actual result differed"
          };
        }
        retestCount += 1;
        return retestCount === 2
          ? {
              exitCode: 1,
              stdout: "",
              stderr: "Expected offer sent, actual offer remained draft"
            }
          : { exitCode: 0, stdout: "fixed", stderr: "" };
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
    await handleBrainCreatorTool(context, "bc_run", {
      mode: "case-source-suite",
      systemId: system.id,
      source,
      confirm: true,
      maxHealAttempts: 0
    });

    const beforeReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "bug",
        systemId: system.id
      })
    );
    regressionRun = true;
    const regression = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "bug-regression",
        systemId: system.id,
        maxHealAttempts: 0
      })
    );

    expect(beforeReview.regressionCandidates).toEqual(
      expect.objectContaining({
        total: 2,
        bugIds: expect.arrayContaining(beforeReview.bugs.map((bug: { id: string }) => bug.id))
      })
    );
    expect(regression.summary).toEqual(
      expect.objectContaining({
        candidates: 2,
        retestPassed: 1,
        retestFailed: 1
      })
    );
    expect(regression.regressionMarkdown).toContain("## Bug Regression Summary");
    expect(regression.regressionMarkdown).toContain("Retest passed: 1");
    expect(regression.regressionMarkdown).toContain("Retest failed: 1");
    expect(regression.regressionMarkdown).toContain("TC-001 创建招聘需求");
    expect(regression.regressionMarkdown).toContain("TC-002 发起 offer");
    expect(regression.bugs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ caseNo: "TC-001", status: "retest-passed" }),
        expect.objectContaining({ caseNo: "TC-002", status: "retest-failed" })
      ])
    );
  });

  it("filters bug regression candidates by id, module, and priority", async () => {
    const workDir = await tempDir();
    let regressionRun = false;
    let retestCount = 0;
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
        if (!regressionRun) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: "Expected documented result, actual result differed"
          };
        }
        retestCount += 1;
        return { exitCode: 0, stdout: "fixed", stderr: "" };
      }
    });
    const source = join(workDir, "cases.xlsx");
    await writeFile(
      source,
      createXlsxFixture([
        ["TC-101", "Create job request", "Recruiting", "Logged in", "1. Click New", "Created", "", "P0", "", "", ""],
        ["TC-102", "Send offer", "Offer", "Candidate ready", "1. Click Offer", "Offer sent", "", "P1", "", "", ""]
      ])
    );
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
    await handleBrainCreatorTool(context, "bc_run", {
      mode: "case-source-suite",
      systemId: system.id,
      source,
      confirm: true,
      maxHealAttempts: 0
    });
    const beforeReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "bug",
        systemId: system.id,
        status: "open"
      })
    );
    const recruitingBug = beforeReview.bugs.find((bug: { module: string }) => bug.module === "Recruiting");

    regressionRun = true;
    const regression = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "bug-regression",
        systemId: system.id,
        bugIds: beforeReview.bugs.map((bug: { id: string }) => bug.id),
        modules: ["Recruiting"],
        priorities: ["P0"],
        maxHealAttempts: 0
      })
    );
    const afterReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "bug",
        systemId: system.id
      })
    );

    expect(beforeReview.bugs).toEqual([
      expect.objectContaining({ caseNo: "TC-101", module: "Recruiting", priority: "P0" }),
      expect.objectContaining({ caseNo: "TC-102", module: "Offer", priority: "P1" })
    ]);
    expect(regression.summary).toEqual(
      expect.objectContaining({ candidates: 1, attempted: 1, retestPassed: 1 })
    );
    expect(regression.bugs).toEqual([
      expect.objectContaining({ id: recruitingBug.id, caseNo: "TC-101", status: "retest-passed" })
    ]);
    expect(afterReview.bugs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ caseNo: "TC-101", status: "retest-passed" }),
        expect.objectContaining({ caseNo: "TC-102", status: "open" })
      ])
    );
    expect(retestCount).toBe(1);
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

  it("exposes a bounded read-only historical diagnosis audit", async () => {
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(await tempDir(), "assets.json")
    });
    const system = context.service.createSystemProfile({
      name: "Legacy Console",
      environment: "test",
      baseUrl: "https://legacy.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://legacy.example.test"]
    });
    context.repository.bugReports.push({
      id: "legacy-bug",
      systemId: system.id,
      sourceId: "legacy-source",
      caseNo: "TC-001",
      caseTitle: "Legacy assertion",
      module: "Orders",
      priority: "P1",
      expectedResult: "approved",
      actualResult: "Expected approved, actual pending",
      reproductionSteps: [],
      evidencePaths: [],
      gapIds: [],
      status: "open",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z"
    });
    context.repository.gaps.push({
      id: "legacy-gap",
      projectId: system.id,
      sourceType: "legacy-execution",
      sourceId: "TC-002",
      reason: "network timeout while opening the target",
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z"
    });

    const before = JSON.stringify({
      bugs: context.repository.bugReports,
      gaps: context.repository.gaps
    });
    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", { systemId: system.id })
    );
    const review = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "execution-diagnosis",
        systemId: system.id,
        limit: 1
      })
    );

    expect(status.executionDiagnoses.legacyAudit).toEqual(
      expect.objectContaining({ totalCandidates: 2, bugs: 1, gaps: 1 })
    );
    expect(review.legacyAudit.summary).toEqual(
      expect.objectContaining({ totalCandidates: 2, truncated: true })
    );
    expect(review.legacyAudit.candidates).toHaveLength(1);
    expect(JSON.stringify(review.legacyAudit)).not.toContain(
      "Expected approved, actual pending"
    );
    expect(
      JSON.stringify({
        bugs: context.repository.bugReports,
        gaps: context.repository.gaps
      })
    ).toBe(before);

    const migrationPreview = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "review-legacy-diagnosis",
        systemId: system.id,
        diagnosisAssetType: "bug",
        diagnosisAssetId: "legacy-bug",
        diagnosisDecision: "confirm_bug",
        confirm: false
      })
    );
    expect(migrationPreview).toEqual(
      expect.objectContaining({
        status: "preview",
        requiresConfirmation: true,
        decision: "confirm_bug"
      })
    );
    expect(context.repository.executionDiagnosisReviews).toHaveLength(0);

    const confirmed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "review-legacy-diagnosis",
        systemId: system.id,
        diagnosisAssetType: "bug",
        diagnosisAssetId: "legacy-bug",
        diagnosisDecision: "confirm_bug",
        confirmationNote: "Confirmed historical expectation mismatch",
        confirm: true
      })
    );
    const confirmedStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", { systemId: system.id })
    );
    const confirmedReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "execution-diagnosis",
        systemId: system.id
      })
    );
    expect(confirmed).toEqual(
      expect.objectContaining({
        status: "confirmed",
        review: expect.objectContaining({ decision: "confirm_bug" }),
        diagnosis: expect.objectContaining({
          verdict: "product_bug",
          bugReportId: "legacy-bug"
        })
      })
    );
    expect(context.repository.bugReports[0].status).toBe("open");
    expect(confirmedStatus.executionDiagnoses).toEqual(
      expect.objectContaining({
        legacyAudit: expect.objectContaining({ totalCandidates: 1 }),
        legacyReviews: expect.objectContaining({ total: 1, migrated: 1 })
      })
    );
    expect(confirmedReview.legacyReviews).toEqual([
      expect.objectContaining({ assetId: "legacy-bug", decision: "confirm_bug" })
    ]);
    const repeated = errorOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "review-legacy-diagnosis",
        systemId: system.id,
        diagnosisAssetType: "bug",
        diagnosisAssetId: "legacy-bug",
        diagnosisDecision: "confirm_bug",
        confirmationNote: "Repeat",
        confirm: true
      })
    );
    expect(repeated).toContain("already reviewed");

    context.repository.bugReports.push({
      id: "legacy-technical-bug",
      systemId: system.id,
      sourceId: "legacy-source",
      caseNo: "TC-003",
      caseTitle: "Misclassified generated test failure",
      module: "Orders",
      priority: "P1",
      expectedResult: "approved",
      actualResult: "SyntaxError in generated test",
      reproductionSteps: [],
      evidencePaths: [],
      gapIds: [],
      status: "open",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z"
    });
    const correctedPreview = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "review-legacy-diagnosis",
        systemId: system.id,
        diagnosisAssetType: "bug",
        diagnosisAssetId: "legacy-technical-bug",
        diagnosisDecision: "override_classification",
        correctedFailureType: "assertion_failure",
        correctedVerdict: "product_bug",
        confirm: false
      })
    );
    expect(correctedPreview.conclusion).toEqual({
      failureType: "assertion_failure",
      verdict: "product_bug",
      matchesSuggestion: false
    });
    const corrected = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "review-legacy-diagnosis",
        systemId: system.id,
        diagnosisAssetType: "bug",
        diagnosisAssetId: "legacy-technical-bug",
        diagnosisDecision: "override_classification",
        correctedFailureType: "assertion_failure",
        correctedVerdict: "product_bug",
        confirmationNote: "Trace confirms the assertion reached the target system",
        confirm: true
      })
    );
    const qualityStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", { systemId: system.id })
    );
    const qualityReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "execution-diagnosis",
        systemId: system.id,
        minSampleSize: 2
      })
    );
    expect(corrected.review).toEqual(
      expect.objectContaining({
        decision: "override_classification",
        matchesSuggestion: false,
        confirmedVerdict: "product_bug"
      })
    );
    expect(qualityStatus.executionDiagnoses.legacyReviews.quality).toEqual(
      expect.objectContaining({
        adjudicated: 2,
        matched: 1,
        corrected: 1,
        accuracy: 0.5
      })
    );
    expect(qualityStatus.executionDiagnoses.humanAdjudicationEval).toEqual(
      expect.objectContaining({
        readiness: "insufficient-sample",
        adjudicated: 2,
        minSampleSize: 20,
        observedAccuracy: 0.5,
        reportableAccuracy: null
      })
    );
    expect(qualityReview.humanAdjudicationEval).toEqual(
      expect.objectContaining({
        readiness: "ready",
        reportableAccuracy: 0.5
      })
    );
    expect(qualityReview.evalMarkdown).toContain(
      "Reportable accuracy: 50.0%"
    );
  });

  it("previews and confirms rollback of a historical diagnosis migration", async () => {
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(await tempDir(), "assets.json")
    });
    const system = context.service.createSystemProfile({
      name: "Rollback Console",
      environment: "test",
      baseUrl: "https://rollback.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://rollback.example.test"]
    });
    context.repository.bugReports.push({
      id: "legacy-automation-bug",
      systemId: system.id,
      sourceId: "legacy-source",
      caseNo: "TC-ROLLBACK",
      caseTitle: "Generated test failed",
      module: "Orders",
      priority: "P1",
      expectedResult: "approved",
      actualResult: "SyntaxError in generated test",
      reproductionSteps: [],
      evidencePaths: [],
      gapIds: [],
      status: "open",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z"
    });
    const migrated = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "review-legacy-diagnosis",
        systemId: system.id,
        diagnosisAssetType: "bug",
        diagnosisAssetId: "legacy-automation-bug",
        diagnosisDecision: "review_bug_as_gap",
        confirmationNote: "Confirmed generated test failure",
        confirm: true
      })
    );

    const beforePreview = JSON.stringify(context.repository);
    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "rollback-legacy-diagnosis",
        systemId: system.id,
        diagnosisReviewId: migrated.review.id,
        confirm: false
      })
    );
    expect(preview).toEqual(
      expect.objectContaining({ status: "preview", requiresConfirmation: true })
    );
    expect(JSON.stringify(context.repository)).toBe(beforePreview);

    const rolledBack = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "rollback-legacy-diagnosis",
        systemId: system.id,
        diagnosisReviewId: migrated.review.id,
        confirmationNote: "Restore the source asset for a new evidence review",
        confirm: true
      })
    );
    expect(rolledBack).toEqual(
      expect.objectContaining({
        status: "rolled-back",
        review: expect.objectContaining({ status: "rolled-back" })
      })
    );
    expect(context.repository.bugReports[0]).toEqual(
      expect.objectContaining({ status: "open", gapIds: [], diagnosisId: undefined })
    );
    expect(context.repository.gaps).toEqual([]);
    expect(context.repository.executionDiagnoses).toEqual([]);
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
