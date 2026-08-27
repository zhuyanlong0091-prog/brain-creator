import { describe, expect, it, vi } from "vitest";
import { SemanticSpineService } from "./semanticSpine.js";

function store() {
  return {
    semanticConcepts: [],
    semanticAliases: [],
    semanticRelations: [],
    businessEntityInstances: [],
    persist: vi.fn()
  };
}

describe("SemanticSpineService", () => {
  it("keeps one semantic action when requirement and system labels differ", () => {
    const repository = store();
    const spine = new SemanticSpineService(repository);
    const concept = spine.upsertConcept({
      identityKey: "recruitment-demand.create",
      kind: "action",
      canonicalName: "create",
      aliases: ["新增"],
      systemId: "system-a",
      sourceRefs: ["requirement:clause-1"]
    });
    spine.upsertAlias(concept.id, "新建", ["page:page-1"], 0.95, "confirmed");

    expect(spine.resolve("新增", { systemId: "system-a" })?.id).toBe(concept.id);
    expect(spine.resolve("新建", { systemId: "system-a" })?.id).toBe(concept.id);
    expect(repository.semanticConcepts).toHaveLength(1);
  });

  it("reuses the same business entity instance across dependent cases", () => {
    const repository = store();
    const spine = new SemanticSpineService(repository);
    const employee = spine.upsertConcept({ identityKey: "employee", kind: "data-entity", canonicalName: "employee" });
    const first = spine.upsertEntity({
      entityKey: "employee:testperson001",
      semanticConceptId: employee.id,
      values: { name: "testperson001" },
      systemId: "system-a",
      sourceRefs: ["case:create-employee"]
    });
    const second = spine.upsertEntity({
      entityKey: "employee:testperson001",
      semanticConceptId: employee.id,
      values: { name: "testperson001", status: "active" },
      systemId: "system-a",
      sourceRefs: ["case:edit-employee"]
    });

    expect(second.id).toBe(first.id);
    expect(second.values).toEqual({ name: "testperson001", status: "active" });
    expect(repository.businessEntityInstances).toHaveLength(1);
  });
});
