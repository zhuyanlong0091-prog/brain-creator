import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { RequirementSuiteRun } from "../domain/types.js";
import type { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { decryptSecrets } from "../shared/crypto.js";
import { scanSensitivePatterns, scanSensitiveValues } from "../shared/secretScan.js";

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
  requirementSetIds?: string[];
  suiteRunId?: string;
  createdAt: string;
  artifacts: ArtifactManifestItem[];
  sourceRefs: string[];
};

export type ArtifactManifestInput = {
  workDir: string;
  systemId: string;
  requirementSetId?: string;
  requirementSetIds?: string[];
  suiteRunId?: string;
  artifactPaths: string[];
  sourceRefs?: string[];
  protectedSecrets?: Record<string, string>;
  ownershipDirectory?: string;
};

export type ArtifactSecurityFinding = {
  path: string;
  secretKeys: string[];
};

export async function auditArtifactDirectory(input: {
  workDir: string;
  directoryPath: string;
  protectedSecrets?: Record<string, string>;
}): Promise<{ filesScanned: number; findings: ArtifactSecurityFinding[] }> {
  const root = resolve(input.workDir, input.directoryPath);
  const rootOffset = relative(resolve(input.workDir), root);
  if (rootOffset.startsWith("..") || isAbsolute(rootOffset)) {
    throw new Error("Artifact audit path must stay inside workspace");
  }
  const files = await collectFiles(root);
  const findings: ArtifactSecurityFinding[] = [];
  for (const file of files) {
    const relativePath = normalizeArchivePath(relative(input.workDir, file));
    if (isProtectedAuthArtifact(relativePath)) {
      findings.push({
        path: relativePath,
        secretKeys: ["protected-auth-artifact"]
      });
      continue;
    }
    const content = await readFile(file);
    const matches = scanSensitiveText(
      content.toString("utf8"),
      Object.entries(input.protectedSecrets ?? {})
    );
    if (matches.length > 0) {
      findings.push({
        path: relativePath,
        secretKeys: matches.map((match) => match.secretKey)
      });
    }
  }
  return { filesScanned: files.length, findings };
}

export async function writeArtifactManifest(input: ArtifactManifestInput): Promise<ArtifactManifest> {
  const createdAt = new Date().toISOString();
  const ownership = [
    ".brain-creator",
    "artifacts",
    safePart(input.systemId),
    safePart(input.requirementSetId ?? "unscoped"),
    safePart(input.suiteRunId ?? "unscoped")
  ];
  const ownershipDirectory = input.ownershipDirectory
    ? resolve(input.ownershipDirectory)
    : resolve(input.workDir, ...ownership);
  const ownershipOffset = relative(resolve(input.workDir), ownershipDirectory);
  if (ownershipOffset.startsWith("..") || isAbsolute(ownershipOffset)) {
    throw new Error("Artifact ownership directory must stay inside workspace");
  }
  const manifestPath = resolve(ownershipDirectory, "manifest.json");
  const ownedArtifactPaths = input.ownershipDirectory
    ? (await collectFiles(ownershipDirectory)).filter(
        (path) => !["manifest.json", "index.md"].includes(path.split(/[\\/]/).at(-1) ?? "")
      )
    : [];
  const artifacts = await describeArtifacts(
    input.workDir,
    [...new Set([...input.artifactPaths, ...ownedArtifactPaths])]
  );
  const directoryAudit = await auditArtifactDirectory({
    workDir: input.workDir,
    directoryPath: dirname(manifestPath),
    protectedSecrets: input.protectedSecrets
  });
  const knownArtifactPaths = new Set(artifacts.map((item) => item.path));
  const unlistedFindings = directoryAudit.findings.filter(
    (finding) => !knownArtifactPaths.has(finding.path)
  );
  if (unlistedFindings.length > 0) {
    throw new Error(
      `Artifact manifest blocked because sensitive values were found in unlisted files: ${unlistedFindings
        .map((finding) => finding.path)
        .join(", ")}`
    );
  }
  const secretFindings = await scanArtifactSecrets(
    input.workDir,
    artifacts.filter((item) => item.status === "present"),
    Object.entries(input.protectedSecrets ?? {})
  );
  if (secretFindings.length > 0) {
    throw new Error(
      `Artifact manifest blocked because sensitive values were found in: ${secretFindings
        .map((finding) => finding.path)
        .join(", ")}`
    );
  }
  const manifest: ArtifactManifest = {
    path: manifestPath,
    systemId: input.systemId,
    ...(input.requirementSetId ? { requirementSetId: input.requirementSetId } : {}),
    ...(input.requirementSetIds && input.requirementSetIds.length > 0
      ? { requirementSetIds: [...new Set(input.requirementSetIds)] }
      : {}),
    ...(input.suiteRunId ? { suiteRunId: input.suiteRunId } : {}),
    createdAt,
    artifacts,
    sourceRefs: [...new Set(input.sourceRefs ?? [])]
  };
  const manifestFindings = scanSensitiveText(
    JSON.stringify(manifest),
    Object.entries(input.protectedSecrets ?? {})
  );
  if (manifestFindings.length > 0) {
    throw new Error(
      `Artifact manifest blocked because sensitive values were found in manifest: ${manifestFindings
        .map((finding) => finding.secretKey)
        .join(", ")}`
    );
  }
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(
    resolve(ownershipDirectory, "index.md"),
    renderArtifactIndex(manifest),
    "utf8"
  );
  await writeFile(
    resolve(ownershipDirectory, "..", "latest.json"),
    JSON.stringify({
      suiteRunId: input.suiteRunId ?? "unscoped",
      manifestPath: normalizeArchivePath(relative(input.workDir, manifestPath)),
      updatedAt: createdAt
    }, null, 2),
    "utf8"
  );
  return manifest;
}

function renderArtifactIndex(manifest: ArtifactManifest) {
  const lines = [
    "# Brain Creator Artifact Run",
    "",
    `- System: ${manifest.systemId}`,
    `- Requirement: ${manifest.requirementSetId ?? "unscoped"}`,
    `- Suite run: ${manifest.suiteRunId ?? "unscoped"}`,
    `- Created: ${manifest.createdAt}`,
    "",
    "## Artifacts",
    "",
    ...manifest.artifacts.map((artifact) =>
      `- ${artifact.status === "present" ? "[x]" : "[ ]"} ${artifact.path}`
    )
  ];
  return `${lines.join("\n")}\n`;
}

export async function exportCaseSuiteArchive(input: {
  repository: InMemoryBrainCreatorRepository;
  workDir: string;
  suiteRunId: string;
  outputPath: string;
}) {
  const caseSuiteRun = input.repository.caseSuiteRuns.find((item) => item.id === input.suiteRunId);
  const requirementSuiteRun = input.repository.requirementSuiteRuns.find(
    (item) => item.id === input.suiteRunId
  );
  const suiteRun = caseSuiteRun ?? requirementSuiteRun;
  if (!suiteRun) throw new Error("Case suite run not found");
  const explicitArtifactPaths = caseSuiteRun
    ? caseSuiteRun.artifactPaths
    : requirementSuiteArtifactPaths(input.repository, requirementSuiteRun!);
  const ownedDirectory = await findOwnedSuiteDirectory(input.workDir, suiteRun.id);
  const ownedPaths = ownedDirectory ? await collectFiles(ownedDirectory) : [];
  const described = await describeArtifacts(
    input.workDir,
    [...new Set([...explicitArtifactPaths, ...ownedPaths])]
  );
  const protectedSecrets = input.repository.authProfiles
    .filter((profile) => profile.projectId === suiteRun.systemId)
    .flatMap((profile) => {
      try {
        return Object.entries(decryptSecrets(profile.encryptedSecrets)).map(([key, value]) => [
          `${profile.id}.${key}`,
          value
        ] as const);
      } catch {
        return [];
      }
    });
  const protectedArtifacts = described
    .filter((item) => item.status === "present" && isProtectedAuthArtifact(item.path));
  if (protectedArtifacts.length > 0) {
    throw new Error(
      `Artifact export blocked because protected authentication state cannot be exported: ${protectedArtifacts
        .map((item) => item.path)
        .join(", ")}`
    );
  }
  const ownedArtifactDirectories = new Set(
    described
      .filter((item) => item.status === "present")
      .map((item) => {
        const normalized = normalizeArchivePath(item.path);
        return normalized.includes("/.brain-creator/artifacts/") ||
          normalized.startsWith(".brain-creator/artifacts/")
          ? normalizeArchivePath(dirname(normalized))
          : undefined;
      })
      .filter((directory): directory is string => Boolean(directory))
  );
  const unlistedFindings = (
    await Promise.all(
      [...ownedArtifactDirectories].map((directoryPath) =>
        auditArtifactDirectory({
          workDir: input.workDir,
          directoryPath,
          protectedSecrets: Object.fromEntries(protectedSecrets)
        })
      )
    )
  ).flatMap((audit) => audit.findings);
  if (unlistedFindings.length > 0) {
    throw new Error(
      `Artifact export blocked because sensitive values were found in unlisted files: ${unlistedFindings
        .map((finding) => finding.path)
        .join(", ")}`
    );
  }
  const secretFindings = await scanArtifactSecrets(
    input.workDir,
    described.filter((item) => item.status === "present"),
    protectedSecrets
  );
  if (secretFindings.length > 0) {
    throw new Error(
      `Artifact export blocked because sensitive values were found in: ${secretFindings
        .map((finding) => finding.path)
        .join(", ")}`
    );
  }
  const manifest = {
    format: "brain-creator-suite-export",
    version: 1,
    suiteRunId: suiteRun.id,
    systemId: suiteRun.systemId,
    ...(caseSuiteRun ? { sourceId: caseSuiteRun.sourceId } : {}),
    ...(requirementSuiteRun
      ? {
          knowledgeProjectId: requirementSuiteRun.knowledgeProjectId,
          requirementSetIds: requirementSuiteRun.requirementSetIds ?? []
        }
      : {}),
    createdAt: new Date().toISOString(),
    suiteRun,
    artifacts: described.filter((item) => item.status === "present"),
    missingArtifacts: described.filter((item) => item.status === "missing").map((item) => item.path)
  };
  const manifestFindings = scanSensitiveText(
    JSON.stringify(manifest),
    protectedSecrets
  );
  if (manifestFindings.length > 0) {
    throw new Error(
      `Artifact export blocked because sensitive values were found in export manifest: ${manifestFindings
        .map((finding) => finding.secretKey)
        .join(", ")}`
    );
  }
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

function requirementSuiteArtifactPaths(
  repository: InMemoryBrainCreatorRepository,
  run: RequirementSuiteRun
) {
  const executableCaseIds = new Set(run.caseRuns.map((item) => item.executableCaseId));
  const testCaseIds = new Set(
    run.caseRuns.map((item) => item.testCaseId).filter((value): value is string => Boolean(value))
  );
  const chainRunIds = new Set(
    run.caseRuns.map((item) => item.chainRunId).filter((value): value is string => Boolean(value))
  );
  const evidence = repository.executionEvidence.filter(
    (item) => executableCaseIds.has(item.executableCaseId) || testCaseIds.has(item.testCaseId)
  );
  const chains = repository.chainRuns.filter(
    (item) => chainRunIds.has(item.id) || testCaseIds.has(item.testCaseId)
  );
  const tasks = repository.agentTasks.filter(
    (item) => item.chainContext?.requirementSuiteRunId === run.id
  );
  return [
    run.reportPath,
    ...chains.flatMap((item) => [item.specPath, item.testPath]),
    ...tasks.flatMap((item) => [item.promptPath, item.contextPath, ...item.outputPaths]),
    ...evidence.flatMap((item) => [
      item.contextPackPath,
      item.reporterPath,
      ...item.tracePaths,
      ...item.artifactPaths,
      ...item.steps.flatMap((step) => [
        step.screenshotPath,
        ...(step.evidenceRefs ?? []),
        ...(step.traceRefs ?? [])
      ])
    ])
  ].filter((path): path is string => Boolean(path));
}

async function findOwnedSuiteDirectory(workDir: string, suiteRunId: string) {
  const artifactRoot = resolve(workDir, ".brain-creator", "artifacts");
  for (const manifestPath of await findNamedFiles(artifactRoot, "manifest.json")) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { suiteRunId?: string };
      if (manifest.suiteRunId === suiteRunId) return dirname(manifestPath);
    } catch {
      continue;
    }
  }
  return undefined;
}

async function findNamedFiles(root: string, name: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const file = resolve(root, entry.name);
      if (entry.isDirectory()) files.push(...await findNamedFiles(file, name));
      else if (entry.isFile() && entry.name === name) files.push(file);
    }
    return files;
  } catch {
    return [];
  }
}

async function scanArtifactSecrets(
  workDir: string,
  artifacts: ArtifactManifestItem[],
  entries: Array<readonly [string, string]>
) {
  const findings: Array<{ path: string; secretKeys: string[] }> = [];
  for (const artifact of artifacts) {
    const content = await readFile(resolve(workDir, artifact.path));
    const matches = scanSensitiveText(content.toString("utf8"), entries);
    if (matches.length > 0) {
      findings.push({
        path: artifact.path,
        secretKeys: matches.map((match) => match.secretKey)
      });
    }
  }
  return findings;
}

async function collectFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const file = resolve(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await collectFiles(file)));
      } else if (entry.isFile()) {
        files.push(file);
      }
    }
    return files;
  } catch {
    return [];
  }
}

function scanSensitiveText(content: string, entries: Array<readonly [string, string]>) {
  const secrets = Object.fromEntries(entries);
  return [
    ...scanSensitiveValues(content, secrets),
    ...scanSensitivePatterns(content).map((finding) => ({
      secretKey: `pattern:${finding.rule}`,
      matchedLength: finding.matchedLength
    }))
  ];
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

function isProtectedAuthArtifact(path: string) {
  return /(?:^|\/)\.brain-creator\/auth\//i.test(normalizeArchivePath(path));
}
