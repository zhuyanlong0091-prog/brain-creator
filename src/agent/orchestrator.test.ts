import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generatePlanDraft, runAgent, runChain } from "./orchestrator.js";
import { encryptSecrets } from "../shared/crypto.js";
import type {
  AuthProfile,
  BusinessRule,
  GlossaryTerm,
  SystemProfile,
  TestCase
} from "../domain/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runAgent", () => {
  it("records a succeeded Playwright agent run from a command runner", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    const run = await runAgent({
      systemId: "system_1",
      agent: "planner",
      inputSummary: "测试购买机器人",
      args: ["--prompt", "specs/_context/system_1-prompt.md"],
      outputPaths: ["specs/robot.md"],
      runner: async (command, args) => {
        calls.push({ command, args });
        return { exitCode: 0, stdout: "planner ok", stderr: "" };
      }
    });

    expect(calls).toEqual([
      {
        command: "npx",
        args: ["playwright", "agent", "planner", "--prompt", "specs/_context/system_1-prompt.md"]
      }
    ]);
    expect(run).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^agent_/),
        systemId: "system_1",
        agent: "planner",
        status: "succeeded",
        inputSummary: "测试购买机器人",
        outputPaths: ["specs/robot.md"],
        logs: ["planner ok"]
      })
    );
    expect(run.duration).toBeGreaterThanOrEqual(0);
  });

  it("records a failed Playwright agent run without throwing", async () => {
    const run = await runAgent({
      systemId: "system_1",
      agent: "generator",
      inputSummary: "生成购买机器人测试",
      args: ["--spec", "specs/robot.md"],
      outputPaths: [],
      runner: async () => ({ exitCode: 1, stdout: "", stderr: "generator failed" })
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBe("generator failed");
    expect(run.logs).toEqual(["generator failed"]);
  });
});

describe("generatePlanDraft", () => {
  it("builds context, runs planner, parses scenarios, checks rules, and extracts new terms", async () => {
    const workDir = await tempDir();
    const specPath = join(workDir, "specs", "robot.md");
    const calls: string[][] = [];

    const result = await generatePlanDraft({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      requirement: "测试购买机器人的完整流程",
      glossaryTerms: [robotTerm()],
      businessRules: [paymentRule()],
      specPath,
      runner: async (_command, args) => {
        calls.push(args);
        await writeFile(
          specPath,
          [
            "## Scenario: 购买机器人",
            "Priority: critical",
            "Rule: rule_1",
            "- navigate: 商品列表",
            "- click: 机器人商品",
            "- assert: 订单金额 => 金额正确",
            "- click: 提交订单"
          ].join("\n"),
          "utf8"
        );
        return { exitCode: 0, stdout: "planner wrote spec", stderr: "" };
      }
    });

    expect(calls[0]).toEqual(
      expect.arrayContaining(["playwright", "agent", "planner", "--output", specPath])
    );
    expect(result.agentRun.status).toBe("succeeded");
    expect(result.scenarios[0]).toEqual(
      expect.objectContaining({
        title: "购买机器人",
        priority: "critical",
        businessRuleRef: "rule_1"
      })
    );
    expect(result.ruleCheckResult.passed).toBe(true);
    expect(result.newTerms.map((term) => term.zhCN)).toEqual(["商品列表", "订单金额", "提交订单"]);
    expect(await readFile(result.promptPath, "utf8")).toContain("测试购买机器人的完整流程");
  });
});

describe("runChain", () => {
  it("serializes an approved test case, runs generator, and executes the generated test", async () => {
    const workDir = await tempDir();
    const commands: string[][] = [];
    const testCase = approvedTestCase();

    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      testCase,
      runner: async (_command, args) => {
        commands.push(args);
        return { exitCode: 0, stdout: `${args.join(" ")} ok`, stderr: "" };
      }
    });

    expect(commands).toEqual([
      expect.arrayContaining(["playwright", "agent", "generator"]),
      ["playwright", "test", result.testPath]
    ]);
    expect(result.chainRun).toEqual(
      expect.objectContaining({
        systemId: "system_1",
        testCaseId: testCase.id,
        status: "succeeded",
        specPath: result.specPath,
        testPath: result.testPath,
        gaps: []
      })
    );
    expect(await readFile(result.specPath, "utf8")).toContain("## Scenario: 购买机器人");
  });

  it("marks the chain failed when the generated test command fails", async () => {
    const workDir = await tempDir();
    const result = await runChain({
      workDir,
      system: systemProfile(),
      authProfile: authProfile(),
      testCase: approvedTestCase(),
      runner: async (_command, args) => ({
        exitCode: args[1] === "test" ? 1 : 0,
        stdout: "",
        stderr: args[1] === "test" ? "test failed" : ""
      })
    });

    expect(result.chainRun.status).toBe("failed");
    expect(result.generateRun.status).toBe("succeeded");
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-orchestrator-"));
  tempDirs.push(dir);
  return dir;
}

function systemProfile(): SystemProfile {
  return {
    id: "system_1",
    name: "Orders Console",
    environment: "staging",
    baseUrl: "https://shop.example.test",
    defaultLocale: "zh-CN",
    urlAllowlist: ["https://shop.example.test"],
    status: "succeeded",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function authProfile(): AuthProfile {
  return {
    id: "auth_1",
    projectId: "system_1",
    env: "staging",
    role: "qa-admin",
    loginMethod: "token",
    encryptedSecrets: encryptSecrets({ token: "secret-token" }),
    status: "succeeded",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function robotTerm(): GlossaryTerm {
  return {
    id: "term_1",
    projectId: "system_1",
    key: "product.robot",
    zhCN: "机器人",
    enUS: "Robot",
    aliases: [],
    pageScope: "/products",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function paymentRule(): BusinessRule {
  return {
    id: "rule_1",
    systemId: "system_1",
    name: "Payment amount rule",
    condition: "必须校验订单金额",
    severity: "block",
    createdAt: "2026-05-29T00:00:00.000Z"
  };
}

function approvedTestCase(): TestCase {
  return {
    id: "case_1",
    systemId: "system_1",
    requirement: "测试购买机器人",
    status: "approved",
    scenarios: [
      {
        id: "scenario_1",
        title: "购买机器人",
        priority: "critical",
        steps: [
          { action: "navigate", target: "商品列表" },
          { action: "assert", target: "订单金额", expected: "金额正确" }
        ]
      }
    ],
    newTerms: [],
    ruleCheckResult: { passed: true, checks: [] },
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
}
