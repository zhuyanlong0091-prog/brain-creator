// @vitest-environment node

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import {
  applyArtifactMigration,
  planArtifactMigration,
  rollbackArtifactMigration
} from "./artifactMigration.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("artifact migration", () => {
  it("plans without mutating and moves owned legacy files with an index", async () => {
    const root = await tempDir();
    const repository = repositoryFixture(root);
    const oldSpec = join(root, "specs", "case_1.md");
    const oldTest = join(root, "tests", "generated", "case_1.spec.ts");
    await mkdir(dirname(oldSpec), { recursive: true });
    await mkdir(dirname(oldTest), { recursive: true });
    await writeFile(oldSpec, "# Create order", "utf8");
    await writeFile(oldTest, "import { test } from '@playwright/test';", "utf8");

    const plan = await planArtifactMigration({ repository, workDir: root });

    expect(plan.entries).toHaveLength(2);
    expect(plan.entries.every((entry) => entry.ownership === "resolved")).toBe(true);
    expect(plan.entries.map((entry) => entry.to)).toEqual(expect.arrayContaining([
      expect.stringContaining(".brain-creator/artifacts/orders/checkout-v2/suite_run_1/specs/tc-001-create-order.md"),
      expect.stringContaining(".brain-creator/artifacts/orders/checkout-v2/suite_run_1/tests/tc-001-create-order.spec.ts")
    ]));
    expect(existsSync(oldSpec)).toBe(true);

    const result = await applyArtifactMigration({ repository, workDir: root, plan });
    expect(result.status).toBe("applied");
    expect(existsSync(oldSpec)).toBe(false);
    expect(repository.chainRuns[0].specPath?.replace(/\\/g, "/")).toContain(".brain-creator/artifacts/");
    const index = JSON.parse(await readFile(result.legacyPathIndexPath, "utf8"));
    expect(index.paths["specs/case_1.md"]).toContain("/specs/tc-001-create-order.md");

    const rollback = await rollbackArtifactMigration({
      repository,
      workDir: root,
      migrationId: plan.id
    });
    expect(rollback.status).toBe("rolled-back");
    expect(existsSync(oldSpec)).toBe(true);
    expect(repository.chainRuns[0].specPath).toBe(oldSpec);
  });

  it("routes unowned generated files to unresolved without pretending ownership", async () => {
    const root = await tempDir();
    const repository = new InMemoryBrainCreatorRepository();
    const orphan = join(root, "specs", "unknown.md");
    await mkdir(dirname(orphan), { recursive: true });
    await writeFile(orphan, "unknown", "utf8");

    const plan = await planArtifactMigration({ repository, workDir: root });

    expect(plan.entries).toEqual([
      expect.objectContaining({
        from: "specs/unknown.md",
        to: expect.stringContaining(".brain-creator/artifacts/unresolved/"),
        ownership: "unresolved"
      })
    ]);
  });
});

function repositoryFixture(root: string) {
  const repository = new InMemoryBrainCreatorRepository();
  repository.systemProfiles.push({
    id: "system_orders",
    name: "Orders",
    environment: "test",
    defaultLocale: "en-US",
    baseUrl: "https://orders.example.test",
    urlAllowlist: ["https://orders.example.test/**"],
    status: "succeeded",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z"
  });
  repository.requirementSets.push({
    id: "requirement_checkout",
    knowledgeProjectId: "project_orders",
    sourceId: "source_orders",
    version: 2,
    title: "Checkout",
    summary: "Checkout",
    contentHash: "hash",
    status: "approved",
    affectedNodeIds: [],
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z"
  });
  repository.executableCases.push({
    id: "executable_1",
    knowledgeProjectId: "project_orders",
    requirementSetId: "requirement_checkout",
    testIntentId: "intent_1",
    systemId: "system_orders",
    title: "Create order",
    status: "ready",
    preconditions: [],
    steps: [],
    dataProfileIds: [],
    gapIds: [],
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z"
  });
  repository.testCases.push({
    id: "case_1",
    systemId: "system_orders",
    requirement: "Create order",
    scenarios: [],
    newTerms: [],
    ruleCheckResult: { passed: true, checks: [] },
    status: "approved",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z"
  });
  repository.requirementSuiteRuns.push({
    id: "suite_run_1",
    knowledgeProjectId: "project_orders",
    systemId: "system_orders",
    status: "completed",
    continueOnBlocked: false,
    allowCreateTestData: false,
    requirementSetIds: ["requirement_checkout"],
    total: 1,
    passed: 1,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    caseRuns: [{
      executableCaseId: "executable_1",
      executionPlanId: "plan_1",
      testCaseId: "case_1",
      title: "Create order",
      order: 1,
      status: "passed",
      gapIds: [],
      attempts: []
    }],
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:01:00.000Z",
    completedAt: "2026-08-20T00:01:00.000Z"
  });
  repository.chainRuns.push({
    id: "chain_1",
    systemId: "system_orders",
    testCaseId: "case_1",
    status: "succeeded",
    specPath: join(root, "specs", "case_1.md"),
    testPath: join(root, "tests", "generated", "case_1.spec.ts"),
    gaps: [],
    createdAt: "2026-08-20T00:00:00.000Z",
    completedAt: "2026-08-20T00:01:00.000Z"
  });
  return repository;
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-artifact-migration-"));
  tempDirs.push(dir);
  return dir;
}
