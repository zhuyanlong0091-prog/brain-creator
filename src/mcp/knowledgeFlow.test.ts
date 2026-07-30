// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutableCase, Gap, TestIntent } from "../domain/types.js";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Brain Creator requirement-first facade", () => {
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
    expect(
      dataOf(
        await handleBrainCreatorTool(context, "bc_status", {
          knowledgeProjectId: project.id
        })
      ).nextAction
    ).toBe("compile_cases");

    context.knowledgeService.compileExecutableCases(design.testIntents[0].id, system.id);
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

    expect(compiled.executableCase.status).toBe("blocked");
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
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json"),
      agentBridge: bridge,
      runner: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: [
          "Error: expect(received).toBe(expected)",
          "Expected: \"approved\"",
          "Received: \"draft\""
        ].join("\n")
      })
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
    expect(spec).toContain("Evidence Contract");
    expect(taskContext.chainContext.executionEvidenceId).toBe(result.executionEvidence.id);
    expect(context.repository.executionEvidence).toEqual([
      expect.objectContaining({ status: "running", contextPackPath: result.contextPackPath })
    ]);

    await writeFile(
      result.testPath,
      [
        `import { test, expect } from "../${basename(result.seedPath)}";`,
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

    expect(completed.chainRun.status).toBe("failed");
    expect(context.repository.bugReports).toEqual([
      expect.objectContaining({ sourceId: result.executableCaseId, status: "open" })
    ]);
    expect(context.repository.gaps.filter((gap) => gap.projectId === system.id)).toHaveLength(0);
    expect(context.repository.executionEvidence).toEqual([
      expect.objectContaining({ status: "failed", chainRunId: completed.chainRun.id })
    ]);
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
