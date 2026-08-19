// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { ExecutableCaseStep } from "../domain/types.js";
import { KnowledgeService } from "./service.js";
import type { SystemBrain } from "./systemBrain.js";
import { planStateActions } from "./stateActionPlanner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("State action planner", () => {
  it("enriches an existing generic select step from observed state evidence", () => {
    const result = planStateActions(
      [
        step("select", "Select the requirement-defined option", "conditional selector"),
        step(
          "assert",
          "Verify the headcount field is visible",
          "headcount field",
          "The headcount field is visible"
        )
      ],
      stateBrain([
        transition({
          id: "transition-intern",
          targetName: "Employee Type",
          inputValue: "Intern",
          visibleAdded: ["Headcount Field"]
        })
      ]),
      "选择实习生后显示占编字段",
      "page-settings"
    );

    expect(result.verdict).toBe("unique");
    expect(result.steps[0]).toEqual(
      expect.objectContaining({
        action: "select",
        targetSemantic: "Employee Type",
        value: "Intern",
        pageModelId: "page-settings",
        locatorPointId: "locator-employee-type",
        sourceRefs: expect.arrayContaining([
          "system-interaction:transition-intern"
        ])
      })
    );
  });

  it("inserts a missing state action before its assertion", () => {
    const result = planStateActions(
      [
        step(
          "assert",
          "Verify Threshold becomes visible",
          "Threshold",
          "Threshold is visible"
        )
      ],
      stateBrain([
        transition({
          id: "transition-advanced",
          targetName: "Mode",
          inputValue: "Advanced",
          visibleAdded: ["Threshold"]
        })
      ]),
      "Advanced mode reveals Threshold",
      "page-settings"
    );

    expect(result.verdict).toBe("unique");
    expect(result.steps.map((item) => item.action)).toEqual(["select", "assert"]);
    expect(result.steps[0]).toEqual(
      expect.objectContaining({
        targetSemantic: "Mode",
        value: "Advanced",
        origin: "observed"
      })
    );
  });

  it("inserts an observed disclosure action before its assertion", () => {
    const brain = stateBrain([]);
    brain.stateTransitions.push({
      ...transition({
        id: "transition-details",
        targetName: "Advanced Details",
        inputValue: "unused",
        visibleAdded: ["Threshold"]
      }),
      targetRole: "button",
      targetSelector: "[data-testid=advanced-details]",
      targetKind: "disclosure",
      action: "click",
      inputValue: undefined
    });
    brain.pages[0].locators.push(
      locator("locator-advanced-details", "Advanced Details", "button")
    );

    const result = planStateActions(
      [
        step(
          "assert",
          "Verify Threshold becomes visible",
          "Threshold",
          "Threshold is visible"
        )
      ],
      brain,
      "Advanced Details reveals Threshold",
      "page-settings"
    );

    expect(result.verdict).toBe("unique");
    expect(result.steps[0]).toEqual(
      expect.objectContaining({
        action: "click",
        targetSemantic: "Advanced Details",
        value: undefined,
        locatorPointId: "locator-advanced-details",
        origin: "observed"
      })
    );
  });

  it("blocks equally relevant state transitions instead of choosing one", () => {
    const result = planStateActions(
      [
        step(
          "assert",
          "Verify Threshold becomes visible",
          "Threshold",
          "Threshold is visible"
        )
      ],
      stateBrain([
        transition({
          id: "transition-mode",
          targetName: "Mode",
          inputValue: "Advanced",
          visibleAdded: ["Threshold"]
        }),
        transition({
          id: "transition-profile",
          targetName: "Profile",
          inputValue: "Custom",
          visibleAdded: ["Threshold"]
        })
      ]),
      "Show Threshold",
      "page-settings"
    );

    expect(result.verdict).toBe("ambiguous");
    expect(result.candidateCount).toBe(2);
    expect(result.candidates.map((candidate) => candidate.targetName)).toEqual([
      "Mode",
      "Profile"
    ]);
  });

  it("blocks a selected transition when its control has no locator evidence", () => {
    const brain = stateBrain([
      transition({
        id: "transition-advanced",
        targetName: "Mode",
        inputValue: "Advanced",
        visibleAdded: ["Threshold"]
      })
    ]);
    brain.pages[0].locators = [];
    brain.pages[0].locatorCount = 0;

    const result = planStateActions(
      [
        step(
          "assert",
          "Verify Threshold becomes visible",
          "Threshold",
          "Threshold is visible"
        )
      ],
      brain,
      "Advanced mode reveals Threshold",
      "page-settings"
    );

    expect(result.verdict).toBe("missing");
    expect(result.reason).toContain("locator evidence");
  });

  it("blocks a select transition when captured input evidence is missing", () => {
    const brain = stateBrain([
      {
        ...transition({
          id: "transition-advanced",
          targetName: "Mode",
          inputValue: "Advanced",
          visibleAdded: ["Threshold"]
        }),
        inputValue: undefined
      }
    ]);

    const result = planStateActions(
      [
        step(
          "assert",
          "Verify Threshold becomes visible",
          "Threshold",
          "Threshold is visible"
        )
      ],
      brain,
      "Mode reveals Threshold",
      "page-settings"
    );

    expect(result.verdict).toBe("missing");
    expect(result.reason).toContain("has no input value");
  });

  it("does not inject an unrelated observed transition", () => {
    const steps = [
      step(
        "assert",
        "Verify the profile name",
        "Profile Name",
        "Profile Name is visible"
      )
    ];
    const result = planStateActions(
      steps,
      stateBrain([
        transition({
          id: "transition-advanced",
          targetName: "Mode",
          inputValue: "Advanced",
          visibleAdded: ["Threshold"]
        })
      ]),
      "Review profile name",
      "page-settings"
    );

    expect(result.verdict).toBe("not-required");
    expect(result.steps).toEqual(steps);
  });

  it("persists state plans and converts ambiguity into a System Brain Gap", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    repository.systemProfiles.push({
      id: "system-state",
      name: "Settings System",
      environment: "test",
      baseUrl: "https://settings.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://settings.example.test"],
      status: "succeeded",
      createdAt: now(),
      updatedAt: now()
    });
    const project = await service.createProject({
      name: "Settings Knowledge",
      key: "settings-state-plan",
      defaultLocale: "en-US"
    });
    service.bindSystem(project.id, "system-state");
    addStateAssets(repository, project.id, [
      transition({
        id: "transition-advanced",
        targetName: "Mode",
        inputValue: "Advanced",
        visibleAdded: ["Threshold"]
      })
    ]);
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Settings",
        content: "Threshold becomes visible.",
        blocks: [
          { type: "paragraph", text: "Threshold becomes visible." }
        ],
        attachments: [],
        source: "requirements/settings.md",
        sourceType: "local-file",
        contentHash: "settings-state-v1",
        warnings: []
      }
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    if (design.evaluationGate.actions.some((action) => action.status === "pending")) {
      await service.confirmEvaluationActions({
        requirementSetId: ingested.requirementSet.id,
        actionIds: design.evaluationGate.actions
          .filter((action) => action.status === "pending")
          .map((action) => action.id),
        note: "The trigger is confirmed from observed System Brain evidence.",
        confirm: true
      });
    }
    service.approveRequirementSet(ingested.requirementSet.id);

    const unique = service.compileExecutableCases(
      design.testIntents[0].id,
      "system-state"
    );

    expect(unique.executableCase.status).toBe("ready");
    expect(unique.executableCase.statePlan).toEqual(
      expect.objectContaining({ verdict: "unique", candidateCount: 1 })
    );
    expect(unique.executableCase.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "select",
          targetSemantic: "Mode",
          value: "Advanced",
          locatorPointId: "locator-mode"
        })
      ])
    );

    repository.systemExplorations[0].interactionTransitions.push({
      ...repository.systemExplorations[0].interactionTransitions[0],
      id: "transition-custom",
      targetName: "Profile",
      targetSelector: "[data-testid=profile]",
      inputValue: "Custom"
    });
    const ambiguous = service.compileExecutableCases(
      design.testIntents[0].id,
      "system-state"
    );

    expect(ambiguous.executableCase.status).toBe("ambiguous");
    expect(ambiguous.executableCase.statePlan).toEqual(
      expect.objectContaining({ verdict: "ambiguous", candidateCount: 2 })
    );
    expect(ambiguous.gaps).toEqual([]);
    expect(repository.explorationTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "state-action",
          status: "pending",
          reason: expect.stringContaining(
            "multiple equally relevant state transitions"
          )
        })
      ])
    );
  });
});

function step(
  action: ExecutableCaseStep["action"],
  instruction: string,
  targetSemantic: string,
  expected?: string
): ExecutableCaseStep {
  return {
    id: `step-${action}`,
    order: 1,
    action,
    instruction,
    targetSemantic,
    expected,
    origin: "source",
    sourceRefs: ["requirement:state"]
  };
}

function stateBrain(
  stateTransitions: SystemBrain["stateTransitions"]
): SystemBrain {
  return {
    knowledgeProjectId: "knowledge-state",
    systemId: "system-state",
    pages: [
      {
        pageModelId: "page-settings",
        name: "Settings",
        route: "/settings",
        version: 1,
        screenshotId: "shot-settings",
        locatorCount: 3,
        probeIssueCount: 0,
        locators: [
          locator("locator-employee-type", "Employee Type", "combobox"),
          locator("locator-mode", "Mode", "combobox"),
          locator("locator-profile", "Profile", "combobox")
        ],
        probeResultIds: [],
        sourceRefs: ["page-model:page-settings"]
      }
    ],
    workflows: [],
    behaviorRules: [],
    apiFlows: [],
    navigationEdges: [],
    states: [],
    stateTransitions,
    observations: [],
    conflicts: [],
    readiness: {
      pageEvidence: true,
      locatorEvidence: true,
      workflowEvidence: false,
      apiEvidence: false,
      navigationEvidence: false,
      stateEvidence: stateTransitions.length > 0,
      readyForCompilation: true
    }
  };
}

function transition(input: {
  id: string;
  targetName: string;
  inputValue: string;
  visibleAdded: string[];
}): SystemBrain["stateTransitions"][number] {
  return {
    id: input.id,
    explorationId: "exploration-state",
    pageModelId: "page-settings",
    pageUrl: "https://example.test/settings",
    targetName: input.targetName,
    targetRole: "combobox",
    targetSelector: `[data-testid=${input.targetName.toLowerCase().replace(/\s+/g, "-")}]`,
    targetKind: "select",
    action: "select",
    inputValue: input.inputValue,
    beforeStateId: `before-${input.id}`,
    afterStateId: `after-${input.id}`,
    visibleAdded: input.visibleAdded,
    visibleRemoved: [],
    dialogAdded: [],
    dialogRemoved: [],
    urlChanged: false,
    sourceRefs: [
      `system-exploration:exploration-state`,
      `system-interaction:${input.id}`,
      "page-model:page-settings"
    ]
  };
}

function locator(id: string, name: string, role: string) {
  return {
    id,
    pageModelId: "page-settings",
    name,
    selector: `[data-testid=${name.toLowerCase().replace(/\s+/g, "-")}]`,
    role,
    text: name,
    fallbackSelectors: [`text=${name}`],
    confidence: 0.99
  };
}

function addStateAssets(
  repository: InMemoryBrainCreatorRepository,
  knowledgeProjectId: string,
  transitions: SystemBrain["stateTransitions"]
) {
  repository.pageModels.push({
    id: "page-settings",
    projectId: "system-state",
    route: "/settings",
    name: "Settings",
    version: 1,
    domSnapshotId: "dom-settings",
    screenshotId: "shot-settings",
    status: "succeeded",
    createdAt: now(),
    updatedAt: now()
  });
  repository.locatorPoints.push(
    locator("locator-mode", "Mode", "combobox"),
    locator("locator-profile", "Profile", "combobox"),
    locator("locator-threshold", "Threshold", "textbox")
  );
  repository.systemExplorations.push({
    id: "exploration-state",
    knowledgeProjectId,
    systemId: "system-state",
    startUrl: "https://settings.example.test/settings",
    status: "completed",
    interactionMode: "safe",
    budget: {
      maxPages: 1,
      maxDepth: 0,
      maxDurationMs: 30_000,
      maxInteractionsPerPage: 3
    },
    pageModelIds: ["page-settings"],
    navigationEdges: [],
    interactionTransitions: transitions.map((item) => ({
      id: item.id,
      pageModelId: item.pageModelId,
      pageUrl: item.pageUrl,
      targetName: item.targetName,
      targetRole: item.targetRole,
      targetSelector: item.targetSelector,
      targetKind: item.targetKind,
      action: item.action,
      inputValue: item.inputValue,
      before: {
        id: item.beforeStateId,
        url: item.pageUrl,
        visibleElements: [],
        dialogs: []
      },
      after: {
        id: item.afterStateId,
        url: item.pageUrl,
        visibleElements: item.visibleAdded,
        dialogs: item.dialogAdded
      },
      visibleAdded: item.visibleAdded,
      visibleRemoved: item.visibleRemoved,
      dialogAdded: item.dialogAdded,
      dialogRemoved: item.dialogRemoved,
      urlChanged: item.urlChanged,
      blockedRequests: [],
      status: "observed",
      screenshotPath: item.screenshotPath
    })),
    warnings: [],
    gapIds: [],
    artifactDir: ".brain-creator/system-explorations/state-plan",
    createdAt: now(),
    updatedAt: now(),
    completedAt: now()
  });
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-state-plan-"));
  tempDirs.push(dir);
  return dir;
}

function now() {
  return new Date().toISOString();
}
