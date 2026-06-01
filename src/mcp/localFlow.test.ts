import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Brain Creator local MCP flow", () => {
  it("runs create system to search assets as a local end-to-end smoke flow", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(workDir, ".brain-creator", "assets.json"),
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
    const confirmedTerms = dataOf(
      await handleBrainCreatorTool(context, "bc_batch_confirm_terms", {
        caseId: draft.testCase.id,
        confirmTermIds: draft.testCase.newTerms.map((term: { id: string }) => term.id),
        ignoreTermIds: []
      })
    );
    const updatedPlan = dataOf(
      await handleBrainCreatorTool(context, "bc_update_plan", {
        caseId: draft.testCase.id,
        scenarios: [
          {
            id: "scenario_1",
            title: "璐拱鏈哄櫒浜哄苟鏍￠獙璁㈠崟閲戦",
            priority: "critical",
            businessRuleRef: "rule_1",
            steps: [
              { action: "navigate", target: "鍟嗗搧鍒楄〃" },
              { action: "assert", target: "璁㈠崟閲戦", expected: "閲戦姝ｇ‘" }
            ]
          }
        ]
      })
    );
    await handleBrainCreatorTool(context, "bc_approve_plan", {
      caseId: draft.testCase.id
    });
    const agentRun = dataOf(
      await handleBrainCreatorTool(context, "bc_run_agent", {
        systemId: system.id,
        agent: "planner",
        inputSummary: "Smoke single planner run",
        args: ["--prompt", "specs/_context/smoke.md"],
        outputPaths: ["specs/smoke.md"]
      })
    );
    const run = dataOf(
      await handleBrainCreatorTool(context, "bc_run_chain", {
        caseId: draft.testCase.id
      })
    );
    const assets = dataOf(
      await handleBrainCreatorTool(context, "bc_search_assets", {
        projectId: system.id,
        query: "机器人"
      })
    );

    const terms = dataOf(
      await handleBrainCreatorTool(context, "bc_list_terms", {
        projectId: system.id,
        query: ""
      })
    );
    const updatedTerm = dataOf(
      await handleBrainCreatorTool(context, "bc_update_term", {
        projectId: system.id,
        termId: terms[0].id,
        key: "checkout.robot",
        zhCN: terms[0].zhCN,
        enUS: "Robot checkout",
        aliases: ["robot order"],
        pageScope: "/checkout"
      })
    );
    const deletedTerm = dataOf(
      await handleBrainCreatorTool(context, "bc_delete_term", {
        projectId: system.id,
        termId: updatedTerm.id
      })
    );
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

    expect(confirmedTerms.confirmedTerms.length).toBeGreaterThan(0);
    expect(terms.length).toBe(confirmedTerms.confirmedTerms.length);
    expect(updatedTerm.key).toBe("checkout.robot");
    expect(deletedTerm.id).toBe(updatedTerm.id);
    expect(updatedPlan.scenarios[0].title).toContain("璁㈠崟閲戦");
    expect(agentRun.status).toBe("succeeded");
    expect(run.chainRun.status).toBe("succeeded");
    expect(cases).toEqual([expect.objectContaining({ id: draft.testCase.id })]);
    expect(gaps).toEqual([]);
    expect(assets.map((asset: { type: string }) => asset.type)).toEqual(
      expect.arrayContaining(["test-case", "agent-run", "chain-run"])
    );
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
  const dir = await mkdtemp(join(tmpdir(), "brain-local-flow-"));
  tempDirs.push(dir);
  return dir;
}
