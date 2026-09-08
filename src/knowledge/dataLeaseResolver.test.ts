// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { ExecutableCase, TestDataLease } from "../domain/types.js";
import { findActiveTestDataLease } from "./dataLeaseResolver.js";

describe("cross-case data lease resolution", () => {
  it("resolves only the active lease from the declared producer case", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const producer = executableCase("case-producer", "intent-create");
    const consumer = executableCase("case-consumer", "intent-edit");
    consumer.caseDependencyGraph = {
      requirementSetId: "requirement-1",
      systemId: "system-hr",
      nodes: [],
      edges: [{
        id: "edge-1",
        fromTestIntentId: producer.testIntentId,
        toTestIntentId: consumer.testIntentId,
        entityReference: "employee:testperson001",
        relation: "requires",
        sourceRefs: ["requirement:employee-edit"]
      }],
      dependencyOrder: [producer.testIntentId, consumer.testIntentId],
      unresolved: [],
      verdict: "ready",
      sourceRefs: ["requirement:employee-edit"],
      generatedAt: new Date(0).toISOString()
    };
    repository.executableCases.push(producer, consumer);
    const lease = dataLease(producer.id);
    repository.testDataLeases.push(lease);

    expect(findActiveTestDataLease(repository, consumer, "system-hr", {
      profileId: "entity:employee%3Atestperson001",
      entityReference: "employee:testperson001"
    })).toBe(lease);
  });

  it("does not reuse a lease when the producer is ambiguous or unrelated", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const producer = executableCase("case-producer", "intent-create");
    const consumer = executableCase("case-consumer", "intent-edit");
    repository.executableCases.push(producer, consumer);
    repository.testDataLeases.push(dataLease(producer.id));

    expect(findActiveTestDataLease(repository, consumer, "system-hr", {
      profileId: "entity:employee%3Atestperson001",
      entityReference: "employee:testperson001"
    })).toBeUndefined();
  });
});

function executableCase(id: string, testIntentId: string): ExecutableCase {
  return {
    id,
    knowledgeProjectId: "project-1",
    requirementSetId: "requirement-1",
    testIntentId,
    systemId: "system-hr",
    title: id,
    status: "ready",
    preconditions: [],
    steps: [],
    dataProfileIds: [],
    gapIds: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

function dataLease(executableCaseId: string): TestDataLease {
  return {
    id: "lease-employee",
    knowledgeProjectId: "project-1",
    systemId: "system-hr",
    executableCaseId,
    profileId: "profile-employee",
    taskId: "task-employee",
    decision: "create",
    reference: "employee:001",
    entityReference: "employee:testperson001",
    cleanup: "delete-created",
    status: "active",
    sourceRefs: ["case:create-employee"],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}
