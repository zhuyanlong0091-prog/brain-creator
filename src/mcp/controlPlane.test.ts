// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("facade control plane", () => {
  it("creates, browser-verifies, and archives auth through bc_configure", async () => {
    const workDir = await tempDir();
    const verificationInputs: Array<Record<string, unknown>> = [];
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json"),
      authStateVerifier: async (input) => {
        verificationInputs.push(input);
        return {
          status: "valid",
          finalUrl: "https://orders.example.test/dashboard",
          title: "Orders Dashboard"
        };
      }
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "system",
        name: "Orders",
        environment: "test",
        baseUrl: "https://orders.example.test",
        urlAllowlist: ["https://orders.example.test"]
      })
    );
    const auth = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "auth",
        operation: "create",
        systemId: system.id,
        env: "test",
        role: "buyer",
        loginMethod: "script",
        secrets: { storageStatePath: ".brain-creator/auth/buyer.json" }
      })
    );

    const verified = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "auth",
        operation: "verify",
        systemId: system.id,
        authProfileId: auth.id
      })
    );
    const archived = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "auth",
        operation: "archive",
        systemId: system.id,
        authProfileId: auth.id
      })
    );

    expect(verificationInputs).toEqual([
      expect.objectContaining({
        targetUrl: "https://orders.example.test",
        allowedUrls: ["https://orders.example.test"]
      })
    ]);
    expect(verified).toEqual(
      expect.objectContaining({
        status: "succeeded",
        verificationEvidence: expect.objectContaining({
          finalUrl: "https://orders.example.test/dashboard",
          title: "Orders Dashboard"
        })
      })
    );
    expect(archived.status).toBe("cancelled");
  });

  it("resolves, dismisses, and reopens gaps only after an explicit confirmation", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "system",
        name: "Orders",
        environment: "test",
        baseUrl: "https://orders.example.test",
        urlAllowlist: ["https://orders.example.test"]
      })
    );
    const gap = context.service.reportGap({
      projectId: system.id,
      sourceType: "system-brain",
      sourceId: "page-1",
      reason: "Page binding is ambiguous",
      severity: "high",
      owner: "qa"
    });

    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "dismiss-gap",
        systemId: system.id,
        gapId: gap.id,
        confirmationNote: "The alternate page is out of scope.",
        evidenceRefs: ["evidence:binding-review"],
        confirm: false
      })
    );
    const dismissed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "dismiss-gap",
        systemId: system.id,
        gapId: gap.id,
        confirmationNote: "The alternate page is out of scope.",
        evidenceRefs: ["evidence:binding-review"],
        confirm: true
      })
    );
    const reopened = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "reopen-gap",
        systemId: system.id,
        gapId: gap.id,
        confirmationNote: "A new route makes the ambiguity relevant.",
        evidenceRefs: ["evidence:new-route"],
        confirm: true
      })
    );

    expect(preview).toEqual(expect.objectContaining({ status: "preview", requiresConfirmation: true }));
    expect(dismissed.status).toBe("dismissed");
    expect(reopened.status).toBe("open");
    expect(reopened.lifecycle).toHaveLength(2);
  });

  it("batch compiles through a summary response and reviews paged details", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json"),
      knowledgeDir: join(workDir, "knowledge")
    });
    const project = await context.knowledgeService.createProject({
      name: "Order Workflow",
      key: "order-workflow-control",
      defaultLocale: "en-US"
    });
    const ingested = await context.knowledgeService.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order workflow",
        content: "Buyer creates an order. Manager approves the order.",
        blocks: [],
        attachments: [],
        source: "requirements/orders.md",
        sourceType: "local-file",
        contentHash: "orders-control-hash",
        warnings: []
      }
    });
    const design = await context.knowledgeService.generateTestDesign(
      ingested.requirementSet.id
    );
    if (design.evaluationGate.actions.length > 0) {
      await context.knowledgeService.confirmEvaluationActions({
        requirementSetId: ingested.requirementSet.id,
        actionIds: design.evaluationGate.actions.map((action) => action.id),
        note: "Order workflow branches are confirmed.",
        confirm: true
      });
    }
    context.knowledgeService.approveRequirementSet(ingested.requirementSet.id);

    const summary = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "compile-cases",
        requirementSetId: ingested.requirementSet.id,
        responseMode: "summary"
      })
    );
    const review = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "compile-run",
        knowledgeProjectId: project.id,
        id: summary.compileRunId,
        limit: 1
      })
    );

    expect(summary).toEqual(
      expect.objectContaining({
        responseMode: "summary",
        compileRunId: expect.stringMatching(/^compileRun_/),
        total: design.testIntents.length,
        nextAction: "preview-requirement-suite"
      })
    );
    expect(summary).not.toHaveProperty("items");
    expect(review.items).toEqual([
      expect.objectContaining({
        compileRunId: summary.compileRunId,
        returnedItems: 1,
        items: [expect.objectContaining({ testIntentId: expect.any(String) })]
      })
    ]);
  });

  it("reloads the persistent store without restarting the MCP context", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    await handleBrainCreatorTool(context, "bc_configure", {
      target: "system",
      name: "Orders",
      environment: "test",
      baseUrl: "https://orders.example.test",
      urlAllowlist: ["https://orders.example.test"]
    });

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "runtime",
        operation: "reload-store"
      })
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "reloaded",
        counts: expect.objectContaining({ systems: 1 }),
        nextAction: "review-status"
      })
    );
  });

  it("rejects an invalid store reload without replacing in-memory assets", async () => {
    const workDir = await tempDir();
    const dataFilePath = join(workDir, "assets.json");
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "system",
        name: "Orders",
        environment: "test",
        baseUrl: "https://orders.example.test",
        urlAllowlist: ["https://orders.example.test"]
      })
    );
    const validSnapshot = await readFile(dataFilePath, "utf8");
    await writeFile(dataFilePath, JSON.stringify({ systemProfiles: "invalid" }), "utf8");

    const failed = envelopeOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "runtime",
        operation: "reload-store"
      })
    );

    expect(failed.success).toBe(false);
    expect(failed.error).toEqual(expect.objectContaining({ code: "BC_UNEXPECTED" }));
    expect(context.repository.systemProfiles).toEqual([
      expect.objectContaining({ id: system.id })
    ]);
    await writeFile(dataFilePath, validSnapshot, "utf8");
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
  const dir = await mkdtemp(join(tmpdir(), "brain-control-plane-"));
  tempDirs.push(dir);
  return dir;
}
