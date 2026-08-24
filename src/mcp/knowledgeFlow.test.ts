// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExecutableCase,
  Gap,
  RequirementSet,
  TestIntent
} from "../domain/types.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

const tempDirs: string[] = [];

function structuredFailureReport() {
  return JSON.stringify({
    stats: { expected: 1, unexpected: 1, skipped: 0 },
    suites: [
      {
        specs: [
          {
            id: "requirement-mismatch",
            title: "requirement mismatch",
            tests: [{ results: [{ status: "failed" }] }]
          }
        ]
      }
    ]
  });
}

function structuredPassReport() {
  return JSON.stringify({
    stats: { expected: 1, unexpected: 0, skipped: 0 },
    suites: [{ specs: [{ id: "requirement-pass", title: "requirement pass", tests: [{ results: [{ status: "passed" }] }] }] }]
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Brain Creator requirement-first facade", () => {
  it("does not offer a ready executable case while its intent has an open test-data gap", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Data Gate",
      key: "data-gate",
      defaultLocale: "en-US"
    });
    const system = context.service.createSystemProfile({
      name: "Data Gate System",
      environment: "test",
      baseUrl: "https://data-gate.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://data-gate.example.test"]
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    const now = new Date().toISOString();
    const executableCase: ExecutableCase = {
      id: "executable-data-gate",
      knowledgeProjectId: project.id,
      requirementSetId: "requirement-data-gate",
      testIntentId: "intent-data-gate",
      systemId: system.id,
      title: "Create a record with an available reference",
      status: "ready",
      preconditions: [],
      steps: [],
      dataProfileIds: [],
      gapIds: [],
      createdAt: now,
      updatedAt: now
    };
    context.repository.executableCases.push(executableCase);
    context.repository.gaps.push({
      id: "gap-data-gate",
      projectId: project.id,
      sourceType: "test-data-plan",
      sourceId: executableCase.testIntentId,
      reason: "No available test reference exists.",
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: now,
      updatedAt: now
    });
    context.repository.persist();

    const preview = dataOf(await handleBrainCreatorTool(context, "bc_run", {
      mode: "requirement-suite",
      knowledgeProjectId: project.id,
      systemId: system.id,
      confirm: false
    }));

    expect(preview.status).toBe("preview");
    expect(preview.executableCases).toEqual([]);
  });

  it("runs bounded system exploration and exposes its progress through status and review", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json"),
      systemExplorer: {
        explore: vi.fn().mockResolvedValue({
          pages: [
            {
              depth: 0,
              evidence: {
                title: "Orders",
                finalUrl: "https://orders.example.test/orders",
                domText: "Create Order",
                screenshotPath: "evidence/orders.png",
                interactiveElements: [
                  {
                    name: "Create Order",
                    role: "link",
                    text: "Create Order",
                    selector: "[data-testid=create-order]"
                  }
                ],
                consoleErrors: [],
                networkFailures: [],
                issues: []
              },
              links: [
                {
                  text: "Create Order",
                  url: "https://orders.example.test/orders/new"
                }
              ]
            },
            {
              depth: 1,
              evidence: {
                title: "Create Order",
                finalUrl: "https://orders.example.test/orders/new",
                domText: "Order Name",
                screenshotPath: "evidence/order-new.png",
                interactiveElements: [
                  {
                    name: "Order Name",
                    role: "textbox",
                    text: "Order Name",
                    selector: "[name=orderName]"
                  }
                ],
                consoleErrors: [],
                networkFailures: [],
                issues: []
              },
              links: []
            }
          ],
          blockers: [],
          warnings: [],
          budgetExhausted: false
        })
      }
    });
    const project = await context.knowledgeService.createProject({
      name: "Exploration Knowledge",
      key: "exploration-knowledge",
      defaultLocale: "en-US"
    });
    const system = context.service.createSystemProfile({
      name: "Order Console",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"]
    });
    context.knowledgeService.bindSystem(project.id, system.id);

    const explored = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "explore-system",
        knowledgeProjectId: project.id,
        systemId: system.id,
        startUrl: "https://orders.example.test/orders",
        maxPages: 3,
        maxDepth: 1,
        maxDurationMs: 30_000,
        interactionMode: "safe",
        maxInteractionsPerPage: 2
      })
    );
    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );
    const review = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "system-exploration",
        knowledgeProjectId: project.id,
        id: explored.exploration.id
      })
    );

    expect(explored.exploration).toEqual(
      expect.objectContaining({
        status: "completed",
        interactionMode: "safe",
        budget: expect.objectContaining({ maxInteractionsPerPage: 2 })
      })
    );
    expect(explored.brain.navigationEdges).toHaveLength(1);
    expect(status.knowledge.explorations).toEqual(
      expect.objectContaining({
        total: 1,
        byStatus: { completed: 1 }
      })
    );
    expect(status.knowledge.systemBrains[0]).toEqual(
      expect.objectContaining({
        navigationEdges: 1,
        states: 0,
        stateTransitions: 0,
        latestExploration: expect.objectContaining({ status: "completed" })
      })
    );
    expect(review.items).toEqual([
      expect.objectContaining({ id: explored.exploration.id, status: "completed" })
    ]);
  });

  it("refreshes and reviews System Brain through facade tools", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "System Brain Facade",
      key: "system-brain-facade",
      defaultLocale: "en-US"
    });
    const system = context.service.createSystemProfile({
      name: "Order Console",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"]
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    const recordedPage = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "record-page-evidence",
        knowledgeProjectId: project.id,
        systemId: system.id,
        pageEvidence: {
          title: "Orders",
          finalUrl: "https://orders.example.test/orders",
          domText: "Create Order",
          screenshotPath: "evidence/orders.png",
          interactiveElements: [
            {
              name: "Create Order",
              role: "button",
              text: "Create Order",
              selector: "[data-testid=create-order]"
            }
          ],
          consoleErrors: [],
          networkFailures: [],
          issues: []
        }
      })
    );
    const rejectedTraining = await handleBrainCreatorTool(context, "bc_prepare", {
      action: "record-training-evidence",
      knowledgeProjectId: project.id,
      systemId: system.id,
      pageModelId: recordedPage.pageModel.id,
      trainingEvidence: {
        actions: [
          {
            type: "click",
            targetLocatorId: "locator-from-another-page",
            inputValue: "",
            assertion: "Order form opens"
          }
        ],
        apiRequests: []
      }
    });
    expect(rejectedTraining.isError).toBe(true);
    const recordedTraining = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "record-training-evidence",
        knowledgeProjectId: project.id,
        systemId: system.id,
        pageModelId: recordedPage.pageModel.id,
        trainingEvidence: {
          actions: [
            {
              type: "click",
              targetLocatorId: recordedPage.locatorPoints[0].id,
              inputValue: "",
              assertion: "Order form opens"
            }
          ],
          apiRequests: [{ method: "POST", url: "/api/orders", status: 201 }],
          artifacts: {
            videoUrl: "evidence/orders.webm",
            traceUrl: "evidence/orders.zip",
            harUrl: "evidence/orders.har",
            screenshotUrl: "evidence/orders-final.png"
          }
        }
      })
    );
    const updatedPage = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "record-page-evidence",
        knowledgeProjectId: project.id,
        systemId: system.id,
        pageEvidence: {
          title: "Orders Updated",
          finalUrl: "https://orders.example.test/orders",
          domText: "Create Order Save",
          screenshotPath: "evidence/orders-v2.png",
          interactiveElements: [
            {
              name: "Create Order",
              role: "button",
              text: "Create Order",
              selector: "[data-testid=create-order]"
            },
            {
              name: "Save",
              role: "button",
              text: "Save",
              selector: "[data-testid=save-order]"
            }
          ],
          consoleErrors: [],
          networkFailures: [],
          issues: []
        }
      })
    );
    const refreshed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "refresh-system-brain",
        knowledgeProjectId: project.id,
        systemId: system.id
      })
    );
    const reviewed = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "system-brain",
        knowledgeProjectId: project.id,
        systemId: system.id
      })
    );
    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );

    expect(recordedPage.brain.readiness.readyForCompilation).toBe(true);
    expect(recordedTraining.brain.readiness).toEqual(
      expect.objectContaining({ workflowEvidence: true, apiEvidence: true })
    );
    expect(updatedPage.pageModel.version).toBe(2);
    expect(refreshed.readiness.readyForCompilation).toBe(true);
    expect(reviewed.brain.pages).toHaveLength(1);
    expect(reviewed.brain.pages[0]).toEqual(
      expect.objectContaining({
        pageModelId: updatedPage.pageModel.id,
        version: 2,
        name: "Orders Updated"
      })
    );
    expect(reviewed.brain.workflows).toHaveLength(1);
    expect(reviewed.brain.behaviorRules).toHaveLength(1);
    expect(status.knowledge.systemBrains).toEqual([
      expect.objectContaining({
        systemId: system.id,
        readiness: expect.objectContaining({ readyForCompilation: true })
      })
    ]);

    const rejected = await handleBrainCreatorTool(context, "bc_prepare", {
      action: "record-page-evidence",
      knowledgeProjectId: project.id,
      systemId: system.id,
      pageEvidence: {
        title: "Foreign",
        finalUrl: "https://foreign.example.test/orders",
        domText: "Create Order",
        screenshotPath: "evidence/foreign.png",
        interactiveElements: [],
        consoleErrors: [],
        networkFailures: [],
        issues: []
      }
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]).toEqual(
      expect.objectContaining({ text: expect.stringContaining("outside the system URL allowlist") })
    );
    const prefixAttack = await handleBrainCreatorTool(context, "bc_prepare", {
      action: "record-page-evidence",
      knowledgeProjectId: project.id,
      systemId: system.id,
      pageEvidence: {
        title: "Prefix Attack",
        finalUrl: "https://orders.example.test.evil.com/orders",
        domText: "Create Order",
        screenshotPath: "evidence/prefix-attack.png",
        interactiveElements: [],
        consoleErrors: [],
        networkFailures: [],
        issues: []
      }
    });
    expect(prefixAttack.isError).toBe(true);
  });

  it("accepts visible-browser interaction evidence through the prepare facade", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Interaction Evidence",
      key: "interaction-evidence",
      defaultLocale: "en-US"
    });
    const system = context.service.createSystemProfile({
      name: "Order Console",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"]
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    const page = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "record-page-evidence",
        knowledgeProjectId: project.id,
        systemId: system.id,
        pageEvidence: {
          title: "Recruitment requirement",
          finalUrl: "https://orders.example.test/recruitmentRequirement/edit",
          domText: "Establishment Occupied",
          screenshotPath: "evidence/before.png",
          interactiveElements: [
            {
              name: "Establishment Occupied",
              role: "combobox",
              text: "No",
              selector: "[name=establishmentOccupied]"
            }
          ],
          consoleErrors: [],
          networkFailures: [],
          issues: []
        }
      })
    );
    const recorded = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "record-interaction-evidence",
        knowledgeProjectId: project.id,
        systemId: system.id,
        pageModelId: page.pageModel.id,
        interactionEvidence: {
          pageUrl: "https://orders.example.test/recruitmentRequirement/edit",
          targetName: "Establishment Occupied",
          targetRole: "combobox",
          targetSelector: "[name=establishmentOccupied]",
          targetKind: "select",
          action: "select",
          inputValue: "Yes",
          before: {
            id: "before",
            url: "https://orders.example.test/recruitmentRequirement/edit",
            visibleElements: ["Employee Type"],
            dialogs: [],
            controlValues: [{ name: "Establishment Occupied", value: "No" }]
          },
          after: {
            id: "after",
            url: "https://orders.example.test/recruitmentRequirement/edit",
            visibleElements: ["Employee Type", "Establishment ABC"],
            dialogs: [],
            controlValues: [{ name: "Establishment Occupied", value: "Yes" }]
          },
          visibleAdded: ["Establishment ABC"],
          visibleRemoved: [],
          dialogAdded: [],
          dialogRemoved: [],
          changedControls: [{ name: "Establishment Occupied", before: "No", after: "Yes" }],
          urlChanged: false,
          transitionKind: "state",
          blockedRequests: [],
          status: "observed",
          screenshotPath: "evidence/after.png",
          evidenceRefs: ["page-model:" + page.pageModel.id, "screenshot:before.png", "screenshot:after.png"]
        }
      })
    );

    expect(recorded.exploration.status).toBe("completed");
    expect(recorded.brain.readiness.stateEvidence).toBe(true);
    expect(recorded.brain.stateTransitions).toEqual([
      expect.objectContaining({ targetName: "Establishment Occupied", inputValue: "Yes" })
    ]);
  });

  it("recommends binding, System Brain exploration, evidence compilation, and execution in order", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Knowledge Next Action",
      key: "knowledge-next-action",
      defaultLocale: "en-US"
    });
    const ingested = await context.knowledgeService.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Customer Requirement",
        content: "Users create a customer record.",
        blocks: [{ type: "paragraph", text: "Users create a customer record." }],
        attachments: [],
        source: "requirements/customer.md",
        sourceType: "local-file",
        contentHash: "next-action",
        warnings: []
      }
    });
    const design = await context.knowledgeService.generateTestDesign(
      ingested.requirementSet.id
    );
    context.knowledgeService.approveRequirementSet(ingested.requirementSet.id);

    expect(
      dataOf(
        await handleBrainCreatorTool(context, "bc_status", {
          knowledgeProjectId: project.id
        })
      ).nextAction
    ).toBe("bind_system");

    const system = context.service.createSystemProfile({
      name: "Customer Console",
      environment: "test",
      baseUrl: "https://customers.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://customers.example.test"]
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    expect(
      dataOf(
        await handleBrainCreatorTool(context, "bc_status", {
          knowledgeProjectId: project.id
        })
      ).nextAction
    ).toBe("explore_system");

    const awaitingEvidence = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "compile-cases",
        testIntentId: design.testIntents[0].id,
        systemId: system.id
      })
    );
    expect(awaitingEvidence.executableCase.status).toBe("needs-exploration");
    const explorationTaskId = awaitingEvidence.executableCase.explorationTaskIds[0];
    const awaitingStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );
    expect(awaitingStatus.nextAction).toBe("review_exploration_task");
    expect(awaitingStatus.activeExplorationTaskId).toBe(explorationTaskId);
    expect(awaitingStatus.knowledge.compilation.explorationTasks).toEqual(
      expect.objectContaining({ total: 1, pending: 1 })
    );
    const summarizedStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id,
        responseMode: "summary"
      })
    );
    expect(summarizedStatus.summary.activeExplorationTaskId).toBe(explorationTaskId);

    context.repository.pageModels.push({
      id: "page-next-action",
      projectId: system.id,
      route: "/customers",
      name: "Customers",
      version: 1,
      domSnapshotId: "dom-next-action",
      screenshotId: "shot-next-action",
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    context.repository.locatorPoints.push({
      id: "locator-next-action",
      pageModelId: "page-next-action",
      name: "Create Customer",
      selector: "[data-testid=create-customer]",
      role: "button",
      text: "Create Customer",
      fallbackSelectors: ["text=Create Customer"],
      confidence: 0.98
    });
    await context.knowledgeService.refreshSystemBrain(project.id, system.id);
    const previewResolution = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "resolve-exploration-task",
        explorationTaskId,
        explorationOutcome: "resolved",
        evidenceRefs: ["page-model:page-next-action", "locator-point:locator-next-action"],
        confirm: false
      })
    );
    expect(previewResolution).toEqual(expect.objectContaining({
      status: "preview",
      requiresConfirmation: true
    }));
    const resumed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "resolve-exploration-task",
        explorationTaskId,
        explorationOutcome: "resolved",
        evidenceRefs: ["page-model:page-next-action", "locator-point:locator-next-action"],
        confirm: true
      })
    );
    expect(resumed.resumed.executableCase.status).toBe("ready");
    expect(resumed.nextAction).toBe("preview-requirement-suite");
    expect(
      dataOf(
        await handleBrainCreatorTool(context, "bc_status", {
          knowledgeProjectId: project.id
        })
      ).nextAction
    ).toBe("run_requirement_suite");

    const otherSystem = context.service.createSystemProfile({
      name: "Other Customer Console",
      environment: "test",
      baseUrl: "https://other-customers.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://other-customers.example.test"]
    });
    context.knowledgeService.bindSystem(project.id, otherSystem.id);
    const crossSystemRun = envelopeOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        systemId: otherSystem.id,
        confirm: true
      })
    );
    expect(crossSystemRun.success).toBe(false);
    expect(crossSystemRun.errors).toEqual([
      expect.stringContaining("compiled for another business system")
    ]);
  });

  it("exposes historical Requirement Eval accuracy through the review facade", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Eval Review",
      key: "eval-review",
      defaultLocale: "en-US"
    });

    const reviewed = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "requirement-eval-accuracy",
        knowledgeProjectId: project.id
      })
    );

    expect(reviewed).toEqual(
      expect.objectContaining({
        project,
        accuracy: expect.objectContaining({
          totalEvidence: 0,
          accuracyRate: null,
          methodology: expect.any(String)
        })
      })
    );
  });

  it("ingests, analyzes, approves, and compiles a local requirement through facade tools", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, ".brain-creator", "local-assets.json")
    });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Order Approval",
        key: "order-approval",
        defaultLocale: "en-US"
      })
    );
    const source = join(workDir, "requirement.md");
    await writeFile(
      source,
      "# Order Approval\n\nUsers create orders. Orders above 1000 require manager approval.",
      "utf8"
    );
    const ingested = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    const designed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "generate-test-design",
        requirementSetId: ingested.requirementSet.id
      })
    );
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-baseline",
      requirementSetId: ingested.requirementSet.id,
      confirm: true
    });
    const compiled = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "compile-cases",
        testIntentId: designed.testIntents[0].id
      })
    );
    const coveragePage = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "coverage",
        knowledgeProjectId: project.id,
        limit: 1,
        offset: 0
      })
    );

    expect(ingested.requirementSet.status).toBe("draft");
    expect(designed.evaluation.verdict).toBe("pass");
    expect(designed.analysis.clauses).toHaveLength(2);
    expect(designed.testIntents).toHaveLength(2);
    expect(designed.evaluation.coverage).toEqual(
      expect.objectContaining({ totalClauses: 2, coveredClauses: 2, coverageRate: 1 })
    );
    expect(compiled.executableCase.status).toBe("ready");
    expect(compiled.workflowPath).toBeUndefined();
    expect(compiled.stateActions).toBeUndefined();
    expect(compiled.nextAction).toBe("preview-requirement-suite");
    expect(coveragePage.executionLedger.items).toHaveLength(1);
    expect(coveragePage.executionLedger.totalItems).toBe(2);
    expect(coveragePage.requirementCoverageProfiles).toEqual([
      expect.objectContaining({ requirementSetId: ingested.requirementSet.id, status: "complete" })
    ]);
    expect(coveragePage.processModels).toEqual({ workflows: [], stateMachines: [] });
    expect(coveragePage.itemPage).toEqual({
      limit: 1,
      offset: 0,
      total: 2,
      nextOffset: 1
    });
  });

  it("surfaces and resolves a test data plan through the prepare facade", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Customer Data",
        key: "customer-data-facade"
      })
    );
    const source = join(workDir, "customer-data.md");
    await writeFile(source, "# Customer\n\nFill Customer form.", "utf8");
    const ingested = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    const designed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "generate-test-design",
        requirementSetId: ingested.requirementSet.id
      })
    );
    const pendingActionIds = designed.evaluationGate.actions
      .filter((action: { status: string }) => action.status === "pending")
      .map((action: { id: string }) => action.id);
    if (pendingActionIds.length > 0) {
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "confirm-eval-actions",
        requirementSetId: ingested.requirementSet.id,
        actionIds: pendingActionIds,
        confirmationNote: "The customer data requirement is confirmed.",
        confirm: true
      });
    }
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-baseline",
      requirementSetId: ingested.requirementSet.id,
      confirm: true
    });
    const profile = designed.dataProfiles[0];
    const selectedIntent = designed.testIntents.find(
      (intent: { requirementRefs: string[] }) =>
        profile.sourceRefs.some((sourceRef: string) =>
          intent.requirementRefs.includes(sourceRef)
        )
    );
    expect(selectedIntent).toBeDefined();
    if (!selectedIntent) throw new Error("Related TestIntent was not generated");
    const storedProfile = context.repository.testDataProfiles.find(
      (item) => item.id === profile.id
    );
    if (!storedProfile) throw new Error("TestDataProfile was not persisted");
    storedProfile.field = "Customer";
    storedProfile.strategy = "existing-reference";
    storedProfile.seed = "status=active";

    const compiled = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "compile-cases",
        testIntentId: selectedIntent.id
      })
    );
    const blockedStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );
    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "resolve-test-data",
        executableCaseId: compiled.executableCase.id,
        confirm: false
      })
    );

    expect(compiled.executableCase.status).toBe("needs-data");
    expect(compiled.testDataPlan).toEqual(
      expect.objectContaining({ verdict: "blocked" })
    );
    expect(compiled.nextAction).toBe("resolve-test-data");
    expect(blockedStatus.nextAction).toBe("resolve_test_data");
    expect(preview).toEqual(
      expect.objectContaining({
        status: "preview",
        requiresConfirmation: true
      })
    );

    const resolved = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "resolve-test-data",
        executableCaseId: compiled.executableCase.id,
        testDataResolutions: [
          {
            profileId: profile.id,
            decision: "reuse",
            reference: "customer:42",
            value: "Existing Customer"
          }
        ],
        confirm: true
      })
    );
    const readyStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );

    expect(resolved.executableCase).toEqual(
      expect.objectContaining({
        status: "ready",
        dataPlan: expect.objectContaining({ verdict: "ready" })
      })
    );
    expect(readyStatus.nextAction).toBe("bind_system");
  });

  it("requires a separate Facade confirmation for Requirement Eval actions", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Approval Workflow",
        key: "approval-workflow"
      })
    );
    const source = join(workDir, "approval.md");
    await writeFile(
      source,
      "# Approval\n\nWhen the manager approves, status changes from draft to approved.",
      "utf8"
    );
    const ingested = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    const designed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "generate-test-design",
        requirementSetId: ingested.requirementSet.id
      })
    );
    const pendingStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );
    const rejectedApproval = envelopeOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "approve-baseline",
        requirementSetId: ingested.requirementSet.id,
        confirm: true
      })
    );
    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "confirm-eval-actions",
        requirementSetId: ingested.requirementSet.id,
        actionIds: [designed.evaluationGate.actions[0].id],
        confirmationNote: "The alternate path keeps the draft status.",
        confirm: false
      })
    );
    const confirmed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "confirm-eval-actions",
        requirementSetId: ingested.requirementSet.id,
        actionIds: [designed.evaluationGate.actions[0].id],
        confirmationNote: "The alternate path keeps the draft status.",
        confirm: true
      })
    );
    const approved = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "approve-baseline",
        requirementSetId: ingested.requirementSet.id,
        confirm: true
      })
    );

    expect(rejectedApproval.success).toBe(false);
    expect(rejectedApproval.errors).toEqual([expect.stringContaining("Eval actions")]);
    expect(pendingStatus.nextAction).toBe("confirm_requirement_eval");
    expect(pendingStatus.knowledge.evaluationGates).toEqual(
      expect.objectContaining({ pendingActions: 1, blockedActions: 0 })
    );
    expect(preview).toEqual(
      expect.objectContaining({ status: "preview", requiresConfirmation: true })
    );
    expect(confirmed.evaluationGate.status).toBe("confirmed");
    expect(approved.status).toBe("approved");
  });

  it("prepares and submits test data through the requirement Facade", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const system = context.service.createSystemProfile({
      name: "Customer Portal",
      environment: "test",
      baseUrl: "https://customer.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://customer.example.test"]
    });
    const project = await context.knowledgeService.createProject({
      name: "Customer Knowledge",
      key: "customer-provider-facade",
      defaultLocale: "en-US"
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    const now = new Date(0).toISOString();
    const intent: TestIntent = {
      id: "intent-provider-facade",
      knowledgeProjectId: project.id,
      requirementSetId: "requirement-provider-facade",
      title: "Use an active customer",
      module: "Customer",
      priority: "P1",
      objective: "Use an existing active customer.",
      preconditions: [],
      expectedResults: ["The customer is accepted."],
      requirementRefs: ["requirement:customer"],
      knowledgeNodeRefs: [],
      techniques: ["scenario"],
      status: "blocked",
      createdAt: now,
      updatedAt: now
    };
    const requirementSet: RequirementSet = {
      id: intent.requirementSetId,
      knowledgeProjectId: project.id,
      sourceId: "source-provider-facade",
      version: 1,
      title: "Customer reference",
      summary: "Use an active customer.",
      contentHash: "customer-provider-v1",
      status: "approved",
      affectedNodeIds: [],
      approvedAt: now,
      createdAt: now,
      updatedAt: now
    };
    const gap: Gap = {
      id: "gap-provider-facade",
      projectId: project.id,
      sourceType: "test-data-plan",
      sourceId: "executable-provider-facade",
      reason: "Customer reference needs lookup.",
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: now,
      updatedAt: now
    };
    const executableCase: ExecutableCase = {
      id: "executable-provider-facade",
      knowledgeProjectId: project.id,
      requirementSetId: intent.requirementSetId,
      testIntentId: intent.id,
      systemId: system.id,
      title: intent.title,
      status: "blocked",
      preconditions: [],
      steps: [{
        id: "step-provider-facade",
        order: 1,
        action: "select",
        instruction: "Select Customer",
        targetSemantic: "Customer",
        dataProfileId: "profile-provider-facade",
        origin: "source",
        sourceRefs: ["requirement:customer"]
      }],
      dataProfileIds: ["profile-provider-facade"],
      dataPlan: {
        verdict: "blocked",
        reasons: ["Customer reference needs lookup."],
        operations: [{
          profileId: "profile-provider-facade",
          field: "Customer",
          strategy: "existing-reference",
          decision: "lookup",
          status: "needs-resolution",
          lookupQuery: "status=active",
          dependsOnProfileIds: [],
          cleanup: "delete-created",
          constraints: ["status must be active"],
          sourceRefs: ["requirement:customer"]
        }],
        dependencyOrder: ["profile-provider-facade"],
        requiresConfirmation: true,
        requiresCleanup: false,
        sourceRefs: ["requirement:customer"]
      },
      gapIds: [gap.id],
      createdAt: now,
      updatedAt: now
    };
    context.repository.testIntents.push(intent);
    context.repository.requirementSets.push(requirementSet);
    context.repository.gaps.push(gap);
    context.repository.executableCases.push(executableCase);
    context.repository.persist();

    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "prepare-test-data",
        knowledgeProjectId: project.id,
        systemId: system.id,
        executableCaseId: executableCase.id,
        confirm: false
      })
    );
    const prepared = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "prepare-test-data",
        knowledgeProjectId: project.id,
        systemId: system.id,
        executableCaseId: executableCase.id,
        confirm: true,
        allowCreate: true
      })
    );
    const pendingStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );

    expect(preview.status).toBe("preview");
    expect(prepared.task).toEqual(
      expect.objectContaining({
        action: "lookup-or-create",
        status: "pending",
        allowCreate: true
      })
    );
    expect(pendingStatus.nextAction).toBe("complete_test_data_task");

    const submitted = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "submit-test-data",
        taskId: prepared.task.id,
        taskStatus: "succeeded",
        dataDecision: "create",
        dataReference: "customer:new-42",
        dataValue: "New Customer",
        sourceRefs: ["api:customers/new-42"]
      })
    );

    expect(submitted.executableCase).toEqual(
      expect.objectContaining({
        status: "ready",
        dataPlan: expect.objectContaining({ verdict: "ready" })
      })
    );
    expect(submitted.lease).toEqual(
      expect.objectContaining({ decision: "create", status: "active" })
    );
    const resolvedStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );
    expect(resolvedStatus.knowledge.testData.leases).toEqual(
      expect.objectContaining({ total: 1, byStatus: { active: 1 } })
    );

    const executionPreview = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "prepare-execution",
        knowledgeProjectId: project.id,
        systemId: system.id,
        executableCaseId: executableCase.id,
        confirm: false
      })
    );
    const executionConfirmed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "prepare-execution",
        knowledgeProjectId: project.id,
        systemId: system.id,
        executableCaseId: executableCase.id,
        confirm: true
      })
    );
    const reviewed = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "execution-plan",
        knowledgeProjectId: project.id,
        id: executionConfirmed.executionPlan.id
      })
    );

    expect(executionPreview).toEqual(
      expect.objectContaining({
        status: "preview",
        draft: expect.objectContaining({ verdict: "needs-confirmation" })
      })
    );
    expect(executionConfirmed).toEqual(
      expect.objectContaining({
        status: "ready",
        persisted: true,
        executionPlan: expect.objectContaining({
          systemId: system.id,
          dataBindings: [
            expect.objectContaining({ leaseId: submitted.lease.id })
          ]
        })
      })
    );
    expect(reviewed.items).toEqual([
      expect.objectContaining({ id: executionConfirmed.executionPlan.id })
    ]);

    const storedTask = context.repository.testDataTasks.find(
      (item) => item.id === prepared.task.id
    )!;
    storedTask.status = "pending";
    const testCaseCount = context.repository.testCases.length;
    const agentTaskCount = context.repository.agentTasks.length;
    const evidenceCount = context.repository.executionEvidence.length;
    const blockedRun = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        systemId: system.id,
        executableCaseId: executableCase.id,
        confirm: true
      })
    );
    expect(blockedRun).toEqual(
      expect.objectContaining({
        status: "blocked",
        executionPreflight: expect.objectContaining({
          status: "blocked",
          draft: expect.objectContaining({
            checks: expect.arrayContaining([
              expect.objectContaining({
                id: "test-data-tasks",
                status: "blocked"
              })
            ])
          })
        })
      })
    );
    expect(context.repository.testCases).toHaveLength(testCaseCount);
    expect(context.repository.agentTasks).toHaveLength(agentTaskCount);
    expect(context.repository.executionEvidence).toHaveLength(evidenceCount);
    storedTask.status = "submitted";
  });

  it("does not let a superseded blocked Eval gate poison the revised baseline status", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Inventory",
        key: "inventory-revision"
      })
    );
    const source = join(workDir, "inventory.md");
    await writeFile(
      source,
      "# Inventory\n\nThe stock field is visible. The stock field is not visible.",
      "utf8"
    );
    const first = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-test-design",
      requirementSetId: first.requirementSet.id
    });

    await writeFile(source, "# Inventory\n\nThe stock field is visible.", "utf8");
    const revised = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "refresh-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "generate-test-design",
      requirementSetId: revised.requirementSet.id
    });
    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );

    expect(
      context.repository.requirementSets.find((item) => item.id === first.requirementSet.id)?.status
    ).toBe("superseded");
    expect(revised.requirementSet.status).toBe("draft");
    expect(status.knowledge.evaluationGates.blockedActions).toBe(0);
    expect(status.nextAction).toBe("review_and_approve_baseline");
  });

  it("previews Feishu host connector work without persisting a false requirement revision", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "CRM",
        key: "crm"
      })
    );

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source: "https://example.feishu.cn/wiki/abc123"
      })
    );

    expect(result.status).toBe("needs-host-connector");
    expect(context.repository.requirementSets).toHaveLength(0);
  });

  it("ingests direct Feishu content and records connector failures as gaps", async () => {
    const workDir = await tempDir();
    const source = "https://example.feishu.cn/docx/abc123";
    const directContext = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "direct-assets.json"),
      feishuReader: {
        readRequirement: async () => ({
          title: "Direct Feishu",
          content: "Users submit requests.",
          blocks: [{ type: "paragraph", text: "Users submit requests." }],
          attachments: [],
          source,
          sourceType: "feishu",
          contentHash: "direct-hash",
          warnings: []
        })
      }
    });
    const project = dataOf(
      await handleBrainCreatorTool(directContext, "bc_configure", {
        target: "knowledge-project",
        name: "Direct",
        key: "direct"
      })
    );

    const ingested = dataOf(
      await handleBrainCreatorTool(directContext, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    expect(ingested.status).toBe("draft-created");

    const failureDir = await tempDir();
    const failureContext = createBrainCreatorMcpContext({
      workDir: failureDir,
      dataFilePath: join(failureDir, "failure-assets.json"),
      feishuReader: { readRequirement: async () => { throw new Error("permission denied"); } }
    });
    const failureProject = dataOf(
      await handleBrainCreatorTool(failureContext, "bc_configure", {
        target: "knowledge-project",
        name: "Failure",
        key: "failure"
      })
    );
    const failed = dataOf(
      await handleBrainCreatorTool(failureContext, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: failureProject.id,
        source
      })
    );

    expect(failed.status).toBe("connector-error");
    expect(failed.gap.status).toBe("open");
    expect(failureContext.repository.requirementSets).toHaveLength(0);
  });

  it("uses bc_prepare for host visual analysis without creating a premature Gap", async () => {
    const workDir = await tempDir();
    const imagePath = join(workDir, "approval-flow.png");
    await writeFile(imagePath, Buffer.from("image"));
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const project = dataOf(await handleBrainCreatorTool(context, "bc_configure", {
      target: "knowledge-project", name: "Approval", key: "approval"
    }));
    const source = join(workDir, "requirement.md");
    const ingested = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "ingest-requirement",
      knowledgeProjectId: project.id,
      source,
      contentPackage: {
        title: "Approval",
        content: "Managers approve orders.",
        blocks: [{ type: "paragraph", text: "Managers approve orders." }],
        attachments: [{ name: "approval-flow.png", url: imagePath }],
        source,
        sourceType: "local-file",
        contentHash: "approval-attachment",
        warnings: []
      }
    }));

    const prepared = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "analyze-attachments",
      requirementSourceId: ingested.source.id
    }));
    expect(ingested.nextAction).toBe("analyze-attachments");
    expect(prepared.status).toBe("needs-host-vision");
    expect(prepared.recognitionRequests).toHaveLength(1);
    expect(context.repository.gaps).toEqual([]);

    const submitted = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "submit-attachment-analysis",
      requirementSourceId: ingested.source.id,
      attachmentId: prepared.recognitionRequests[0].attachmentId,
      attachmentAnalysis: {
        kind: "state-machine",
        markdown: "Draft -> Approved",
        nodes: [
          { id: "draft", type: "state", label: "Draft" },
          { id: "approved", type: "state", label: "Approved" }
        ],
        edges: [{ from: "draft", to: "approved", actor: "manager" }],
        confidence: 0.9
      }
    }));
    expect(submitted.analysis.status).toBe("draft");

    const preview = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "confirm-attachment-analysis",
      attachmentAnalysisId: submitted.analysis.id
    }));
    expect(preview.requiresConfirmation).toBe(true);

    const confirmed = dataOf(await handleBrainCreatorTool(context, "bc_prepare", {
      action: "confirm-attachment-analysis",
      attachmentAnalysisId: submitted.analysis.id,
      confirmedBy: "qa",
      confirm: true
    }));
    expect(confirmed.status).toBe("confirmed");
  });

  it("adds knowledge status and review without requiring a bound runtime system", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Contracts",
        key: "contracts"
      })
    );

    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", { knowledgeProjectId: project.id })
    );
    const review = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "knowledge",
        knowledgeProjectId: project.id
      })
    );

    expect(status.knowledge.project.id).toBe(project.id);
    expect(status.nextAction).toBe("ingest_requirement");
    expect(review.project.id).toBe(project.id);
  });

  it("requests host Skill output instead of labeling built-in analysis as host-skill", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Inventory",
        key: "inventory"
      })
    );
    const source = join(workDir, "inventory.md");
    await writeFile(source, "# Inventory\n\nUsers create stock adjustments.", "utf8");
    const ingested = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "generate-analysis",
        requirementSetId: ingested.requirementSet.id,
        provider: "host-skill"
      })
    );

    expect(result.status).toBe("needs-host-skill");
    expect(context.repository.knowledgeNodes).toHaveLength(0);
  });

  it("previews requirement execution and refuses confirmation before system binding", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({ workDir, dataFilePath: join(workDir, "assets.json") });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Payments",
        key: "payments"
      })
    );
    const source = join(workDir, "payment.md");
    await writeFile(source, "# Payment\n\nUsers submit a payment form.", "utf8");
    const ingested = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    const designed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "generate-test-design",
        requirementSetId: ingested.requirementSet.id
      })
    );
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-baseline",
      requirementSetId: ingested.requirementSet.id,
      confirm: true
    });
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "compile-cases",
      testIntentId: designed.testIntents[0].id
    });

    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        confirm: false
      })
    );
    const confirmed = envelopeOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        confirm: true
      })
    );

    expect(preview).toEqual(expect.objectContaining({ status: "preview", boundSystemIds: [] }));
    expect(confirmed.success).toBe(false);
    expect(confirmed.errors).toEqual([expect.stringContaining("bound")]);
  });

  it("injects a traceable ContextPack and evidence contract into host-agent generation", async () => {
    const workDir = await tempDir();
    const bridge = Object.assign(
      async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      { provider: "host-agent", preflight: async () => ({ ok: true }) }
    );
    let testRunCount = 0;
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json"),
      agentBridge: bridge,
      runner: async () =>
        ++testRunCount === 1
          ? {
              exitCode: 1,
              stdout: structuredFailureReport(),
              stderr: [
                "Error: expect(received).toBe(expected)",
                "Expected: \"approved\"",
                "Received: \"draft\""
              ].join("\n")
            }
          : { exitCode: 0, stdout: structuredPassReport(), stderr: "" }
    });
    const project = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "knowledge-project",
        name: "Orders",
        key: "orders-context"
      })
    );
    const source = join(workDir, "orders.md");
    await writeFile(source, "# Orders\n\nUsers create an order form and managers approve it.", "utf8");
    const ingested = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "ingest-requirement",
        knowledgeProjectId: project.id,
        source
      })
    );
    const designed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "generate-test-design",
        requirementSetId: ingested.requirementSet.id
      })
    );
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "approve-baseline",
      requirementSetId: ingested.requirementSet.id,
      confirm: true
    });
    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "compile-cases",
      testIntentId: designed.testIntents[0].id
    });
    const system = dataOf(
      await handleBrainCreatorTool(context, "bc_configure", {
        target: "system",
        name: "Orders Test",
        environment: "test",
        baseUrl: "https://orders.example.test",
        urlAllowlist: ["https://orders.example.test"]
      })
    );
    await handleBrainCreatorTool(context, "bc_configure", {
      target: "system-binding",
      knowledgeProjectId: project.id,
      systemId: system.id
    });
    await handleBrainCreatorTool(context, "bc_configure", {
      target: "auth",
      systemId: system.id,
      env: "test",
      role: "manager",
      loginMethod: "token",
      secrets: { token: "secret-token" }
    });

    const primaryCase = context.repository.executableCases[0];
    const blockedCase = {
      ...JSON.parse(JSON.stringify(primaryCase)),
      id: "executable-orders-blocked",
      title: "Blocked sibling scenario",
      gapIds: ["gap-orders-blocked"]
    };
    context.repository.executableCases.push(blockedCase);
    context.repository.gaps.push({
      id: "gap-orders-blocked",
      projectId: project.id,
      sourceType: "execution-preflight-test",
      sourceId: blockedCase.id,
      reason: "A sibling scenario still lacks execution evidence.",
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const testCaseCount = context.repository.testCases.length;
    const agentTaskCount = context.repository.agentTasks.length;
    const evidenceCount = context.repository.executionEvidence.length;
    const batchBlocked = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        systemId: system.id,
        confirm: true,
        maxHealAttempts: 0
      })
    );

    expect(batchBlocked).toEqual(
      expect.objectContaining({
        status: "blocked",
        executionPreflights: expect.arrayContaining([
          expect.objectContaining({
            executableCaseId: blockedCase.id,
            status: "blocked"
          })
        ])
      })
    );
    expect(context.repository.testCases).toHaveLength(testCaseCount);
    expect(context.repository.agentTasks).toHaveLength(agentTaskCount);
    expect(context.repository.executionEvidence).toHaveLength(evidenceCount);
    context.repository.gaps.find(
      (gap) => gap.id === "gap-orders-blocked"
    )!.status = "resolved";
    blockedCase.status = "ready";

    const result = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        systemId: system.id,
        confirm: true,
        maxHealAttempts: 0
      })
    );
    const spec = await readFile(result.specPath, "utf8");
    const taskContext = JSON.parse(await readFile(result.contextPath, "utf8"));

    expect(result.status).toBe("needs_agent_execution");
    expect(spec).toContain("Brain Creator Knowledge Context");
    expect(spec).toContain("Executable Step Traceability");
    expect(spec).toContain("Execution Plan");
    expect(spec).toContain("Evidence Contract");
    expect(result.executionPlan).toEqual(
      expect.objectContaining({ verdict: "ready", systemId: system.id })
    );
    expect(taskContext.chainContext.executionPlanId).toBe(
      result.executionPlan.id
    );
    expect(taskContext.chainContext.executionEvidenceId).toBe(result.executionEvidence.id);
    expect(context.repository.executionEvidence).toEqual([
      expect.objectContaining({
        status: "running",
        executionPlanId: result.executionPlan.id,
        contextPackPath: result.contextPackPath
      })
    ]);

    const executableCase = context.repository.executableCases.find(
      (item) => item.id === result.executableCaseId
    )!;
    const originalInstruction = executableCase.steps[0].instruction;
    const agentRunCount = context.repository.agentRuns.length;
    executableCase.steps[0].instruction = "Use a changed mutable instruction";
    const staleSubmission = envelopeOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: result.task.id,
        status: "succeeded",
        stdout: "generator output created",
        stderr: "",
        outputPaths: [result.testPath]
      })
    );

    expect(staleSubmission.success).toBe(false);
    expect(staleSubmission.errors).toEqual([
      expect.stringContaining("Execution plan is stale")
    ]);
    expect(result.task.status).toBe("pending");
    expect(context.repository.agentRuns).toHaveLength(agentRunCount);
    executableCase.steps[0].instruction = originalInstruction;

    await writeFile(
      result.testPath,
      [
        `import { test, expect } from "../${basename(result.seedPath)}";`,
        ...result.executionPlan.steps
          .filter((step: { action: string }) => step.action !== "api")
          .map(
            (step: { id: string }) =>
              `await bc.step(${JSON.stringify(step.id)}, page, action);`
          ),
        'test("requirement mismatch", async () => { expect("draft").toBe("approved"); });'
      ].join("\n"),
      "utf8"
    );
    const completed = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: result.task.id,
        status: "succeeded",
        stdout: "generator output created",
        stderr: "",
        outputPaths: [result.testPath]
      })
    );
    expect(completed.submittedCase.chainRun.status).toBe("failed");
    expect(completed.status).toBe("needs_agent_execution");
    expect(completed.requirementSuiteRun).toEqual(
      expect.objectContaining({
        status: "waiting-for-agent",
        total: 2,
        passed: 0,
        failed: 1,
        blocked: 0,
        currentExecutableCaseId: blockedCase.id
      })
    );
    expect(context.repository.bugReports).toEqual([
      expect.objectContaining({ sourceId: result.executableCaseId, status: "open" })
    ]);
    expect(context.repository.executionDiagnoses).toEqual([
      expect.objectContaining({
        requirementSuiteRunId: completed.requirementSuiteRun.id,
        executableCaseId: result.executableCaseId,
        verdict: "product_bug",
        failureType: "assertion_failure",
        retry: expect.objectContaining({ attempted: 0, max: 0, exhausted: true })
      })
    ]);
    expect(completed.submittedCase.executionDiagnosis).toEqual(
      expect.objectContaining({
        id: context.repository.executionDiagnoses[0].id,
        verdict: "product_bug"
      })
    );
    expect(
      context.repository.runLedgerEntries.find(
        (entry) => entry.event === "failure-diagnosed"
      )
    ).toEqual(
      expect.objectContaining({
        failureType: "assertion_failure",
        references: expect.objectContaining({
          diagnosisId: context.repository.executionDiagnoses[0].id
        })
      })
    );
    expect(context.repository.gaps.filter((gap) => gap.projectId === system.id)).toHaveLength(0);
    const runningStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );
    const reviewedRun = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "requirement-suite-run",
        knowledgeProjectId: project.id,
        id: completed.requirementSuiteRun.id
      })
    );
    const reviewedDiagnosis = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "execution-diagnosis",
        knowledgeProjectId: project.id,
        id: context.repository.executionDiagnoses[0].id
      })
    );
    const repeated = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        systemId: system.id,
        confirm: true,
        maxHealAttempts: 0
      })
    );

    expect(runningStatus.nextAction).toBe(
      "complete_requirement_suite_agent_task"
    );
    expect(runningStatus.knowledge.requirementSuiteRuns.active.id).toBe(
      completed.requirementSuiteRun.id
    );
    expect(runningStatus.knowledge.executionDiagnoses).toEqual(
      expect.objectContaining({
        total: 1,
        byVerdict: { product_bug: 1 },
        byFailureType: { assertion_failure: 1 }
      })
    );
    expect(reviewedRun.items).toEqual([
      expect.objectContaining({
        id: completed.requirementSuiteRun.id,
        reconciliation: expect.objectContaining({
          systemId: system.id,
          requirementSetIds: [ingested.requirementSet.id]
        })
      })
    ]);
    expect(reviewedDiagnosis).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          total: 1,
          byVerdict: { product_bug: 1 }
        }),
        items: [
          expect.objectContaining({
            id: context.repository.executionDiagnoses[0].id,
            verdict: "product_bug"
          })
        ]
      })
    );
    expect(repeated.task.id).toBe(completed.task.id);
    expect(context.repository.requirementSuiteRuns).toHaveLength(1);

    await writeFile(
      completed.testPath,
      [
        `import { test, expect } from "../${basename(completed.seedPath)}";`,
        ...(completed.task.chainContext?.requiredStepIds ?? []).map(
          (stepId: string) => `await bc.step(${JSON.stringify(stepId)}, page, action);`
        ),
        'test("sibling scenario", async () => { expect("approved").toBe("approved"); });'
      ].join("\n"),
      "utf8"
    );
    const finalized = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: completed.task.id,
        status: "succeeded",
        stdout: "generator output created",
        stderr: "",
        outputPaths: [completed.testPath]
      })
    );

    expect(finalized.status).toBe("failed");
    expect(finalized.requirementSuiteRun).toEqual(
      expect.objectContaining({
        status: "failed",
        total: 2,
        passed: 1,
        failed: 1,
        blocked: 0
      })
    );
    expect(finalized.requirementSuiteRun).not.toHaveProperty(
      "currentExecutableCaseId"
    );
    expect(context.repository.executionEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          chainRunId: completed.submittedCase.chainRun.id
        }),
        expect.objectContaining({
          status: "passed",
          chainRunId: finalized.chainRun.id
        })
      ])
    );
  });

  it("prepares and cleans created test data inside a requirement suite", async () => {
    const workDir = await tempDir();
    const bridge = Object.assign(
      async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      { provider: "host-agent", preflight: async () => ({ ok: true }) }
    );
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json"),
      agentBridge: bridge,
      runner: async () => ({
        exitCode: 0,
        stdout: structuredPassReport(),
        stderr: ""
      })
    });
    const now = new Date().toISOString();
    context.repository.knowledgeProjects.push({
      id: "knowledge-data-suite",
      name: "Orders",
      key: "orders-data-suite",
      defaultLocale: "zh-CN",
      status: "active",
      systemIds: ["system-data-suite"],
      createdAt: now,
      updatedAt: now
    });
    context.repository.systemProfiles.push({
      id: "system-data-suite",
      name: "Orders Test",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://orders.example.test"],
      status: "succeeded",
      createdAt: now,
      updatedAt: now
    });
    context.repository.authProfiles.push({
      id: "auth-data-suite",
      projectId: "system-data-suite",
      env: "test",
      role: "qa",
      loginMethod: "token",
      encryptedSecrets: { token: "encrypted" },
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
      lastVerifiedAt: now
    });
    context.repository.requirementSets.push({
      id: "requirement-data-suite",
      knowledgeProjectId: "knowledge-data-suite",
      sourceId: "source-data-suite",
      version: 1,
      title: "Create order",
      summary: "Create an order for an existing or new customer.",
      contentHash: "a".repeat(64),
      status: "approved",
      affectedNodeIds: [],
      approvedAt: now,
      createdAt: now,
      updatedAt: now
    });
    context.repository.testIntents.push({
      id: "intent-data-suite",
      knowledgeProjectId: "knowledge-data-suite",
      requirementSetId: "requirement-data-suite",
      title: "Create order with customer",
      module: "Orders",
      priority: "P0",
      objective: "Create an order with a customer reference.",
      preconditions: [],
      expectedResults: ["Order is created"],
      requirementRefs: ["requirement:order-customer"],
      knowledgeNodeRefs: [],
      techniques: ["scenario"],
      status: "blocked",
      createdAt: now,
      updatedAt: now
    });
    context.repository.executableCases.push({
      id: "executable-data-suite",
      knowledgeProjectId: "knowledge-data-suite",
      requirementSetId: "requirement-data-suite",
      testIntentId: "intent-data-suite",
      systemId: "system-data-suite",
      title: "Create order with customer",
      status: "blocked",
      preconditions: [],
      steps: [
        {
          id: "step-data-suite",
          order: 1,
          action: "fill",
          instruction: "Fill the customer field",
          targetSemantic: "Customer",
          dataProfileId: "profile-data-suite",
          origin: "source",
          sourceRefs: ["requirement:order-customer"]
        }
      ],
      dataPlan: {
        verdict: "blocked",
        reasons: [
          "Test data for Customer requires an explicit reuse or create decision"
        ],
        operations: [
          {
            profileId: "profile-data-suite",
            field: "Customer",
            strategy: "existing-reference",
            decision: "lookup",
            status: "needs-resolution",
            lookupQuery: "status=active",
            dependsOnProfileIds: [],
            cleanup: "delete-created",
            constraints: [],
            reason:
              "Test data for Customer requires an explicit reuse or create decision",
            sourceRefs: ["requirement:order-customer"]
          }
        ],
        dependencyOrder: ["profile-data-suite"],
        requiresConfirmation: false,
        requiresCleanup: false,
        sourceRefs: ["requirement:order-customer"]
      },
      dataProfileIds: ["profile-data-suite"],
      gapIds: ["gap-data-suite"],
      createdAt: now,
      updatedAt: now
    });
    context.repository.gaps.push({
      id: "gap-data-suite",
      projectId: "knowledge-data-suite",
      sourceType: "test-data-plan",
      sourceId: "requirement-data-suite",
      reason:
        "Test data for Customer requires an explicit reuse or create decision",
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: now,
      updatedAt: now
    });

    const prepared = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: "knowledge-data-suite",
        systemId: "system-data-suite",
        authProfileId: "auth-data-suite",
        confirm: true,
        allowCreateTestData: true,
        maxHealAttempts: 0
      })
    );

    expect(prepared).toEqual(
      expect.objectContaining({
        status: "needs_test_data",
        stage: "test-data-prepare",
        task: expect.objectContaining({
          action: "lookup-or-create",
          allowCreate: true
        }),
        requirementSuiteRun: expect.objectContaining({
          status: "waiting-for-test-data",
          allowCreateTestData: true
        })
      })
    );
    const waitingStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: "knowledge-data-suite"
      })
    );
    const repeatedPreparation = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: "knowledge-data-suite",
        systemId: "system-data-suite",
        authProfileId: "auth-data-suite",
        confirm: true,
        allowCreateTestData: true
      })
    );

    expect(waitingStatus.nextAction).toBe(
      "complete_requirement_suite_test_data_task"
    );
    expect(repeatedPreparation.task.id).toBe(prepared.task.id);
    expect(context.repository.requirementSuiteRuns).toHaveLength(1);
    expect(context.repository.testDataTasks).toHaveLength(1);

    const generated = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "submit-test-data",
        taskId: prepared.task.id,
        taskStatus: "succeeded",
        dataDecision: "create",
        dataReference: "customer:new-1",
        dataValue: "Suite Customer",
        sourceRefs: ["browser:create/customer-new-1.json"]
      })
    );

    expect(generated).toEqual(
      expect.objectContaining({
        status: "needs_agent_execution",
        stage: "generator",
        executionPlan: expect.objectContaining({
          executableCaseId: "executable-data-suite",
          verdict: "ready"
        })
      })
    );
    await writeFile(
      generated.testPath,
      [
        `import { test, expect } from "../${basename(generated.seedPath)}";`,
        ...generated.executionPlan.steps
          .filter((step: { action: string }) => step.action !== "api")
          .map(
            (step: { id: string }) =>
              `await bc.step(${JSON.stringify(step.id)}, page, action);`
          ),
        'test("created data", async () => { expect(true).toBe(true); });'
      ].join("\n"),
      "utf8"
    );

    const cleanup = dataOf(
      await handleBrainCreatorTool(context, "bc_submit_agent_output", {
        taskId: generated.task.id,
        status: "succeeded",
        stdout: "generator output created",
        stderr: "",
        outputPaths: [generated.testPath]
      })
    );

    expect(cleanup).toEqual(
      expect.objectContaining({
        status: "needs_test_data",
        stage: "test-data-cleanup",
        task: expect.objectContaining({
          action: "cleanup",
          leaseId: expect.any(String)
        }),
        requirementSuiteRun: expect.objectContaining({
          status: "waiting-for-test-data",
          passed: 0
        })
      })
    );

    const cleanupFailed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "submit-test-data",
        taskId: cleanup.task.id,
        taskStatus: "failed",
        error: "Cleanup API unavailable",
        sourceRefs: ["network:cleanup-timeout"]
      })
    );

    expect(cleanupFailed).toEqual(
      expect.objectContaining({
        status: "blocked",
        stage: "test-data-cleanup",
        gap: expect.objectContaining({
          sourceType: "test-data-cleanup",
          status: "open"
        }),
        requirementSuiteRun: expect.objectContaining({
          status: "blocked",
          currentExecutableCaseId: "executable-data-suite"
        })
      })
    );

    const cleanupRetry = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: "knowledge-data-suite",
        systemId: "system-data-suite",
        authProfileId: "auth-data-suite",
        suiteId: cleanup.requirementSuiteRun.id,
        confirm: true,
        resume: true,
        continueOnBlocked: true
      })
    );

    expect(cleanupRetry).toEqual(
      expect.objectContaining({
        status: "needs_test_data",
        stage: "test-data-cleanup",
        task: expect.objectContaining({
          action: "cleanup",
          status: "pending"
        })
      })
    );
    expect(cleanupRetry.task.id).not.toBe(cleanup.task.id);

    const completed = dataOf(
      await handleBrainCreatorTool(context, "bc_prepare", {
        action: "submit-test-data",
        taskId: cleanupRetry.task.id,
        taskStatus: "succeeded",
        sourceRefs: ["browser:cleanup/customer-new-1.json"]
      })
    );

    expect(completed.requirementSuiteRun).toEqual(
      expect.objectContaining({
        status: "completed",
        passed: 1,
        failed: 0,
        blocked: 0
      })
    );
    expect(context.repository.testDataLeases).toEqual([
      expect.objectContaining({
        decision: "create",
        status: "released",
        releasedAt: expect.any(String)
      })
    ]);
  });

  it("previews and confirms requirement suite cancellation through bc_run", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Cancellation Knowledge",
      key: "cancellation-knowledge",
      defaultLocale: "en-US"
    });
    const run = context.requirementSuiteRuns.create({
      knowledgeProjectId: project.id,
      systemId: "system-cancellation",
      cases: [
        {
          executableCaseId: "executable-cancellation",
          title: "Cancel pending execution"
        }
      ],
      continueOnBlocked: false
    });
    context.requirementSuiteRuns.beginNext(run.id);
    context.repository.testDataTasks.push({
      id: "test-data-cancellation",
      knowledgeProjectId: project.id,
      systemId: "system-cancellation",
      executableCaseId: "executable-cancellation",
      profileId: "profile-cancellation",
      field: "Order",
      action: "lookup-or-create",
      status: "pending",
      idempotencyKey: "cancel-test-data",
      allowCreate: false,
      cleanup: "none",
      contextPath: "context.json",
      promptPath: "prompt.md",
      sourceRefs: [],
      outputSourceRefs: [],
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z"
    });
    context.requirementSuiteRuns.markWaitingForTestData(
      run.id,
      "executable-cancellation",
      {
        taskId: "test-data-cancellation",
        phase: "prepare"
      }
    );

    const preview = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        suiteId: run.id,
        suiteAction: "cancel",
        confirm: false
      })
    );

    expect(preview).toEqual(
      expect.objectContaining({
        status: "control-preview",
        action: "cancel",
        requiresConfirmation: true
      })
    );
    expect(context.requirementSuiteRuns.get(run.id).status).toBe(
      "waiting-for-test-data"
    );

    const cancelled = dataOf(
      await handleBrainCreatorTool(context, "bc_run", {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        suiteId: run.id,
        suiteAction: "cancel",
        confirm: true
      })
    );

    expect(cancelled).toEqual(
      expect.objectContaining({
        status: "cancelled",
        action: "cancel",
        requirementSuiteRun: expect.objectContaining({
          status: "cancelled",
          cancelled: 1,
          reportPath: expect.stringContaining("suite-report.html")
        })
      })
    );
    expect(context.repository.testDataTasks[0].status).toBe("cancelled");
    const archivedRoot = join(cancelled.requirementSuiteRun.reportPath, "..", "..");
    await expect(readFile(join(archivedRoot, "source", "requirements.json"), "utf8"))
      .resolves.toContain('"requirementSets"');
    await expect(readFile(join(archivedRoot, "analysis", "knowledge-and-coverage.json"), "utf8"))
      .resolves.toContain('"coverage"');
    await expect(readFile(join(archivedRoot, "cases", "executable-cases.json"), "utf8"))
      .resolves.toContain('"executableCases"');

    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );
    const review = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "run-ledger",
        knowledgeProjectId: project.id,
        id: run.id
      })
    );

    expect(status.knowledge.runLedger).toEqual(
      expect.objectContaining({
        total: 4,
        recent: expect.arrayContaining([
          expect.objectContaining({ event: "suite-cancelled" })
        ])
      })
    );
    expect(review).toEqual(
      expect.objectContaining({
        summaries: [
          expect.objectContaining({
            requirementSuiteRunId: run.id,
            currentStatus: "cancelled",
            latestEvent: "suite-cancelled"
          })
        ],
        entries: expect.arrayContaining([
          expect.objectContaining({ event: "suite-created" }),
          expect.objectContaining({ event: "test-data-task-requested" }),
          expect.objectContaining({ event: "suite-cancelled" })
        ])
      })
    );
  });

  it("restores status for a legacy active requirement suite without ledger events", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Legacy Suite Knowledge",
      key: "legacy-suite-knowledge",
      defaultLocale: "en-US"
    });
    const run = context.requirementSuiteRuns.create({
      knowledgeProjectId: project.id,
      systemId: "system-legacy-suite",
      cases: [
        {
          executableCaseId: "executable-legacy-suite",
          title: "Resume a legacy suite"
        }
      ],
      continueOnBlocked: false
    });
    context.repository.runLedgerEntries = [];
    context.repository.persist();

    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );

    expect(status.knowledge.requirementSuiteRuns.active.id).toBe(run.id);
    expect(status.knowledge.runLedger).toEqual({
      total: 0,
      activeSummary: undefined,
      recent: []
    });
    expect(status.nextAction).toBe("continue_requirement_suite");
  });

  it("limits historical diagnosis audit to systems bound to the knowledge project", async () => {
    const context = createBrainCreatorMcpContext({
      dataFilePath: join(await tempDir(), "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Audit Knowledge",
      key: "audit-knowledge",
      defaultLocale: "en-US"
    });
    const bound = context.service.createSystemProfile({
      name: "Bound Console",
      environment: "test",
      baseUrl: "https://bound.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://bound.example.test"]
    });
    const other = context.service.createSystemProfile({
      name: "Other Console",
      environment: "test",
      baseUrl: "https://other.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://other.example.test"]
    });
    context.knowledgeService.bindSystem(project.id, bound.id);
    for (const systemId of [bound.id, other.id]) {
      context.repository.gaps.push({
        id: `gap-${systemId}`,
        projectId: systemId,
        sourceType: "legacy-execution",
        sourceId: "TC-001",
        reason: "network timeout",
        severity: "high",
        owner: "qa",
        status: "open",
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:00.000Z"
      });
    }

    const status = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );
    const review = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "execution-diagnosis",
        knowledgeProjectId: project.id
      })
    );

    expect(status.knowledge.executionDiagnoses.legacyAudit.totalCandidates).toBe(1);
    expect(review.legacyAudit.summary.totalCandidates).toBe(1);
    expect(review.legacyAudit.candidates).toEqual([
      expect.objectContaining({ systemId: bound.id, assetId: `gap-${bound.id}` })
    ]);

    await handleBrainCreatorTool(context, "bc_prepare", {
      action: "review-legacy-diagnosis",
      systemId: bound.id,
      diagnosisAssetType: "gap",
      diagnosisAssetId: `gap-${bound.id}`,
      diagnosisDecision: "confirm_gap",
      confirmationNote: "Confirmed network execution blocker",
      confirm: true
    });
    const confirmedStatus = dataOf(
      await handleBrainCreatorTool(context, "bc_status", {
        knowledgeProjectId: project.id
      })
    );
    const confirmedReview = dataOf(
      await handleBrainCreatorTool(context, "bc_review", {
        target: "execution-diagnosis",
        knowledgeProjectId: project.id
      })
    );
    expect(
      confirmedStatus.knowledge.executionDiagnoses.legacyAudit.totalCandidates
    ).toBe(0);
    expect(confirmedStatus.knowledge.executionDiagnoses.legacyReviews).toEqual(
      expect.objectContaining({
        total: 1,
        migrated: 1,
        quality: expect.objectContaining({
          adjudicated: 1,
          matched: 1,
          corrected: 0,
          accuracy: 1
        })
      })
    );
    expect(confirmedReview.legacyReviews).toEqual([
      expect.objectContaining({ systemId: bound.id, assetId: `gap-${bound.id}` })
    ]);
  });

  it("summarizes stability iterations without treating one run as stable", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Stability Summary",
      key: "stability-summary",
      defaultLocale: "en-US"
    });
    const system = context.service.createSystemProfile({
      name: "Stability Console",
      environment: "test",
      baseUrl: "https://stability.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://stability.example.test"]
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    const first = context.requirementSuiteRuns.create({
      knowledgeProjectId: project.id,
      systemId: system.id,
      cases: [{ executableCaseId: "case-stability", title: "Stable case" }],
      continueOnBlocked: false,
      stabilityGroupId: "stability-group",
      stabilityIteration: 1,
      stabilityTarget: 2
    });
    first.status = "completed";
    first.passed = 1;
    first.caseRuns[0].status = "passed";
    const second = context.requirementSuiteRuns.create({
      knowledgeProjectId: project.id,
      systemId: system.id,
      cases: [{ executableCaseId: "case-stability", title: "Stable case" }],
      continueOnBlocked: false,
      stabilityGroupId: "stability-group",
      stabilityIteration: 2,
      stabilityTarget: 2
    });
    second.status = "failed";
    second.failed = 1;
    second.caseRuns[0].status = "failed";

    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {
      knowledgeProjectId: project.id
    }));

    expect(status.knowledge.requirementSuiteRuns.stability).toEqual([
      expect.objectContaining({
        stabilityGroupId: "stability-group",
        target: 2,
        iterations: 2,
        completed: 2,
        passed: 1,
        failed: 1,
        verdict: "unstable"
      })
    ]);
  });

  it("exposes due stability schedules through bc_status for external schedulers", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Scheduled Status",
      key: "scheduled-status",
      defaultLocale: "en-US"
    });
    const system = context.service.createSystemProfile({
      name: "Scheduled Console",
      environment: "test",
      baseUrl: "https://scheduled.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://scheduled.example.test"]
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    const run = context.requirementSuiteRuns.create({
      knowledgeProjectId: project.id,
      systemId: system.id,
      cases: [{ executableCaseId: "case-scheduled", title: "Scheduled case" }],
      continueOnBlocked: false,
      stabilityGroupId: "scheduled-group",
      stabilityIteration: 1,
      stabilityTarget: 3,
      stabilityPolicy: { targetIterations: 3, minIntervalMs: 60_000 }
    });
    run.status = "completed";
    run.passed = 1;
    run.caseRuns[0].status = "passed";
    run.stabilitySchedule!.nextRunAt = "2020-01-01T00:00:00.000Z";

    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {
      systemId: system.id
    }));

    expect(status.requirementSuiteRuns).toEqual(
      expect.objectContaining({
        total: 1,
        scheduledRuns: [
          expect.objectContaining({
            runId: run.id,
            knowledgeProjectId: project.id,
            due: true,
            stabilityIteration: 1,
            stabilityTarget: 3
          })
        ],
        stability: [
          expect.objectContaining({
            stabilityGroupId: "scheduled-group",
            schedule: expect.objectContaining({ due: true })
          })
        ]
      })
    );
    expect(status.authRefresh).toEqual(
      expect.objectContaining({
        registeredProviders: expect.arrayContaining(["token", "cookie"]),
        unavailableProviders: []
      })
    );
    expect(status.requirementSuiteRuns.stability[0].nextRunAt).toBe(
      "2020-01-01T00:00:00.000Z"
    );
  });

  it("previews and claims the next due stability run through the facade", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Scheduler Facade",
      key: "scheduler-facade",
      defaultLocale: "en-US"
    });
    const system = context.service.createSystemProfile({
      name: "Scheduler Console",
      environment: "test",
      baseUrl: "https://scheduler.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://scheduler.example.test"]
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    const run = context.requirementSuiteRuns.create({
      knowledgeProjectId: project.id,
      systemId: system.id,
      cases: [{ executableCaseId: "case-scheduler", title: "Scheduler case" }],
      continueOnBlocked: false,
      stabilityGroupId: "scheduler-group",
      stabilityIteration: 2,
      stabilityTarget: 3,
      stabilityPolicy: { targetIterations: 3, minIntervalMs: 60_000 }
    });
    run.stabilitySchedule!.nextRunAt = "2020-01-01T00:00:00.000Z";

    const preview = dataOf(await handleBrainCreatorTool(context, "bc_run", {
      mode: "requirement-suite",
      knowledgeProjectId: project.id,
      systemId: system.id,
      suiteAction: "claim-next-scheduled",
      scheduleOwner: "external-cron",
      confirm: false
    }));
    expect(preview).toEqual(expect.objectContaining({
      status: "control-preview",
      scheduledRuns: [expect.objectContaining({ id: run.id })]
    }));

    const claimed = dataOf(await handleBrainCreatorTool(context, "bc_run", {
      mode: "requirement-suite",
      knowledgeProjectId: project.id,
      systemId: system.id,
      suiteAction: "claim-next-scheduled",
      scheduleOwner: "external-cron",
      confirm: true,
      scheduleLeaseMs: 60_000
    }));
    expect(claimed).toEqual(expect.objectContaining({
      status: "scheduled-control-applied",
      requirementSuiteRun: expect.objectContaining({
        id: run.id,
        stabilitySchedule: expect.objectContaining({ leaseOwner: "external-cron" })
      })
    }));
  });

  it("does not call completed iterations stable without strong execution evidence", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Evidence Stability",
      key: "evidence-stability",
      defaultLocale: "en-US"
    });
    const system = context.service.createSystemProfile({
      name: "Evidence Console",
      environment: "test",
      baseUrl: "https://evidence.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://evidence.example.test"]
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    for (const iteration of [1, 2]) {
      const run = context.requirementSuiteRuns.create({
        knowledgeProjectId: project.id,
        systemId: system.id,
        cases: [{ executableCaseId: `case-evidence-${iteration}`, title: "Evidence case" }],
        continueOnBlocked: false,
        stabilityGroupId: "evidence-stability-group",
        stabilityIteration: iteration,
        stabilityTarget: 2
      });
      run.status = "completed";
      run.passed = 1;
      run.caseRuns[0].status = "passed";
    }

    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {
      knowledgeProjectId: project.id
    }));

    expect(status.knowledge.requirementSuiteRuns.stability).toEqual([
      expect.objectContaining({
        completed: 2,
        passed: 2,
        strongVerified: 0,
        verdict: "unstable"
      })
    ]);
  });

  it("emits MCP progress notifications while keeping the ledger authoritative", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Observable Knowledge",
      key: "observable-knowledge",
      defaultLocale: "en-US"
    });
    const run = context.requirementSuiteRuns.create({
      knowledgeProjectId: project.id,
      systemId: "system-observable",
      cases: [{ executableCaseId: "case-observable", title: "Observable case" }],
      continueOnBlocked: false
    });
    const notifications: Array<Record<string, unknown>> = [];

    await handleBrainCreatorTool(
      context,
      "bc_run",
      {
        mode: "requirement-suite",
        knowledgeProjectId: project.id,
        suiteId: run.id,
        suiteAction: "cancel",
        confirm: false,
        observationMode: "summary",
        responseMode: "full"
      },
      {
        progressToken: "observable-progress",
        sendNotification: async (notification) => {
          notifications.push(notification as unknown as Record<string, unknown>);
        }
      }
    );

    expect(notifications).toEqual([
      expect.objectContaining({
        method: "notifications/progress",
        params: expect.objectContaining({
          progressToken: "observable-progress",
          progress: 0
        })
      }),
      expect.objectContaining({
        method: "notifications/progress",
        params: expect.objectContaining({
          progressToken: "observable-progress",
          progress: 1
        })
      })
    ]);
    expect(context.runLedger.progress(run.id).current).toEqual(
      expect.objectContaining({ caseTitle: undefined, status: "started" })
    );
    const status = dataOf(await handleBrainCreatorTool(context, "bc_status", {
      knowledgeProjectId: project.id,
      responseMode: "summary"
    }));
    expect(status.summary.activeRun).toEqual(expect.objectContaining({
      runId: run.id,
      status: "running",
      browserMode: "headless",
      progress: expect.objectContaining({ sequence: 1, status: "started" }),
      possiblyStalled: false
    }));
  });

  it("controls a due stability run through the facade lease actions", async () => {
    const workDir = await tempDir();
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const project = await context.knowledgeService.createProject({
      name: "Scheduled Stability",
      key: "scheduled-stability",
      defaultLocale: "en-US"
    });
    const system = context.service.createSystemProfile({
      name: "Scheduled Console",
      environment: "test",
      baseUrl: "https://scheduled.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://scheduled.example.test"]
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    const run = context.requirementSuiteRuns.create({
      knowledgeProjectId: project.id,
      systemId: system.id,
      cases: [{ executableCaseId: "case-scheduled", title: "Scheduled case" }],
      continueOnBlocked: false,
      stabilityPolicy: { targetIterations: 2, minIntervalMs: 60_000 },
      stabilityIteration: 2,
      stabilityTarget: 2
    });
    run.stabilitySchedule = {
      status: "active",
      nextRunAt: "2026-08-17T00:00:00.000Z",
      attemptCount: 2
    };

    const preview = dataOf(await handleBrainCreatorTool(context, "bc_run", {
      mode: "requirement-suite",
      knowledgeProjectId: project.id,
      systemId: system.id,
      suiteId: run.id,
      suiteAction: "claim-scheduled",
      scheduleOwner: "codex",
      confirm: false
    }));
    expect(preview).toMatchObject({
      status: "control-preview",
      action: "claim-scheduled",
      requiresConfirmation: true
    });

    const claimed = dataOf(await handleBrainCreatorTool(context, "bc_run", {
      mode: "requirement-suite",
      knowledgeProjectId: project.id,
      systemId: system.id,
      suiteId: run.id,
      suiteAction: "claim-scheduled",
      scheduleOwner: "codex",
      confirm: true
    }));
    expect(claimed).toMatchObject({
      status: "scheduled-control-applied",
      action: "claim-scheduled",
      requirementSuiteRun: {
        stabilitySchedule: { leaseOwner: "codex" }
      }
    });
  });
});

function dataOf(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Missing MCP text result");
  const envelope = JSON.parse(text);
  if (!envelope.success) throw new Error(envelope.errors?.join("; ") ?? "MCP call failed");
  return envelope.data;
}

function envelopeOf(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Missing MCP text result");
  return JSON.parse(text);
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-mcp-knowledge-"));
  tempDirs.push(dir);
  return dir;
}
