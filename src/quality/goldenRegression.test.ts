// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExecutableCase, RequirementSet, TestIntent } from "../domain/types.js";
import type { SystemBrain } from "../knowledge/systemBrain.js";
import { BrainCreatorService } from "../domain/service.js";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { KnowledgeService } from "../knowledge/service.js";
import { RequirementSuiteRunService } from "../knowledge/requirementSuiteRun.js";
import { SystemBrainSnapshotService } from "../brain/systemSnapshot.js";
import { propagateSystemBrainChangeSet } from "../brain/systemReconciliation.js";

describe("cross-system and multi-requirement golden regression", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("keeps requirements isolated and propagates a System Brain behavior diff only to affected cases", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const domain = new BrainCreatorService(repository);
    const knowledgeDir = await mkdtemp(join(tmpdir(), "brain-golden-"));
    tempDirs.push(knowledgeDir);
    const knowledge = new KnowledgeService(repository, knowledgeDir);
    const systemA = domain.createSystemProfile(systemInput("Orders system", "https://orders.golden.test/"));
    const systemB = domain.createSystemProfile(systemInput("HR system", "https://hr.golden.test/"));
    const project = await knowledge.createProject({
      name: "Cross-system golden project",
      key: "cross-system-golden",
      defaultLocale: "en-US"
    });
    knowledge.bindSystem(project.id, systemA.id);
    knowledge.bindSystem(project.id, systemB.id);

    const orderV1 = await requirement(knowledge, project.id, "orders-v1", "Create and approve an order");
    const orderV2 = await requirement(knowledge, project.id, "orders-v2", "Add order rejection");
    const hrV1 = await requirement(knowledge, project.id, "hr-v1", "Create an employee");

    const pageA = domain.discoverPageModel({
      projectId: systemA.id,
      route: systemA.baseUrl + "orders",
      name: "Orders",
      authProfileId: "",
      domText: "Orders Approve Reject",
      captureMode: "manual",
      targetUrl: systemA.baseUrl + "orders"
    }).pageModel;
    const pageB = domain.discoverPageModel({
      projectId: systemB.id,
      route: systemB.baseUrl + "employees",
      name: "Employees",
      authProfileId: "",
      domText: "Employees Create",
      captureMode: "manual",
      targetUrl: systemB.baseUrl + "employees"
    }).pageModel;

    const snapshots = new SystemBrainSnapshotService(repository);
    const baselineA = snapshots.capture({
      knowledgeProjectId: project.id,
      systemId: systemA.id,
      brain: brain(project.id, systemA.id, pageA.id, systemA.baseUrl + "orders", "Approve", "pending")
    });
    const baselineB = snapshots.capture({
      knowledgeProjectId: project.id,
      systemId: systemB.id,
      brain: brain(project.id, systemB.id, pageB.id, systemB.baseUrl + "employees", "Create", "draft")
    });
    snapshots.confirm(baselineA.snapshot.id, "golden-reviewer");
    snapshots.confirm(baselineB.snapshot.id, "golden-reviewer");

    const orderCaseV1 = createCase(project.id, orderV1, systemA.id, "Order approval", baselineA.snapshot.id);
    const orderCaseV2 = createCase(project.id, orderV2, systemA.id, "Order rejection", baselineA.snapshot.id);
    const hrCase = createCase(project.id, hrV1, systemB.id, "Employee creation", baselineB.snapshot.id);
    repository.testIntents.push(orderCaseV1.intent, orderCaseV2.intent, hrCase.intent);
    repository.executableCases.push(orderCaseV1.executableCase, orderCaseV2.executableCase, hrCase.executableCase);

    const suiteRuns = new RequirementSuiteRunService(repository);
    const ordersRun = suiteRuns.create({
      knowledgeProjectId: project.id,
      systemId: systemA.id,
      requirementSetIds: [orderV1.id, orderV2.id],
      cases: [
        { executableCaseId: orderCaseV1.executableCase.id, title: orderCaseV1.executableCase.title },
        { executableCaseId: orderCaseV2.executableCase.id, title: orderCaseV2.executableCase.title }
      ],
      continueOnBlocked: false
    });
    const ordersReconciliation = suiteRuns.reconcile(ordersRun.id);
    expect(ordersReconciliation).toEqual(expect.objectContaining({
      status: "complete",
      requirementSetIds: expect.arrayContaining([orderV1.id, orderV2.id]),
      crossSystemCaseIds: []
    }));

    const hrRun = suiteRuns.create({
      knowledgeProjectId: project.id,
      systemId: systemB.id,
      requirementSetIds: [hrV1.id],
      cases: [{ executableCaseId: hrCase.executableCase.id, title: hrCase.executableCase.title }],
      continueOnBlocked: false
    });
    const hrReconciliation = suiteRuns.reconcile(hrRun.id);
    expect(hrReconciliation).toEqual(expect.objectContaining({
      status: "complete",
      requirementSetIds: [hrV1.id],
      crossSystemCaseIds: []
    }));

    const changed = snapshots.capture({
      knowledgeProjectId: project.id,
      systemId: systemA.id,
      brain: brain(project.id, systemA.id, pageA.id, systemA.baseUrl + "orders", "Approve", "approved")
    });
    expect(changed.changeSet?.summary.behaviorChanged).toBe(1);
    const impact = propagateSystemBrainChangeSet({
      changeSet: changed.changeSet!,
      executableCases: repository.executableCases,
      testIntents: repository.testIntents,
      semanticBindings: [],
      persist: () => repository.persist()
    });

    expect(impact.affectedExecutableCaseIds).toEqual([
      orderCaseV1.executableCase.id,
      orderCaseV2.executableCase.id
    ].sort());
    expect(orderCaseV1.executableCase.status).toBe("stale");
    expect(orderCaseV2.executableCase.status).toBe("stale");
    expect(hrCase.executableCase.status).toBe("ready");
    expect(impact.affectedTestIntentIds).not.toContain(hrCase.intent.id);
  });
});

async function requirement(knowledge: KnowledgeService, projectId: string, key: string, title: string) {
  return (await knowledge.ingestRequirement({
    projectId,
    contentPackage: {
      title,
      content: `# ${title}\n\nThe system must support ${title}.`,
      blocks: [],
      attachments: [],
      source: `golden://${key}.md`,
      sourceType: "local-file",
      contentHash: key,
      warnings: []
    }
  })).requirementSet;
}

function systemInput(name: string, baseUrl: string) {
  return {
    name,
    environment: "test",
    baseUrl,
    urlAllowlist: [baseUrl],
    defaultLocale: "en-US"
  };
}

function brain(
  knowledgeProjectId: string,
  systemId: string,
  pageModelId: string,
  route: string,
  action: string,
  afterValue: string
): SystemBrain {
  return {
    knowledgeProjectId,
    systemId,
    pages: [{
      pageModelId,
      name: action === "Approve" ? "Orders" : "Employees",
      route,
      version: 1,
      screenshotId: "golden-screenshot",
      locatorCount: 1,
      probeIssueCount: 0,
      locators: [],
      probeResultIds: [],
      sourceRefs: [`page-model:${pageModelId}`]
    }],
    workflows: [],
    behaviorRules: [],
    apiFlows: [],
    navigationEdges: [],
    states: [],
    stateTransitions: [{
      id: `transition-${systemId}`,
      explorationId: `exploration-${systemId}`,
      pageModelId,
      pageUrl: route,
      targetName: action,
      targetRole: "button",
      targetSelector: "#action",
      targetKind: "tab",
      action: "click",
      beforeStateId: "before",
      afterStateId: "after",
      visibleAdded: [afterValue],
      visibleRemoved: [],
      dialogAdded: [],
      dialogRemoved: [],
      changedControls: [{ name: "status", before: "pending", after: afterValue }],
      urlChanged: false,
      transitionKind: "state",
      sourceRefs: [`system-transition:${systemId}`]
    }],
    observations: [],
    conflicts: [],
    readiness: {
      pageEvidence: true,
      locatorEvidence: true,
      workflowEvidence: false,
      apiEvidence: false,
      navigationEvidence: false,
      stateEvidence: true,
      readyForCompilation: true
    }
  };
}

function createCase(
  knowledgeProjectId: string,
  requirementSet: RequirementSet,
  systemId: string,
  title: string,
  systemBrainSnapshotId: string
) {
  const intent: TestIntent = {
    id: `${systemId}-${requirementSet.id}-intent`,
    knowledgeProjectId,
    requirementSetId: requirementSet.id,
    title,
    module: "Golden",
    priority: "P1",
    objective: title,
    preconditions: [],
    expectedResults: ["The workflow completes."],
    requirementRefs: [`requirement:${requirementSet.id}`],
    knowledgeNodeRefs: [],
    techniques: ["scenario"],
    status: "approved",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const executableCase: ExecutableCase = {
    id: `${systemId}-${requirementSet.id}-case`,
    knowledgeProjectId,
    requirementSetId: requirementSet.id,
    testIntentId: intent.id,
    systemId,
    title,
    status: "ready",
    preconditions: [],
    steps: [{
      id: `${intent.id}-step`,
      order: 1,
      action: "assert",
      instruction: "Verify the workflow state",
      targetSemantic: "workflow state",
      assertion: { type: "state", strength: "strong", expected: "approved" },
      origin: "source",
      sourceRefs: intent.requirementRefs
    }],
    dataProfileIds: [],
    gapIds: [],
    systemBrainSnapshotId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return { intent, executableCase };
}
