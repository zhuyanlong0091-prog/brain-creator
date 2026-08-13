// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { KnowledgeService } from "./service.js";

describe("TestIntent coverage ledger", () => {
  it("classifies every intent by execution evidence or explicit non-execution state", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, ".brain-creator/test-knowledge");
    const project = await service.createProject({ name: "Coverage", key: "coverage-ledger", defaultLocale: "en-US" });
    const sets = [
      ["set-strong", "approved"],
      ["set-limited", "approved"],
      ["set-blocked", "approved"],
      ["set-not-selected", "approved"],
      ["set-superseded", "superseded"]
    ] as const;
    for (const [id, status] of sets) {
      repository.requirementSources.push({
        id: `source-${id}`,
        knowledgeProjectId: project.id,
        source: `docs/${id}.md`,
        sourceType: "local-file",
        title: id,
        contentHash: id,
        content: "Requirement content",
        blocks: [{ type: "paragraph", text: "Requirement content" }],
        attachments: id === "set-strong" ? [{ name: "flow.png", type: "image/png" }] : [],
        warnings: [],
        accessStatus: "available",
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      repository.requirementSets.push({
        id,
        knowledgeProjectId: project.id,
        sourceId: `source-${id}`,
        version: 1,
        title: id,
        summary: id,
        contentHash: id,
        status,
        affectedNodeIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    for (const [index, [requirementSetId]] of sets.entries()) {
      repository.testIntents.push({
        id: `intent-${index}`,
        knowledgeProjectId: project.id,
        requirementSetId,
        title: `Intent ${index}`,
        module: "Orders",
        priority: "P1",
        objective: "Verify behavior",
        preconditions: [],
        expectedResults: ["Pass"],
        requirementRefs: [`requirement:${index}`],
        knowledgeNodeRefs: [`node:${index}`],
        techniques: ["scenario"],
        status: "compiled",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    for (const [index, classification] of (["strong", "limited", "blocked"] as const).entries()) {
      const caseId = `case-${index}`;
      repository.executableCases.push({
        id: caseId,
        knowledgeProjectId: project.id,
        requirementSetId: sets[index][0],
        testIntentId: `intent-${index}`,
        title: caseId,
        status: classification === "blocked" ? "blocked" : "executed",
        preconditions: [],
        steps: [],
        dataProfileIds: [],
        gapIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      repository.executionEvidence.push({
        id: `evidence-${index}`,
        knowledgeProjectId: project.id,
        systemId: "system-1",
        executableCaseId: caseId,
        testCaseId: `test-${index}`,
        contextPackPath: "context.json",
        status: classification === "blocked" ? "blocked" : "passed",
        assuranceLevel: classification === "blocked" ? "none" : classification,
        steps: [],
        tracePaths: [],
        artifactPaths: [],
        consoleErrors: [],
        networkFailures: [],
        createdAt: new Date().toISOString()
      });
    }

    const ledger = service.testIntentCoverage(project.id);
    expect(ledger.total).toBe(5);
    expect(ledger.counts).toEqual({
      "strong-verified": 1,
      limited: 1,
      blocked: 1,
      "not-selected": 1,
      superseded: 1
    });
    expect(ledger.items.every((item) => item.requirementRefs.length === 1)).toBe(true);
    expect(service.requirementSourceLedger(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "source-set-strong",
          attachmentCount: 1,
          unreadAttachments: [expect.objectContaining({ status: "unread" })]
        })
      ])
    );

    repository.executableCases[0].systemId = "system-a";
    repository.executionEvidence[0].systemId = "system-a";
    const systemLedger = service.testIntentCoverage(project.id, "system-a");
    expect(systemLedger.counts).toEqual({
      "strong-verified": 1,
      "not-selected": 3,
      superseded: 1
    });
    expect(systemLedger.items.find((item) => item.testIntentId === "intent-0")).toEqual(
      expect.objectContaining({ classification: "strong-verified" })
    );
    expect(systemLedger.items.find((item) => item.testIntentId === "intent-1")).toEqual(
      expect.objectContaining({ classification: "not-selected" })
    );
  });
});
