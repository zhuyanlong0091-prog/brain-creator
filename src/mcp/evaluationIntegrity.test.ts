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

describe("evaluation integrity facade", () => {
  it("starts, reviews, validates, and completes an evaluation trial", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-evaluation-"));
    tempDirs.push(workDir);
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Evaluation",
      key: "evaluation",
      defaultLocale: "en-US"
    });
    const ingested = await context.knowledgeService.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order approval",
        content: "A requester submits an order for approval.",
        blocks: [{ type: "paragraph", text: "A requester submits an order for approval." }],
        attachments: [],
        source: "requirements/order.md",
        sourceType: "local-file",
        contentHash: "order-v1",
        warnings: []
      }
    });

    const started = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "start-evaluation-trial",
      knowledgeProjectId: project.id,
      requirementSourceId: ingested.source.id,
      comparisonGroupId: "order-ab",
      evaluationProvider: "host-agent",
      evaluationWorkspacePath: join(workDir, "host"),
      evaluationStorePath: join(workDir, "host", ".brain-creator", "store"),
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    })) as { trial: { id: string; status: string } };
    expect(started.trial.status).toBe("active");

    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {
      knowledgeProjectId: project.id
    })) as { evaluationIntegrity: { active: number; invalidated: number } };
    expect(status.evaluationIntegrity).toEqual(expect.objectContaining({ active: 1, invalidated: 0 }));

    const review = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "evaluation-trial",
      knowledgeProjectId: project.id,
      id: started.trial.id
    })) as { summary: { total: number }; items: Array<{ sourceSnapshot: unknown; projectionManifests: unknown[] }> };
    expect(review.summary.total).toBe(1);
    expect(review.items[0].sourceSnapshot).toBeDefined();
    expect(review.items[0].projectionManifests).toHaveLength(1);

    const completed = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "complete-evaluation-trial",
      evaluationTrialId: started.trial.id,
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    })) as { status: string };
    expect(completed.status).toBe("completed");
  });

  it("records a manual intervention and surfaces the invalidated trial", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-evaluation-"));
    tempDirs.push(workDir);
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const project = await context.knowledgeService.createProject({ name: "Eval", key: "eval", defaultLocale: "en-US" });
    const ingested = await context.knowledgeService.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Requirement",
        content: "Create a record.",
        blocks: [], attachments: [], source: "requirement.md", sourceType: "local-file",
        contentHash: "hash-1", warnings: []
      }
    });
    const started = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "start-evaluation-trial",
      knowledgeProjectId: project.id,
      requirementSourceId: ingested.source.id,
      comparisonGroupId: "comparison",
      evaluationProvider: "builtin",
      evaluationWorkspacePath: join(workDir, "builtin"),
      evaluationStorePath: join(workDir, "builtin", "store"),
      codeRevision: "commit-1",
      runtimeVersions: { node: "22.0.0" }
    })) as { trial: { id: string } };

    const intervention = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "record-evaluation-intervention",
      evaluationTrialId: started.trial.id,
      interventionCategory: "manual-store-write",
      interventionActor: "host-agent",
      interventionNote: "Changed the canonical store outside the Facade",
      evidenceRefs: ["audit:manual-write"]
    })) as { invalidatesTrial: boolean };
    expect(intervention.invalidatesTrial).toBe(true);
    expect(context.repository.evaluationTrials[0].status).toBe("invalidated");
  });
});

function dataOf(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Expected a text response");
  return (JSON.parse(text) as { data?: unknown }).data;
}
