// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository, JsonFileBrainCreatorRepository } from "../domain/repository.js";
import type { RequirementContentPackage } from "../domain/types.js";
import { KnowledgeService } from "./service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("KnowledgeService", () => {
  it("creates a knowledge project before a runtime system is bound", async () => {
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), knowledgeDir);

    const project = await service.createProject({
      name: "Order Approval",
      key: "order-approval",
      defaultLocale: "en-US"
    });

    expect(project.systemIds).toEqual([]);
    expect(await readFile(join(knowledgeDir, "order-approval", "MOC.md"), "utf8")).toContain(
      "# Order Approval"
    );
  });

  it("creates a new requirement revision only when the content hash changes", async () => {
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), await tempDir());
    const project = await service.createProject({
      name: "Orders",
      key: "orders",
      defaultLocale: "zh-CN"
    });
    const first = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("hash-1", "订单金额超过 1000 元需要经理审批。")
    });
    const same = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("hash-1", "订单金额超过 1000 元需要经理审批。")
    });
    const changed = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("hash-2", "订单金额超过 2000 元需要经理审批。")
    });

    expect(first.changed).toBe(true);
    expect(same.changed).toBe(false);
    expect(same.requirementSet.id).toBe(first.requirementSet.id);
    expect(changed.requirementSet.version).toBe(2);
    expect(changed.previousRequirementSetId).toBe(first.requirementSet.id);
  });

  it("records source parser warnings as gaps instead of silently dropping content", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({ name: "Wiki", key: "wiki-warnings", defaultLocale: "en-US" });
    const contentPackage = requirementPackage("wiki-warning", "Users approve requests.");
    contentPackage.warnings = ["Feishu table block requires separate extraction"];

    const result = await service.ingestRequirement({ projectId: project.id, contentPackage });

    expect(result.gaps).toEqual([
      expect.objectContaining({ sourceType: "requirement-source-warning", status: "open" })
    ]);
  });

  it("restores knowledge assets from the versioned JSON repository", async () => {
    const root = await tempDir();
    const filePath = join(root, "assets.json");
    const first = new KnowledgeService(new JsonFileBrainCreatorRepository(filePath), join(root, "knowledge"));
    const project = await first.createProject({ name: "CRM", key: "crm", defaultLocale: "zh-CN" });
    await first.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("crm-hash", "销售线索可以转为商机。")
    });

    const second = new KnowledgeService(
      new JsonFileBrainCreatorRepository(filePath),
      join(root, "knowledge")
    );

    expect(second.listProjects()).toEqual([expect.objectContaining({ id: project.id, key: "crm" })]);
    expect(second.listRequirementSets(project.id)).toHaveLength(1);
  });

  it("requires approval before compiling executable cases", async () => {
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), await tempDir());
    const project = await service.createProject({ name: "Recruiting", key: "recruiting", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "recruiting-hash",
        "用户进入招聘需求列表，新建招聘需求并填写表单。需求类型选择离职替补后显示替补人员字段。"
      )
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);

    expect(design.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "contains", sourceRefs: expect.any(Array) }),
        expect.objectContaining({ relation: "covers", sourceRefs: expect.any(Array) })
      ])
    );

    expect(() => service.compileExecutableCases(design.testIntents[0].id)).toThrow(
      "Requirement baseline must be approved"
    );

    await service.confirmEvaluationActions({
      requirementSetId: ingested.requirementSet.id,
      actionIds: design.evaluationGate.actions.map((action) => action.id),
      note: "When the replacement type is not selected, the replacement employee field stays hidden.",
      confirm: true
    });
    service.approveRequirementSet(ingested.requirementSet.id);
    const compiled = service.compileExecutableCases(design.testIntents[0].id);

    expect(compiled.executableCase.steps.map((step) => step.action)).toEqual(
      expect.arrayContaining(["navigate", "click", "fill", "assert"])
    );
    expect(compiled.executableCase.steps.every((step) => step.sourceRefs.length > 0)).toBe(true);
  });

  it("batch compiles an approved requirement idempotently and records a bounded compile run", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Order Lifecycle",
      key: "order-lifecycle-batch",
      defaultLocale: "en-US"
    });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "order-batch-hash",
        "Buyer creates an order. Manager approves an order. Finance rejects an order."
      )
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    if (design.evaluationGate.actions.length > 0) {
      await service.confirmEvaluationActions({
        requirementSetId: ingested.requirementSet.id,
        actionIds: design.evaluationGate.actions.map((action) => action.id),
        note: "The listed order lifecycle branches are confirmed.",
        confirm: true
      });
    }
    service.approveRequirementSet(ingested.requirementSet.id);

    const first = service.compileExecutableCasesBatch({
      requirementSetId: ingested.requirementSet.id
    });
    const second = service.compileExecutableCasesBatch({
      requirementSetId: ingested.requirementSet.id
    });

    expect(first.compileRun.total).toBe(design.testIntents.length);
    expect(first.compileRun.items).toHaveLength(design.testIntents.length);
    expect(first.compileRun.items.every((item) => item.result !== "reused")).toBe(true);
    expect(second.compileRun.items.every((item) => item.result === "reused")).toBe(true);
    expect(repository.executableCases).toHaveLength(design.testIntents.length);
    expect(repository.compileRuns).toHaveLength(2);
  });

  it("rejects an explicit batch selection that crosses requirement sets", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Order Revisions",
      key: "order-revisions-batch",
      defaultLocale: "en-US"
    });
    const first = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("order-revision-1", "Buyer creates an order.")
    });
    const second = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("order-revision-2", "Manager approves an order.")
    });
    const firstDesign = await service.generateTestDesign(first.requirementSet.id);
    const secondDesign = await service.generateTestDesign(second.requirementSet.id);

    expect(() =>
      service.compileExecutableCasesBatch({
        requirementSetId: first.requirementSet.id,
        testIntentIds: [firstDesign.testIntents[0].id, secondDesign.testIntents[0].id]
      })
    ).toThrow(/does not belong to RequirementSet/);
  });

  it("persists an explicit page binding decision for ambiguous compilation", async () => {
    const root = await tempDir();
    const filePath = join(root, "assets.json");
    const repository = new JsonFileBrainCreatorRepository(filePath);
    const service = new KnowledgeService(repository, join(root, "knowledge"));
    const project = await service.createProject({
      name: "Page Binding",
      key: "page-binding",
      defaultLocale: "en-US"
    });
    repository.systemProfiles.push({
      id: "system-binding-1",
      name: "Orders",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-binding-1");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("binding-hash", "User creates an order.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    repository.pageModels.push({
      id: "page-binding-1",
      projectId: "system-binding-1",
      route: "/orders/new",
      name: "Create order",
      version: 1,
      domSnapshotId: "dom-1",
      screenshotId: "shot-1",
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const decision = service.confirmPageBinding({
      testIntentId: design.testIntents[0].id,
      systemId: "system-binding-1",
      pageModelId: "page-binding-1",
      role: "buyer",
      note: "Confirmed from the order creation workflow."
    });

    expect(decision).toEqual(
      expect.objectContaining({
        testIntentId: design.testIntents[0].id,
        pageModelId: "page-binding-1",
        role: "buyer"
      })
    );
    expect(repository.pageBindingDecisions).toHaveLength(1);
    expect(
      service.confirmPageBinding({
        testIntentId: design.testIntents[0].id,
        systemId: "system-binding-1",
        pageModelId: "page-binding-1",
        role: "buyer",
        note: "Confirmed from the order creation workflow."
      }).id
    ).toBe(decision.id);
    expect(repository.pageBindingDecisions).toHaveLength(1);
    expect(new JsonFileBrainCreatorRepository(filePath).pageBindingDecisions).toEqual([
      expect.objectContaining({ id: decision.id, pageModelId: "page-binding-1" })
    ]);
  });

  it("persists atomic test intents and a traceable requirement evaluation report", async () => {
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), knowledgeDir);
    const project = await service.createProject({
      name: "Order Approval",
      key: "order-coverage",
      defaultLocale: "en-US"
    });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "order-coverage-v1",
        "Buyer creates an order. Orders above 1000 require manager approval. Status changes from draft to approved. Finance users may reject the order."
      )
    });

    const design = await service.generateTestDesign(ingested.requirementSet.id);
    const report = await readFile(
      join(knowledgeDir, "order-coverage", "requirements", ingested.requirementSet.id, "analysis.md"),
      "utf8"
    );

    expect(design.testIntents).toHaveLength(4);
    expect(design.evaluation.coverage).toEqual(
      expect.objectContaining({ totalClauses: 4, coveredClauses: 4, coverageRate: 1 })
    );
    expect(report).toContain("## Requirement Clauses");
    expect(report).toContain("## Evaluation");
    expect(report).toContain("Coverage: 4/4 (100%)");
    expect(report).toContain(design.analysis.clauses[0].sourceRef);
  });

  it("writes cross-module clauses into separate module knowledge files and edges", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({
      name: "Recruiting Offer",
      key: "recruiting-offer",
      defaultLocale: "en-US"
    });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "cross-module",
        "Recruiter creates a hiring request. When the request is approved, the Offer module creates an offer."
      )
    });

    const result = await service.generateTestDesign(ingested.requirementSet.id);

    expect(result.testIntents.map((intent) => intent.module)).toEqual([
      "Recruiting",
      "Offer"
    ]);
    expect(
      await readFile(
        join(knowledgeDir, "recruiting-offer", "modules", "recruiting", "flows.md"),
        "utf8"
      )
    ).toContain("Recruiter creates a hiring request");
    expect(
      await readFile(
        join(knowledgeDir, "recruiting-offer", "modules", "offer", "flows.md"),
        "utf8"
      )
    ).toContain("Offer module creates an offer");
    const moduleNodes = repository.knowledgeNodes.filter(
      (node) => node.requirementSetId === ingested.requirementSet.id && node.type === "module"
    );
    for (const moduleNode of moduleNodes) {
      expect(
        repository.knowledgeEdges.some(
          (edge) =>
            edge.fromNodeId === moduleNode.id &&
            repository.knowledgeNodes.some(
              (node) => node.id === edge.toNodeId && node.module === moduleNode.module
            )
        )
      ).toBe(true);
    }
  });

  it("persists Eval actions and blocks approval until the user explicitly confirms them", async () => {
    const root = await tempDir();
    const dataFile = join(root, "assets.json");
    const knowledgeDir = join(root, "knowledge");
    const first = new KnowledgeService(new JsonFileBrainCreatorRepository(dataFile), knowledgeDir);
    const project = await first.createProject({
      name: "Order Workflow",
      key: "order-eval-gate",
      defaultLocale: "en-US"
    });
    const ingested = await first.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "order-eval-gate-v1",
        "When the manager approves the order, status changes from draft to approved."
      )
    });

    const design = await first.generateTestDesign(ingested.requirementSet.id);
    const pendingAction = design.evaluationGate.actions[0];

    expect(design.evaluationGate).toEqual(
      expect.objectContaining({
        status: "needs-confirmation",
        verdict: "needs-user",
        actions: [
          expect.objectContaining({
            kind: "missing-branch",
            status: "pending",
            sourceRefs: [expect.stringContaining("#clause-1")]
          })
        ]
      })
    );
    expect(() => first.approveRequirementSet(ingested.requirementSet.id)).toThrow(
      "Requirement Eval actions must be confirmed before approval"
    );

    const restored = new KnowledgeService(
      new JsonFileBrainCreatorRepository(dataFile),
      knowledgeDir
    );
    expect(restored.listRequirementSets(project.id)[0].evaluationGate?.actions[0].status).toBe("pending");
    await expect(
      restored.confirmEvaluationActions({
        requirementSetId: ingested.requirementSet.id,
        actionIds: [pendingAction.id],
        note: "If approval does not occur, the order remains in draft.",
        confirm: false
      })
    ).rejects.toThrow("Explicit confirmation is required");

    const confirmed = await restored.confirmEvaluationActions({
      requirementSetId: ingested.requirementSet.id,
      actionIds: [pendingAction.id],
      note: "If approval does not occur, the order remains in draft.",
      confirm: true
    });
    const confirmationReport = await readFile(
      join(
        knowledgeDir,
        "order-eval-gate",
        "requirements",
        ingested.requirementSet.id,
        "evaluation-confirmations.md"
      ),
      "utf8"
    );

    expect(confirmed.evaluationGate.status).toBe("confirmed");
    expect(confirmed.evaluationGate.actions[0]).toEqual(
      expect.objectContaining({
        status: "confirmed",
        confirmationNote: "If approval does not occur, the order remains in draft.",
        confirmedAt: expect.any(String)
      })
    );
    expect(confirmationReport).toContain("If approval does not occur");
    expect(restored.approveRequirementSet(ingested.requirementSet.id).status).toBe("approved");
    const compiled = restored.compileExecutableCases(design.testIntents[0].id).executableCase;
    expect(compiled.steps.every((step) =>
      step.sourceRefs.some((sourceRef) => sourceRef.includes("#eval-action-"))
    )).toBe(true);
  });

  it("creates a gap instead of guessing when an implicit workflow has multiple paths", async () => {
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), await tempDir());
    const project = await service.createProject({ name: "Contracts", key: "contracts", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "contracts-hash",
        "合同可以从列表新建，也可以从客户详情新建。填写合同表单并提交。"
      )
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);

    const compiled = service.compileExecutableCases(design.testIntents[0].id);

    expect(compiled.executableCase.status).toBe("blocked");
    expect(compiled.gaps).toEqual([
      expect.objectContaining({ reason: expect.stringContaining("multiple workflow paths") })
    ]);
  });

  it("recognizes real UTF-8 Chinese workflows and conditional fields", async () => {
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), await tempDir());
    const project = await service.createProject({ name: "Recruiting", key: "utf8-recruiting", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "utf8-recruiting",
        "\u8fdb\u5165\u62db\u8058\u9700\u6c42\u5217\u8868\uff0c\u586b\u5199\u62db\u8058\u9700\u6c42\u8868\u5355\u3002\u9700\u6c42\u7c7b\u578b\u9009\u62e9\u79bb\u804c\u66ff\u8865\u540e\u663e\u793a\u66ff\u8865\u4eba\u5458\u5b57\u6bb5\u3002"
      )
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    await service.confirmEvaluationActions({
      requirementSetId: ingested.requirementSet.id,
      actionIds: design.evaluationGate.actions.map((action) => action.id),
      note: "未选择离职替补时，替补人员字段保持隐藏。",
      confirm: true
    });
    service.approveRequirementSet(ingested.requirementSet.id);

    const compiled = service.compileExecutableCases(design.testIntents[0].id);

    expect(compiled.executableCase.steps.map((step) => step.action)).toEqual([
      "navigate", "click", "fill", "select", "assert"
    ]);
    expect(compiled.executableCase.steps.find((step) => step.action === "click")?.origin).toBe("derived");
  });

  it("blocks real UTF-8 Chinese requirements with multiple create paths", async () => {
    const service = new KnowledgeService(new InMemoryBrainCreatorRepository(), await tempDir());
    const project = await service.createProject({ name: "Contracts", key: "utf8-contracts", defaultLocale: "zh-CN" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "utf8-contracts",
        "\u53ef\u4ee5\u4ece\u5217\u8868\u9875\u65b0\u5efa\u5408\u540c\uff0c\u4e5f\u53ef\u4ee5\u4ece\u5ba2\u6237\u8be6\u60c5\u9875\u65b0\u5efa\u5408\u540c\u3002"
      )
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);

    expect(service.compileExecutableCases(design.testIntents[0].id).executableCase.status).toBe("blocked");
  });

  it("reuses an existing design and deprecates impacted nodes only after the new baseline is approved", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({ name: "Orders", key: "orders-impact", defaultLocale: "en-US" });
    const first = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("v1", "Orders above 1000 require approval.")
    });
    const firstDesign = await service.generateTestDesign(first.requirementSet.id);
    const reused = await service.generateTestDesign(first.requirementSet.id);
    service.approveRequirementSet(first.requirementSet.id);
    const second = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("v2", "Orders above 2000 require approval.")
    });
    await service.generateTestDesign(second.requirementSet.id);

    expect(reused.reused).toBe(true);
    expect(repository.testIntents.filter((item) => item.requirementSetId === first.requirementSet.id)).toHaveLength(
      firstDesign.testIntents.length
    );
    expect(second.requirementSet.affectedNodeIds.length).toBeGreaterThan(0);
    const unchangedModule = repository.knowledgeNodes.find(
      (item) => item.requirementSetId === first.requirementSet.id && item.type === "module"
    );
    expect(second.requirementSet.affectedNodeIds).not.toContain(unchangedModule?.id);
    expect(
      repository.knowledgeNodes.filter((item) => first.requirementSet.affectedNodeIds.includes(item.id))
    ).toEqual(expect.arrayContaining([expect.objectContaining({ status: "confirmed" })]));

    service.approveRequirementSet(second.requirementSet.id);

    expect(
      repository.knowledgeNodes.filter((item) => first.requirementSet.affectedNodeIds.includes(item.id))
    ).toEqual(expect.arrayContaining([expect.objectContaining({ status: "deprecated" })]));
    expect(unchangedModule?.status).toBe("confirmed");
  });

  it("blocks baseline approval while requirement clarification gaps remain open", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({ name: "Invoices", key: "invoice-gaps", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("invoice-gap", "The invoice approval threshold is not specified.")
    });

    const design = await service.generateTestDesign(ingested.requirementSet.id);

    expect(design.evaluation.verdict).toBe("needs-user");
    expect(design.gaps).toEqual([expect.objectContaining({ sourceType: "requirement-clarification" })]);
    expect(design.evaluationGate.actions[0]).toEqual(
      expect.objectContaining({
        kind: "clarification",
        status: "pending",
        gapIds: [design.gaps[0].id]
      })
    );
    expect(() => service.approveRequirementSet(ingested.requirementSet.id)).toThrow(
      "Requirement Eval actions must be confirmed"
    );
    const confirmation = await service.confirmEvaluationActions({
      requirementSetId: ingested.requirementSet.id,
      actionIds: [design.evaluationGate.actions[0].id],
      note: "The invoice approval threshold is 1000.",
      confirm: true
    });

    expect(design.gaps[0].status).toBe("resolved");
    expect(confirmation.evaluationGate.actions[0].resolutionNodeId).toEqual(expect.any(String));
    expect(
      repository.knowledgeNodes.find(
        (node) => node.id === confirmation.evaluationGate.actions[0].resolutionNodeId
      )
    ).toEqual(expect.objectContaining({ content: "The invoice approval threshold is 1000." }));
    expect(service.approveRequirementSet(ingested.requirementSet.id).status).toBe("approved");
  });

  it("blocks baseline approval when requirement clauses contradict each other", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Approval Form",
      key: "approval-conflict",
      defaultLocale: "en-US"
    });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage(
        "approval-conflict-v1",
        "The approval field is visible. The approval field is not visible."
      )
    });

    const design = await service.generateTestDesign(ingested.requirementSet.id);

    expect(design.evaluation.verdict).toBe("needs-user");
    expect(design.gaps).toEqual([
      expect.objectContaining({ sourceType: "requirement-conflict", status: "open" })
    ]);
    expect(design.evaluationGate).toEqual(
      expect.objectContaining({
        status: "blocked",
        actions: [expect.objectContaining({ kind: "contradiction", status: "blocked" })]
      })
    );
    expect(() => service.approveRequirementSet(ingested.requirementSet.id)).toThrow(
      "Blocked Requirement Eval output cannot be approved"
    );
    await expect(
      service.confirmEvaluationActions({
        requirementSetId: ingested.requirementSet.id,
        actionIds: [design.evaluationGate.actions[0].id],
        note: "The field should be visible.",
        confirm: true
      })
    ).rejects.toThrow("Blocked Requirement Eval actions cannot be confirmed");
  });

  it("keeps approved expectations separate from conflicting system observations", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({ name: "Orders", key: "orders-observed", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-orders",
      name: "Orders",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-orders");
    repository.knowledgeNodes.push({
      id: "expected-rule",
      knowledgeProjectId: project.id,
      type: "rule",
      title: "Approval threshold",
      content: "Orders above 1000 require approval.",
      module: "Orders",
      sourceRefs: ["requirement-1"],
      origin: "source",
      confidence: 1,
      status: "confirmed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const result = await service.recordSystemObservation({
      projectId: project.id,
      systemId: "system-orders",
      type: "rule",
      title: "Approval threshold",
      content: "Orders above 2000 require approval.",
      module: "Orders",
      sourceRefs: ["trace/order-42.zip"]
    });

    expect(result.conflicted).toBe(true);
    expect(result.observation).toEqual(expect.objectContaining({ origin: "observed", status: "conflicted" }));
    expect(repository.knowledgeNodes.find((node) => node.id === "expected-rule")?.status).toBe("confirmed");
    expect(result.gaps).toEqual([expect.objectContaining({ sourceType: "system-observation", status: "open" })]);
    expect(await readFile(join(knowledgeDir, "orders-observed", "systems", "system-orders", "conflicts.md"), "utf8"))
      .toContain("Orders above 2000 require approval");
  });

  it("stores step-level execution evidence without inventing missing screenshots", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({ name: "Evidence", key: "execution-evidence", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-evidence",
      name: "Evidence",
      environment: "test",
      baseUrl: "https://evidence.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://evidence.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-evidence");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("evidence", "Users create an order form.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);
    const compiled = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const evidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-evidence",
      executableCaseId: compiled.id,
      testCaseId: "test-case-evidence",
      contextPackPath: "context/evidence.json"
    });

    const completed = await service.completeExecutionEvidence(evidence.id, {
      status: "failed",
      chainRunId: "chain-evidence",
      actualResult: "Expected approved status but received draft",
      artifactPaths: ["evidence/step-04.png", "evidence/trace.zip"],
      tracePaths: ["evidence/trace.zip"],
      consoleErrors: ["console error: failed request"],
      networkFailures: ["GET /orders 500"]
    });

    expect(completed.status).toBe("failed");
    expect(completed.steps.find((step) => step.order === 4)?.screenshotPath).toBe(
      "evidence/step-04.png"
    );
    expect(completed.steps.find((step) => step.action === "assert")).toEqual(
      expect.objectContaining({ assertionStatus: "failed", actual: expect.stringContaining("draft") })
    );
    expect(completed.steps.filter((step) => step.action !== "assert")).toEqual(
      expect.arrayContaining([expect.objectContaining({ assertionStatus: "blocked" })])
    );
    expect(compiled.status).toBe("executed");
    expect(
      await readFile(
        join(knowledgeDir, "execution-evidence", "reports", "chain-evidence", "summary.md"),
        "utf8"
      )
    ).toContain("Expected approved status but received draft");
  });

  it("downgrades assurance when structured reporter omits a declared step", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    await writeFile(join(knowledgeDir, "trace.zip"), "trace", "utf8");
    const project = await service.createProject({ name: "Reporter coverage", key: "reporter-coverage", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-reporter-coverage",
      name: "Reporter coverage",
      environment: "test",
      baseUrl: "https://reporter-coverage.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://reporter-coverage.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-reporter-coverage");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("reporter-coverage", "Users create an order record.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);
    const executableCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const evidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-reporter-coverage",
      executableCaseId: executableCase.id,
      testCaseId: "test-reporter-coverage",
      contextPackPath: "context/reporter-coverage.json"
    });
    const completed = await service.completeExecutionEvidence(evidence.id, {
      status: "passed",
      artifactPaths: [],
      tracePaths: ["trace.zip"],
      evidenceRootDir: knowledgeDir,
      reporterResult: {
        status: "passed",
        total: evidence.assertionContracts?.length ?? 0,
        passed: evidence.assertionContracts?.length ?? 0,
        failed: 0,
        skipped: 0,
        durationMs: 1,
        assertions: (evidence.assertionContracts ?? []).map((contract) => ({
          id: contract.id,
          status: "passed" as const,
          evidenceRefs: []
        })),
        steps: [],
        attachments: [],
        consoleErrors: [],
        networkFailures: []
      }
    });

    expect(completed.assuranceLevel).toBe("limited");
    expect(completed.evidenceWarnings).toEqual([
      expect.stringContaining("Missing structured Reporter evidence for step(s):")
    ]);
    expect(completed.evidenceWarnings?.some((warning) => warning.includes("Missing trace artifact"))).toBe(false);
  });

  it("records field and workflow coverage only from step evidence", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({ name: "Coverage dimensions", key: "coverage-dimensions", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-coverage-dimensions",
      name: "Coverage dimensions",
      environment: "test",
      baseUrl: "https://coverage-dimensions.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://coverage-dimensions.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-coverage-dimensions");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("coverage-dimensions", "Users fill the customer form and save the customer record.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);
    const executableCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const evidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-coverage-dimensions",
      executableCaseId: executableCase.id,
      testCaseId: "test-coverage-dimensions",
      contextPackPath: "context/coverage-dimensions.json"
    });
    const completed = await service.completeExecutionEvidence(evidence.id, {
      status: "passed",
      artifactPaths: [],
      reporterResult: {
        status: "passed",
        total: evidence.assertionContracts?.length ?? 0,
        passed: evidence.assertionContracts?.length ?? 0,
        failed: 0,
        skipped: 0,
        durationMs: 1,
        assertions: (evidence.assertionContracts ?? []).map((contract) => ({
          id: contract.id,
          status: "passed" as const,
          evidenceRefs: ["evidence/assertion.png"]
        })),
        steps: evidence.steps.map((step) => ({
          id: step.stepId,
          title: `bc:${step.stepId}`,
          status: "passed" as const,
          evidenceRefs: ["evidence/step.png"]
        })),
        attachments: ["evidence/step.png"],
        consoleErrors: [],
        networkFailures: []
      }
    });

    expect(completed.coverage?.required).toEqual(expect.arrayContaining(["field", "workflow"]));
    expect(completed.coverage?.verified).toEqual(expect.arrayContaining(["field", "workflow"]));
    expect(completed.coverage?.missing).toEqual([]);
    expect(completed.assuranceLevel).toBe("strong");
  });

  it("estimates Requirement Eval accuracy from traceable historical execution outcomes", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Historical Eval",
      key: "historical-eval",
      defaultLocale: "en-US"
    });
    repository.systemProfiles.push({
      id: "system-history",
      name: "Historical Eval",
      environment: "test",
      baseUrl: "https://history.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://history.example.test"],
      status: "succeeded",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    service.bindSystem(project.id, "system-history");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: requirementPackage("history", "Users create a customer record.")
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    service.approveRequirementSet(ingested.requirementSet.id);

    const passCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const passEvidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-history",
      executableCaseId: passCase.id,
      testCaseId: "test-pass",
      contextPackPath: "context/pass.json"
    });
    await service.completeExecutionEvidence(passEvidence.id, {
      status: "passed",
      chainRunId: "chain-pass",
      actualResult: "Customer record created",
      artifactPaths: [],
      reporterResult: {
        status: "passed",
        total: passEvidence.assertionContracts?.length ?? 0,
        passed: passEvidence.assertionContracts?.length ?? 0,
        failed: 0,
        skipped: 0,
        durationMs: 10,
        assertions: (passEvidence.assertionContracts ?? []).map((contract) => ({
          id: contract.id,
          status: "passed" as const,
          evidenceRefs: []
        })),
        attachments: [],
        consoleErrors: [],
        networkFailures: []
      }
    });
    expect(repository.executionEvidence.find((item) => item.id === passEvidence.id)?.assuranceLevel).toBe(
      passEvidence.assertionContracts?.length ? "strong" : "none"
    );

    const bugCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const bugEvidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-history",
      executableCaseId: bugCase.id,
      testCaseId: "test-bug",
      contextPackPath: "context/bug.json"
    });
    await service.completeExecutionEvidence(bugEvidence.id, {
      status: "failed",
      chainRunId: "chain-bug",
      actualResult: "Save returned an error",
      artifactPaths: []
    });
    repository.bugReports.push({
      id: "bug-history",
      systemId: "system-history",
      sourceId: bugCase.id,
      caseNo: bugCase.id,
      caseTitle: bugCase.title,
      module: "Customer",
      priority: "P0",
      expectedResult: "Customer record is created",
      actualResult: "Save returned an error",
      reproductionSteps: [],
      evidencePaths: [],
      chainRunId: "chain-bug",
      gapIds: [],
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const disputedCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const disputedEvidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-history",
      executableCaseId: disputedCase.id,
      testCaseId: "test-disputed",
      contextPackPath: "context/disputed.json"
    });
    await service.completeExecutionEvidence(disputedEvidence.id, {
      status: "failed",
      chainRunId: "chain-disputed",
      actualResult: "Observed behavior contradicts the expected workflow",
      artifactPaths: []
    });

    const blockedCase = service.compileExecutableCases(design.testIntents[0].id).executableCase;
    const blockedEvidence = service.createExecutionEvidence({
      projectId: project.id,
      systemId: "system-history",
      executableCaseId: blockedCase.id,
      testCaseId: "test-blocked",
      contextPackPath: "context/blocked.json"
    });
    await service.completeExecutionEvidence(blockedEvidence.id, {
      status: "blocked",
      actualResult: "Environment request failed",
      artifactPaths: [],
      networkFailures: ["GET /customers 503"]
    });

    expect(service.requirementEvalAccuracy(project.id)).toEqual(
      expect.objectContaining({
        totalEvidence: 4,
        validated: 2,
        contradicted: 1,
        inconclusive: 1,
        accuracyRate: 2 / 3,
        systemConformanceRate: 1 / 2,
        traceabilityRate: 1
      })
    );
    expect(service.requirementEvalAccuracy(project.id).byRequirementSet).toEqual([
      expect.objectContaining({
        requirementSetId: ingested.requirementSet.id,
        validated: 2,
        contradicted: 1,
        inconclusive: 1
      })
    ]);
  });
});

function requirementPackage(contentHash: string, content: string): RequirementContentPackage {
  return {
    title: "Requirement",
    content,
    blocks: [{ type: "paragraph", text: content }],
    attachments: [],
    source: "requirements/requirement.md",
    sourceType: "local-file" as const,
    contentHash,
    warnings: []
  };
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-knowledge-"));
  tempDirs.push(dir);
  return dir;
}
