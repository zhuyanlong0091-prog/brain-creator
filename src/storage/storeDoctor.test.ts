// @vitest-environment node

import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ShardedFileBrainCreatorRepository } from "../domain/repository.js";
import { inspectStoreHealth } from "./storeDoctor.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("store doctor", () => {
  it("reports a healthy schema 19 store", async () => {
    const root = await tempDir();
    const storeDir = join(root, "store");
    new ShardedFileBrainCreatorRepository(storeDir, join(root, "local-assets.json"));

    expect(inspectStoreHealth({ storeDir, legacyPath: join(root, "local-assets.json") })).toEqual(
      expect.objectContaining({ status: "pass", temporaryFiles: [] })
    );
  });

  it("reports malformed, missing-index, and unfinished store states", async () => {
    const root = await tempDir();
    const storeDir = join(root, "store");
    const legacyPath = join(root, "local-assets.json");
    await mkdir(storeDir, { recursive: true });
    await writeFile(join(storeDir, "manifest.json"), "{broken", "utf8");
    expect(inspectStoreHealth({ storeDir, legacyPath }).status).toBe("fail");

    await rm(join(storeDir, "manifest.json"));
    new (ShardedFileBrainCreatorRepository)(storeDir, legacyPath);
    await rm(join(storeDir, "indexes", "asset-index.json"));
    expect(inspectStoreHealth({ storeDir, legacyPath }).status).toBe("warn");

    await writeFile(join(storeDir, "unfinished.tmp"), "pending", "utf8");
    expect(inspectStoreHealth({ storeDir, legacyPath })).toEqual(
      expect.objectContaining({ status: "warn", temporaryFiles: ["unfinished.tmp"] })
    );
  });

  it("reports a missing collection shard as a store failure", async () => {
    const root = await tempDir();
    const storeDir = join(root, "store");
    const legacyPath = join(root, "local-assets.json");
    new ShardedFileBrainCreatorRepository(storeDir, legacyPath);
    await rm(join(storeDir, "collections", "gaps.json"));

    expect(inspectStoreHealth({ storeDir, legacyPath })).toEqual(
      expect.objectContaining({ status: "fail", message: expect.stringContaining("gaps") })
    );
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-store-doctor-"));
  tempDirs.push(dir);
  return dir;
}
