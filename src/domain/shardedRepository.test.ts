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
    repository.persist();

    const manifest = JSON.parse(await readFile(join(storeDir, "manifest.json"), "utf8"));
    expect(manifest).toEqual(expect.objectContaining({ schemaVersion: 17, format: "sharded" }));
    expect(manifest.collections).toContain("systemProfiles");
    expect(existsSync(join(storeDir, "collections", "systemProfiles.json"))).toBe(true);
    expect(existsSync(join(storeDir, "systems", system.id, "system.json"))).toBe(true);
    expect(existsSync(join(storeDir, "indexes", "asset-index.json"))).toBe(true);

    const restored = new ShardedFileBrainCreatorRepository(storeDir, legacyPath);
    expect(restored.schemaVersion).toBe(17);
    expect(restored.systemProfiles).toEqual([expect.objectContaining({ id: system.id })]);

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
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-sharded-repository-"));
  tempDirs.push(dir);
  return dir;
}
