// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExecutableCase } from "../domain/types.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Facade execution recovery", () => {
  it("exposes the current requirement-suite step from persisted progress", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-recovery-facade-"));
    tempDirs.push(workDir);
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const system = context.service.createSystemProfile({
      name: "Orders",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"]
    });
    const project = await context.knowledgeService.createProject({
      name: "Orders knowledge",
      key: "orders-recovery-facade",
      defaultLocale: "en-US"
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    const executableCase: ExecutableCase = {
      id: "case-recovery-facade",
      knowledgeProjectId: project.id,
      requirementSetId: "requirement-orders",
      testIntentId: "intent-orders",
      systemId: system.id,
      title: "Approve order",
      status: "ready",
      preconditions: [],
      steps: [],
      dataProfileIds: [],
      gapIds: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };
    context.repository.executableCases.push(executableCase);
    const run = context.requirementSuiteRuns.create({
      knowledgeProjectId: project.id,
      systemId: system.id,
      cases: [{ executableCaseId: executableCase.id, title: executableCase.title }],
      continueOnBlocked: false
    });
    context.runLedger.appendProgress({
      runType: "requirement-suite",
      knowledgeProjectId: project.id,
      systemId: system.id,
      requirementSuiteRunId: run.id,
      executableCaseId: executableCase.id,
      caseTitle: executableCase.title,
      stage: "execution",
      status: "waiting",
      stepId: "step-approval",
      stepTitle: "Waiting for approver",
      pageUrl: "https://orders.example.test/orders/1001?token=secret",
      waitReason: "Waiting for the approval role"
    });

    const response = await handleBrainCreatorTool(context, "bc_status", {
      knowledgeProjectId: project.id,
      responseMode: "full"
    });
    const payload = JSON.parse(response.content[0].type === "text" ? response.content[0].text : "{}");

    expect(payload.data.summary.activeRun.executionRecovery).toEqual(expect.objectContaining({
      runId: run.id,
      currentStepId: "step-approval",
      nextAction: "resume-after-checkpoint"
    }));
    expect(payload.data.summary.activeRun.executionRecovery.currentPageUrl)
      .toBe("https://orders.example.test/orders/1001?token=%5BREDACTED%5D");
  });
});
