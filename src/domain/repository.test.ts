// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("restores System Brain exploration runs after recreation", async () => {
    const filePath = join(await tempDir(), "assets.json");
    const first = new JsonFileBrainCreatorRepository(filePath);
    first.systemExplorations.push({
      id: "exploration_1",
      knowledgeProjectId: "knowledge_1",
      systemId: "system_1",
      startUrl: "https://orders.example.test/",
      status: "completed",
      interactionMode: "off",
      budget: {
        maxPages: 5,
        maxDepth: 2,
        maxDurationMs: 60_000,
        maxInteractionsPerPage: 0
      },
      pageModelIds: ["page_1"],
      navigationEdges: [],
      interactionTransitions: [],
      warnings: [],
      gapIds: [],
      artifactDir: ".brain-creator/system-explorations/exploration_1",
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:01:00.000Z",
      completedAt: "2026-07-28T00:01:00.000Z"
    });
    first.persist();

    const second = new JsonFileBrainCreatorRepository(filePath);

    expect(second.schemaVersion).toBe(9);
    expect(second.systemExplorations).toEqual([
      expect.objectContaining({ id: "exploration_1", status: "completed" })
    ]);
  });

  it("restores test data tasks and leases after recreation", async () => {
    const filePath = join(await tempDir(), "assets.json");
    const first = new JsonFileBrainCreatorRepository(filePath);
    first.testDataTasks.push({
      id: "testDataTask_1",
      knowledgeProjectId: "knowledge_1",
      systemId: "system_1",
      executableCaseId: "executableCase_1",
      profileId: "profile_1",
      field: "Customer",
      action: "lookup-or-create",
      status: "submitted",
      idempotencyKey: "system_1:executableCase_1:profile_1:lookup-or-create:none",
      allowCreate: false,
      cleanup: "none",
      lookupQuery: "status=active",
      leaseId: "testDataLease_1",
      contextPath: ".brain-creator/test-data/testDataTask_1/input.context.json",
      promptPath: ".brain-creator/test-data/testDataTask_1/input.prompt.md",
      sourceRefs: ["requirement:customer"],
      outputSourceRefs: ["api:customers/42"],
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:01:00.000Z",
      submittedAt: "2026-07-30T00:01:00.000Z"
    });
    first.testDataLeases.push({
      id: "testDataLease_1",
      knowledgeProjectId: "knowledge_1",
      systemId: "system_1",
      executableCaseId: "executableCase_1",
      profileId: "profile_1",
      taskId: "testDataTask_1",
      decision: "reuse",
      reference: "customer:42",
      cleanup: "none",
      status: "active",
      sourceRefs: ["api:customers/42"],
      createdAt: "2026-07-30T00:01:00.000Z",
      updatedAt: "2026-07-30T00:01:00.000Z"
    });
    first.executionPlans.push({
      id: "executionPlan_1",
      knowledgeProjectId: "knowledge_1",
      requirementSetId: "requirement_1",
      systemId: "system_1",
      executableCaseId: "executableCase_1",
      title: "Create order",
      preconditions: [],
      steps: [],
      dataBindings: [],
      contextPack: {
        knowledgeProjectId: "knowledge_1",
        purpose: "generator",
        query: "Create order",
        content: "",
        references: [],
        truncated: false
      },
      checks: [],
      verdict: "ready",
      blockers: [],
      sourceRefs: ["requirement:1"],
      snapshotHash: "a".repeat(64),
      generatedAt: "2026-07-30T00:01:00.000Z",
      confirmedAt: "2026-07-30T00:01:00.000Z"
    });
    first.requirementSuiteRuns.push({
      id: "requirementSuiteRun_1",
      knowledgeProjectId: "knowledge_1",
      systemId: "system_1",
      status: "waiting-for-agent",
      continueOnBlocked: false,
      allowCreateTestData: true,
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      currentExecutableCaseId: "executableCase_1",
      caseRuns: [{
        executableCaseId: "executableCase_1",
        executionPlanId: "executionPlan_1",
        title: "Create order",
        order: 1,
        status: "waiting-for-agent",
        testCaseId: "case_1",
        agentTaskId: "agentTask_1",
        executionEvidenceId: "executionEvidence_1",
        gapIds: [],
        startedAt: "2026-07-30T00:01:00.000Z"
      }],
      createdAt: "2026-07-30T00:01:00.000Z",
      updatedAt: "2026-07-30T00:01:00.000Z"
    });
    first.persist();

    const second = new JsonFileBrainCreatorRepository(filePath);

    expect(second.schemaVersion).toBe(9);
    expect(second.testDataTasks).toEqual([
      expect.objectContaining({ id: "testDataTask_1", status: "submitted" })
    ]);
    expect(second.testDataLeases).toEqual([
      expect.objectContaining({ id: "testDataLease_1", status: "active" })
    ]);
    expect(second.executionPlans).toEqual([
      expect.objectContaining({ id: "executionPlan_1", verdict: "ready" })
    ]);
    expect(second.requirementSuiteRuns).toEqual([
      expect.objectContaining({
        id: "requirementSuiteRun_1",
        status: "waiting-for-agent",
        allowCreateTestData: true
      })
    ]);
  });

  it("defaults legacy requirement suite runs to read-only test-data reuse", async () => {
    const filePath = join(await tempDir(), "assets.json");
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 8,
        requirementSuiteRuns: [
          {
            id: "legacy-suite",
            knowledgeProjectId: "knowledge-legacy",
            systemId: "system-legacy",
            status: "running",
            continueOnBlocked: false,
            total: 1,
            passed: 0,
            failed: 0,
            blocked: 0,
            caseRuns: [
              {
                executableCaseId: "case-legacy",
                title: "Legacy case",
                order: 1,
                status: "queued",
                gapIds: []
              }
            ],
            createdAt: "2026-07-30T00:00:00.000Z",
            updatedAt: "2026-07-30T00:00:00.000Z"
          }
        ]
      }),
      "utf8"
    );

    const repository = new JsonFileBrainCreatorRepository(filePath);

    expect(repository.schemaVersion).toBe(9);
    expect(repository.requirementSuiteRuns[0]).toEqual(
      expect.objectContaining({
        id: "legacy-suite",
        allowCreateTestData: false
      })
    );
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-repository-"));
  tempDirs.push(dir);
  return dir;
}
