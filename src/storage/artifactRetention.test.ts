// @vitest-environment node

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { applyArtifactRetention, planArtifactRetention } from "./artifactRetention.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("artifact retention", () => {
  it("only removes terminal, non-latest runs after explicit confirmation", async () => {
    const root = await tempDir();
    const repository = new InMemoryBrainCreatorRepository();
    repository.requirementSuiteRuns.push(
      requirementRun("run_old", "completed", "2026-01-01T00:00:00.000Z"),
      requirementRun("run_latest", "completed", "2026-01-01T00:00:00.000Z"),
      requirementRun("run_active", "running", "2026-01-01T00:00:00.000Z")
    );
    for (const id of ["run_old", "run_latest", "run_active"]) {
      const dir = join(root, ".brain-creator", "artifacts", "orders", "checkout-v1", id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "manifest.json"), JSON.stringify({
        systemId: "system_orders",
        requirementSetId: "requirement_checkout",
        suiteRunId: id,
        createdAt: "2026-01-01T00:00:00.000Z",
        artifacts: [],
        sourceRefs: []
      }), "utf8");
    }
    await writeFile(
      join(root, ".brain-creator", "artifacts", "orders", "checkout-v1", "latest.json"),
      JSON.stringify({ suiteRunId: "run_latest" }),
      "utf8"
    );

    const plan = await planArtifactRetention({
      repository,
      workDir: root,
      olderThanDays: 30,
      now: new Date("2026-08-20T00:00:00.000Z")
    });
    expect(plan.entries.map((entry) => entry.suiteRunId)).toEqual(["run_old"]);
    await expect(applyArtifactRetention({ workDir: root, plan, confirm: false }))
      .rejects.toThrow("explicit confirmation");
    expect(existsSync(plan.entries[0].path)).toBe(true);

    const result = await applyArtifactRetention({ workDir: root, plan, confirm: true });
    expect(result.deleted).toBe(1);
    expect(existsSync(plan.entries[0].path)).toBe(false);
    expect(existsSync(join(root, ".brain-creator", "artifacts", "orders", "checkout-v1", "run_latest"))).toBe(true);
  });
});

function requirementRun(id: string, status: "completed" | "running", completedAt: string) {
  return {
    id,
    knowledgeProjectId: "project_orders",
    systemId: "system_orders",
    status,
    continueOnBlocked: false,
    allowCreateTestData: false,
    total: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    caseRuns: [],
    createdAt: completedAt,
    updatedAt: completedAt,
    ...(status === "completed" ? { completedAt } : {})
  };
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-artifact-retention-"));
  tempDirs.push(dir);
  return dir;
}
