// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBrainCreatorMcpContext, handleBrainCreatorTool } from "./handlers.js";
import type { RequirementSet, TestIntent } from "../domain/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Testdata Brain facade", () => {
  it("reviews a system-scoped entity dependency graph", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-testdata-facade-"));
    tempDirs.push(workDir);
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const system = context.service.createSystemProfile({
      name: "Orders",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"]
    });
    const project = await context.knowledgeService.createProject({
      name: "Orders knowledge",
      key: "orders-testdata-facade",
      defaultLocale: "en-US"
    });
    context.knowledgeService.bindSystem(project.id, system.id);

    const order = await context.testDataBrain.create({
      systemId: system.id,
      entityType: "order",
      reference: "order:1001",
      values: { status: "draft" },
      sourceRefs: ["testdata:order-1001"]
    });
    const approval = await context.testDataBrain.create({
      systemId: system.id,
      entityType: "approval",
      reference: "approval:1001",
      sourceRefs: ["testdata:approval-1001"]
    });
    context.testDataBrain.linkDependency({
      systemId: system.id,
      fromReference: order.reference,
      toReference: approval.reference,
      relation: "requires",
      sourceRefs: ["requirement:order-approval"]
    });

    const result = await handleBrainCreatorTool(context, "bc_review", {
      target: "testdata",
      knowledgeProjectId: project.id,
      systemId: system.id,
      responseMode: "full"
    });
    const payload = JSON.parse(result.content[0].type === "text" ? result.content[0].text : "{}");

    expect(payload.data.totals).toEqual({ entities: 2, dependencies: 1 });
    expect(payload.data.systems[0].dependencies[0]).toEqual(
      expect.objectContaining({
        fromReference: "order:1001",
        toReference: "approval:1001",
        relation: "requires"
      })
    );
  });

  it("reviews explicit cross-case dependencies through the facade", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-creator-case-dependency-facade-"));
    tempDirs.push(workDir);
    const context = createBrainCreatorMcpContext({
      workDir,
      dataFilePath: join(workDir, "assets.json")
    });
    const system = context.service.createSystemProfile({
      name: "Orders",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"]
    });
    const project = await context.knowledgeService.createProject({
      name: "Orders knowledge",
      key: "orders-case-dependency-facade",
      defaultLocale: "en-US"
    });
    context.knowledgeService.bindSystem(project.id, system.id);
    const now = new Date(0).toISOString();
    const requirementSet: RequirementSet = {
      id: "requirement-orders-dependencies",
      knowledgeProjectId: project.id,
      sourceId: "source-orders-dependencies",
      version: 1,
      title: "Order lifecycle",
      summary: "Create then edit an order",
      contentHash: "orders-dependencies-hash",
      status: "approved",
      affectedNodeIds: [],
      createdAt: now,
      updatedAt: now
    };
    const producer: TestIntent = intent("intent-order-create", project.id, requirementSet.id, {
      producesEntityRefs: ["order:1001"]
    });
    const consumer: TestIntent = intent("intent-order-edit", project.id, requirementSet.id, {
      consumesEntityRefs: ["order:1001"]
    });
    context.repository.requirementSets.push(requirementSet);
    context.repository.testIntents.push(consumer, producer);

    const result = await handleBrainCreatorTool(context, "bc_review", {
      target: "case-dependency",
      knowledgeProjectId: project.id,
      systemId: system.id,
      responseMode: "full"
    });
    const payload = JSON.parse(result.content[0].type === "text" ? result.content[0].text : "{}");

    expect(payload.data.items[0]).toEqual(expect.objectContaining({
      verdict: "ready",
      edges: [expect.objectContaining({
        fromTestIntentId: producer.id,
        toTestIntentId: consumer.id,
        entityReference: "order:1001"
      })]
    }));
  });
});

function intent(id: string, projectId: string, requirementSetId: string, overrides: Partial<TestIntent> = {}): TestIntent {
  return {
    id,
    knowledgeProjectId: projectId,
    requirementSetId,
    title: id,
    module: "Orders",
    priority: "P1",
    objective: "Use an order",
    preconditions: [],
    expectedResults: ["The order is accepted"],
    requirementRefs: [`requirement:${id}`],
    knowledgeNodeRefs: [],
    techniques: ["scenario"],
    status: "approved",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides
  };
}
