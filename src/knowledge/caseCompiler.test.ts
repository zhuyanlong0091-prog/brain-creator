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

  it("compiles occupied and non-occupied branches into a visibility assertion", () => {
    const result = compileIntentSemanticSteps({
      intent: intent({
        title: "Create intern offer",
        objective: "选择招聘需求，若是否占编=是时，展示需求部门、需求职位、编制编码；是否占编=否时，隐藏编制编码",
        expectedResults: ["选择招聘需求后，按是否占编规则展示或隐藏编制字段"]
      }),
      workflowModels: [],
      stateMachineModels: [],
      additionalSourceRefs: []
    });
    const assertion = result.steps.find((step) => step.action === "assert");

    expect(assertion).toEqual(expect.objectContaining({
      assertion: expect.objectContaining({
        type: "visibility",
        strength: "limited",
        expected: "当是否占编=是时，应显示：需求部门、需求职位、编制编码；当是否占编=否时，应隐藏：编制编码"
      })
    }));
    expect(assertion?.expected).not.toContain("<");
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

  it("returns bounded ambiguity instead of selecting the first edge that shares a source ref", () => {
    const model = stateModel();
    const sharedRef = "attachment-analysis:shared#edge:1";
    const ambiguousModel: StateMachineModel = {
      ...model,
      states: [
        ...model.states,
        { id: "rejected", label: "Rejected", initial: false, terminal: true, sourceRefs: [sharedRef] }
      ],
      transitions: [
        { ...model.transitions[0], id: "transition-submit", to: "submitted", sourceRefs: [sharedRef] },
        { ...model.transitions[0], id: "transition-reject", to: "rejected", trigger: "reject", sourceRefs: [sharedRef] }
      ]
    };

    const result = compileIntentSemanticSteps({
      intent: intent({ requirementRefs: [sharedRef], processModelRefs: [ambiguousModel.id] }),
      workflowModels: [],
      stateMachineModels: [ambiguousModel],
      additionalSourceRefs: []
    });

    expect(result.steps).toEqual([]);
    expect(result.ambiguity).toEqual(expect.objectContaining({
      reason: expect.stringContaining("Multiple confirmed process transitions"),
      sourceRefs: expect.arrayContaining([
        sharedRef,
        "state-machine:state-model-1#transition:transition-submit",
        "state-machine:state-model-1#transition:transition-reject"
      ])
    }));
  });

  it("honors an explicit transition identity when its source ref is shared", () => {
    const model = stateModel();
    const sharedRef = "attachment-analysis:shared#edge:1";
    const selectedModel: StateMachineModel = {
      ...model,
      states: [
        ...model.states,
        { id: "rejected", label: "Rejected", initial: false, terminal: true, sourceRefs: [sharedRef] }
      ],
      transitions: [
        { ...model.transitions[0], id: "transition-submit", sourceRefs: [sharedRef] },
        { ...model.transitions[0], id: "transition-reject", to: "rejected", trigger: "reject", sourceRefs: [sharedRef] }
      ]
    };

    const result = compileIntentSemanticSteps({
      intent: intent({
        requirementRefs: [sharedRef, "transition-reject"],
        processModelRefs: [selectedModel.id]
      }),
      workflowModels: [],
      stateMachineModels: [selectedModel],
      additionalSourceRefs: []
    });

    expect(result.ambiguity).toBeUndefined();
    expect(result.steps[1]).toEqual(expect.objectContaining({
      instruction: expect.stringContaining("Draft to Rejected using reject")
    }));
  });

  it("uses an explicit model ref when multiple confirmed models share the same edge evidence", () => {
    const sharedRef = "attachment-analysis:shared#edge:1";
    const firstModel = stateModel();
    const selectedModel: StateMachineModel = {
      ...stateModel(),
      id: "state-model-2",
      states: [
        { id: "draft", label: "Queued", initial: true, terminal: false, sourceRefs: [sharedRef] },
        { id: "submitted", label: "Accepted", initial: false, terminal: true, sourceRefs: [sharedRef] }
      ],
      transitions: [{
        ...stateModel().transitions[0],
        id: "transition-accepted",
        trigger: "accept",
        sourceRefs: [sharedRef]
      }]
    };

    const result = compileIntentSemanticSteps({
      intent: intent({ requirementRefs: [sharedRef], processModelRefs: [selectedModel.id] }),
      workflowModels: [],
      stateMachineModels: [firstModel, selectedModel],
      additionalSourceRefs: []
    });

    expect(result.ambiguity).toBeUndefined();
    expect(result.source).toBe("state-machine");
    expect(result.steps[1]).toEqual(expect.objectContaining({
      instruction: expect.stringContaining("Queued to Accepted using accept")
    }));
    expect(result.processPathSourceRefs).toContain("state-machine:state-model-2");
  });

  it("does not prefer a state edge when a workflow edge is an equally supported candidate", () => {
    const sharedRef = "attachment-analysis:shared#edge:1";
    const state = { ...stateModel(), transitions: [{ ...stateModel().transitions[0], sourceRefs: [sharedRef] }] };
    const workflow = { ...workflowModel(), transitions: [{ ...workflowModel().transitions[0], sourceRefs: [sharedRef] }] };

    const result = compileIntentSemanticSteps({
      intent: intent({
        requirementRefs: [sharedRef],
        processModelRefs: [state.id, workflow.id]
      }),
      workflowModels: [workflow],
      stateMachineModels: [state],
      additionalSourceRefs: []
    });

    expect(result.steps).toEqual([]);
    expect(result.ambiguity?.sourceRefs).toEqual(expect.arrayContaining([
      "state-machine:state-model-1",
      "workflow:workflow-model-1",
      "state-machine:state-model-1#transition:transition-1",
      "workflow:workflow-model-1#transition:workflow-transition-1"
    ]));
  });

  it("does not compile an explicitly referenced model from another project or requirement set", () => {
    const model = stateModel();
    const mismatchedProject = { ...model, knowledgeProjectId: "other-project" };
    const mismatchedRequirement = { ...model, id: "state-model-2", requirementSetId: "other-requirement" };

    const result = compileIntentSemanticSteps({
      intent: intent({
        requirementRefs: [model.transitions[0].sourceRefs[0]],
        processModelRefs: [mismatchedProject.id, mismatchedRequirement.id]
      }),
      workflowModels: [],
      stateMachineModels: [mismatchedProject, mismatchedRequirement],
      additionalSourceRefs: []
    });

    expect(result.steps).toEqual([]);
    expect(result.ambiguity).toEqual(expect.objectContaining({
      reason: expect.stringContaining("unresolved explicit process model references"),
      sourceRefs: expect.arrayContaining([
        "process-model:state-model-1",
        "process-model:state-model-2"
      ])
    }));
  });

  it("rejects a partial explicit model scope when one reference is unresolved", () => {
    const model = stateModel();
    const unresolvedModelRef = "missing-state-model";

    const result = compileIntentSemanticSteps({
      intent: intent({
        requirementRefs: [model.transitions[0].sourceRefs[0]],
        processModelRefs: [model.id, unresolvedModelRef]
      }),
      workflowModels: [],
      stateMachineModels: [model],
      additionalSourceRefs: []
    });

    expect(result.steps).toEqual([]);
    expect(result.ambiguity).toEqual(expect.objectContaining({
      reason: expect.stringContaining(unresolvedModelRef),
      sourceRefs: expect.arrayContaining([`process-model:${unresolvedModelRef}`])
    }));
  });

  it("does not compile a unique state edge when either endpoint is missing", () => {
    const model = stateModel();
    const incompleteModel: StateMachineModel = {
      ...model,
      states: [model.states[0]],
      transitions: [{ ...model.transitions[0], sourceRefs: ["attachment-analysis:incomplete#edge:1"] }]
    };

    const result = compileIntentSemanticSteps({
      intent: intent({
        requirementRefs: [incompleteModel.transitions[0].sourceRefs[0]],
        processModelRefs: [incompleteModel.id]
      }),
      workflowModels: [],
      stateMachineModels: [incompleteModel],
      additionalSourceRefs: []
    });

    expect(result.steps).toEqual([]);
    expect(result.ambiguity).toEqual(expect.objectContaining({
      reason: expect.stringContaining("missing state endpoint"),
      sourceRefs: expect.arrayContaining([
        incompleteModel.transitions[0].sourceRefs[0],
        "state-machine:state-model-1#transition:transition-1"
      ])
    }));
  });

  it("does not compile a unique workflow edge when either step endpoint is missing", () => {
    const model = workflowModel();
    const incompleteModel: WorkflowModel = {
      ...model,
      steps: [model.steps[0]],
      transitions: [model.transitions[0]]
    };

    const result = compileIntentSemanticSteps({
      intent: intent({
        requirementRefs: [incompleteModel.transitions[0].sourceRefs[0]],
        processModelRefs: [incompleteModel.id]
      }),
      workflowModels: [incompleteModel],
      stateMachineModels: [],
      additionalSourceRefs: []
    });

    expect(result.steps).toEqual([]);
    expect(result.ambiguity).toEqual(expect.objectContaining({
      reason: expect.stringContaining("missing workflow step endpoint"),
      sourceRefs: expect.arrayContaining([
        "workflow:workflow-model-1#transition:workflow-transition-1"
      ])
    }));
  });

  it("keeps every ambiguous edge traceable beyond the bounded candidate display size", () => {
    const model = stateModel();
    const sharedRef = "attachment-analysis:many#edge:1";
    const states = Array.from({ length: 11 }, (_, index) => ({
      id: `target-${index}`,
      label: `Target ${index}`,
      initial: false,
      terminal: true,
      sourceRefs: [sharedRef]
    }));
    const transitions = states.map((state, index) => ({
      ...model.transitions[0],
      id: `transition-${index}`,
      to: state.id,
      sourceRefs: [sharedRef]
    }));
    const manyEdgesModel: StateMachineModel = { ...model, states: [...model.states, ...states], transitions };

    const result = compileIntentSemanticSteps({
      intent: intent({ requirementRefs: [sharedRef], processModelRefs: [manyEdgesModel.id] }),
      workflowModels: [],
      stateMachineModels: [manyEdgesModel],
      additionalSourceRefs: []
    });

    expect(result.steps).toEqual([]);
    expect(result.ambiguity?.sourceRefs).toContain(
      "state-machine:state-model-1#transition:transition-10"
    );
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

  it("blocks a case marked ready when it has no executable steps", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const executableCase = {
      ...executableCaseFixture(),
      status: "ready" as const,
      explorationTaskIds: undefined,
      steps: []
    };

    expect(executableCaseCompileStatus(repository, executableCase)).toBe("blocked");
  });

  it("blocks a ready case that has no business oracle", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const executableCase = {
      ...executableCaseFixture(),
      status: "ready" as const,
      explorationTaskIds: undefined,
      steps: [{
        id: "step-navigate",
        order: 1,
        action: "navigate" as const,
        instruction: "Open the order page",
        targetSemantic: "Order page",
        origin: "source" as const,
        sourceRefs: ["requirement:order"]
      }]
    };

    expect(executableCaseCompileStatus(repository, executableCase)).toBe("blocked");
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
