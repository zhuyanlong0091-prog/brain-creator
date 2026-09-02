import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { TestDataProfile } from "../domain/types.js";
import {
  buildScenarioDataPlan,
  InMemoryTestDataProvider,
  TestDataBrainService
} from "./testdata.js";
import type { BusinessScenario } from "./types.js";

describe("Testdata Brain", () => {
  it("keeps entity dependencies explicit and executes the provider lifecycle", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const provider = new InMemoryTestDataProvider("fixture-provider");
    const service = new TestDataBrainService(repository, [provider]);

    const employee = await service.create({
      systemId: "system-hr",
      entityType: "employee",
      key: "testperson001",
      values: { name: "testperson001", status: "active" },
      sourceRefs: ["recipe:employee"]
    });
    const offer = await service.create({
      systemId: "system-hr",
      entityType: "offer",
      key: "offer-001",
      values: { employee: employee.reference },
      sourceRefs: ["recipe:offer"]
    });
    service.linkDependency({
      systemId: "system-hr",
      fromReference: offer.reference,
      toReference: employee.reference,
      relation: "requires",
      sourceRefs: ["case:offer-approval"]
    });

    await service.transition({
      systemId: "system-hr",
      reference: offer.reference,
      transition: "approved",
      sourceRefs: ["workflow:offer-approval"]
    });
    const verified = await service.verify({
      systemId: "system-hr",
      reference: offer.reference,
      expected: { status: "approved" },
      sourceRefs: ["assertion:offer-approved"]
    });
    expect(verified.status).toBe("verified");
    expect(service.graph("system-hr").dependencies).toEqual([
      expect.objectContaining({
        fromReference: offer.reference,
        toReference: employee.reference,
        relation: "requires"
      })
    ]);

    await service.cleanup({ systemId: "system-hr", reference: offer.reference, sourceRefs: ["cleanup:offer"] });
    expect(repository.businessEntityInstances.find((item) => item.id === offer.entityId)?.status).toBe("released");
    expect(provider.calls).toEqual(["create", "create", "transition", "verify", "cleanup"]);
  });

  it("rejects cross-system dependencies and missing providers", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new TestDataBrainService(repository, []);
    await expect(service.lookup({ systemId: "system-orders", entityType: "order", key: "order-1" }))
      .rejects.toThrow(/provider/i);
    expect(() => service.linkDependency({
      systemId: "system-orders",
      fromReference: "system-hr:employee:1",
      toReference: "system-orders:order:1",
      relation: "requires",
      sourceRefs: ["case:cross-system"]
    })).toThrow(/same system/i);
  });

  it("rejects dependencies whose entities belong to another system", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const provider = new InMemoryTestDataProvider("fixture-provider");
    const service = new TestDataBrainService(repository, [provider]);
    const employee = await service.create({
      systemId: "system-hr",
      entityType: "employee",
      key: "employee-1"
    });
    const order = await service.create({
      systemId: "system-orders",
      entityType: "order",
      key: "order-1"
    });

    expect(() => service.linkDependency({
      systemId: "system-orders",
      fromReference: order.reference,
      toReference: employee.reference,
      relation: "requires",
      sourceRefs: ["case:cross-system-entity"]
    })).toThrow(/unknown entity|same system/i);
  });

  it("builds a scenario data plan with explicit entity dependencies", () => {
    const scenario: BusinessScenario = {
      id: "scenario-offer-approval",
      knowledgeProjectId: "knowledge-hr",
      requirementSetId: "requirement-hr",
      title: "Approve an offer for an employee",
      objective: "Create an offer and approve it for an existing employee.",
      family: "cross-role",
      actors: ["recruiter", "approver"],
      preconditions: [],
      workflowRefs: ["workflow-offer"],
      stateTransitionRefs: ["transition-offer-approve"],
      decisionRuleRefs: [],
      testDataNeeds: ["profile-employee", "profile-offer"],
      expectedBusinessOutcomes: ["The offer is approved."],
      sourceRefs: ["requirement:offer-approval"],
      risk: "high",
      status: "draft"
    };
    const profiles: TestDataProfile[] = [
      {
        id: "profile-employee",
        knowledgeProjectId: scenario.knowledgeProjectId,
        requirementSetId: scenario.requirementSetId,
        name: "Employee",
        field: "Employee",
        strategy: "existing-reference",
        constraints: ["status=active"],
        seed: "employee:testperson001",
        entityReference: "employee:testperson001",
        cleanup: "none",
        sourceRefs: ["requirement:offer-approval"],
        createdAt: new Date(0).toISOString()
      },
      {
        id: "profile-offer",
        knowledgeProjectId: scenario.knowledgeProjectId,
        requirementSetId: scenario.requirementSetId,
        name: "Offer",
        field: "Offer",
        strategy: "generated",
        constraints: ["status=draft"],
        seed: "offer-seed",
        entityReference: "offer:generated",
        dependsOnFields: ["Employee"],
        cleanup: "delete-created",
        sourceRefs: ["requirement:offer-approval"],
        createdAt: new Date(0).toISOString()
      }
    ];

    const plan = buildScenarioDataPlan({
      scenario,
      profiles,
      entities: [{
        id: "entity-employee",
        entityKey: "employee:001",
        entityReference: "employee:testperson001",
        semanticConceptId: "object:employee",
        systemId: "system-hr",
        values: { status: "active" },
        status: "active",
        sourceRefs: ["fixture:employee"],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      }]
    });

    expect(plan).toEqual(expect.objectContaining({
      readiness: "creatable",
      profileIds: scenario.testDataNeeds,
      entityReferences: ["employee:testperson001", "offer:generated"],
      plannedLifecycle: ["lookup", "create", "transition", "verify", "cleanup"]
    }));
    expect(plan.dependencies).toEqual([
      expect.objectContaining({
        entityReference: "offer:generated",
        dependsOnEntityReferences: ["employee:testperson001"]
      })
    ]);
    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        profileId: "profile-employee",
        action: "lookup",
        readiness: "ready"
      }),
      expect.objectContaining({
        profileId: "profile-offer",
        action: "create",
        readiness: "creatable"
      })
    ]));
  });

  it("blocks an existing-reference scenario when the required entity is unavailable", () => {
    const scenario: BusinessScenario = {
      id: "scenario-missing-employee",
      knowledgeProjectId: "knowledge-hr",
      requirementSetId: "requirement-hr",
      title: "Edit an employee",
      objective: "Edit an existing employee.",
      family: "main-flow",
      actors: ["recruiter"],
      preconditions: [],
      workflowRefs: [],
      stateTransitionRefs: [],
      decisionRuleRefs: [],
      testDataNeeds: ["profile-employee"],
      expectedBusinessOutcomes: ["The employee is updated."],
      sourceRefs: ["requirement:employee-edit"],
      risk: "medium",
      status: "draft"
    };
    const profiles: TestDataProfile[] = [{
      id: "profile-employee",
      knowledgeProjectId: scenario.knowledgeProjectId,
      requirementSetId: scenario.requirementSetId,
      name: "Employee",
      field: "Employee",
      strategy: "existing-reference",
      constraints: [],
      seed: "employee:testperson001",
      entityReference: "employee:testperson001",
      cleanup: "none",
      sourceRefs: scenario.sourceRefs,
      createdAt: new Date(0).toISOString()
    }];

    const plan = buildScenarioDataPlan({ scenario, profiles, entities: [] });

    expect(plan.readiness).toBe("blocked");
    expect(plan.missingEntityReferences).toEqual(["employee:testperson001"]);
    expect(plan.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("employee:testperson001")
    ]));
  });

  it("records provider lifecycle and rejects unknown entity transitions", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const provider = new InMemoryTestDataProvider("fixture-provider");
    const service = new TestDataBrainService(repository, [provider]);

    await expect(service.transition({
      systemId: "system-orders",
      reference: "order:missing",
      transition: "approved",
      sourceRefs: ["test:missing"]
    })).rejects.toThrow(/unknown/i);

    const order = await service.create({
      systemId: "system-orders",
      entityType: "order",
      entityReference: "order:1001",
      reference: "order:1001",
      values: { status: "draft" },
      sourceRefs: ["test:order-create"]
    });
    await service.transition({
      systemId: "system-orders",
      reference: order.reference,
      transition: "approved",
      sourceRefs: ["test:order-approve"]
    });
    await service.verify({
      systemId: "system-orders",
      reference: order.reference,
      expected: { status: "approved" },
      sourceRefs: ["test:order-verify"]
    });
    await service.cleanup({
      systemId: "system-orders",
      reference: order.reference,
      sourceRefs: ["test:order-cleanup"]
    });

    const entity = repository.businessEntityInstances.find(
      (item) => item.entityKey === order.reference
    );
    expect(entity?.lifecycleEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "create", provider: "fixture-provider" }),
      expect.objectContaining({ operation: "transition", provider: "fixture-provider" }),
      expect.objectContaining({ operation: "verify", provider: "fixture-provider" }),
      expect.objectContaining({ operation: "cleanup", provider: "fixture-provider" })
    ]));
    expect(entity?.status).toBe("released");
  });
});
