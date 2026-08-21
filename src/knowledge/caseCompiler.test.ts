// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { ExecutableCase, StateMachineModel, TestIntent, WorkflowModel } from "../domain/types.js";
import {
  compileIntentSemanticSteps,
  executableCaseCompileStatus,
  validateStepProvenance
} from "./caseCompiler.js";

describe("Agent executable case compiler", () => {
  it("compiles a state transition from confirmed process evidence", () => {
    const model = stateModel();
    const result = compileIntentSemanticSteps({
      intent: intent({
        requirementRefs: [model.transitions[0].sourceRefs[0]],
        processModelRefs: [model.id],
        expectedResults: ["The order enters Submitted"]
      }),
      workflowModels: [],
      stateMachineModels: [model],
      additionalSourceRefs: []
    });

    expect(result.source).toBe("state-machine");
    expect(result.steps.map((step) => step.action)).toEqual(["navigate", "click", "assert"]);
    expect(result.steps[1]).toEqual(
      expect.objectContaining({
        instruction: expect.stringContaining("Draft to Submitted"),
        sourceRefs: expect.arrayContaining([model.transitions[0].sourceRefs[0]])
      })
    );
    expect(validateStepProvenance(result.steps)).toEqual({ valid: true, invalidStepIds: [] });
  });

  it("does not invent a hidden create action for an unrelated fill intent", () => {
    const result = compileIntentSemanticSteps({
      intent: intent({ objective: "Fill the customer form", expectedResults: ["The form is accepted"] }),
      workflowModels: [],
      stateMachineModels: [],
      additionalSourceRefs: []
    });

    expect(result.source).toBe("requirement-clause");
    expect(result.steps.map((step) => step.action)).toEqual(["navigate", "fill", "assert"]);
    expect(result.steps.some((step) => step.targetSemantic === "new record action")).toBe(false);
  });

  it("keeps the named selection target for conditional form steps", () => {
    const result = compileIntentSemanticSteps({
      intent: intent({
        title: "Create intern offer",
        objective: "选择招聘需求后展示占编字段",
        expectedResults: ["占编字段按需求状态展示"]
      }),
      workflowModels: [],
      stateMachineModels: [],
      additionalSourceRefs: []
    });

    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "select",
          targetSemantic: "招聘需求",
          instruction: "Select 招聘需求"
        })
      ])
    );
  });

  it("compiles a workflow edge and keeps every step traceable", () => {
    const model = workflowModel();
    const result = compileIntentSemanticSteps({
      intent: intent({
        requirementRefs: [model.transitions[0].sourceRefs[0]],
        processModelRefs: [model.id]
      }),
      workflowModels: [model],
      stateMachineModels: [],
      additionalSourceRefs: ["requirement-set:req-1"]
    });

    expect(result.source).toBe("workflow");
    expect(result.steps.map((step) => step.sourceRefs.length > 0)).not.toContain(false);
    expect(result.processPathSourceRefs).toContain(model.transitions[0].sourceRefs[0]);
  });

  it("does not promote a case while its System Brain exploration is pending", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const executableCase = executableCaseFixture();
    repository.explorationTasks.push({
      id: "exploration-1",
      knowledgeProjectId: "project-1",
      requirementSetId: "req-1",
      testIntentId: "intent-1",
      executableCaseId: executableCase.id,
      systemId: "system-1",
      kind: "locator-evidence",
      status: "pending",
      reason: "Missing locator evidence",
      query: "Order submit",
      candidatePageModelIds: [],
      requestedEvidence: ["locator point"],
      sourceRefs: ["source:order"],
      resultSourceRefs: [],
      idempotencyKey: "exploration-key",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(executableCaseCompileStatus(repository, executableCase)).toBe("needs-exploration");
  });
});

function executableCaseFixture(): ExecutableCase {
  return {
    id: "case-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "req-1",
    testIntentId: "intent-1",
    systemId: "system-1",
    title: "Submit order",
    status: "needs-exploration",
    preconditions: [],
    steps: [],
    dataProfileIds: [],
    explorationTaskIds: ["exploration-1"],
    gapIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function intent(overrides: Partial<TestIntent> = {}): TestIntent {
  return {
    id: "intent-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "req-1",
    title: "Order transition",
    module: "Order",
    priority: "P1",
    objective: "Submit the order",
    preconditions: [],
    expectedResults: ["The approved requirement is satisfied"],
    requirementRefs: ["source:order"],
    knowledgeNodeRefs: [],
    techniques: ["state-transition"],
    status: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function stateModel(): StateMachineModel {
  return {
    id: "state-model-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "req-1",
    attachmentAnalysisId: "analysis-1",
    title: "Order states",
    states: [
      { id: "draft", label: "Draft", initial: true, terminal: false, sourceRefs: ["attachment:1"] },
      { id: "submitted", label: "Submitted", initial: false, terminal: true, sourceRefs: ["attachment:1"] }
    ],
    transitions: [{
      id: "transition-1",
      from: "draft",
      to: "submitted",
      trigger: "submit",
      actor: "requester",
      sourceRefs: ["attachment-analysis:1#edge:1"]
    }],
    sourceRefs: ["attachment-analysis:1#edge:1"],
    confidence: 0.96,
    status: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function workflowModel(): WorkflowModel {
  return {
    id: "workflow-model-1",
    knowledgeProjectId: "project-1",
    requirementSetId: "req-1",
    attachmentAnalysisId: "analysis-2",
    title: "Order workflow",
    actors: ["requester", "manager"],
    steps: [
      { id: "create", label: "Create order", actor: "requester", sourceRefs: ["attachment:2"] },
      { id: "review", label: "Review order", actor: "manager", sourceRefs: ["attachment:2"] }
    ],
    transitions: [{
      id: "workflow-transition-1",
      from: "create",
      to: "review",
      condition: "submit",
      actor: "requester",
      sourceRefs: ["attachment-analysis:2#edge:1"]
    }],
    startStepIds: ["create"],
    endStepIds: ["review"],
    sourceRefs: ["attachment-analysis:2#edge:1"],
    confidence: 0.95,
    status: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
