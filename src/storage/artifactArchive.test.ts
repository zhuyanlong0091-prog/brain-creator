// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { encryptSecrets } from "../shared/crypto.js";
import { exportCaseSuiteArchive, writeArtifactManifest } from "./artifactArchive.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("artifact archive", () => {
  it("writes a hashed manifest under system, requirement, and suite ownership", async () => {
    const root = await tempDir();
    const evidence = join(root, "evidence", "step-01.png");
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(evidence, "evidence", "utf8");

    const manifest = await writeArtifactManifest({
      workDir: root,
      systemId: "system_orders",
      requirementSetId: "requirement_orders",
      suiteRunId: "suite_run_1",
      artifactPaths: [evidence]
    });

    expect(manifest.artifacts).toEqual([
      expect.objectContaining({
        path: "evidence/step-01.png",
        status: "present",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    ]);
    expect(existsSync(manifest.path)).toBe(true);
    expect(manifest.path).toContain(join(".brain-creator", "artifacts", "system_orders", "requirement_orders", "suite_run_1"));
  });

  it("blocks sensitive artifacts before they enter the evidence manifest", async () => {
    const root = await tempDir();
    const artifact = join(root, "playwright-report.json");
    await writeFile(artifact, '{"token":"long-lived-token-123"}', "utf8");

    await expect(
      writeArtifactManifest({
        workDir: root,
        systemId: "system_orders",
        artifactPaths: [artifact],
        protectedSecrets: { token: "long-lived-token-123" }
      })
    ).rejects.toThrow(
      "Artifact manifest blocked because sensitive values were found in: playwright-report.json"
    );
  });

  it("exports a suite run with manifest and available evidence without secrets", async () => {
    const root = await tempDir();
    const artifact = join(root, "report.html");
    await writeFile(artifact, "<html>report</html>", "utf8");
    const repository = new InMemoryBrainCreatorRepository();
    repository.caseSuiteRuns.push({
      id: "suite_run_1",
      systemId: "system_orders",
      suiteId: "suite_1",
      sourceId: "source_1",
      status: "completed",
      total: 1,
      passed: 1,
      failed: 0,
      blocked: 0,
      caseResults: [],
      artifactPaths: [artifact, join(root, "missing.png")],
      bugReportIds: [],
      gapIds: [],
      createdAt: "2026-08-12T00:00:00.000Z",
      completedAt: "2026-08-12T00:01:00.000Z"
    });

    const outputPath = join(root, "exports", "suite.zip");
    const result = await exportCaseSuiteArchive({ repository, workDir: root, suiteRunId: "suite_run_1", outputPath });
    const zip = new AdmZip(outputPath);
    const names = zip.getEntries().map((entry) => entry.entryName);
    const manifest = JSON.parse(zip.readAsText("manifest.json"));

    expect(result.status).toBe("exported");
    expect(names).toContain("manifest.json");
    expect(names).toContain("report.html");
    expect(manifest.missingArtifacts).toEqual(["missing.png"]);
    expect(JSON.stringify(manifest)).not.toMatch(/password|token|cookie/i);
    expect(await readFile(outputPath)).toBeInstanceOf(Buffer);
  });

  it("rejects artifact paths outside the workspace", async () => {
    const root = await tempDir();

    await expect(
      writeArtifactManifest({
        workDir: root,
        systemId: "system_orders",
        artifactPaths: [join(root, "..", "outside.txt")]
      })
    ).rejects.toThrow("Artifact path must stay inside workspace");
  });

  it("blocks exporting an artifact that contains a saved credential", async () => {
    const root = await tempDir();
    const artifact = join(root, "report.html");
    await writeFile(artifact, "token=long-lived-token-123", "utf8");
    const repository = new InMemoryBrainCreatorRepository();
    repository.authProfiles.push({
      id: "auth_orders",
      projectId: "system_orders",
      env: "test",
      role: "qa",
      loginMethod: "token",
      encryptedSecrets: encryptSecrets({ token: "long-lived-token-123" }),
      status: "succeeded",
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z"
    });
    repository.caseSuiteRuns.push({
      id: "suite_run_secret",
      systemId: "system_orders",
      suiteId: "suite_1",
      sourceId: "source_1",
      status: "completed",
      total: 1,
      passed: 1,
      failed: 0,
      blocked: 0,
      caseResults: [],
      artifactPaths: [artifact],
      bugReportIds: [],
      gapIds: [],
      createdAt: "2026-08-12T00:00:00.000Z",
      completedAt: "2026-08-12T00:01:00.000Z"
    });

    await expect(
      exportCaseSuiteArchive({
        repository,
        workDir: root,
        suiteRunId: "suite_run_secret",
        outputPath: join(root, "exports", "suite.zip")
      })
    ).rejects.toThrow("Artifact export blocked because sensitive values were found in: report.html");
  });

  it("blocks exporting an artifact with a credential pattern even without the source value", async () => {
    const root = await tempDir();
    const artifact = join(root, "generated.spec.ts");
    await writeFile(artifact, 'const config = { password: "do-not-export-this" };', "utf8");
    const repository = new InMemoryBrainCreatorRepository();
    repository.caseSuiteRuns.push({
      id: "suite_run_pattern",
      systemId: "system_orders",
      suiteId: "suite_1",
      sourceId: "source_1",
      status: "completed",
      total: 1,
      passed: 1,
      failed: 0,
      blocked: 0,
      caseResults: [],
      artifactPaths: [artifact],
      bugReportIds: [],
      gapIds: [],
      createdAt: "2026-08-12T00:00:00.000Z",
      completedAt: "2026-08-12T00:01:00.000Z"
    });

    await expect(
      exportCaseSuiteArchive({
        repository,
        workDir: root,
        suiteRunId: "suite_run_pattern",
        outputPath: join(root, "exports", "suite.zip")
      })
    ).rejects.toThrow("Artifact export blocked because sensitive values were found in: generated.spec.ts");
  });

  it("never exports protected browser authentication state", async () => {
    const root = await tempDir();
    const repository = new InMemoryBrainCreatorRepository();
    repository.caseSuiteRuns.push({
      id: "suite_run_1",
      systemId: "system_orders",
      suiteId: "suite_1",
      sourceId: "source_1",
      status: "completed",
      total: 1,
      passed: 1,
      failed: 0,
      blocked: 0,
      caseResults: [],
      artifactPaths: [],
      bugReportIds: [],
      gapIds: [],
      createdAt: "2026-08-12T00:00:00.000Z",
      completedAt: "2026-08-12T00:01:00.000Z"
    });
    const authState = join(root, ".brain-creator", "auth", "system-1", "storage-state.json");
    await mkdir(dirname(authState), { recursive: true });
    await writeFile(authState, JSON.stringify({ cookies: [], origins: [] }), "utf8");
    repository.caseSuiteRuns[0].artifactPaths = [
      ".brain-creator/auth/system-1/storage-state.json"
    ];

    await expect(
      exportCaseSuiteArchive({
        repository,
        workDir: root,
        suiteRunId: "suite_run_1",
        outputPath: join(root, "exports", "suite.zip")
      })
    ).rejects.toThrow("protected authentication state cannot be exported");
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-artifact-archive-"));
  tempDirs.push(dir);
  return dir;
}
