import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
      runner: async (_command, args) => ({ exitCode: 0, stdout: args.join(" "), stderr: "" })
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

    expect(result.chainRun.status).toBe("succeeded");
    expect(context.service.listChainRuns(system.id)).toEqual([
      expect.objectContaining({ id: result.chainRun.id })
    ]);
    expect(context.service.listAgentRuns(system.id)).toEqual([
      expect.objectContaining({ agent: "generator" })
    ]);
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
});

function dataOf(result: CallToolResult) {
  const firstContent = result.content[0];
  if (firstContent.type !== "text") {
    throw new Error("Expected text result");
  }
  return JSON.parse(firstContent.text).data;
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-mcp-"));
  tempDirs.push(dir);
  return dir;
}
