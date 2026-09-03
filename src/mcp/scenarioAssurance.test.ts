// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function dataOf(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Expected a text response");
  const envelope = JSON.parse(text) as { data?: unknown };
  return envelope.data;
}

describe("scenario assurance facade", () => {
  it("creates scenarios during test design and exposes assurance through review", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-scenario-"));
    tempDirs.push(workDir);
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Scenario Knowledge",
      key: "scenario-knowledge",
      defaultLocale: "en-US"
    });
    const ingested = await context.knowledgeService.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order submission",
        content: "A requester submits a complete order and receives a confirmation.",
        blocks: [],
        attachments: [],
        source: "scenario.md",
        sourceType: "local-file",
        contentHash: "scenario-requirement-v1",
        warnings: []
      }
    });
    const design = await context.knowledgeService.generateTestDesign(ingested.requirementSet.id);
    expect(design.businessScenarios.length).toBeGreaterThan(0);
    expect(design.businessScenarios.every((scenario) => scenario.dataPlan)).toBe(true);
    expect(design.businessScenarios.some((scenario) =>
      scenario.testIntentIds?.some((intentId) =>
        design.testIntents.some((intent) =>
          intent.id === intentId && intent.scenarioIds?.includes(scenario.id)
        )
      )
    )).toBe(true);

    const assessed = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "assess-scenarios",
      knowledgeProjectId: project.id,
      requirementSetId: ingested.requirementSet.id
    })) as { status: string; summary: { blocked: number }; dataPlans: unknown[] };
    expect(assessed.status).toBe("blocked");
    expect(assessed.summary.blocked).toBeGreaterThan(0);
    expect(assessed.dataPlans).toHaveLength(design.businessScenarios.length);

    const testDataReview = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "testdata",
      knowledgeProjectId: project.id
    })) as { scenarioPlans: Array<{ plan: { scenarioId: string } }> };
    expect(testDataReview.scenarioPlans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plan: expect.objectContaining({ scenarioId: design.businessScenarios[0].id })
        })
      ])
    );

    const rejectedStrongRun = await handleBrainCreatorTool(context, "bc_prepare", {
      action: "record-scenario-run",
      scenarioId: design.businessScenarios[0].id,
      runPassed: true,
      strongEvidence: true,
      evidenceRefs: ["evidence:unassured"]
    });
    expect(rejectedStrongRun.isError).toBe(true);

    const review = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "business-scenario",
      knowledgeProjectId: project.id
    })) as { summary: { total: number; byFamily: Record<string, number> } };
    expect(review.summary.total).toBe(design.businessScenarios.length);
    expect(Object.keys(review.summary.byFamily).length).toBeGreaterThan(0);

    context.repository.conformanceResults.push({
      id: "conformance:evidence-order",
      scenarioId: design.businessScenarios[0].id,
      executionEvidenceId: "evidence-order",
      verdict: "inconclusive",
      expectationRefs: ["requirement:order"],
      observationRefs: ["evidence:order"],
      executionRefs: ["evidence-order"],
      reasons: ["The run was limited to process evidence."],
      createdAt: new Date().toISOString()
    });
    const conformanceReview = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "conformance",
      knowledgeProjectId: project.id
    })) as { summary: { total: number; byVerdict: Record<string, number> } };
    expect(conformanceReview.summary).toEqual(expect.objectContaining({
      total: 1,
      byVerdict: expect.objectContaining({ inconclusive: 1 })
    }));

    const mutation = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "evaluate-mutations",
      mutationThreshold: 0.85,
      mutationResults: [
        { id: "mutation-caught", scenarioId: design.businessScenarios[0].id, status: "caught", evidenceRefs: ["evidence:caught"] },
        { id: "mutation-survived", scenarioId: design.businessScenarios[0].id, status: "survived", evidenceRefs: ["evidence:survived"] },
        { id: "mutation-blocked", scenarioId: design.businessScenarios[0].id, status: "blocked", evidenceRefs: [] }
      ]
    })) as { status: string; detectionRate: number; blocked: number };
    expect(mutation.status).toBe("needs-review");
    expect(mutation.detectionRate).toBe(0.5);
    expect(mutation.blocked).toBe(1);
  });

  it("returns provider evaluation readiness from the status facade", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-provider-"));
    tempDirs.push(workDir);
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const system = context.service.createSystemProfile({
      name: "Provider system",
      environment: "test",
      baseUrl: "https://provider.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://provider.example.test"]
    });
    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {
      systemId: system.id
    })) as { providerEvaluation: { primary: { provider: string; role: string } } };
    expect(status.providerEvaluation.primary).toEqual({
      provider: "host-agent",
      modelFamily: "unknown",
      available: true,
      enabled: true,
      role: "primary"
    });
  });
});
