// @vitest-environment node

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { BrainCreatorService } from "./service.js";
import { ShardedFileBrainCreatorRepository } from "./repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ShardedFileBrainCreatorRepository", () => {
  it("writes schema 17 shards, required ownership directories, and rebuildable indexes", async () => {
    const root = await tempDir();
    const storeDir = join(root, ".brain-creator", "store");
    const legacyPath = join(root, ".brain-creator", "local-assets.json");
    const repository = new ShardedFileBrainCreatorRepository(storeDir, legacyPath);
    const service = new BrainCreatorService(repository);
    const system = service.createSystemProfile({
      name: "Orders",
      environment: "test",
      baseUrl: "https://orders.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://orders.example.test"]
    });
    repository.attachmentAnalyses.push({
      id: "analysis-1",
      knowledgeProjectId: "knowledge-1",
      requirementSetId: "requirement-1",
      sourceId: "source-1",
      attachmentId: "attachment-1",
      kind: "flowchart",
      markdown: "Start -> End",
      nodes: [],
      edges: [],
      confidence: 0.9,
      sourceRefs: ["attachment:attachment-1"],
      provider: "host-agent",
      status: "draft",
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z"
    });
    repository.persist();

    const manifest = JSON.parse(await readFile(join(storeDir, "manifest.json"), "utf8"));
    expect(manifest).toEqual(expect.objectContaining({ schemaVersion: 17, format: "sharded" }));
    expect(manifest.collections).toContain("systemProfiles");
    expect(manifest.collections).toContain("attachmentAnalyses");
    expect(existsSync(join(storeDir, "collections", "systemProfiles.json"))).toBe(true);
    expect(existsSync(join(storeDir, "systems", system.id, "system.json"))).toBe(true);
    expect(existsSync(join(storeDir, "indexes", "asset-index.json"))).toBe(true);

    const restored = new ShardedFileBrainCreatorRepository(storeDir, legacyPath);
    expect(restored.schemaVersion).toBe(17);
    expect(restored.systemProfiles).toEqual([expect.objectContaining({ id: system.id })]);
    expect(restored.attachmentAnalyses).toEqual([expect.objectContaining({ id: "analysis-1" })]);

    await rm(join(storeDir, "indexes", "asset-index.json"));
    restored.rebuildIndexes();
    expect(existsSync(join(storeDir, "indexes", "asset-index.json"))).toBe(true);
  });

  it("migrates schema 16 JSON once and keeps a timestamped backup", async () => {
    const root = await tempDir();
    const storeDir = join(root, ".brain-creator", "store");
    const legacyPath = join(root, ".brain-creator", "local-assets.json");
    await mkdir(join(root, ".brain-creator"), { recursive: true });
    await writeFile(
      legacyPath,
      JSON.stringify({
        schemaVersion: 16,
        systemProfiles: [{
          id: "system-legacy",
          name: "Legacy",
          environment: "test",
          baseUrl: "https://legacy.example.test",
          defaultLocale: "en-US",
          urlAllowlist: ["https://legacy.example.test"],
          status: "succeeded",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z"
        }]
      }),
      "utf8"
    );

    const repository = new ShardedFileBrainCreatorRepository(storeDir, legacyPath);

    expect(repository.schemaVersion).toBe(17);
    expect(repository.systemProfiles).toEqual([expect.objectContaining({ id: "system-legacy" })]);
    expect(existsSync(join(storeDir, "manifest.json"))).toBe(true);
    const backups = (await readdir(join(root, ".brain-creator"))).filter((name) =>
      name.startsWith("local-assets.json.backup-")
    );
    expect(backups).toHaveLength(1);

    const second = new ShardedFileBrainCreatorRepository(storeDir, legacyPath);
    expect(second.systemProfiles).toEqual([expect.objectContaining({ id: "system-legacy" })]);
    expect(
      (await readdir(join(root, ".brain-creator"))).filter((name) =>
        name.startsWith("local-assets.json.backup-")
      )
    ).toHaveLength(1);
  });

  it("does not replace in-memory state when a sharded reload fails validation", async () => {
    const root = await tempDir();
    const storeDir = join(root, "store");
    const repository = new ShardedFileBrainCreatorRepository(storeDir, join(root, "legacy.json"));
    const service = new BrainCreatorService(repository);
    const system = service.createSystemProfile({
      name: "Stable",
      environment: "test",
      baseUrl: "https://stable.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://stable.example.test"]
    });
    await writeFile(join(storeDir, "collections", "systemProfiles.json"), "not-json", "utf8");

    expect(() => repository.reload()).toThrow();
    expect(repository.systemProfiles).toEqual([expect.objectContaining({ id: system.id })]);
  });

  it("does not silently treat a missing collection shard as empty", async () => {
    const root = await tempDir();
    const storeDir = join(root, "store");
    const repository = new ShardedFileBrainCreatorRepository(storeDir, join(root, "legacy.json"));
    await rm(join(storeDir, "collections", "gaps.json"));

    expect(() => repository.reload()).toThrow(/shard gaps is missing/);
  });

  it("restores an earlier schema 17 store that predates optional requirement analysis shards", async () => {
    const root = await tempDir();
    const storeDir = join(root, "store");
    new ShardedFileBrainCreatorRepository(storeDir, join(root, "legacy.json"));
    const manifestPath = join(storeDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const optional = [
      "attachmentAnalyses",
      "workflowModels",
      "stateMachineModels",
      "requirementCoverageProfiles"
    ];
    manifest.collections = manifest.collections.filter((key: string) => !optional.includes(key));
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await Promise.all(
      optional.map((key) => rm(join(storeDir, "collections", `${key}.json`)))
    );

    const restored = new ShardedFileBrainCreatorRepository(storeDir, join(root, "legacy.json"));

    expect(restored.attachmentAnalyses).toEqual([]);
    expect(restored.workflowModels).toEqual([]);
    expect(restored.stateMachineModels).toEqual([]);
    expect(restored.requirementCoverageProfiles).toEqual([]);
  });

  it("projects all system-owned assets without mixing two systems", async () => {
    const root = await tempDir();
    const storeDir = join(root, "store");
    const repository = new ShardedFileBrainCreatorRepository(storeDir, join(root, "legacy.json"));
    const now = "2026-08-13T00:00:00.000Z";
    repository.systemProfiles.push(
      {
        id: "system-a",
        name: "System A",
        environment: "test",
        baseUrl: "https://a.example.test",
        defaultLocale: "en-US",
        urlAllowlist: [],
        status: "succeeded",
        createdAt: now,
        updatedAt: now
      },
      {
        id: "system-b",
        name: "System B",
        environment: "test",
        baseUrl: "https://b.example.test",
        defaultLocale: "en-US",
        urlAllowlist: [],
        status: "succeeded",
        createdAt: now,
        updatedAt: now
      }
    );
    repository.pageModels.push(
      {
        id: "page-a",
        projectId: "system-a",
        route: "/a",
        name: "A page",
        version: 1,
        domSnapshotId: "dom-a",
        screenshotId: "shot-a",
        status: "succeeded",
        createdAt: now,
        updatedAt: now
      },
      {
        id: "page-b",
        projectId: "system-b",
        route: "/b",
        name: "B page",
        version: 1,
        domSnapshotId: "dom-b",
        screenshotId: "shot-b",
        status: "succeeded",
        createdAt: now,
        updatedAt: now
      }
    );
    repository.locatorPoints.push(
      {
        id: "locator-a",
        pageModelId: "page-a",
        name: "A button",
        selector: "#a",
        role: "button",
        text: "A",
        fallbackSelectors: [],
        confidence: 1
      },
      {
        id: "locator-b",
        pageModelId: "page-b",
        name: "B button",
        selector: "#b",
        role: "button",
        text: "B",
        fallbackSelectors: [],
        confidence: 1
      }
    );
    repository.gaps.push(
      {
        id: "gap-a",
        projectId: "system-a",
        sourceType: "page-model",
        sourceId: "page-a",
        reason: "A gap",
        severity: "low",
        owner: "tester",
        status: "open",
        createdAt: now,
        updatedAt: now
      },
      {
        id: "gap-b",
        projectId: "system-b",
        sourceType: "page-model",
        sourceId: "page-b",
        reason: "B gap",
        severity: "low",
        owner: "tester",
        status: "open",
        createdAt: now,
        updatedAt: now
      }
    );
    repository.knowledgeProjects.push({
      id: "knowledge-shared",
      key: "shared",
      name: "Shared requirements",
      defaultLocale: "en-US",
      status: "active",
      systemIds: ["system-a", "system-b"],
      createdAt: now,
      updatedAt: now
    });
    repository.knowledgeNodes.push(
      {
        id: "node-requirement",
        knowledgeProjectId: "knowledge-shared",
        type: "requirement",
        title: "Shared requirement",
        content: "Shared expectation",
        module: "shared",
        sourceRefs: ["source:shared"],
        origin: "source",
        confidence: 1,
        status: "confirmed",
        createdAt: now,
        updatedAt: now
      },
      {
        id: "node-a-observed",
        knowledgeProjectId: "knowledge-shared",
        systemId: "system-a",
        type: "field",
        title: "System A field",
        content: "Observed only in A",
        module: "a",
        sourceRefs: ["evidence:a"],
        origin: "observed",
        confidence: 1,
        status: "confirmed",
        createdAt: now,
        updatedAt: now
      },
      {
        id: "node-b-observed",
        knowledgeProjectId: "knowledge-shared",
        systemId: "system-b",
        type: "field",
        title: "System B field",
        content: "Observed only in B",
        module: "b",
        sourceRefs: ["evidence:b"],
        origin: "observed",
        confidence: 1,
        status: "confirmed",
        createdAt: now,
        updatedAt: now
      }
    );
    repository.persist();

    const systemAAssets = JSON.parse(
      await readFile(join(storeDir, "systems", "system-a", "assets.json"), "utf8")
    );
    const systemBAssets = JSON.parse(
      await readFile(join(storeDir, "systems", "system-b", "assets.json"), "utf8")
    );
    const index = JSON.parse(await readFile(join(storeDir, "indexes", "asset-index.json"), "utf8"));

    expect(systemAAssets.pageModels).toEqual([expect.objectContaining({ id: "page-a" })]);
    expect(systemAAssets.locatorPoints).toEqual([expect.objectContaining({ id: "locator-a" })]);
    expect(systemAAssets.gaps).toEqual([expect.objectContaining({ id: "gap-a" })]);
    expect(systemAAssets.knowledgeNodes.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(["node-requirement", "node-a-observed"])
    );
    expect(systemAAssets.knowledgeNodes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "node-b-observed" })])
    );
    expect(systemBAssets.pageModels).toEqual([expect.objectContaining({ id: "page-b" })]);
    expect(systemBAssets.locatorPoints).toEqual([expect.objectContaining({ id: "locator-b" })]);
    expect(systemBAssets.gaps).toEqual([expect.objectContaining({ id: "gap-b" })]);
    expect(systemBAssets.knowledgeNodes.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(["node-requirement", "node-b-observed"])
    );
    expect(systemBAssets.knowledgeNodes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "node-a-observed" })])
    );
    expect(systemAAssets.pageModels).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "page-b" })]));
    expect(index).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "page-a", systemId: "system-a" }),
      expect.objectContaining({ id: "page-b", systemId: "system-b" }),
      expect.objectContaining({ id: "locator-a", pageModelId: "page-a" }),
      expect.objectContaining({ id: "locator-b", pageModelId: "page-b" })
    ]));
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-sharded-repository-"));
  tempDirs.push(dir);
  return dir;
}
