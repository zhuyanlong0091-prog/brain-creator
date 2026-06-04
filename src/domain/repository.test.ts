// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrainCreatorService } from "./service.js";
import { JsonFileBrainCreatorRepository } from "./repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("JsonFileBrainCreatorRepository", () => {
  it("restores business systems after the service is recreated", async () => {
    const filePath = join(await tempDir(), "assets.json");
    const firstService = new BrainCreatorService(new JsonFileBrainCreatorRepository(filePath));
    const system = firstService.createSystemProfile({
      name: "Orders Console",
      environment: "staging",
      baseUrl: "http://127.0.0.1:3000/fixtures/private-target",
      defaultLocale: "zh-CN",
      urlAllowlist: ["http://127.0.0.1:3000/fixtures/private-target"]
    });

    const secondService = new BrainCreatorService(new JsonFileBrainCreatorRepository(filePath));

    expect(secondService.listSystemProfiles()).toEqual([
      expect.objectContaining({
        id: system.id,
        name: "Orders Console"
      })
    ]);
  });

  it("restores page assets after the service is recreated", async () => {
    const filePath = join(await tempDir(), "assets.json");
    const firstService = new BrainCreatorService(new JsonFileBrainCreatorRepository(filePath));
    firstService.discoverPageModel({
      projectId: "project-1",
      route: "/orders",
      name: "Orders",
      authProfileId: "auth_1",
      domText: "Create Order Submit"
    });

    const secondService = new BrainCreatorService(new JsonFileBrainCreatorRepository(filePath));

    expect(
      secondService.searchAssets({
        projectId: "project-1",
        query: "order"
      })
    ).toEqual(expect.arrayContaining([expect.objectContaining({ type: "page-model" })]));
  });

  it("restores glossary terms after the service is recreated", async () => {
    const filePath = join(await tempDir(), "assets.json");
    const firstService = new BrainCreatorService(new JsonFileBrainCreatorRepository(filePath));
    firstService.createGlossaryTerm({
      projectId: "project-1",
      key: "order.submit",
      zhCN: "提交订单",
      enUS: "Submit order",
      aliases: ["Create Order"],
      pageScope: "/orders"
    });

    const secondService = new BrainCreatorService(new JsonFileBrainCreatorRepository(filePath));

    expect(
      secondService.searchAssets({
        projectId: "project-1",
        query: "提交"
      })
    ).toEqual(expect.arrayContaining([expect.objectContaining({ type: "glossary-term" })]));
  });

  it("restores v2 business rules, test cases, and run records after recreation", async () => {
    const filePath = join(await tempDir(), "assets.json");
    const firstService = new BrainCreatorService(new JsonFileBrainCreatorRepository(filePath));
    const rule = firstService.createBusinessRule({
      systemId: "system-1",
      name: "Robot payment rule",
      condition: "购买机器人必须校验支付金额",
      severity: "block"
    });
    const testCase = firstService.createTestCase({
      systemId: "system-1",
      requirement: "测试购买机器人",
      scenarios: [],
      newTerms: [],
      ruleCheckResult: {
        passed: true,
        checks: [{ ruleId: rule.id, ruleName: rule.name, covered: true, detail: "covered" }]
      }
    });
    firstService.recordAgentRun({
      id: "agent_1",
      systemId: "system-1",
      agent: "planner",
      status: "succeeded",
      inputSummary: "Planner explored robot purchase",
      outputPaths: ["specs/robot.md"],
      duration: 10,
      logs: [],
      createdAt: "2026-05-29T00:00:00.000Z"
    });
    firstService.recordChainRun({
      id: "chain_1",
      systemId: "system-1",
      testCaseId: testCase.id,
      status: "succeeded",
      specPath: "specs/robot.md",
      testPath: "tests/generated/robot.spec.ts",
      gaps: [],
      createdAt: "2026-05-29T00:00:00.000Z"
    });

    const secondService = new BrainCreatorService(new JsonFileBrainCreatorRepository(filePath));

    expect(secondService.listBusinessRules("system-1")).toEqual([
      expect.objectContaining({ id: rule.id })
    ]);
    expect(secondService.listTestCases("system-1")).toEqual([
      expect.objectContaining({ id: testCase.id })
    ]);
    expect(secondService.listAgentRuns("system-1")).toEqual([
      expect.objectContaining({ id: "agent_1" })
    ]);
    expect(secondService.listChainRuns("system-1")).toEqual([
      expect.objectContaining({ id: "chain_1" })
    ]);
  });

  it("restores manual auth checkpoints after recreation", async () => {
    const filePath = join(await tempDir(), "assets.json");
    const firstService = new BrainCreatorService(new JsonFileBrainCreatorRepository(filePath));
    const system = firstService.createSystemProfile({
      name: "Google Gmail Login",
      environment: "external-first-run",
      baseUrl: "https://workspace.google.com/intl/zh-CN/gmail/",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://accounts.google.com/"]
    });
    const auth = firstService.createAuthProfile({
      projectId: system.id,
      env: "external-first-run",
      role: "manual-user",
      loginMethod: "script",
      secrets: { mode: "manual-browser-login-required" }
    });
    const checkpoint = firstService.createAuthCheckpoint({
      systemId: system.id,
      authProfileId: auth.id,
      reason: "Manual Google authentication required",
      resumeInstruction: "Resume after Inbox is visible"
    });

    const secondService = new BrainCreatorService(new JsonFileBrainCreatorRepository(filePath));

    expect(secondService.listAuthCheckpoints(system.id)).toEqual([
      expect.objectContaining({ id: checkpoint.id, status: "awaiting-user" })
    ]);
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-repository-"));
  tempDirs.push(dir);
  return dir;
}
