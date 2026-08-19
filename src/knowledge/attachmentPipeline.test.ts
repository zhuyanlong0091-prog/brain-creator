// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { KnowledgeService } from "./service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("requirement attachment pipeline", () => {
  it("downloads and recognizes an attachment before it can create a Gap", async () => {
    const root = await tempDir();
    const imagePath = join(root, "flow.png");
    await writeFile(imagePath, Buffer.from("image"));
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"));
    const project = await service.createProject({ name: "Order", key: "order", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order flow",
        content: "Orders require approval.",
        blocks: [{ type: "paragraph", text: "Orders require approval." }],
        attachments: [{ name: "flow.png", url: imagePath }],
        source: join(root, "requirement.md"),
        sourceType: "local-file",
        contentHash: "attachment-hash",
        warnings: []
      }
    });

    expect(repository.gaps).toEqual([]);
    expect(ingested.source.attachments[0]).toEqual(
      expect.objectContaining({ status: "discovered", attempts: 0, sourceId: ingested.source.id })
    );

    const prepared = await service.prepareRequirementAttachments({
      sourceId: ingested.source.id,
      analyzer: async () => ({
        kind: "state-machine",
        markdown: "Draft -> Approved",
        nodes: [
          { id: "draft", type: "state", label: "Draft" },
          { id: "approved", type: "state", label: "Approved" }
        ],
        edges: [{ from: "draft", to: "approved", condition: "approve", actor: "manager" }],
        confidence: 0.94
      })
    });

    expect(prepared.gaps).toEqual([]);
    expect(prepared.analyses).toEqual([
      expect.objectContaining({ kind: "state-machine", status: "draft", provider: "adapter" })
    ]);
    expect(ingested.source.attachments[0].status).toBe("structured");
  });

  it("returns a host-agent recognition request when no visual adapter is configured", async () => {
    const { service, sourceId } = await fixtureWithAttachment();

    const prepared = await service.prepareRequirementAttachments({ sourceId });

    expect(prepared.recognitionRequests).toEqual([
      expect.objectContaining({ attachmentId: expect.any(String), localPath: expect.any(String) })
    ]);
    expect(prepared.gaps).toEqual([]);
  });

  it("retries visual recognition once before creating a Gap", async () => {
    const { service, sourceId } = await fixtureWithAttachment();
    const analyzer = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary vision failure"))
      .mockResolvedValueOnce({
        kind: "table",
        markdown: "| Field | Rule |\n| --- | --- |",
        nodes: [],
        edges: [],
        confidence: 0.8
      });

    const prepared = await service.prepareRequirementAttachments({ sourceId, analyzer });

    expect(analyzer).toHaveBeenCalledTimes(2);
    expect(prepared.analyses).toHaveLength(1);
    expect(prepared.gaps).toEqual([]);
  });

  it("creates one actionable Gap only after download retries are exhausted", async () => {
    const root = await tempDir();
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"));
    const project = await service.createProject({ name: "Order", key: "failed", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order flow",
        content: "Orders require approval.",
        blocks: [{ type: "paragraph", text: "Orders require approval." }],
        attachments: [{ name: "flow.png", url: "https://example.test/flow.png" }],
        source: "https://example.test/requirements",
        sourceType: "http",
        contentHash: "failed-hash",
        warnings: []
      }
    });
    const fetcher = vi.fn(async () => new Response("denied", { status: 403 }));

    const prepared = await service.prepareRequirementAttachments({
      sourceId: ingested.source.id,
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(prepared.gaps).toEqual([
      expect.objectContaining({ sourceType: "requirement-attachment", status: "open" })
    ]);
    expect(prepared.gaps[0].reason).toContain("3 download attempts");
  });

  it("rejects local attachment paths outside the requirement directory", async () => {
    const root = await tempDir();
    const requirementDir = join(root, "requirements");
    await mkdir(requirementDir, { recursive: true });
    const secretPath = join(root, "secret.png");
    await writeFile(secretPath, Buffer.from("secret"));
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"), root);
    const project = await service.createProject({ name: "Order", key: "path-guard", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order",
        content: "Orders require approval.",
        blocks: [{ type: "paragraph", text: "Orders require approval." }],
        attachments: [{ name: "secret.png", url: secretPath }],
        source: join(requirementDir, "requirement.md"),
        sourceType: "local-file",
        contentHash: "path-guard",
        warnings: []
      }
    });

    const prepared = await service.prepareRequirementAttachments({ sourceId: ingested.source.id });

    expect(prepared.gaps[0].reason).toContain("must stay inside the requirement source directory");
    expect(ingested.source.attachments[0].localPath).toBeUndefined();
  });

  it("validates host output and requires confirmation before marking analysis confirmed", async () => {
    const { service, sourceId } = await fixtureWithAttachment();
    const prepared = await service.prepareRequirementAttachments({ sourceId });
    const request = prepared.recognitionRequests[0];
    const submitted = service.submitRequirementAttachmentAnalysis({
      sourceId,
      attachmentId: request.attachmentId,
      provider: "host-agent",
      result: {
        kind: "flowchart",
        markdown: "Start -> Submit",
        nodes: [{ id: "start", type: "step", label: "Start" }],
        edges: [],
        confidence: 0.88
      }
    });

    expect(submitted.status).toBe("draft");
    const confirmed = service.confirmRequirementAttachmentAnalysis({
      analysisId: submitted.id,
      confirmedBy: "qa"
    });
    expect(confirmed.status).toBe("confirmed");
  });

  it("blocks approval before critical process evidence is confirmed without creating a premature Gap", async () => {
    const root = await tempDir();
    const imagePath = join(root, "approval-flow.png");
    await writeFile(imagePath, Buffer.from("image"));
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"));
    const project = await service.createProject({ name: "Order", key: "process-gate", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order approval",
        content: "Orders require approval.",
        blocks: [{ type: "paragraph", text: "Orders require approval." }],
        attachments: [{ name: "approval-flow.png", url: imagePath }],
        source: join(root, "requirement.md"),
        sourceType: "local-file",
        contentHash: "process-gate-hash",
        warnings: []
      }
    });

    const design = await service.generateTestDesign(ingested.requirementSet.id);

    expect(design.evaluationGate.status).toBe("blocked");
    expect(design.evaluation.verdict).toBe("blocked");
    expect(design.evaluation.requiredActions).toContain(
      "Analyze and confirm critical process attachments"
    );
    expect(design.evaluationGate.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "unconfirmed-attachment", status: "blocked" })])
    );
    expect(repository.gaps).toEqual([]);
    expect(() => service.approveRequirementSet(ingested.requirementSet.id)).toThrow(
      "Blocked Requirement Eval output cannot be approved"
    );
  });

  it("rebuilds test design with workflow and state coverage after attachment confirmation", async () => {
    const root = await tempDir();
    const imagePath = join(root, "approval-state.png");
    await writeFile(imagePath, Buffer.from("image"));
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, join(root, "knowledge"));
    const project = await service.createProject({ name: "Order", key: "process-design", defaultLocale: "en-US" });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Order lifecycle",
        content: "Orders have a lifecycle.",
        blocks: [{ type: "paragraph", text: "Orders have a lifecycle." }],
        attachments: [{ name: "approval-state.png", url: imagePath }],
        source: join(root, "requirement.md"),
        sourceType: "local-file",
        contentHash: "process-design-hash",
        warnings: []
      }
    });
    const before = await service.generateTestDesign(ingested.requirementSet.id);
    const prepared = await service.prepareRequirementAttachments({
      sourceId: ingested.source.id,
      analyzer: async () => ({
        kind: "state-machine",
        markdown: "Draft -> Submitted -> Approved",
        nodes: [
          { id: "draft", type: "state", label: "Draft" },
          { id: "submitted", type: "state", label: "Submitted" },
          { id: "approved", type: "state", label: "Approved" }
        ],
        edges: [
          { from: "draft", to: "submitted", condition: "submit", actor: "requester" },
          { from: "submitted", to: "approved", condition: "approve", actor: "manager" }
        ],
        confidence: 0.96
      })
    });
    service.confirmRequirementAttachmentAnalysis({
      analysisId: prepared.analyses[0].id,
      confirmedBy: "qa"
    });

    const after = await service.generateTestDesign(ingested.requirementSet.id);

    expect(before.testIntents).toHaveLength(1);
    expect(after.reused).toBeUndefined();
    expect(after.stateMachineModels).toHaveLength(1);
    expect(after.coverageProfile.status).toBe("complete");
    expect(after.coverageProfile.dimensions.state.missingRefs).toEqual([]);
    expect(after.testIntents.length).toBeGreaterThan(before.testIntents.length);
    expect(after.testIntents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scenarioType: "positive", processModelRefs: [after.stateMachineModels[0].id] }),
        expect.objectContaining({ scenarioType: "negative" })
      ])
    );
    expect(after.testIntents.every((intent) => intent.requirementRefs.length > 0)).toBe(true);
  });
});

async function fixtureWithAttachment() {
  const root = await tempDir();
  const imagePath = join(root, "flow.png");
  await writeFile(imagePath, Buffer.from("image"));
  const repository = new InMemoryBrainCreatorRepository();
  const service = new KnowledgeService(repository, join(root, "knowledge"));
  const project = await service.createProject({ name: "Order", key: "fixture", defaultLocale: "en-US" });
  const ingested = await service.ingestRequirement({
    projectId: project.id,
    contentPackage: {
      title: "Order flow",
      content: "Orders require approval.",
      blocks: [{ type: "paragraph", text: "Orders require approval." }],
      attachments: [{ name: "flow.png", url: imagePath }],
      source: join(root, "requirement.md"),
      sourceType: "local-file",
      contentHash: "fixture-hash",
      warnings: []
    }
  });
  return { service, sourceId: ingested.source.id };
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-attachment-"));
  tempDirs.push(dir);
  return dir;
}
