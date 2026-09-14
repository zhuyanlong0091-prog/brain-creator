import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { RunLedgerService } from "../knowledge/runLedger.js";
import {
  createBrainCreatorMcpContext,
  handleBrainCreatorTool,
  type BrainCreatorMcpContext
} from "./handlers.js";

function contextFor(repository: InMemoryBrainCreatorRepository) {
  return {
    repository,
    runLedger: new RunLedgerService(repository)
  } as unknown as BrainCreatorMcpContext;
}

function readResult(result: Awaited<ReturnType<typeof handleBrainCreatorTool>>) {
  return JSON.parse((result.content[0] as { text: string }).text) as {
    success: boolean;
    data?: Record<string, unknown>;
    errors?: Array<{ message?: string }>;
  };
}

describe("execution action facade", () => {
  it("records an uncertain send and reconciles it without rerunning the action", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "suite-orders",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      status: "running",
      currentExecutableCaseId: "case-submit",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 1,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [{
        executableCaseId: "case-submit",
        title: "Submit order",
        order: 1,
        status: "running",
        gapIds: [],
        attempts: []
      }],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    });
    const context = contextFor(repository);

    const sent = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "record-execution-action",
      responseMode: "full",
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionPhase: "sent",
      actionSemantic: "Submit order",
      actionStepId: "step-submit",
      actionPostcondition: "Order status is submitted"
    }));
    expect(sent.success).toBe(true);
    expect(sent.data).toEqual(expect.objectContaining({
      status: "waiting",
      nextAction: "reconcile-action"
    }));
    expect(context.runLedger.latestUnresolvedAction("suite-orders")?.actionKey)
      .toBe("plan-submit:step-submit");

    const resumed = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "reconcile-execution-action",
      responseMode: "full",
      confirm: true,
      requirementSuiteRunId: "suite-orders",
      systemId: "system-orders",
      executableCaseId: "case-submit",
      actionKey: "plan-submit:step-submit",
      actionPhase: "sent",
      actionSemantic: "Submit order",
      actionPostcondition: "Order status is submitted",
      actionEvidenceRefs: ["evidence:order-submitted"]
    }));
    expect(resumed.success).toBe(true);
    expect(resumed.data).toEqual(expect.objectContaining({
      status: "reconciled",
      nextAction: "continue-requirement-suite"
    }));
    expect(context.runLedger.latestUnresolvedAction("suite-orders")).toBeUndefined();
    expect(repository.runLedgerEntries.filter((entry) => entry.actionKey === "plan-submit:step-submit"))
      .toHaveLength(2);
  });

  it("rejects actions that claim another system or case", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push({
      id: "suite-orders",
      knowledgeProjectId: "project-orders",
      systemId: "system-orders",
      status: "running",
      continueOnBlocked: false,
      allowCreateTestData: false,
      total: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      cancelled: 0,
      caseRuns: [],
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:01.000Z"
    });

    const result = readResult(await handleBrainCreatorTool(
      contextFor(repository),
      "bc_prepare",
      {
        action: "record-execution-action",
        requirementSuiteRunId: "suite-orders",
        systemId: "system-billing",
        executableCaseId: "case-other",
        actionKey: "action-1",
        actionPhase: "sent",
        actionSemantic: "Submit order"
      }
    ));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("does not match");
    expect(repository.runLedgerEntries).toHaveLength(0);
  });

  it("stops requirement-suite continuation before dispatching another action", async () => {
    const workDir = await mkdtemp(`${tmpdir()}/brain-action-guard-`);
    try {
      const context = createBrainCreatorMcpContext({ workDir });
      context.repository.knowledgeProjects.push({
        id: "project-orders",
        key: "orders",
        name: "Orders",
        defaultLocale: "en-US",
        status: "active",
        systemIds: ["system-orders"],
        createdAt: "2026-09-14T00:00:00.000Z",
        updatedAt: "2026-09-14T00:00:00.000Z"
      });
      context.repository.requirementSuiteRuns.push({
        id: "suite-orders",
        knowledgeProjectId: "project-orders",
        systemId: "system-orders",
        status: "running",
        currentExecutableCaseId: "case-submit",
        continueOnBlocked: false,
        allowCreateTestData: false,
        total: 1,
        passed: 0,
        failed: 0,
        blocked: 0,
        skipped: 0,
        cancelled: 0,
        caseRuns: [{
          executableCaseId: "case-submit",
          title: "Submit order",
          order: 1,
          status: "running",
          gapIds: [],
          attempts: []
        }],
        createdAt: "2026-09-14T00:00:00.000Z",
        updatedAt: "2026-09-14T00:00:01.000Z"
      });
      context.runLedger.recordAction({
        requirementSuiteRunId: "suite-orders",
        systemId: "system-orders",
        executableCaseId: "case-submit",
        actionKey: "plan-submit:step-submit",
        phase: "sent",
        actionSemantic: "Submit order"
      });

      const result = readResult(await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: "project-orders",
        systemId: "system-orders",
        suiteId: "suite-orders",
        confirm: true,
        browserMode: "headless"
      }));
      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({
        status: "waiting",
        nextAction: "reconcile-action",
        pendingAction: expect.objectContaining({ actionKey: "plan-submit:step-submit" })
      }));
      expect(context.repository.requirementSuiteRuns[0].caseRuns[0].status).toBe("running");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("stops document-suite continuation before creating another test case", async () => {
    const workDir = await mkdtemp(`${tmpdir()}/brain-document-action-guard-`);
    try {
      const source = `${workDir}/cases.md`;
      await writeFile(source, [
        "| 用例编号 | 用例标题 | 所属模块 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| TC-001 | Submit order | Orders | Signed in | Submit order | Order is submitted | P0 |"
      ].join("\n"), "utf8");
      const context = createBrainCreatorMcpContext({
        workDir,
        agentBridge: Object.assign(
          async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          {
            provider: "host-agent" as const,
            preflight: async () => ({ ok: true })
          }
        ),
        runner: async () => {
          throw new Error("runner must not execute while action reconciliation is pending");
        }
      });
      const system = context.service.createSystemProfile({
        name: "Orders",
        environment: "test",
        baseUrl: "https://orders.example.test",
        defaultLocale: "en-US",
        urlAllowlist: ["https://orders.example.test"]
      });
      context.service.createAuthProfile({
        projectId: system.id,
        env: "test",
        role: "qa",
        loginMethod: "script",
        secrets: {}
      });
      const caseSource = context.service.upsertCaseSource({
        systemId: system.id,
        source,
        sourceType: "markdown",
        contentHash: "document-action-guard",
        caseCount: 1,
        moduleStats: { Orders: 1 },
        priorityStats: { P0: 1 }
      });
      const suite = context.service.createCaseSuite({
        systemId: system.id,
        sourceId: caseSource.id,
        totalCases: 1,
        selectedCaseNos: ["TC-001"],
        status: "running"
      });
      context.runLedger.recordAction({
        runType: "document-suite",
        systemId: system.id,
        caseSuiteId: suite.id,
        caseNo: "TC-001",
        actionKey: "tc-001:submit",
        phase: "sent",
        actionSemantic: "Submit order"
      });

      const result = readResult(await handleBrainCreatorTool(context, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        suiteId: suite.id,
        source,
        confirm: true,
        browserMode: "headless"
      }));

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({
        status: "waiting",
        nextAction: "reconcile-action",
        pendingAction: expect.objectContaining({ actionKey: "tc-001:submit" })
      }));
      expect(context.repository.testCases).toHaveLength(0);
      expect(context.service.getCaseSuite(suite.id).status).toBe("waiting-for-agent");

      const reconciled = readResult(await handleBrainCreatorTool(context, "bc_prepare", {
        action: "reconcile-execution-action",
        responseMode: "full",
        confirm: true,
        caseSuiteId: suite.id,
        systemId: system.id,
        caseNo: "TC-001",
        actionKey: "tc-001:submit",
        actionSemantic: "Submit order",
        actionPostcondition: "Order status is submitted",
        actionEvidenceRefs: ["evidence:order-submitted"]
      }));
      expect(reconciled.data).toEqual(expect.objectContaining({
        status: "reconciled",
        nextAction: "continue-case-source-suite"
      }));
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("replays a pending document action after a fresh MCP context is created", async () => {
    const workDir = await mkdtemp(`${tmpdir()}/brain-document-recovery-`);
    const bridge = Object.assign(
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      {
        provider: "host-agent" as const,
        preflight: async () => ({ ok: true })
      }
    );
    const authStateVerifier = async () => ({ status: "valid" as const });
    try {
      const firstContext = createBrainCreatorMcpContext({
        workDir,
        agentBridge: bridge,
        authStateVerifier
      });
      const system = firstContext.service.createSystemProfile({
        name: "Orders",
        environment: "test",
        baseUrl: "https://orders.example.test",
        defaultLocale: "en-US",
        urlAllowlist: ["https://orders.example.test"]
      });
      firstContext.service.createAuthProfile({
        projectId: system.id,
        env: "test",
        role: "qa",
        loginMethod: "script",
        secrets: {}
      });
      const source = `${workDir}/cases.md`;
      await writeFile(source, [
        "| 用例编号 | 用例标题 | 所属模块 | 前置条件 | 操作步骤 | 预期结果 | 优先级 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| TC-001 | Submit order | Orders | Signed in | Submit order | Order is submitted | P1 |"
      ].join("\n"), "utf8");
      const caseSource = firstContext.service.upsertCaseSource({
        systemId: system.id,
        source,
        sourceType: "markdown",
        contentHash: "persistent-recovery",
        caseCount: 1,
        moduleStats: { Orders: 1 },
        priorityStats: { P1: 1 }
      });
      const suite = firstContext.service.createCaseSuite({
        systemId: system.id,
        sourceId: caseSource.id,
        totalCases: 1,
        selectedCaseNos: ["TC-001"],
        status: "running"
      });
      firstContext.runLedger.recordAction({
        runType: "document-suite",
        systemId: system.id,
        caseSuiteId: suite.id,
        caseSourceId: caseSource.id,
        caseNo: "TC-001",
        actionKey: "tc-001:submit",
        phase: "sent",
        actionSemantic: "Submit order",
        postcondition: "Order status is submitted"
      });

      const resumedContext = createBrainCreatorMcpContext({
        workDir,
        agentBridge: bridge,
        authStateVerifier,
        runner: async () => {
          throw new Error("runner must not execute before reconciliation");
        }
      });
      const result = readResult(await handleBrainCreatorTool(resumedContext, "bc_run", {
        mode: "case-source-suite",
        systemId: system.id,
        suiteId: suite.id,
        source,
        confirm: true,
        browserMode: "headless"
      }));

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({
        status: "waiting",
        nextAction: "reconcile-action",
        pendingAction: expect.objectContaining({ actionKey: "tc-001:submit" }),
        reportPath: expect.stringContaining("suite-report.html")
      }));
      const report = await readFile(result.data?.reportPath as string, "utf8");
      expect(report).toContain("TC-001");
      expect(report).toContain("write action was sent");
      expect(resumedContext.repository.testCases).toHaveLength(0);
      expect(resumedContext.repository.runLedgerEntries).toHaveLength(
        firstContext.repository.runLedgerEntries.length
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
