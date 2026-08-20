import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type ArtifactRunLayoutInput = {
  workDir: string;
  systemKey: string;
  requirementKey: string;
  requirementVersion?: number;
  suiteRunId: string;
};

export type ArtifactRunLayout = {
  root: string;
  sourceDir: string;
  analysisDir: string;
  casesDir: string;
  specsDir: string;
  testsDir: string;
  evidenceDir: string;
  reportDir: string;
  manifestPath: string;
  indexPath: string;
  latestPath: string;
};

export function resolveArtifactRunLayout(input: ArtifactRunLayoutInput): ArtifactRunLayout {
  const systemKey = ownershipPart(input.systemKey);
  const requirementBase = ownershipPart(input.requirementKey);
  const requirementKey = input.requirementVersion === undefined
    ? requirementBase
    : `${requirementBase}-v${input.requirementVersion}`;
  const suiteRunId = ownershipPart(input.suiteRunId);
  const root = resolve(
    input.workDir,
    ".brain-creator",
    "artifacts",
    systemKey,
    requirementKey,
    suiteRunId
  );
  assertInsideWorkspace(input.workDir, root);
  return {
    root,
    sourceDir: join(root, "source"),
    analysisDir: join(root, "analysis"),
    casesDir: join(root, "cases"),
    specsDir: join(root, "specs"),
    testsDir: join(root, "tests"),
    evidenceDir: join(root, "evidence"),
    reportDir: join(root, "report"),
    manifestPath: join(root, "manifest.json"),
    indexPath: join(root, "index.md"),
    latestPath: join(dirnameOfRun(root), "latest.json")
  };
}

export function artifactFileName(input: {
  caseNo?: string;
  title: string;
  extension: string;
  contentHash?: string;
}) {
  const extension = input.extension.startsWith(".") ? input.extension : `.${input.extension}`;
  const parts = [input.caseNo, input.title]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(readableSlug)
    .filter(Boolean);
  const fallback = input.contentHash?.slice(0, 12) ?? "artifact";
  return `${parts.join("-") || fallback}${extension}`;
}

export async function writeArtifactPlaywrightConfig(input: {
  workDir: string;
  layout: ArtifactRunLayout;
}) {
  const configPath = join(input.layout.root, "playwright.config.ts");
  const projectConfig = resolve(input.workDir, "playwright.config.ts");
  const baseImport = existsSync(projectConfig)
    ? `import baseConfig from ${JSON.stringify(relative(input.layout.root, projectConfig).replace(/\\/g, "/"))};\n`
    : "const baseConfig = {};\n";
  const source = [
    'import { defineConfig } from "@playwright/test";',
    baseImport.trimEnd(),
    "",
    "export default defineConfig(baseConfig, {",
    '  testDir: "./tests",',
    '  outputDir: "./evidence/test-results",',
    "  fullyParallel: false,",
    "  workers: 1",
    "});",
    ""
  ].join("\n");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, source, "utf8");
  return configPath;
}

export function readableSlug(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 100);
}

function ownershipPart(value: string) {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error("Artifact ownership parts cannot contain traversal");
  }
  return readableSlug(value) || "unscoped";
}

function assertInsideWorkspace(workDir: string, target: string) {
  const offset = relative(resolve(workDir), target);
  if (offset.startsWith("..") || isAbsolute(offset)) {
    throw new Error("Artifact path must stay inside workspace");
  }
}

function dirnameOfRun(root: string) {
  return resolve(root, "..");
}
