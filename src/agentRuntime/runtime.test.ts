import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileBrainCreatorRepository } from "../domain/repository.js";
import { BrainCreatorService } from "../domain/service.js";
import { runBrainCreatorAgent } from "./runtime.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runBrainCreatorAgent", () => {
  it("connects a system from natural language and records session plus ledger", async () => {
    const repository = new JsonFileBrainCreatorRepository(join(await tempDir(), "assets.json"));
    const service = new BrainCreatorService(repository);

    const result = await runBrainCreatorAgent({
      request: "用 Brain Creator 接入 https://test6-ghr.eminxing.com/index 系统",
      repository,
      service,
      workDir: process.cwd()
    });

    expect(result.intent.intent).toBe("connect_system");
    expect(result.session.currentSystemId).toBeDefined();
    expect(result.session.state).toBe("completed");
    expect(result.ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "connect_system",
          toState: "completed",
          systemId: result.session.currentSystemId
        })
      ])
    );
    expect(service.listSystemProfiles()).toEqual([
      expect.objectContaining({
        baseUrl: "https://test6-ghr.eminxing.com/index"
      })
    ]);
  });

  it("reuses an existing system instead of creating a duplicate", async () => {
    const repository = new JsonFileBrainCreatorRepository(join(await tempDir(), "assets.json"));
    const service = new BrainCreatorService(repository);
    const existing = service.createSystemProfile({
      name: "Existing GHR",
      environment: "test",
      baseUrl: "https://test6-ghr.eminxing.com/index",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://test6-ghr.eminxing.com/index"]
    });

    const result = await runBrainCreatorAgent({
      request: "Use Brain Creator to connect https://test6-ghr.eminxing.com/index",
      repository,
      service,
      workDir: process.cwd()
    });

    expect(result.session.currentSystemId).toBe(existing.id);
    expect(service.listSystemProfiles()).toHaveLength(1);
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-agent-runtime-"));
  tempDirs.push(dir);
  return dir;
}
