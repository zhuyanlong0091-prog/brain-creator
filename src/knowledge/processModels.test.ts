// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AttachmentAnalysis } from "../domain/types.js";
import { analyzeRequirement, designTests } from "./policies.js";
import {
  augmentAnalysisWithProcessModels,
  buildProcessModels,
  buildProcessTestIntents,
  buildRequirementCoverageProfile
} from "./processModels.js";

describe("requirement process models", () => {
  it("turns confirmed state-machine evidence into traceable positive and negative intents", () => {
    const analysis = analyzeRequirement({
      requirementSetId: "req-1",
      title: "Order approval",
      content: "Orders require approval.",
      sourceRef: "source-1"
    });
    const models = buildProcessModels({
      knowledgeProjectId: "project-1",
      requirementSetId: "req-1",
      analyses: [stateMachineAnalysis("confirmed")]
    });
    const augmented = augmentAnalysisWithProcessModels(analysis, models);
    const base = designTests({ knowledgeProjectId: "project-1", analysis: augmented });
    const intents = buildProcessTestIntents({
      knowledgeProjectId: "project-1",
      analysis: augmented,
      workflowModels: models.workflowModels,
      stateMachineModels: models.stateMachineModels,
      baseIntents: base.testIntents
    });

    expect(models.stateMachineModels).toHaveLength(1);
    expect(models.stateMachineModels[0].transitions).toHaveLength(2);
    expect(intents.filter((intent) => intent.scenarioType === "positive" && intent.coverageDimensions?.includes("state"))).toHaveLength(2);
    expect(intents.some((intent) => intent.title.includes("missing prerequisite"))).toBe(true);
    expect(intents.some((intent) => intent.title.includes("role mismatch"))).toBe(true);
    expect(intents.some((intent) => intent.title.includes("invalid transition"))).toBe(true);
    expect(intents.every((intent) => intent.requirementRefs.length > 0)).toBe(true);
  });

  it("creates a cross-role actor journey for a confirmed workflow and ignores draft evidence", () => {
    const analysis = analyzeRequirement({
      requirementSetId: "req-1",
      title: "Order workflow",
      content: "Orders are processed.",
      sourceRef: "source-1"
    });
    const models = buildProcessModels({
      knowledgeProjectId: "project-1",
      requirementSetId: "req-1",
      analyses: [workflowAnalysis("confirmed"), stateMachineAnalysis("draft")]
    });
    const augmented = augmentAnalysisWithProcessModels(analysis, models);
    const base = designTests({ knowledgeProjectId: "project-1", analysis: augmented });
    const intents = buildProcessTestIntents({
      knowledgeProjectId: "project-1",
      analysis: augmented,
      workflowModels: models.workflowModels,
      stateMachineModels: models.stateMachineModels,
      baseIntents: base.testIntents
    });

    expect(models.workflowModels).toHaveLength(1);
    expect(models.stateMachineModels).toEqual([]);
    expect(intents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorJourney: ["requester", "manager"],
          coverageDimensions: expect.arrayContaining(["workflow"])
        })
      ])
    );
  });

  it("reports process coverage separately from field coverage", () => {
    const analysis = analyzeRequirement({
      requirementSetId: "req-1",
      title: "Order workflow",
      content: "The order name is required.",
      sourceRef: "source-1"
    });
    const models = buildProcessModels({
      knowledgeProjectId: "project-1",
      requirementSetId: "req-1",
      analyses: [workflowAnalysis("confirmed")]
    });
    const augmented = augmentAnalysisWithProcessModels(analysis, models);
    const base = designTests({ knowledgeProjectId: "project-1", analysis: augmented });
    const intents = buildProcessTestIntents({
      knowledgeProjectId: "project-1",
      analysis: augmented,
      workflowModels: models.workflowModels,
      stateMachineModels: models.stateMachineModels,
      baseIntents: base.testIntents
    });
    const profile = buildRequirementCoverageProfile({
      knowledgeProjectId: "project-1",
      requirementSetId: "req-1",
      inputHash: "hash",
      analysis: augmented,
      intents,
      workflowModels: models.workflowModels,
      stateMachineModels: models.stateMachineModels
    });

    expect(profile.dimensions.workflow.missingRefs).toEqual([]);
    expect(profile.dimensions.workflow.intentCount).toBeGreaterThan(0);
    expect(profile.workflowModelIds).toEqual([models.workflowModels[0].id]);
    expect(profile.status).toBe("complete");
  });

  it("feeds confirmed visual tables into atomic requirement clauses", () => {
    const analysis = analyzeRequirement({
      requirementSetId: "req-1",
      title: "Order limits",
      content: "Order rules are attached.",
      sourceRef: "source-1"
    });
    const table: AttachmentAnalysis = {
      ...stateMachineAnalysis("confirmed"),
      id: "analysis-table",
      attachmentId: "attachment-table",
      kind: "table",
      markdown: "| Tier | Limit |\n| --- | --- |\n| Standard | 100 |\n| Premium | 500 |",
      nodes: [],
      edges: []
    };
    const augmented = augmentAnalysisWithProcessModels(
      analysis,
      { workflowModels: [], stateMachineModels: [] },
      [table]
    );

    expect(augmented.clauses.slice(-2)).toEqual([
      expect.objectContaining({
        text: "Tier: Standard; Limit: 100",
        sourceRef: "attachment-analysis:analysis-table#row:1",
        nodeTypes: ["field", "rule", "data-constraint"]
      }),
      expect.objectContaining({
        text: "Tier: Premium; Limit: 500",
        sourceRef: "attachment-analysis:analysis-table#row:2"
      })
    ]);
  });

  it("blocks coverage when a confirmed process model has no transitions", () => {
    const analysis = analyzeRequirement({
      requirementSetId: "req-1",
      title: "Order state",
      content: "Order states are attached.",
      sourceRef: "source-1"
    });
    const incomplete = { ...stateMachineAnalysis("confirmed"), edges: [] };
    const models = buildProcessModels({
      knowledgeProjectId: "project-1",
      requirementSetId: "req-1",
      analyses: [incomplete]
    });
    const augmented = augmentAnalysisWithProcessModels(analysis, models, [incomplete]);
    const design = designTests({ knowledgeProjectId: "project-1", analysis: augmented });
    const profile = buildRequirementCoverageProfile({
      knowledgeProjectId: "project-1",
      requirementSetId: "req-1",
      inputHash: "hash",
      analysis: augmented,
      intents: design.testIntents,
      workflowModels: models.workflowModels,
      stateMachineModels: models.stateMachineModels
    });

    expect(profile.status).toBe("blocked");
    expect(profile.reasons).toContain("A confirmed state-machine model lacks states or transitions");
  });
});

function stateMachineAnalysis(status: AttachmentAnalysis["status"]): AttachmentAnalysis {
  return {
    id: "analysis-state",
    knowledgeProjectId: "project-1",
    requirementSetId: "req-1",
    sourceId: "source-1",
    attachmentId: "attachment-state",
    kind: "state-machine",
    markdown: "Draft -> Submitted -> Approved",
    nodes: [
      { id: "draft", type: "state", label: "Draft" },
      { id: "submitted", type: "state", label: "Submitted" },
      { id: "approved", type: "state", label: "Approved" }
    ],
    edges: [
      { from: "draft", to: "submitted", condition: "submit", actor: "requester" },
      { from: "submitted", to: "approved", condition: "approve", actor: "manager" }
    ],
    confidence: 0.95,
    sourceRefs: ["attachment:attachment-state"],
    provider: "host-agent",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function workflowAnalysis(status: AttachmentAnalysis["status"]): AttachmentAnalysis {
  return {
    ...stateMachineAnalysis(status),
    id: "analysis-flow",
    attachmentId: "attachment-flow",
    kind: "flowchart",
    markdown: "Create -> Review -> Complete",
    nodes: [
      { id: "create", type: "step", label: "Create request" },
      { id: "review", type: "step", label: "Review request" },
      { id: "complete", type: "step", label: "Complete request" }
    ],
    edges: [
      { from: "create", to: "review", condition: "submit", actor: "requester" },
      { from: "review", to: "complete", condition: "approve", actor: "manager" }
    ],
    sourceRefs: ["attachment:attachment-flow"]
  };
}
