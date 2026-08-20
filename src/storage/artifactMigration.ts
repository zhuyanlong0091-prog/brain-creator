import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import {
  shardedRepositoryCollectionKeys,
  type InMemoryBrainCreatorRepository
} from "../domain/repository.js";
import { artifactFileName, resolveArtifactRunLayout } from "./artifactWorkspace.js";

export type ArtifactMigrationEntry = {
  from: string;
  to: string;
  sha256: string;
  ownership: "resolved" | "unresolved";
  systemId?: string;
  requirementSetId?: string;
  suiteRunId?: string;
};

export type ArtifactMigrationPlan = {
  id: string;
  createdAt: string;
  entries: ArtifactMigrationEntry[];
};

export async function planArtifactMigration(input: {
  repository: InMemoryBrainCreatorRepository;
  workDir: string;
}): Promise<ArtifactMigrationPlan> {
  const files = await collectLegacyFiles(input.workDir);
  const entries: ArtifactMigrationEntry[] = [];
  for (const file of files) {
    const from = workspaceRelative(input.workDir, file);
    const sha256 = await fileHash(file);
    const scope = resolveOwnership(input.repository, input.workDir, file);
    if (!scope) {
      entries.push({
        from,
        to: normalizePath(relative(input.workDir, resolve(
          input.workDir,
          ".brain-creator",
          "artifacts",
          "unresolved",
          `${sha256.slice(0, 12)}-${basename(file)}`
        ))),
        sha256,
        ownership: "unresolved"
      });
      continue;
    }
    const system = input.repository.systemProfiles.find((item) => item.id === scope.systemId);
    const requirement = scope.requirementSetId
      ? input.repository.requirementSets.find((item) => item.id === scope.requirementSetId)
      : undefined;
    const layout = resolveArtifactRunLayout({
      workDir: input.workDir,
      systemKey: system?.name ?? scope.systemId,
      requirementKey: requirement?.title ?? scope.requirementSetId ?? "unscoped",
      requirementVersion: requirement?.version,
      suiteRunId: scope.suiteRunId ?? `legacy-${scope.testCaseId ?? sha256.slice(0, 12)}`
    });
    const seed = isLegacySeedFile(from);
    const category = isTestFile(from) || seed ? "tests" : "specs";
    const targetDir = category === "tests" ? layout.testsDir : layout.specsDir;
    const extension = seed ? ".fixture.ts" : compoundExtension(file);
    const fileName = artifactFileName({
      caseNo: scope.caseNo,
      title: scope.title,
      extension,
      contentHash: sha256
    });
    entries.push({
      from,
      to: workspaceRelative(input.workDir, resolve(targetDir, fileName)),
      sha256,
      ownership: "resolved",
      systemId: scope.systemId,
      ...(scope.requirementSetId ? { requirementSetId: scope.requirementSetId } : {}),
      ...(scope.suiteRunId ? { suiteRunId: scope.suiteRunId } : {})
    });
  }
  entries.sort((left, right) => left.from.localeCompare(right.from));
  const digest = createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 16);
  return {
    id: `artifact-migration-${digest}`,
    createdAt: new Date().toISOString(),
    entries
  };
}

export async function applyArtifactMigration(input: {
  repository: InMemoryBrainCreatorRepository;
  workDir: string;
  plan: ArtifactMigrationPlan;
}) {
  const completed: ArtifactMigrationEntry[] = [];
  try {
    for (const entry of input.plan.entries) {
      const source = workspacePath(input.workDir, entry.from);
      const target = workspacePath(input.workDir, entry.to);
      if (!existsSync(source)) throw new Error(`Legacy artifact is missing: ${entry.from}`);
      if ((await fileHash(source)) !== entry.sha256) {
        throw new Error(`Legacy artifact changed after dry-run: ${entry.from}`);
      }
      if (existsSync(target)) throw new Error(`Artifact migration target already exists: ${entry.to}`);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      if ((await fileHash(target)) !== entry.sha256) {
        throw new Error(`Artifact hash verification failed: ${entry.to}`);
      }
      await rm(source);
      replaceRepositoryPath(input.repository, input.workDir, entry.from, entry.to);
      completed.push(entry);
    }
    input.repository.persist();
    const migrationDir = resolve(input.workDir, ".brain-creator", "migrations", input.plan.id);
    await mkdir(migrationDir, { recursive: true });
    const migrationPath = resolve(migrationDir, "migration.json");
    await writeFile(migrationPath, JSON.stringify({ ...input.plan, status: "applied" }, null, 2), "utf8");
    const legacyPathIndexPath = resolve(
      input.workDir,
      ".brain-creator",
      "artifacts",
      "legacy-path-index.json"
    );
    await mkdir(dirname(legacyPathIndexPath), { recursive: true });
    const existing = await readJson<{ paths?: Record<string, string> }>(legacyPathIndexPath, { paths: {} });
    const paths = { ...(existing.paths ?? {}) };
    for (const entry of input.plan.entries) paths[entry.from] = entry.to;
    await writeFile(
      legacyPathIndexPath,
      JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), paths }, null, 2),
      "utf8"
    );
    return {
      status: "applied" as const,
      migrationId: input.plan.id,
      migrated: completed.length,
      unresolved: completed.filter((entry) => entry.ownership === "unresolved").length,
      migrationPath,
      legacyPathIndexPath
    };
  } catch (error) {
    await reverseCompleted(input.repository, input.workDir, completed);
    input.repository.persist();
    throw error;
  }
}

export async function rollbackArtifactMigration(input: {
  repository: InMemoryBrainCreatorRepository;
  workDir: string;
  migrationId: string;
}) {
  const migrationPath = resolve(
    input.workDir,
    ".brain-creator",
    "migrations",
    input.migrationId,
    "migration.json"
  );
  const migration = await readJson<ArtifactMigrationPlan & { status: string }>(migrationPath);
  if (migration.status !== "applied") throw new Error("Artifact migration is not applied");
  await reverseCompleted(input.repository, input.workDir, [...migration.entries].reverse());
  input.repository.persist();
  await writeFile(migrationPath, JSON.stringify({ ...migration, status: "rolled-back" }, null, 2), "utf8");
  const legacyPathIndexPath = resolve(
    input.workDir,
    ".brain-creator",
    "artifacts",
    "legacy-path-index.json"
  );
  const index = await readJson<{ paths?: Record<string, string> }>(legacyPathIndexPath, { paths: {} });
  for (const entry of migration.entries) delete index.paths?.[entry.from];
  await writeFile(
    legacyPathIndexPath,
    JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), paths: index.paths ?? {} }, null, 2),
    "utf8"
  );
  return { status: "rolled-back" as const, migrationId: input.migrationId, restored: migration.entries.length };
}

type Ownership = {
  systemId: string;
  requirementSetId?: string;
  suiteRunId?: string;
  testCaseId?: string;
  caseNo?: string;
  title: string;
};

function resolveOwnership(
  repository: InMemoryBrainCreatorRepository,
  workDir: string,
  file: string
): Ownership | undefined {
  const matches = (value?: string) => Boolean(value && workspacePath(workDir, value) === file);
  const chain = repository.chainRuns.find((item) => matches(item.specPath) || matches(item.testPath));
  const task = repository.agentTasks.find((item) =>
    [...item.outputPaths, item.promptPath, item.contextPath, item.planContext?.specPath,
      item.planContext?.promptPath, item.planContext?.seedPath, item.chainContext?.specPath,
      item.chainContext?.seedPath, item.chainContext?.testPath, item.chainContext?.contextPackPath]
      .some((path) => matches(path))
  );
  const evidence = repository.executionEvidence.find((item) =>
    [item.contextPackPath, item.reporterPath, ...item.tracePaths, ...item.artifactPaths,
      ...item.steps.flatMap((step) => [step.screenshotPath, ...(step.evidenceRefs ?? []), ...(step.traceRefs ?? [])])]
      .some((path) => matches(path))
  );
  const caseSuite = repository.caseSuiteRuns.find((item) => item.artifactPaths.some((path) => matches(path)));
  const testCaseId = chain?.testCaseId ?? task?.chainContext?.testCaseId ?? evidence?.testCaseId;
  const requirementSuite = repository.requirementSuiteRuns.find((run) =>
    run.id === task?.chainContext?.requirementSuiteRunId ||
    run.caseRuns.some((caseRun) => caseRun.testCaseId === testCaseId || caseRun.executableCaseId === evidence?.executableCaseId)
  );
  const caseRun = requirementSuite?.caseRuns.find((item) =>
    item.testCaseId === testCaseId || item.executableCaseId === evidence?.executableCaseId
  );
  const executableCaseId = task?.chainContext?.executableCaseId ?? evidence?.executableCaseId ?? caseRun?.executableCaseId;
  const executable = repository.executableCases.find((item) => item.id === executableCaseId);
  const testCase = repository.testCases.find((item) => item.id === testCaseId);
  const systemId = chain?.systemId ?? task?.systemId ?? evidence?.systemId ?? caseSuite?.systemId ?? testCase?.systemId;
  if (!systemId) return undefined;
  return {
    systemId,
    requirementSetId: executable?.requirementSetId ?? requirementSuite?.requirementSetIds?.[0],
    suiteRunId: requirementSuite?.id ?? caseSuite?.id,
    testCaseId,
    caseNo: caseRun ? `TC-${String(caseRun.order).padStart(3, "0")}` : task?.suiteContext?.caseNo,
    title: executable?.title ?? caseRun?.title ?? task?.suiteContext?.title ?? testCase?.requirement ?? basename(file, extname(file))
  };
}

async function reverseCompleted(
  repository: InMemoryBrainCreatorRepository,
  workDir: string,
  entries: ArtifactMigrationEntry[]
) {
  for (const entry of entries) {
    const source = workspacePath(workDir, entry.to);
    const target = workspacePath(workDir, entry.from);
    if (!existsSync(source)) continue;
    if ((await fileHash(source)) !== entry.sha256) {
      throw new Error(`Migrated artifact changed; rollback blocked: ${entry.to}`);
    }
    if (existsSync(target)) throw new Error(`Rollback target already exists: ${entry.from}`);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    await rm(source);
    replaceRepositoryPath(repository, workDir, entry.to, entry.from);
  }
}

function replaceRepositoryPath(
  repository: InMemoryBrainCreatorRepository,
  workDir: string,
  from: string,
  to: string
) {
  const replacements = new Map([
    [normalizePath(from), normalizePath(to)],
    [resolve(workDir, from), resolve(workDir, to)]
  ]);
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") return replacements.get(normalizePath(value)) ?? replacements.get(value) ?? value;
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        (value as Record<string, unknown>)[key] = visit(child);
      }
    }
    return value;
  };
  for (const key of shardedRepositoryCollectionKeys()) visit(repository[key]);
}

async function collectLegacyFiles(workDir: string) {
  const roots = [resolve(workDir, "specs"), resolve(workDir, "tests", "generated")];
  const files = (await Promise.all(roots.map(collectFiles))).flat();
  try {
    const testEntries = await readdir(resolve(workDir, "tests"), { withFileTypes: true });
    files.push(...testEntries
      .filter((entry) => entry.isFile() && /^seed-.*\.spec\.ts$/i.test(entry.name))
      .map((entry) => resolve(workDir, "tests", entry.name)));
  } catch {
    // A workspace without a tests directory has no legacy seed files.
  }
  return files.sort();
}

async function collectFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = resolve(root, entry.name);
      if (entry.isDirectory()) files.push(...await collectFiles(path));
      else if (entry.isFile()) files.push(path);
    }
    return files;
  } catch {
    return [];
  }
}

async function fileHash(path: string) {
  const value = await readFile(path);
  return createHash("sha256").update(value).digest("hex");
}

function workspacePath(workDir: string, path: string) {
  const target = resolve(workDir, path);
  const offset = relative(resolve(workDir), target);
  if (offset.startsWith("..") || isAbsolute(offset)) throw new Error("Artifact path must stay inside workspace");
  return target;
}

function workspaceRelative(workDir: string, path: string) {
  return normalizePath(relative(resolve(workDir), workspacePath(workDir, path)));
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

function isTestFile(path: string) {
  return normalizePath(path).startsWith("tests/generated/") || /\.spec\.[cm]?[jt]sx?$/i.test(path);
}

function isLegacySeedFile(path: string) {
  return /^tests\/seed-.*\.spec\.ts$/i.test(normalizePath(path));
}

function compoundExtension(path: string) {
  const name = basename(path);
  const match = name.match(/(\.spec\.[cm]?[jt]sx?)$/i);
  return match?.[1] ?? (extname(name) || ".txt");
}

async function readJson<T>(path: string, fallback?: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}
