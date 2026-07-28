// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Brain Creator requirement-first facade", () => {
  it("ingests, analyzes, approves, and compiles a local requirement through facade tools", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, ".brain-creator", "local-assets.json")
    });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Order Approval",
        key: "order-approval",
        defaultLocale: "en-US"
      })
    );
    const source = join(workDir, "requirement.md");
    await writeFile(
      source,
      "# Order Approval\n\nUsers create orders. Orders above 1000 require manager approval.",
      "utf8"
    );
    const ingested = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    const designed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "generate-test-design",
        requirementSetId: ingested.requirementSet.id
      })
    );
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-baseline",
      requirementSetId: ingested.requirementSet.id,
      confirm: true
    });
    const compiled = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "compile-cases",
        testIntentId: designed.testIntents[0].id
      })
    );

    expect(ingested.requirementSet.status).toBe("draft");
    expect(designed.evaluation.verdict).toBe("pass");
    expect(designed.analysis.clauses).toHaveLength(2);
    expect(designed.testIntents).toHaveLength(2);
    expect(designed.evaluation.coverage).toEqual(
      expect.objectContaining({ totalClauses: 2, coveredClauses: 2, coverageRate: 1 })
    );
    expect(compiled.executableCase.status).toBe("ready");
  });

  it("requires a separate Facade confirmation for Requirement Eval actions", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Approval Workflow",
        key: "approval-workflow"
      })
    );
    const source = join(workDir, "approval.md");
    await writeFile(
      source,
      "# Approval\n\nWhen the manager approves, status changes from draft to approved.",
      "utf8"
    );
    const ingested = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    const designed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "generate-test-design",
        requirementSetId: ingested.requirementSet.id
      })
    );
    const pendingStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );
    const rejectedApproval = envelopeOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "approve-baseline",
        requirementSetId: ingested.requirementSet.id,
        confirm: true
      })
    );
    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "confirm-eval-actions",
        requirementSetId: ingested.requirementSet.id,
        actionIds: [designed.evaluationGate.actions[0].id],
        confirmationNote: "The alternate path keeps the draft status.",
        confirm: false
      })
    );
    const confirmed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "confirm-eval-actions",
        requirementSetId: ingested.requirementSet.id,
        actionIds: [designed.evaluationGate.actions[0].id],
        confirmationNote: "The alternate path keeps the draft status.",
        confirm: true
      })
    );
    const approved = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "approve-baseline",
        requirementSetId: ingested.requirementSet.id,
        confirm: true
      })
    );

    expect(rejectedApproval.success).toBe(false);
    expect(rejectedApproval.errors).toEqual([expect.stringContaining("Eval actions")]);
    expect(pendingStatus.nextAction).toBe("confirm_requirement_eval");
    expect(pendingStatus.knowledge.evaluationGates).toEqual(
      expect.objectContaining({ pendingActions: 1, blockedActions: 0 })
    );
    expect(preview).toEqual(
      expect.objectContaining({ status: "preview", requiresConfirmation: true })
    );
    expect(confirmed.evaluationGate.status).toBe("confirmed");
    expect(approved.status).toBe("approved");
  });

  it("does not let a superseded blocked Eval gate poison the revised baseline status", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Inventory",
        key: "inventory-revision"
      })
    );
    const source = join(workDir, "inventory.md");
    await writeFile(
      source,
      "# Inventory\n\nThe stock field is visible. The stock field is not visible.",
      "utf8"
    );
    const first = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-test-design",
      requirementSetId: first.requirementSet.id
    });

    await writeFile(source, "# Inventory\n\nThe stock field is visible.", "utf8");
    const revised = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "refresh-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-test-design",
      requirementSetId: revised.requirementSet.id
    });
    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );

    expect(
      context.repository.requirementSets.find((item) => item.id === first.requirementSet.id)?.status
    ).toBe("superseded");
    expect(revised.requirementSet.status).toBe("draft");
    expect(status.knowledge.evaluationGates.blockedActions).toBe(0);
    expect(status.nextAction).toBe("review_and_approve_baseline");
  });

  it("previews Feishu host connector work without persisting a false requirement revision", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "CRM",
        key: "crm"
      })
    );

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source: "https://example.feishu.cn/wiki/abc123"
      })
    );

    expect(result.status).toBe("needs-host-connector");
    expect(context.repository.requirementSets).toHaveLength(0);
  });

  it("ingests direct Feishu content and records connector failures as gaps", async () => {
    const workDir = await tempDir();
    const source = "https://example.feishu.cn/docx/abc123";
    const directContext = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "direct-assets.json"),
      feishuReader: {
        readRequirement: async () => ({
          title: "Direct Feishu",
          content: "Users submit requests.",
          blocks: [{ type: "paragraph", text: "Users submit requests." }],
          attachments: [],
          source,
          sourceType: "feishu",
          contentHash: "direct-hash",
          warnings: []
        })
      }
    });
    const project = dataOf(
      await handleBrainCreatorTool(directContext, "bc_configure", {
        target: "knowledge-project",
        name: "Direct",
        key: "direct"
      })
    );

    const ingested = dataOf(
      await handleBrainCreatorTool(directContext, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    expect(ingested.status).toBe("draft-created");

    const failureDir = await tempDir();
    const failureContext = createBrainCreatorMcpContext({
      workDir: failureDir,
      dataFilePath: join(failureDir, "failure-assets.json"),
      feishuReader: { readRequirement: async () => { throw new Error("permission denied"); } }
    });
    const failureProject = dataOf(
      await handleBrainCreatorTool(failureContext, "bc_configure", {
        target: "knowledge-project",
        name: "Failure",
        key: "failure"
      })
    );
    const failed = dataOf(
      await handleBrainCreatorTool(failureContext, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: failureProject.id,
        source
      })
    );

    expect(failed.status).toBe("connector-error");
    expect(failed.gap.status).toBe("open");
    expect(failureContext.repository.requirementSets).toHaveLength(0);
  });

  it("adds knowledge status and review without requiring a bound runtime system", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Contracts",
        key: "contracts"
      })
    );

    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", { knowledgeProjectId: project.id })
    );
    const review = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "knowledge",
        knowledgeProjectId: project.id
      })
    );

    expect(status.knowledge.project.id).toBe(project.id);
    expect(status.nextAction).toBe("ingest_requirement");
    expect(review.project.id).toBe(project.id);
  });

  it("requests host Skill output instead of labeling built-in analysis as host-skill", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Inventory",
        key: "inventory"
      })
    );
    const source = join(workDir, "inventory.md");
    await writeFile(source, "# Inventory\n\nUsers create stock adjustments.", "utf8");
    const ingested = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "generate-analysis",
        requirementSetId: ingested.requirementSet.id,
        provider: "host-skill"
      })
    );

    expect(result.status).toBe("needs-host-skill");
    expect(context.repository.knowledgeNodes).toHaveLength(0);
  });

  it("previews requirement execution and refuses confirmation before system binding", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Payments",
        key: "payments"
      })
    );
    const source = join(workDir, "payment.md");
    await writeFile(source, "# Payment\n\nUsers submit a payment form.", "utf8");
    const ingested = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    const designed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "generate-test-design",
        requirementSetId: ingested.requirementSet.id
      })
    );
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-baseline",
      requirementSetId: ingested.requirementSet.id,
      confirm: true
    });
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "compile-cases",
      testIntentId: designed.testIntents[0].id
    });

    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        confirm: false
      })
    );
    const confirmed = envelopeOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        confirm: true
      })
    );

    expect(preview).toEqual(expect.objectContaining({ status: "preview", boundSystemIds: [] }));
    expect(confirmed.success).toBe(false);
    expect(confirmed.errors).toEqual([expect.stringContaining("bound")]);
  });

  it("injects a traceable ContextPack and evidence contract into host-agent generation", async () => {
    const workDir = await tempDir();
    const bridge = Object.assign(
      async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      { provider: "host-agent", preflight: async () => ({ ok: true }) }
    );
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json"),
      agentBridge: bridge,
      runner: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: [
          "Error: expect(received).toBe(expected)",
          "Expected: \"approved\"",
          "Received: \"draft\""
        ].join("\n")
      })
    });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Orders",
        key: "orders-context"
      })
    );
    const source = join(workDir, "orders.md");
    await writeFile(source, "# Orders\n\nUsers create an order form and managers approve it.", "utf8");
    const ingested = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    const designed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "generate-test-design",
        requirementSetId: ingested.requirementSet.id
      })
    );
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-baseline",
      requirementSetId: ingested.requirementSet.id,
      confirm: true
    });
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "compile-cases",
      testIntentId: designed.testIntents[0].id
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "system",
        name: "Orders Test",
        environment: "test",
        baseUrl: "https://orders.example.test",
        urlAllowlist: ["https://orders.example.test"]
      })
    );
    await handleBrainCreatorTool(context, "bc_configure", {
      target: "system-binding",
      knowledgeProjectId: project.id,
      systemId: system.id
    });
    await handleBrainCreatorTool(context, "bc_configure", {
      target: "auth",
      systemId: system.id,
      env: "test",
      role: "manager",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        systemId: system.id,
        confirm: true,
        maxHealAttempts: 0
      })
    );
    const spec = await readFile(result.specPath, "utf8");
    const taskContext = JSON.parse(await readFile(result.contextPath, "utf8"));

    expect(result.status).toBe("needs_agent_execution");
    expect(spec).toContain("Brain Creator Knowledge Context");
    expect(spec).toContain("Executable Step Traceability");
    expect(spec).toContain("Evidence Contract");
    expect(taskContext.chainContext.executionEvidenceId).toBe(result.executionEvidence.id);
    expect(context.repository.executionEvidence).toEqual([
      expect.objectContaining({ status: "running", contextPackPath: result.contextPackPath })
    ]);

    await writeFile(
      result.testPath,
      [
        `import { test, expect } from "../${basename(result.seedPath)}";`,
        'test("requirement mismatch", async () => { expect("draft").toBe("approved"); });'
      ].join("\n"),
      "utf8"
    );
    const completed = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: result.task.id,
        status: "succeeded",
        stdout: "generator output created",
        stderr: "",
        outputPaths: [result.testPath]
      })
    );

    expect(completed.chainRun.status).toBe("failed");
    expect(context.repository.bugReports).toEqual([
      expect.objectContaining({ sourceId: result.executableCaseId, status: "open" })
    ]);
    expect(context.repository.gaps.filter((gap) => gap.projectId === system.id)).toHaveLength(0);
    expect(context.repository.executionEvidence).toEqual([
      expect.objectContaining({ status: "failed", chainRunId: completed.chainRun.id })
    ]);
  });
});

function dataOf(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Missing MCP text result");
  const envelope = JSON.parse(text);
  if (!envelope.success) throw new Error(envelope.errors?.join("; ") ?? "MCP call failed");
  return envelope.data;
}

function envelopeOf(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Missing MCP text result");
  return JSON.parse(text);
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-mcp-knowledge-"));
  tempDirs.push(dir);
  return dir;
}
