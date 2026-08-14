import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
    expect(content).not.toContain("secret-token");
    expect(content).toContain("BRAIN_CREATOR_AUTH_TOKEN");
    expect(content).toContain("https://shop.example.test");
  });

  it("loads a workspace-scoped storage state for script authentication", async () => {
    const workDir = await tempDir();
    const outputDir = join(workDir, "tests");
    const storageStatePath = join(workDir, ".brain-creator", "auth", "system_1", "storage-state.json");
    await mkdir(join(storageStatePath, ".."), { recursive: true });
    await writeFile(storageStatePath, JSON.stringify({ cookies: [], origins: [] }), "utf8");

    const result = await generateSeedFile({
      workDir,
      outputDir,
      system: systemProfile(),
      authProfile: authProfileWithStorageState(
        ".brain-creator/auth/system_1/storage-state.json"
      )
    });

    const content = await readFile(result.seedPath, "utf8");
    expect(result).toMatchObject({
      loginMethod: "script",
      secretKeys: ["storageStatePath"],
      authState: "storage-state"
    });
    expect(content).toContain("browser.newContext");
    expect(content).toContain("storageState");
    expect(content).toContain(storageStatePath.replace(/\\/g, "\\\\"));
  });

  it("rejects storage state paths outside the workspace", async () => {
    const workDir = await tempDir();

    await expect(
      generateSeedFile({
        workDir,
        outputDir: join(workDir, "tests"),
        system: systemProfile(),
        authProfile: authProfileWithStorageState("../outside/storage-state.json")
      })
    ).rejects.toThrow("Auth storage state must stay inside the Brain Creator workspace");
  });

  it("rejects storage state paths that escape through a symlink", async () => {
    const workDir = await tempDir();
    const outsideDir = await tempDir();
    const linkedDir = join(workDir, ".brain-creator", "auth", "system_1");
    await mkdir(join(linkedDir, ".."), { recursive: true });
    await writeFile(
      join(outsideDir, "storage-state.json"),
      JSON.stringify({ cookies: [], origins: [] }),
      "utf8"
    );
    await symlink(outsideDir, linkedDir, process.platform === "win32" ? "junction" : "dir");

    await expect(
      generateSeedFile({
        workDir,
        outputDir: join(workDir, "tests"),
        system: systemProfile(),
        authProfile: authProfileWithStorageState(
          ".brain-creator/auth/system_1/storage-state.json"
        )
      })
    ).rejects.toThrow("Auth storage state must stay inside the Brain Creator workspace");
  });

  it("generates an explicit role-switch helper for verified actor journeys", async () => {
    const workDir = await tempDir();
    const outputDir = join(workDir, "tests");
    const recruiterState = join(workDir, ".brain-creator", "auth", "recruiter", "state.json");
    const approverState = join(workDir, ".brain-creator", "auth", "approver", "state.json");
    await mkdir(join(recruiterState, ".."), { recursive: true });
    await mkdir(join(approverState, ".."), { recursive: true });
    await writeFile(recruiterState, JSON.stringify({ cookies: [], origins: [] }), "utf8");
    await writeFile(approverState, JSON.stringify({ cookies: [], origins: [] }), "utf8");

    const result = await generateSeedFile({
      workDir,
      outputDir,
      system: systemProfile(),
      authProfile: authProfileWithStorageState(".brain-creator/auth/recruiter/state.json"),
      actorJourney: [
        {
          role: "recruiter",
          authProfile: authProfileWithStorageState(".brain-creator/auth/recruiter/state.json")
        },
        {
          role: "approver",
          authProfile: authProfileWithStorageState(".brain-creator/auth/approver/state.json")
        }
      ]
    });

    const content = await readFile(result.seedPath, "utf8");
    expect(content).toContain("runAsRole");
    expect(content).toContain("BRAIN_CREATOR_ACTOR_EVIDENCE_PATH");
    expect(content).toContain('recordRole("entered")');
    expect(content).toContain("authProfileId: config.authProfileId");
    expect(content).toContain('"recruiter"');
    expect(content).toContain('"approver"');
    expect(content).not.toContain("secret-token");
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

function authProfileWithStorageState(storageStatePath: string): AuthProfile {
  return {
    id: "auth_1",
    projectId: "system_1",
    env: "staging",
    role: "qa-admin",
    loginMethod: "script",
    encryptedSecrets: encryptSecrets({ storageStatePath }),
    status: "succeeded",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
}
