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
