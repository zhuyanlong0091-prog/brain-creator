import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { KnowledgeService } from "./service.js";

it("keeps ambiguous requirement transitions pending exploration instead of compiling the first action", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bc-semantic-ambiguity-"));
  try {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, directory);
    const project = await service.createProject({ name: "Orders", key: "orders", defaultLocale: "en-US" });
    const now = new Date().toISOString();
    repository.systemProfiles.push({ id: "orders", name: "Orders", environment: "test", baseUrl: "https://orders.example.test", defaultLocale: "en-US", urlAllowlist: ["https://orders.example.test"], status: "succeeded", createdAt: now, updatedAt: now });
    service.bindSystem(project.id, "orders");
    const source = await service.ingestRequirement({ projectId: project.id, contentPackage: {
      title: "Order review", content: "An order can be submitted or cancelled.",
      blocks: [{ type: "paragraph", text: "An order can be submitted or cancelled." }],
      attachments: [], source: "orders.md", sourceType: "local-file", contentHash: "orders-v1", warnings: []
    } });
    const design = await service.generateTestDesign(source.requirementSet.id);
    const intent = design.testIntents[0];
    repository.stateMachineModels.push({
      id: "order-states", knowledgeProjectId: project.id, requirementSetId: source.requirementSet.id,
      attachmentAnalysisId: "fixture-analysis", title: "Order states", status: "confirmed", confidence: 1,
      sourceRefs: intent.requirementRefs, createdAt: now, updatedAt: now,
      states: ["draft", "submitted", "cancelled"].map((id) => ({ id, label: id, initial: id === "draft", terminal: id !== "draft", sourceRefs: intent.requirementRefs })),
      transitions: [
        { id: "submit", from: "draft", to: "submitted", trigger: "Submit", sourceRefs: intent.requirementRefs },
        { id: "cancel", from: "draft", to: "cancelled", trigger: "Cancel", sourceRefs: intent.requirementRefs }
      ]
    });
    intent.processModelRefs = ["order-states"];
    service.approveRequirementSet(source.requirementSet.id);
    const result = service.compileExecutableCases(intent.id, "orders");
    expect(result.executableCase.status).toBe("ambiguous");
    expect(result.executableCase.steps).toEqual([]);
    expect(result.executableCase.compilationStages?.[0].verdict).toBe("ambiguous");
    const tasks = repository.explorationTasks.filter((task) => result.executableCase.explorationTaskIds?.includes(task.id));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ kind: "state-action", status: "pending", systemId: "orders" });
    expect(tasks[0].sourceRefs).toEqual(expect.arrayContaining(intent.requirementRefs));
    expect(result.gaps).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
