import { describe, expect, it, vi } from "vitest";
import {
  BUILTIN_SEMANTIC_ALIAS_POLICY,
  SemanticSpineService,
  canonicalActionAlias
} from "./semanticSpine.js";

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
  it("uses an auditable, domain-neutral alias policy", () => {
    expect(BUILTIN_SEMANTIC_ALIAS_POLICY).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonical: "create", aliases: expect.arrayContaining(["新增", "新建"]) }),
      expect.objectContaining({ canonical: "edit", aliases: expect.arrayContaining(["编辑", "修改"]) })
    ]));
    expect(canonicalActionAlias("新增需求")).toBe("create需求");
    expect(canonicalActionAlias("修改订单")).toBe("edit订单");
    expect(canonicalActionAlias("审批通过")).toBe("approve");
    expect(canonicalActionAlias("Address details")).toBe("addressdetails");
  });

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

  it("maps requirement action synonyms to a system action concept", () => {
    const repository = store();
    const spine = new SemanticSpineService(repository);
    const systemAction = spine.upsertConcept({
      identityKey: "action:recruitment-demand:create",
      kind: "action",
      canonicalName: "create",
      aliases: ["新建"],
      knowledgeProjectId: "knowledge-hr",
      systemId: "system-hr",
      sourceRefs: ["system:page:recruitment"],
      status: "confirmed"
    });

    expect(spine.resolve("新增", {
      knowledgeProjectId: "knowledge-hr",
      systemId: "system-hr"
    })?.id).toBe(systemAction.id);
    expect(spine.resolve("创建", {
      knowledgeProjectId: "knowledge-hr",
      systemId: "system-hr"
    })?.canonicalName).toBe("create");
  });

  it("links requirement actions to the unique system action evidence", () => {
    const repository = store();
    const spine = new SemanticSpineService(repository);
    const requirementAction = spine.upsertConcept({
      identityKey: "requirement:requirement-1:action:create",
      kind: "action",
      canonicalName: "create",
      aliases: ["新增"],
      knowledgeProjectId: "knowledge-hr",
      requirementSetId: "requirement-1",
      sourceRefs: ["requirement:clause-1"],
      status: "confirmed"
    });
    const systemAction = spine.upsertConcept({
      identityKey: "action:recruitment:create",
      kind: "action",
      canonicalName: "create",
      aliases: ["新建"],
      knowledgeProjectId: "knowledge-hr",
      systemId: "system-hr",
      sourceRefs: ["system:transition-1"],
      status: "confirmed"
    });

    const relations = spine.linkRequirementActionsToSystem({
      knowledgeProjectId: "knowledge-hr",
      systemId: "system-hr"
    });

    expect(relations).toEqual([
      expect.objectContaining({
        fromConceptId: requirementAction.id,
        toConceptId: systemAction.id,
        relation: "maps-to-system-action",
        status: "confirmed"
      })
    ]);
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
