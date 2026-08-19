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
