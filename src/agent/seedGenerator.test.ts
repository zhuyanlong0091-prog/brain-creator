import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSeedFile } from "./seedGenerator.js";
import { encryptSecrets } from "../shared/crypto.js";
import type { AuthProfile, SystemProfile } from "../domain/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("generateSeedFile", () => {
  it("writes local Playwright auth setup while returning only non-sensitive metadata", async () => {
    const outputDir = await tempDir();
    const authProfile: AuthProfile = {
      id: "auth_1",
      projectId: "system_1",
      env: "staging",
      role: "qa-admin",
      loginMethod: "token",
      encryptedSecrets: encryptSecrets({ token: "secret-token" }),
      status: "succeeded",
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z"
    };

    const result = await generateSeedFile({
      outputDir,
      system: systemProfile(),
      authProfile
    });

    const content = await readFile(result.seedPath, "utf8");
    expect(result).toEqual({
      seedPath: expect.stringContaining("seed-system_1.spec.ts"),
      loginMethod: "token",
      secretKeys: ["token"]
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(content).toContain("secret-token");
    expect(content).toContain("https://shop.example.test");
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-agent-seed-"));
  tempDirs.push(dir);
  return dir;
}

function systemProfile(): SystemProfile {
  return {
    id: "system_1",
    name: "Orders Console",
    environment: "staging",
    baseUrl: "https://shop.example.test",
    defaultLocale: "zh-CN",
    urlAllowlist: ["https://shop.example.test"],
    status: "succeeded",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
}
