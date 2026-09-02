// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { KnowledgeProject, RequirementSet, RequirementSource } from "../domain/types.js";
import type {
  BusinessModelerOutput,
  ClauseAnalystOutput,
  CoverageCriticOutput,
  DocumentMapperOutput
} from "../knowledge/requirementHarness.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

describe("Requirement Host Harness facade", () => {
  it("routes a complex structured source to the Host Harness by default", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-host-routing-"));
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json"),
      knowledgeDir: join(workDir, ".brain-creator", "knowledge")
    });
    const fixture = requirementFixture();
    fixture.source.blocks = [{
      type: "table",
      text: "Condition | Action",
      table: { headers: ["Condition"], rows: [["Approval required"]] },
      sourceRefs: ["requirement.md#line:4"]
    }];
    fixture.source.attachments = [{ name: "workflow.png", status: "discovered", attempts: 0 }];
    context.repository.knowledgeProjects.push(fixture.project);
    context.repository.requirementSources.push(fixture.source);
    context.repository.requirementSets.push(fixture.requirementSet);

    const response = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-analysis",
      requirementSetId: fixture.requirementSet.id
    }));

    expect(response).toEqual(expect.objectContaining({
      status: "needs-host-analysis",
      stage: "document-mapper"
    }));
    expect(response.task.provider).toBe("host-agent");
    expect(response.task.contextPack?.content).toContain("Document block AST");
    expect(response.task.contextPack?.content).toContain("Approval required");
    expect(context.repository.knowledgeNodes).toHaveLength(0);
  });

  it("keeps complex requirements in preview when builtin analysis is explicitly requested", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-builtin-preview-"));
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json"),
      knowledgeDir: join(workDir, ".brain-creator", "knowledge")
    });
    const fixture = requirementFixture();
    fixture.source.blocks = [{ type: "image", text: "Workflow", image: { reference: "workflow.png" } }];
    context.repository.knowledgeProjects.push(fixture.project);
    context.repository.requirementSources.push(fixture.source);
    context.repository.requirementSets.push(fixture.requirementSet);

    const response = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-analysis",
      requirementSetId: fixture.requirementSet.id,
      provider: "builtin"
    }));

    expect(response).toEqual(expect.objectContaining({
      status: "preview-only",
      provider: "builtin",
      nextAction: expect.stringContaining("host-agent")
    }));
    expect(context.repository.knowledgeNodes).toHaveLength(0);
  });

  it("keeps blocked analysis out of domain assets and persists a reviewed host result through test design", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-host-analysis-"));
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json"),
      knowledgeDir: join(workDir, ".brain-creator", "knowledge")
    });
    const fixture = requirementFixture();
    context.repository.knowledgeProjects.push(fixture.project);
    context.repository.requirementSources.push(fixture.source);
    context.repository.requirementSets.push(fixture.requirementSet);

    let response = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-analysis",
      requirementSetId: fixture.requirementSet.id,
      provider: "host-agent"
    }));
    expect(response).toEqual(expect.objectContaining({
      status: "needs-host-analysis",
      stage: "document-mapper"
    }));

    response = await submit(context, response.task.id, documentMap());
    response = await submit(context, response.task.id, clauses());
    response = await submit(context, response.task.id, models());
    response = await submit(context, response.task.id, critic());

    expect(response).toEqual(expect.objectContaining({
      status: "completed",
      result: expect.objectContaining({
        evaluation: expect.objectContaining({ verdict: "pass" }),
        stageEvaluations: expect.arrayContaining([
          expect.objectContaining({ stage: "coverage-critic", evaluator: "isolated-critic" })
        ])
      })
    }));
    expect(context.repository.knowledgeNodes).toHaveLength(0);
    expect(context.repository.workflowModels).toHaveLength(0);

    const designed = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-test-design",
      requirementSetId: fixture.requirementSet.id,
      provider: "host-agent"
    }));

    expect(designed.analysis.provider).toBe("host-agent");
    expect(designed.workflowModels).toHaveLength(1);
    expect(designed.businessObjectModels).toHaveLength(1);
    expect(designed.decisionTableModels).toHaveLength(1);
    expect(context.repository.knowledgeNodes.length).toBeGreaterThan(0);
    expect(context.repository.businessObjectModels[0].semanticConceptId).toMatch(/^semantic_/);
    expect(context.repository.stageEvalRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "document-mapper", evaluator: "producer", status: "current" }),
      expect.objectContaining({ stage: "document-mapper", evaluator: "schema-validator", status: "current" }),
      expect.objectContaining({ stage: "coverage-critic", evaluator: "isolated-critic", status: "current" }),
      expect.objectContaining({ stage: "adjudicator", evaluator: "adjudicator", verdict: "pass" })
    ]));

    const approvalPreview = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-baseline",
      requirementSetId: fixture.requirementSet.id,
      confirm: false
    }));
    expect(approvalPreview.approvalRequired).toBe(true);
    expect(approvalPreview.approvalChallenge.code).toMatch(/^BC-\d{6}$/);

    const agentNoteApproval = await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-baseline",
      requirementSetId: fixture.requirementSet.id,
      confirm: true,
      confirmedBy: "agent-note",
      confirmationNote: "The agent says this is approved."
    });
    expect(JSON.parse(textOf(agentNoteApproval)).success).toBe(false);

    const receipt = dataOf(await handleBrainCreatorTool(context, "bc_configure", {
      target: "approval",
      operation: "create",
      requirementSetId: fixture.requirementSet.id,
      approvalMethod: "challenge-response",
      approvalChallengeId: approvalPreview.approvalChallenge.challengeId,
      approvalCode: approvalPreview.approvalChallenge.code,
      assetHash: approvalPreview.baselineFingerprint,
      confirmedBy: "tester"
    }));
    const approved = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-baseline",
      requirementSetId: fixture.requirementSet.id,
      confirm: true,
      approvalReceiptId: receipt.receipt.id
    }));
    expect(approved.status).toBe("approved");

    const stageReview = dataOf(await handleBrainCreatorTool(context, "bc_review", {
      target: "stage-eval",
      knowledgeProjectId: fixture.project.id,
      requirementSetId: fixture.requirementSet.id,
      responseMode: "summary"
    }));
    expect(stageReview.summary.current).toBeGreaterThan(0);
    expect(stageReview.summary.byStage).toEqual(expect.objectContaining({
      "document-mapper": expect.any(Number),
      adjudicator: expect.any(Number)
    }));

    const reused = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-test-design",
      requirementSetId: fixture.requirementSet.id,
      provider: "host-agent"
    }));
    expect(reused.reused).toBe(true);
    expect(context.repository.businessObjectModels).toHaveLength(1);
  });

  it("normalizes Host Skill output but still requires independent modeling and Critic stages", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-host-skill-analysis-"));
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json"),
      knowledgeDir: join(workDir, ".brain-creator", "knowledge")
    });
    const fixture = requirementFixture();
    context.repository.knowledgeProjects.push(fixture.project);
    context.repository.requirementSources.push(fixture.source);
    context.repository.requirementSets.push(fixture.requirementSet);

    let response = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-analysis",
      requirementSetId: fixture.requirementSet.id,
      provider: "host-skill",
      analysisPackage: {
        module: "Orders",
        clauses: clauses().clauses.map((clause) => ({
          ...clause,
          sourceRef: clause.sourceRefs[0]
        })),
        nodes: [{
          type: "workflow",
          title: "Order approval",
          content: "A requester creates an order, then a manager approves it.",
          sourceRefs: ["source:source-1#line:1"]
        }],
        openQuestions: [],
        risks: [],
        contradictions: [],
        missingBranches: []
      }
    }));

    expect(response).toEqual(expect.objectContaining({
      status: "needs-host-analysis",
      stage: "business-modeler"
    }));
    expect(context.repository.brainTasks.map((task) => task.operation)).toEqual([
      "requirement-analysis:document-mapper",
      "requirement-analysis:clause-analyst",
      "requirement-analysis:business-modeler"
    ]);

    response = await submit(context, response.task.id, models());
    response = await submit(context, response.task.id, critic());
    expect(response.result.analysis.provider).toBe("host-skill");
    expect(response.result.evaluation.verdict).toBe("pass");

    const designed = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-test-design",
      requirementSetId: fixture.requirementSet.id,
      provider: "host-skill"
    }));
    expect(designed.analysis.provider).toBe("host-skill");
    expect(designed.workflowModels).toHaveLength(1);
  });

  it("does not persist requirement assets when the isolated Critic blocks the analysis", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-blocked-host-analysis-"));
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json"),
      knowledgeDir: join(workDir, ".brain-creator", "knowledge")
    });
    const fixture = requirementFixture();
    context.repository.knowledgeProjects.push(fixture.project);
    context.repository.requirementSources.push(fixture.source);
    context.repository.requirementSets.push(fixture.requirementSet);

    let response = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-analysis",
      requirementSetId: fixture.requirementSet.id,
      provider: "host-agent"
    }));
    response = await submit(context, response.task.id, documentMap());
    response = await submit(context, response.task.id, clauses());
    response = await submit(context, response.task.id, models());
    response = await submit(context, response.task.id, {
      ...critic(),
      verdict: "blocked",
      score: 0.4,
      reasons: ["The requirement omits the approval terminal state"],
      missingEndStates: ["Approval terminal state"]
    });

    expect(response.status).toBe("blocked");
    const blockedDesign = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-test-design",
      requirementSetId: fixture.requirementSet.id,
      provider: "host-agent"
    }));
    expect(blockedDesign).toEqual(expect.objectContaining({ status: "blocked" }));
    expect(context.repository.knowledgeNodes).toHaveLength(0);
    expect(context.repository.workflowModels).toHaveLength(0);
    expect(context.repository.gaps).toEqual([
      expect.objectContaining({
        sourceType: "requirement-host-harness",
        reason: expect.stringContaining("blocked by the Coverage Critic")
      })
    ]);
  });
});

async function submit(context: ReturnType<typeof createBrainCreatorMcpContext>, taskId: string, analysisPackage: unknown) {
  return dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
    action: "generate-analysis",
    requirementSetId: "requirement-1",
    provider: "host-agent",
    taskId,
    analysisPackage
  }));
}

function requirementFixture() {
  const now = "2026-08-30T00:00:00.000Z";
  const project: KnowledgeProject = {
    id: "project-1",
    key: "orders",
    name: "Orders",
    defaultLocale: "en-US",
    status: "active",
    systemIds: [],
    createdAt: now,
    updatedAt: now
  };
  const source: RequirementSource = {
    id: "source-1",
    knowledgeProjectId: project.id,
    source: "requirement.md",
    sourceType: "local-file",
    title: "Order approval",
    contentHash: "hash-1",
    content: "A requester creates an order. A manager approves the order.",
    blocks: [],
    attachments: [],
    warnings: [],
    accessStatus: "available",
    revision: 1,
    latestRequirementSetId: "requirement-1",
    createdAt: now,
    updatedAt: now
  };
  const requirementSet: RequirementSet = {
    id: "requirement-1",
    knowledgeProjectId: project.id,
    sourceId: source.id,
    version: 1,
    title: source.title,
    summary: source.title,
    contentHash: source.contentHash,
    status: "draft",
    affectedNodeIds: [],
    createdAt: now,
    updatedAt: now
  };
  return { project, source, requirementSet };
}

function documentMap(): DocumentMapperOutput {
  return {
    goals: ["Approve orders"],
    scope: ["Order approval"],
    modules: ["Orders"],
    actors: ["requester", "manager"],
    businessObjects: ["Order"],
    attachmentRefs: [],
    risks: [],
    sourceRefs: ["source:source-1#line:1"]
  };
}

function clauses(): ClauseAnalystOutput {
  return {
    module: "Orders",
    clauses: [{
      id: "clause-1",
      index: 1,
      text: "A requester creates an order, then a manager approves it.",
      sourceRefs: ["source:source-1#line:1"],
      module: "Orders",
      kind: "workflow",
      origin: "explicit",
      confidence: 1,
      status: "draft",
      nodeTypes: ["workflow", "actor", "object"]
    }],
    openQuestions: []
  };
}

function models(): BusinessModelerOutput {
  return {
    businessObjectModels: [{
      localId: "order",
      name: "Order",
      actors: ["requester", "manager"],
      fields: [],
      states: ["draft", "approved"],
      invariants: ["Approval is required"],
      sourceRefs: ["source:source-1#line:1"]
    }],
    workflowModels: [{
      localId: "approval",
      title: "Order approval",
      actors: ["requester", "manager"],
      steps: [
        { id: "create", label: "Create", actor: "requester", sourceRefs: ["source:source-1#line:1"] },
        { id: "approve", label: "Approve", actor: "manager", sourceRefs: ["source:source-1#line:1"] }
      ],
      transitions: [{ id: "submit", from: "create", to: "approve", sourceRefs: ["source:source-1#line:1"] }],
      startStepIds: ["create"],
      endStepIds: ["approve"],
      sourceRefs: ["source:source-1#line:1"],
      confidence: 0.95
    }],
    stateMachineModels: [],
    decisionTableModels: [{
      localId: "approval-rule",
      title: "Approval rule",
      conditions: ["Approved"],
      actions: ["Mark approved"],
      rules: [{
        conditionValues: { Approved: "yes" },
        expectedActions: ["Mark approved"],
        sourceRefs: ["source:source-1#line:1"]
      }],
      sourceRefs: ["source:source-1#line:1"]
    }],
    invariants: ["Approval is required"]
  };
}

function critic(): CoverageCriticOutput {
  return {
    verdict: "pass",
    score: 0.95,
    reasons: [],
    missingMainFlows: [],
    missingBranches: [],
    missingExceptions: [],
    missingActors: [],
    missingEndStates: [],
    contradictions: [],
    unsupportedInferences: [],
    requiredActions: [],
    evidenceRefs: ["source:source-1#line:1"]
  };
}

function dataOf(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Missing MCP text result");
  const envelope = JSON.parse(text);
  if (!envelope.success) throw new Error(envelope.errors?.join("; ") ?? "MCP call failed");
  return envelope.data;
}

function textOf(result: CallToolResult) {
  const item = result.content.find(
    (candidate): candidate is Extract<CallToolResult["content"][number], { type: "text" }> => candidate.type === "text"
  );
  if (!item?.text) throw new Error("Missing MCP text result");
  return item.text;
}
