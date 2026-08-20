import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";

export type ArtifactRetentionEntry = {
  path: string;
  suiteRunId: string;
  systemId: string;
  createdAt: string;
  bytes: number;
};

export type ArtifactRetentionPlan = {
  createdAt: string;
  olderThanDays: number;
  entries: ArtifactRetentionEntry[];
};

export async function planArtifactRetention(input: {
  repository: InMemoryBrainCreatorRepository;
  workDir: string;
  olderThanDays: number;
  systemId?: string;
  now?: Date;
}): Promise<ArtifactRetentionPlan> {
  if (!Number.isInteger(input.olderThanDays) || input.olderThanDays < 1) {
    throw new Error("olderThanDays must be a positive integer");
  }
  const artifactRoot = resolve(input.workDir, ".brain-creator", "artifacts");
  const manifestPaths = await findNamedFiles(artifactRoot, "manifest.json");
  const latestRunIds = new Set<string>();
  for (const path of await findNamedFiles(artifactRoot, "latest.json")) {
    const latest: { suiteRunId?: string } = await readJson<{ suiteRunId?: string }>(path)
      .catch(() => ({}));
    if (latest.suiteRunId) latestRunIds.add(latest.suiteRunId);
  }
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - input.olderThanDays * 24 * 60 * 60 * 1000;
  const entries: ArtifactRetentionEntry[] = [];
  for (const path of manifestPaths) {
    const manifest: {
      systemId?: string;
      suiteRunId?: string;
      createdAt?: string;
    } = await readJson<{
      systemId?: string;
      suiteRunId?: string;
      createdAt?: string;
    }>(path).catch(() => ({}));
    if (!manifest.systemId || !manifest.suiteRunId || !manifest.createdAt) continue;
    if (input.systemId && manifest.systemId !== input.systemId) continue;
    if (latestRunIds.has(manifest.suiteRunId)) continue;
    const run = input.repository.requirementSuiteRuns.find((item) => item.id === manifest.suiteRunId)
      ?? input.repository.caseSuiteRuns.find((item) => item.id === manifest.suiteRunId);
    if (!run || !isTerminal(run.status)) continue;
    const completedAt = "completedAt" in run && run.completedAt ? run.completedAt : manifest.createdAt;
    if (new Date(completedAt).getTime() > cutoff) continue;
    const directory = resolve(path, "..");
    assertOwnedPath(artifactRoot, directory);
    entries.push({
      path: directory,
      suiteRunId: manifest.suiteRunId,
      systemId: manifest.systemId,
      createdAt: manifest.createdAt,
      bytes: await directoryBytes(directory)
    });
  }
  entries.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return {
    createdAt: now.toISOString(),
    olderThanDays: input.olderThanDays,
    entries
  };
}

export async function applyArtifactRetention(input: {
  workDir: string;
  plan: ArtifactRetentionPlan;
  confirm: boolean;
}) {
  if (!input.confirm) throw new Error("Artifact retention requires explicit confirmation");
  const artifactRoot = resolve(input.workDir, ".brain-creator", "artifacts");
  let deleted = 0;
  let bytesFreed = 0;
  for (const entry of input.plan.entries) {
    const target = resolve(entry.path);
    assertOwnedPath(artifactRoot, target);
    if (!existsSync(resolve(target, "manifest.json"))) {
      throw new Error(`Retention target has no manifest: ${entry.path}`);
    }
    await rm(target, { recursive: true, force: false });
    deleted += 1;
    bytesFreed += entry.bytes;
  }
  return { status: "completed" as const, deleted, bytesFreed };
}

async function findNamedFiles(root: string, name: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = resolve(root, entry.name);
      if (entry.isDirectory()) files.push(...await findNamedFiles(path, name));
      else if (entry.isFile() && entry.name === name) files.push(path);
    }
    return files;
  } catch {
    return [];
  }
}

async function directoryBytes(root: string): Promise<number> {
  const files = await collectFiles(root);
  const sizes = await Promise.all(files.map(async (file) => (await stat(file)).size));
  return sizes.reduce((total, size) => total + size, 0);
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function isTerminal(status: string) {
  return ["completed", "failed", "cancelled"].includes(status);
}

function assertOwnedPath(root: string, target: string) {
  const offset = relative(resolve(root), resolve(target));
  if (!offset || offset.startsWith("..") || isAbsolute(offset)) {
    throw new Error("Retention target must be an owned Suite directory");
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}
