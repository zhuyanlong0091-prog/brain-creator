// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutableCaseStep,
  RequirementContentPackage
} from "../domain/types.js";
import { KnowledgeService } from "./service.js";
import {
  type SystemBrain,
  type SystemBrainPage
} from "./systemBrain.js";
import { planWorkflowPath } from "./workflowPathPlanner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("System Brain", () => {
  it("compiles the unique shortest navigation path into evidence-bound steps", () => {
    const steps = workflowSteps();
    const result = planWorkflowPath(
      steps,
      workflowBrain([
        edge("page-dashboard", "page-recruiting", "Recruiting"),
        edge("page-recruiting", "page-create", "Create Request")
      ]),
      "Fill the recruiting request form"
    );

    expect(result).toEqual(
      expect.objectContaining({
        verdict: "unique",
        startPageModelId: "page-dashboard",
        targetPageModelId: "page-create",
        pageModelIds: ["page-dashboard", "page-recruiting", "page-create"]
      })
    );
    expect(result.steps.map((step) => step.action)).toEqual([
      "navigate",
      "click",
      "click",
      "fill",
      "assert"
    ]);
    expect(result.steps.slice(0, 3)).toEqual([
      expect.objectContaining({ pageModelId: "page-dashboard" }),
      expect.objectContaining({
        pageModelId: "page-dashboard",
        targetSemantic: "Recruiting",
        origin: "observed",
        sourceRefs: expect.arrayContaining([
          "system-navigation:exploration-path:page-dashboard:page-recruiting:recruiting"
        ])
      }),
      expect.objectContaining({
        pageModelId: "page-recruiting",
        targetSemantic: "Create Request",
        origin: "observed"
      })
    ]);
    expect(result.steps.slice(3)).toEqual([
      expect.objectContaining({ pageModelId: "page-create" }),
      expect.objectContaining({ pageModelId: "page-create" })
    ]);
  });

  it("blocks equal shortest navigation paths instead of choosing one", () => {
    const brain = workflowBrain([
      edge("page-dashboard", "page-recruiting", "Recruiting"),
      edge("page-recruiting", "page-create", "Create Request"),
      edge("page-dashboard", "page-shortcut", "Recruiting Shortcut"),
      edge("page-shortcut", "page-create", "Create From Shortcut")
    ]);
    brain.pages.push(
      page("page-shortcut", "Recruiting Shortcut", "/shortcut", [
        locator("locator-shortcut-create", "Create From Shortcut", "link")
      ])
    );

    const result = planWorkflowPath(
      workflowSteps(),
      brain,
      "Fill the recruiting request form"
    );

    expect(result.verdict).toBe("ambiguous");
    expect(result.reason).toContain("multiple equally short navigation paths");
    expect(result.candidatePaths).toHaveLength(2);
    expect(result.candidatePaths.map((path) => path.navigationLabels)).toEqual(
      expect.arrayContaining([
        ["Recruiting", "Create Request"],
        ["Recruiting Shortcut", "Create From Shortcut"]
      ])
    );
  });

  it("treats parallel controls between the same pages as distinct paths", () => {
    const result = planWorkflowPath(
      workflowSteps(),
      workflowBrain([
        edge("page-dashboard", "page-recruiting", "Recruiting"),
        edge("page-dashboard", "page-recruiting", "Recruiting Menu"),
        edge("page-recruiting", "page-create", "Create Request")
      ]),
      "Fill the recruiting request form"
    );

    expect(result.verdict).toBe("ambiguous");
    expect(result.candidatePaths.map((path) => path.navigationLabels)).toEqual(
      expect.arrayContaining([
        ["Recruiting", "Create Request"],
        ["Recruiting Menu", "Create Request"]
      ])
    );
  });

  it("blocks when navigation path enumeration exceeds its safety budget", () => {
    const result = planWorkflowPath(
      workflowSteps(),
      workflowBrain(
        Array.from({ length: 1_001 }, (_, index) =>
          edge("page-dashboard", "page-create", `Create Request ${index}`)
        )
      ),
      "Fill the recruiting request form"
    );

    expect(result.verdict).toBe("missing");
    expect(result.reason).toContain("exceeded the safety budget");
    expect(result.candidatePathCount).toBe(1_000);
    expect(result.candidatePaths).toHaveLength(10);
  });

  it("blocks when navigation evidence cannot reach the target page", () => {
    const brain = workflowBrain([
      edge("page-dashboard", "page-recruiting", "Recruiting")
    ]);

    const result = planWorkflowPath(
      workflowSteps(),
      brain,
      "Fill the recruiting request form"
    );

    expect(result.verdict).toBe("missing");
    expect(result.reason).toContain("no navigation path");
    expect(result.targetPageModelId).toBe("page-create");
  });

  it("keeps single-page compilation compatible when no path is required", () => {
    const brain = workflowBrain([]);
    brain.pages = [brain.pages[2]];

    const result = planWorkflowPath(
      workflowSteps(),
      brain,
      "Fill the recruiting request form"
    );

    expect(result.verdict).toBe("not-required");
    expect(result.steps).toEqual(workflowSteps());
  });

  it("persists a unique path plan and creates a Gap when the graph becomes ambiguous", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Workflow Planning",
      key: "workflow-planning",
      defaultLocale: "en-US"
    });
    addSystem(repository, "system-path");
    service.bindSystem(project.id, "system-path");
    addWorkflowGraphAssets(repository, project.id, false);
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "workflow-path",
        "Users fill the recruiting request form."
      )
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);

    const unique = service.compileExecutableCases(
      design.testIntents[0].id,
      "system-path"
    );

    expect(unique.executableCase.status).toBe("ready");
    expect(unique.executableCase.pathPlan).toEqual(
      expect.objectContaining({
        verdict: "unique",
        pageModelIds: ["page-dashboard", "page-recruiting", "page-create"]
      })
    );
    expect(unique.executableCase.steps.map((step) => step.action)).toEqual([
      "navigate",
      "click",
      "click",
      "fill",
      "assert"
    ]);

    addWorkflowGraphAssets(repository, project.id, true);
    const ambiguous = service.compileExecutableCases(
      design.testIntents[0].id,
      "system-path"
    );

    expect(ambiguous.executableCase.status).toBe("blocked");
    expect(ambiguous.executableCase.pathPlan).toEqual(
      expect.objectContaining({
        verdict: "ambiguous",
        candidatePaths: expect.arrayContaining([
          expect.objectContaining({
            pageModelIds: [
              "page-dashboard",
              "page-recruiting",
              "page-create"
            ]
          }),
          expect.objectContaining({
            pageModelIds: ["page-dashboard", "page-shortcut", "page-create"]
          })
        ])
      })
    );
    expect(ambiguous.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "system-brain",
          reason: expect.stringContaining("multiple equally short navigation paths")
        })
      ])
    );
  });

  it("builds an isolated, idempotent system view from page, training, cascade, and API evidence", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({
      name: "Recruiting Knowledge",
      key: "recruiting-knowledge",
      defaultLocale: "zh-CN"
    });
    addSystem(repository, "system-recruiting");
    addSystem(repository, "system-other");
    service.bindSystem(project.id, "system-recruiting");
    addSystemAssets(repository, "system-recruiting");
    repository.pageModels.push({
      id: "page-other",
      projectId: "system-other",
      route: "/other",
      name: "Other",
      version: 1,
      domSnapshotId: "dom-other",
      screenshotId: "shot-other",
      status: "succeeded",
      createdAt: now(),
      updatedAt: now()
    });

    const first = await service.refreshSystemBrain(project.id, "system-recruiting");
    const observedCount = repository.knowledgeNodes.filter(
      (node) => node.origin === "observed" && node.systemId === "system-recruiting"
    ).length;
    const second = await service.refreshSystemBrain(project.id, "system-recruiting");

    expect(first.pages).toHaveLength(1);
    expect(first.pages[0]).toEqual(
      expect.objectContaining({
        pageModelId: "page-recruiting",
        locatorCount: 3,
        probeIssueCount: 0
      })
    );
    expect(first.workflows).toEqual([
      expect.objectContaining({
        trainingSessionId: "session-recruiting",
        actionStepIds: ["action-select"],
        apiFlowIds: ["api-recruiting"]
      })
    ]);
    expect(first.behaviorRules).toEqual([
      expect.objectContaining({
        trigger: expect.stringContaining("Employment Type"),
        effect: "Replacement Employee becomes visible"
      })
    ]);
    expect(first.readiness).toEqual({
      pageEvidence: true,
      locatorEvidence: true,
      workflowEvidence: true,
      apiEvidence: true,
      navigationEvidence: false,
      stateEvidence: false,
      readyForCompilation: true
    });
    expect(second.pages.some((page) => page.pageModelId === "page-other")).toBe(false);
    expect(
      repository.knowledgeNodes.filter(
        (node) => node.origin === "observed" && node.systemId === "system-recruiting"
      )
    ).toHaveLength(observedCount);
    expect(
      await readFile(
        join(
          knowledgeDir,
          "recruiting-knowledge",
          "systems",
          "system-recruiting",
          "brain.md"
        ),
        "utf8"
      )
    ).toContain("Replacement Employee becomes visible");
    expect(
      await readFile(join(knowledgeDir, "recruiting-knowledge", "MOC.md"), "utf8")
    ).toContain("[[systems/system-recruiting/brain|system-recruiting]]");
  });

  it("keeps requirement expectations separate when a system observation conflicts", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Observed Rules",
      key: "observed-rules",
      defaultLocale: "en-US"
    });
    addSystem(repository, "system-recruiting");
    service.bindSystem(project.id, "system-recruiting");
    addSystemAssets(repository, "system-recruiting");
    repository.knowledgeNodes.push({
      id: "expected-cascade",
      knowledgeProjectId: project.id,
      type: "rule",
      title: "Employment Type behavior",
      content: "Selecting Intern keeps Replacement Employee hidden",
      module: "Recruiting",
      sourceRefs: ["requirement:cascade"],
      origin: "source",
      confidence: 1,
      status: "confirmed",
      createdAt: now(),
      updatedAt: now()
    });

    const brain = await service.refreshSystemBrain(project.id, "system-recruiting");

    expect(repository.knowledgeNodes.find((node) => node.id === "expected-cascade")?.status).toBe(
      "confirmed"
    );
    expect(brain.conflicts).toEqual([
      expect.objectContaining({
        title: "Employment Type behavior",
        status: "conflicted",
        systemId: "system-recruiting"
      })
    ]);
    expect(
      repository.gaps.filter(
        (gap) => gap.projectId === project.id && gap.sourceType === "system-observation"
      )
    ).toHaveLength(1);
  });

  it("binds executable steps to System Brain evidence and blocks systems without page evidence", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Order Knowledge",
      key: "order-knowledge",
      defaultLocale: "en-US"
    });
    addSystem(repository, "system-recruiting");
    addSystem(repository, "system-empty");
    addSystem(repository, "system-button-only");
    service.bindSystem(project.id, "system-recruiting");
    service.bindSystem(project.id, "system-empty");
    service.bindSystem(project.id, "system-button-only");
    repository.pageModels.push({
      id: "page-payroll",
      projectId: "system-recruiting",
      route: "/payroll",
      name: "Payroll",
      version: 1,
      domSnapshotId: "dom-payroll",
      screenshotId: "shot-payroll",
      status: "succeeded",
      createdAt: now(),
      updatedAt: now()
    });
    repository.locatorPoints.push({
      id: "locator-payroll",
      pageModelId: "page-payroll",
      name: "Create Payroll",
      selector: "[data-testid=create-payroll]",
      role: "button",
      text: "Create Payroll",
      fallbackSelectors: ["text=Create Payroll"],
      confidence: 0.99
    });
    addSystemAssets(repository, "system-recruiting");
    repository.pageModels.push({
      id: "page-button-only",
      projectId: "system-button-only",
      route: "/recruiting/buttons",
      name: "Recruiting Buttons",
      version: 1,
      domSnapshotId: "dom-button-only",
      screenshotId: "shot-button-only",
      status: "succeeded",
      createdAt: now(),
      updatedAt: now()
    });
    repository.locatorPoints.push({
      id: "locator-button-only",
      pageModelId: "page-button-only",
      name: "Continue",
      selector: "[data-testid=continue]",
      role: "button",
      text: "Continue",
      fallbackSelectors: ["text=Continue"],
      confidence: 0.99
    });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("compile-system", "Users create a recruiting request.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);

    const compiled = service.compileExecutableCases(
      design.testIntents[0].id,
      "system-recruiting"
    );
    const blocked = service.compileExecutableCases(
      design.testIntents[0].id,
      "system-empty"
    );
    const fillRequirement = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("fill-system", "Users fill a recruiting form.")
    });
    const fillDesign = await service.generateTestDesign(fillRequirement.requirementSet.id);
    service.approveRequirementSet(fillRequirement.requirementSet.id);
    const roleMismatch = service.compileExecutableCases(
      fillDesign.testIntents[0].id,
      "system-button-only"
    );

    expect(compiled.executableCase).toEqual(
      expect.objectContaining({ systemId: "system-recruiting", status: "ready" })
    );
    expect(compiled.executableCase.steps.find((step) => step.action === "navigate")).toEqual(
      expect.objectContaining({
        pageModelId: "page-recruiting",
        sourceRefs: expect.arrayContaining(["page-model:page-recruiting"])
      })
    );
    expect(compiled.executableCase.steps.find((step) => step.action === "click")).toEqual(
      expect.objectContaining({
        locatorPointId: "locator-create",
        sourceRefs: expect.arrayContaining(["locator-point:locator-create"])
      })
    );
    expect(blocked.executableCase.status).toBe("blocked");
    expect(blocked.gaps).toEqual([
      expect.objectContaining({
        sourceType: "system-brain",
        reason: expect.stringContaining("page evidence")
      })
    ]);
    expect(roleMismatch.executableCase.status).toBe("blocked");
    expect(roleMismatch.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "system-brain",
          reason: expect.stringContaining("no locator evidence for fill")
        })
      ])
    );
  });
});

function workflowSteps(): ExecutableCaseStep[] {
  return [
    {
      id: "step-navigate",
      order: 1,
      action: "navigate",
      instruction: "Open the target module entry page",
      targetSemantic: "module entry",
      origin: "derived",
      sourceRefs: ["requirement:path"]
    },
    {
      id: "step-fill",
      order: 2,
      action: "fill",
      instruction: "Fill the recruiting request form",
      targetSemantic: "Request Name",
      origin: "source",
      sourceRefs: ["requirement:path"]
    },
    {
      id: "step-assert",
      order: 3,
      action: "assert",
      instruction: "Verify the request is ready",
      targetSemantic: "Request Name",
      expected: "The form accepts the request name",
      origin: "source",
      sourceRefs: ["requirement:path"]
    }
  ];
}

function workflowBrain(navigationEdges: SystemBrain["navigationEdges"]): SystemBrain {
  return {
    knowledgeProjectId: "knowledge-path",
    systemId: "system-path",
    pages: [
      page("page-dashboard", "Dashboard", "/", [
        locator("locator-recruiting", "Recruiting", "link")
      ]),
      page("page-recruiting", "Recruiting Requests", "/recruiting", [
        locator("locator-create-request", "Create Request", "link")
      ]),
      page("page-create", "Create Recruiting Request", "/recruiting/new", [
        locator("locator-request-name", "Request Name", "textbox")
      ])
    ],
    workflows: [],
    behaviorRules: [],
    apiFlows: [],
    navigationEdges,
    states: [],
    stateTransitions: [],
    observations: [],
    conflicts: [],
    readiness: {
      pageEvidence: true,
      locatorEvidence: true,
      workflowEvidence: false,
      apiEvidence: false,
      navigationEvidence: navigationEdges.length > 0,
      stateEvidence: false,
      readyForCompilation: true
    }
  };
}

function page(
  pageModelId: string,
  name: string,
  route: string,
  locators: SystemBrainPage["locators"]
): SystemBrainPage {
  return {
    pageModelId,
    name,
    route,
    version: 1,
    screenshotId: `shot-${pageModelId}`,
    locatorCount: locators.length,
    probeIssueCount: 0,
    locators,
    probeResultIds: [],
    sourceRefs: [`page-model:${pageModelId}`]
  };
}

function locator(id: string, name: string, role: string) {
  return {
    id,
    pageModelId:
      id.includes("request-name")
        ? "page-create"
        : id.includes("create-request")
          ? "page-recruiting"
          : id.includes("shortcut")
            ? "page-shortcut"
            : "page-dashboard",
    name,
    selector: `[data-testid=${id}]`,
    role,
    text: name,
    fallbackSelectors: [`text=${name}`],
    confidence: 0.99
  };
}

function edge(
  fromPageModelId: string,
  toPageModelId: string,
  text: string
): SystemBrain["navigationEdges"][number] {
  return {
    explorationId: "exploration-path",
    fromPageModelId,
    toPageModelId,
    fromUrl: `https://example.test/${fromPageModelId}`,
    toUrl: `https://example.test/${toPageModelId}`,
    text,
    sourceRefs: [
      `system-exploration:exploration-path`,
      `page-model:${fromPageModelId}`,
      `page-model:${toPageModelId}`,
      `system-navigation:exploration-path:${fromPageModelId}:${toPageModelId}:${text
        .replace(/\s+/g, "")
        .toLowerCase()}`
    ]
  };
}

function addWorkflowGraphAssets(
  repository: InMemoryBrainCreatorRepository,
  knowledgeProjectId: string,
  includeShortcut: boolean
) {
  const brain = workflowBrain([
    edge("page-dashboard", "page-recruiting", "Recruiting"),
    edge("page-recruiting", "page-create", "Create Request"),
    ...(includeShortcut
      ? [
          edge("page-dashboard", "page-shortcut", "Recruiting Shortcut"),
          edge("page-shortcut", "page-create", "Create From Shortcut")
        ]
      : [])
  ]);
  if (includeShortcut) {
    brain.pages.push(
      page("page-shortcut", "Recruiting Shortcut", "/shortcut", [
        locator("locator-shortcut-create", "Create From Shortcut", "link")
      ])
    );
  }
  const existingPageIds = new Set(repository.pageModels.map((item) => item.id));
  for (const brainPage of brain.pages.filter(
    (candidate) => !existingPageIds.has(candidate.pageModelId)
  )) {
    repository.pageModels.push({
      id: brainPage.pageModelId,
      projectId: "system-path",
      route: brainPage.route,
      name: brainPage.name,
      version: 1,
      domSnapshotId: `dom-${brainPage.pageModelId}`,
      screenshotId: brainPage.screenshotId,
      status: "succeeded",
      createdAt: now(),
      updatedAt: now()
    });
    repository.locatorPoints.push(...brainPage.locators);
  }
  repository.systemExplorations.push({
    id: includeShortcut ? "exploration-shortcut" : "exploration-path",
    knowledgeProjectId,
    systemId: "system-path",
    startUrl: "https://system-path.example.test/",
    status: "completed",
    interactionMode: "off",
    budget: {
      maxPages: 5,
      maxDepth: 2,
      maxDurationMs: 60_000,
      maxInteractionsPerPage: 0
    },
    pageModelIds: brain.pages.map((item) => item.pageModelId),
    navigationEdges: brain.navigationEdges.map((item) => ({
      fromUrl: item.fromUrl,
      toUrl: item.toUrl,
      text: item.text,
      fromPageModelId: item.fromPageModelId,
      toPageModelId: item.toPageModelId
    })),
    interactionTransitions: [],
    warnings: [],
    gapIds: [],
    artifactDir: ".brain-creator/system-explorations/workflow-path",
    createdAt: now(),
    updatedAt: now(),
    completedAt: now()
  });
}

function addSystem(repository: InMemoryBrainCreatorRepository, systemId: string) {
  repository.systemProfiles.push({
    id: systemId,
    name: systemId,
    environment: "test",
    baseUrl: `https://${systemId}.example.test`,
    defaultLocale: "en-US",
    urlAllowlist: [`https://${systemId}.example.test`],
    status: "succeeded",
    createdAt: now(),
    updatedAt: now()
  });
}

function addSystemAssets(repository: InMemoryBrainCreatorRepository, systemId: string) {
  repository.pageModels.push({
    id: "page-recruiting",
    projectId: systemId,
    route: "/recruiting/requests",
    name: "Recruiting Requests",
    version: 1,
    domSnapshotId: "dom-recruiting",
    screenshotId: "shot-recruiting",
    status: "succeeded",
    createdAt: now(),
    updatedAt: now()
  });
  repository.locatorPoints.push(
    {
      id: "locator-create",
      pageModelId: "page-recruiting",
      name: "Create Request",
      selector: "[data-testid=create-request]",
      role: "button",
      text: "Create Request",
      fallbackSelectors: ["text=Create Request"],
      confidence: 0.98
    },
    {
      id: "locator-type",
      pageModelId: "page-recruiting",
      name: "Employment Type",
      selector: "[data-testid=employment-type]",
      role: "combobox",
      text: "Employment Type",
      fallbackSelectors: ["text=Employment Type"],
      confidence: 0.97
    },
    {
      id: "locator-replacement",
      pageModelId: "page-recruiting",
      name: "Replacement Employee",
      selector: "[data-testid=replacement-employee]",
      role: "textbox",
      text: "Replacement Employee",
      fallbackSelectors: ["text=Replacement Employee"],
      confidence: 0.97
    }
  );
  repository.probeResults.push({
    id: "probe-recruiting",
    pageModelId: "page-recruiting",
    type: "browser-capture",
    result: "3 locator points found",
    issues: [],
    createdAt: now()
  });
  repository.trainingSessions.push({
    id: "session-recruiting",
    projectId: systemId,
    pageModelId: "page-recruiting",
    videoUrl: "artifacts/training.webm",
    traceUrl: "artifacts/training.zip",
    status: "succeeded",
    createdAt: now(),
    updatedAt: now()
  });
  repository.actionSteps.push({
    id: "action-select",
    sessionId: "session-recruiting",
    type: "select",
    targetLocatorId: "locator-type",
    inputValue: "Intern",
    assertion: "Replacement Employee becomes visible",
    order: 1
  });
  repository.apiFlows.push({
    id: "api-recruiting",
    sessionId: "session-recruiting",
    name: "Create recruiting request",
    requests: [{ method: "POST", url: "/api/recruiting/requests", status: 201 }],
    dependencies: [],
    assertions: ["POST /api/recruiting/requests 201"]
  });
}

function requirementPackage(contentHash: string, content: string): RequirementContentPackage {
  return {
    title: "Requirement",
    content,
    blocks: [{ type: "paragraph", text: content }],
    attachments: [],
    source: "requirements/requirement.md",
    sourceType: "local-file",
    contentHash,
    warnings: []
  };
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-system-"));
  tempDirs.push(dir);
  return dir;
}

function now() {
  return new Date().toISOString();
}
