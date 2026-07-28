// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { RequirementContentPackage } from "../domain/types.js";
import { KnowledgeService } from "./service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("System Brain", () => {
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
