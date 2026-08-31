// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HarnessRuntime } from "../brain/harness.js";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { AttachmentAnalysis, KnowledgeProject, RequirementSet, RequirementSource } from "../domain/types.js";
import {
  RequirementAnalysisHostHarness,
  type BusinessModelerOutput,
  type ClauseAnalystOutput,
  type CoverageCriticOutput,
  type DocumentMapperOutput
} from "./requirementHarness.js";

describe("RequirementAnalysisHostHarness", () => {
  it("runs mapper, analyst, modeler, and isolated critic as four traceable Brain tasks", async () => {
    const fixture = await createFixture();
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    const mapper = await coordinator.start(fixture.requirementSet.id);
    expect(mapper).toEqual(expect.objectContaining({
      status: "needs-host-analysis",
      stage: "document-mapper"
    }));
    expect(mapper.task.operation).toBe("requirement-analysis:document-mapper");
    expect(mapper.task.contextPack?.content).toContain("source:req-source#line:1");
    expect(mapper.task.contextPack?.content).toContain("attachment-analysis:attachment-analysis-1");

    const analyst = await coordinator.submit({ taskId: mapper.task.id, output: documentMap() });
    expect(analyst.stage).toBe("clause-analyst");
    expect(analyst.task.sessionId).toBe(mapper.task.sessionId);

    const modeler = await coordinator.submit({ taskId: analyst.task.id, output: clauses() });
    expect(modeler.stage).toBe("business-modeler");

    const critic = await coordinator.submit({ taskId: modeler.task.id, output: businessModels() });
    expect(critic.stage).toBe("coverage-critic");
    expect(critic.task.contextPack?.content).toContain('"workflowModels"');
    expect(critic.task.contextPack?.content).not.toContain("conversationHistory");
    expect(critic.task.contextPack?.content).not.toContain("designerReasoning");

    const completed = await coordinator.submit({ taskId: critic.task.id, output: criticOutput() });
    expect(completed.status).toBe("completed");
    expect(completed.result?.analysis.provider).toBe("host-agent");
    expect(completed.result?.analysis.clauses).toHaveLength(3);
    expect(completed.result?.models.workflowModels).toHaveLength(2);
    expect(completed.result?.models.stateMachineModels).toHaveLength(1);
    expect(completed.result?.models.businessObjectModels[0]).toEqual(expect.objectContaining({
      name: "Order",
      sourceRefs: ["source:req-source#line:1"]
    }));
    expect(completed.result?.evaluation).toEqual(expect.objectContaining({ verdict: "pass" }));
    expect(fixture.repository.brainTasks).toHaveLength(4);
    expect(fixture.repository.brainTasks.every((task) => task.status === "succeeded")).toBe(true);
    expect(new Set(fixture.repository.brainTasks.map((task) => task.id)).size).toBe(4);
  });

  it("allows one structured-output retry and then blocks with a recoverable Gap", async () => {
    const fixture = await createFixture();
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    const first = await coordinator.start(fixture.requirementSet.id);
    const retry = await coordinator.submit({ taskId: first.task.id, output: { modules: [] } });

    expect(retry).toEqual(expect.objectContaining({
      status: "needs-host-analysis",
      stage: "document-mapper",
      retry: true
    }));
    expect(retry.task.id).not.toBe(first.task.id);
    expect(fixture.repository.brainTasks).toHaveLength(2);

    const blocked = await coordinator.submit({ taskId: retry.task.id, output: { modules: [] } });
    expect(blocked.status).toBe("blocked");
    expect(blocked.gap).toEqual(expect.objectContaining({
      sourceType: "requirement-host-harness",
      sourceId: fixture.requirementSet.id,
      status: "open"
    }));
    expect(blocked.gap?.reason).toContain("document-mapper");
    expect(fixture.repository.gaps).toContainEqual(blocked.gap);
  });

  it("blocks completeness when a critical process image has not been confirmed", async () => {
    const fixture = await createFixture({ attachmentStatus: "downloaded", includeAnalysis: false });
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    let next = await coordinator.start(fixture.requirementSet.id);
    next = await coordinator.submit({ taskId: next.task.id, output: documentMap() });
    next = await coordinator.submit({ taskId: next.task.id, output: clauses() });
    next = await coordinator.submit({ taskId: next.task.id, output: businessModels() });
    const completed = await coordinator.submit({ taskId: next.task.id, output: criticOutput() });

    expect(completed.status).toBe("blocked");
    expect(completed.result?.evaluation).toEqual(expect.objectContaining({ verdict: "blocked" }));
    expect(completed.result?.evaluation.reasons).toEqual([
      expect.stringContaining("critical process attachment")
    ]);
    expect(completed.task.state).toBe("blocked");
  });

  it("truncates cold source text without dropping traceable source references", async () => {
    const fixture = await createFixture();
    fixture.repository.requirementSources[0].content = Array.from(
      { length: 200 },
      (_, index) => `Requirement line ${index + 1}: ${"x".repeat(500)}`
    ).join("\n");
    const coordinator = new RequirementAnalysisHostHarness(
      fixture.repository,
      new HarnessRuntime(fixture.repository),
      fixture.knowledgeDir
    );

    const mapper = await coordinator.start(fixture.requirementSet.id);
    expect(mapper.task.contextPack).toEqual(expect.objectContaining({ truncated: true }));
    expect(mapper.task.contextPack!.estimatedChars).toBeLessThanOrEqual(50_000);
    expect(mapper.task.contextPack!.references).toContainEqual(expect.objectContaining({
      ref: "source:req-source#line:200"
    }));
  });
});

async function createFixture(options: { attachmentStatus?: "downloaded" | "confirmed"; includeAnalysis?: boolean } = {}) {
  const repository = new InMemoryBrainCreatorRepository();
  const knowledgeDir = await mkdtemp(join(tmpdir(), "brain-creator-requirement-harness-"));
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
    id: "req-source",
    knowledgeProjectId: project.id,
    source: "requirements.md",
    sourceType: "local-file",
    title: "Order approval",
    contentHash: "hash-1",
    content: "A requester creates an order. A manager approves it. The approved order becomes active.",
    blocks: [],
    attachments: [{
      id: "attachment-1",
      sourceId: "req-source",
      name: "order-state.png",
      mimeType: "image/png",
      status: options.attachmentStatus ?? "confirmed"
    }],
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
    summary: "Order approval",
    contentHash: source.contentHash,
    status: "draft",
    affectedNodeIds: [],
    createdAt: now,
    updatedAt: now
  };
  repository.knowledgeProjects.push(project);
  repository.requirementSources.push(source);
  repository.requirementSets.push(requirementSet);
  if (options.includeAnalysis !== false) repository.attachmentAnalyses.push(attachmentAnalysis(now));
  return { repository, knowledgeDir, requirementSet };
}

function attachmentAnalysis(now: string): AttachmentAnalysis {
  return {
    id: "attachment-analysis-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    sourceId: "req-source",
    attachmentId: "attachment-1",
    kind: "flowchart",
    markdown: "Requester creates an order, then a manager approves it.",
    nodes: [
      { id: "visual-create", type: "action", label: "Create" },
      { id: "visual-approve", type: "action", label: "Approve" }
    ],
    edges: [{ from: "visual-create", to: "visual-approve", actor: "manager" }],
    confidence: 0.96,
    sourceRefs: ["attachment:attachment-1"],
    provider: "host-agent",
    status: "confirmed",
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    confirmedBy: "tester"
  };
}

function documentMap(): DocumentMapperOutput {
  return {
    goals: ["Approve valid orders"],
    scope: ["Order creation and approval"],
    modules: ["Orders"],
    actors: ["requester", "manager"],
    businessObjects: ["Order"],
    attachmentRefs: ["attachment-analysis:attachment-analysis-1"],
    risks: ["Approval can be bypassed"],
    sourceRefs: ["source:req-source#line:1"]
  };
}

function clauses(): ClauseAnalystOutput {
  return {
    module: "Orders",
    clauses: [
      {
        id: "clause-create",
        index: 1,
        text: "A requester creates an order.",
        sourceRefs: ["source:req-source#line:1"],
        module: "Orders",
        kind: "workflow",
        origin: "explicit",
        confidence: 1,
        status: "draft",
        nodeTypes: ["workflow", "actor", "object"]
      },
      {
        id: "clause-approve",
        index: 2,
        text: "A manager approves the order.",
        sourceRefs: ["source:req-source#line:1"],
        module: "Orders",
        kind: "workflow",
        origin: "explicit",
        confidence: 1,
        status: "draft",
        nodeTypes: ["workflow", "actor", "object"]
      },
      {
        id: "clause-active",
        index: 3,
        text: "The approved order becomes active.",
        sourceRefs: ["source:req-source#line:1"],
        module: "Orders",
        kind: "state",
        origin: "explicit",
        confidence: 1,
        status: "draft",
        nodeTypes: ["state", "rule"]
      }
    ],
    openQuestions: []
  };
}

function businessModels(): BusinessModelerOutput {
  return {
    businessObjectModels: [{
      localId: "order",
      name: "Order",
      actors: ["requester", "manager"],
      fields: [],
      states: ["draft", "pending", "active"],
      invariants: ["Only an approved order becomes active"],
      sourceRefs: ["source:req-source#line:1"]
    }],
    workflowModels: [{
      localId: "order-approval",
      title: "Order approval",
      actors: ["requester", "manager"],
      steps: [
        { id: "create", label: "Create order", actor: "requester", sourceRefs: ["source:req-source#line:1"] },
        { id: "approve", label: "Approve order", actor: "manager", sourceRefs: ["source:req-source#line:1"] }
      ],
      transitions: [{
        id: "create-to-approve",
        from: "create",
        to: "approve",
        actor: "manager",
        businessObject: "Order",
        sourceRefs: ["source:req-source#line:1"]
      }],
      startStepIds: ["create"],
      endStepIds: ["approve"],
      sourceRefs: ["source:req-source#line:1"],
      confidence: 0.95
    }],
    stateMachineModels: [{
      localId: "order-state",
      title: "Order state",
      states: [
        { id: "pending", label: "Pending", initial: true, terminal: false, sourceRefs: ["source:req-source#line:1"] },
        { id: "active", label: "Active", initial: false, terminal: true, sourceRefs: ["source:req-source#line:1"] }
      ],
      transitions: [{
        id: "approve",
        from: "pending",
        to: "active",
        trigger: "Approve",
        actor: "manager",
        validity: "legal",
        sourceRefs: ["source:req-source#line:1"]
      }],
      sourceRefs: ["source:req-source#line:1"],
      confidence: 0.95
    }],
    decisionTableModels: [{
      localId: "approval-rule",
      title: "Approval outcome",
      conditions: ["Manager approves"],
      actions: ["Order becomes active"],
      rules: [{
        conditionValues: { "Manager approves": "yes" },
        expectedActions: ["Order becomes active"],
        sourceRefs: ["source:req-source#line:1"]
      }],
      sourceRefs: ["source:req-source#line:1"]
    }],
    invariants: ["Only an approved order becomes active"]
  };
}

function criticOutput(): CoverageCriticOutput {
  return {
    verdict: "pass",
    score: 0.96,
    reasons: [],
    missingMainFlows: [],
    missingBranches: [],
    missingExceptions: [],
    missingActors: [],
    missingEndStates: [],
    contradictions: [],
    unsupportedInferences: [],
    requiredActions: [],
    evidenceRefs: ["source:req-source#line:1"]
  };
}
