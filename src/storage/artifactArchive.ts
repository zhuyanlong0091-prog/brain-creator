import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { CaseSuiteRun } from "../domain/types.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";

export type ArtifactManifestItem = {
  path: string;
  status: "present" | "missing";
  bytes?: number;
  sha256?: string;
};

export type ArtifactManifest = {
  path: string;
  systemId: string;
  requirementSetId?: string;
  suiteRunId?: string;
  createdAt: string;
  artifacts: ArtifactManifestItem[];
  sourceRefs: string[];
};

export type ArtifactManifestInput = {
  workDir: string;
  systemId: string;
  requirementSetId?: string;
  suiteRunId?: string;
  artifactPaths: string[];
  sourceRefs?: string[];
};

export async function writeArtifactManifest(input: ArtifactManifestInput): Promise<ArtifactManifest> {
  const createdAt = new Date().toISOString();
  const ownership = [
    ".brain-creator",
    "artifacts",
    safePart(input.systemId),
    safePart(input.requirementSetId ?? "unscoped"),
    safePart(input.suiteRunId ?? "unscoped")
  ];
  const manifestPath = resolve(input.workDir, ...ownership, "manifest.json");
  const artifacts = await describeArtifacts(input.workDir, input.artifactPaths);
  const manifest: ArtifactManifest = {
    path: manifestPath,
    systemId: input.systemId,
    ...(input.requirementSetId ? { requirementSetId: input.requirementSetId } : {}),
    ...(input.suiteRunId ? { suiteRunId: input.suiteRunId } : {}),
    createdAt,
    artifacts,
    sourceRefs: [...new Set(input.sourceRefs ?? [])]
  };
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

export async function exportCaseSuiteArchive(input: {
  repository: InMemoryBrainCreatorRepository;
  workDir: string;
  suiteRunId: string;
  outputPath: string;
}) {
  const suiteRun = input.repository.caseSuiteRuns.find((item) => item.id === input.suiteRunId);
  if (!suiteRun) throw new Error("Case suite run not found");
  const described = await describeArtifacts(input.workDir, suiteRun.artifactPaths);
  const manifest = {
    format: "brain-creator-suite-export",
    version: 1,
    suiteRunId: suiteRun.id,
    systemId: suiteRun.systemId,
    sourceId: suiteRun.sourceId,
    createdAt: new Date().toISOString(),
    suiteRun,
    artifacts: described.filter((item) => item.status === "present"),
    missingArtifacts: described.filter((item) => item.status === "missing").map((item) => item.path)
  };
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
  for (const artifact of described.filter((item) => item.status === "present")) {
    const sourcePath = resolve(input.workDir, artifact.path);
    zip.addLocalFile(sourcePath, "", artifact.path);
  }
  await mkdir(dirname(resolve(input.outputPath)), { recursive: true });
  await writeFile(input.outputPath, zip.toBuffer());
  return {
    status: "exported" as const,
    outputPath: resolve(input.outputPath),
    suiteRunId: suiteRun.id,
    artifactCount: manifest.artifacts.length,
    missingArtifacts: manifest.missingArtifacts
  };
}

async function describeArtifacts(workDir: string, paths: string[]) {
  const root = resolve(workDir);
  const uniquePaths = [...new Set(paths)].map((path) => {
    const absolute = resolve(root, path);
    const offset = relative(root, absolute);
    if (offset.startsWith("..") || isAbsolute(offset)) {
      throw new Error("Artifact path must stay inside workspace");
    }
    return offset;
  });
  const result: ArtifactManifestItem[] = [];
  for (const path of uniquePaths) {
    const absolutePath = resolve(workDir, path);
    try {
      const file = await stat(absolutePath);
      if (!file.isFile()) throw new Error("not a file");
      const digest = createHash("sha256").update(await readFile(absolutePath)).digest("hex");
      result.push({ path: normalizeArchivePath(path), status: "present", bytes: file.size, sha256: digest });
    } catch {
      result.push({ path: normalizeArchivePath(path), status: "missing" });
    }
  }
  return result;
}

function safePart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function normalizeArchivePath(value: string) {
  return value.split(sep).join("/");
}
