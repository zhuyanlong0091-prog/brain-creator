#!/usr/bin/env node
import { constants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isCliEntryPoint } from "./entrypoint.js";

export type InstallAssetsOptions = {
  targetDir?: string;
  packageRoot?: string;
  force?: boolean;
};

export type InstallAssetsResult = {
  targetDir: string;
  installed: string[];
  skipped: string[];
};

const assetPairs = [
  {
    source: "playwright.config.ts",
    target: "playwright.config.ts"
  },
  {
    source: "skills/brain-creator/SKILL.md",
    target: ".claude/skills/brain-creator/SKILL.md"
  },
  {
    source: ".claude/agents/playwright-test-planner.md",
    target: ".claude/agents/playwright-test-planner.md"
  },
  {
    source: ".claude/agents/playwright-test-generator.md",
    target: ".claude/agents/playwright-test-generator.md"
  },
  {
    source: ".claude/agents/playwright-test-healer.md",
    target: ".claude/agents/playwright-test-healer.md"
  }
];

export async function installBrainCreatorAssets(
  options: InstallAssetsOptions = {}
): Promise<InstallAssetsResult> {
  const targetDir = resolve(options.targetDir ?? process.cwd());
  const packageRoot = resolve(options.packageRoot ?? resolvePackageRoot());
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const pair of assetPairs) {
    const sourcePath = join(packageRoot, pair.source);
    const targetPath = join(targetDir, pair.target);
    if (!options.force && (await exists(targetPath))) {
      skipped.push(targetPath);
      continue;
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    installed.push(targetPath);
  }

  return { targetDir, installed, skipped };
}

function resolvePackageRoot() {
  const currentFile = fileURLToPath(import.meta.url);
  if (currentFile.includes(`${join("dist", "cli")}`)) {
    return resolve(dirname(currentFile), "..", "..");
  }
  return resolve(dirname(currentFile), "..", "..");
}

async function exists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (isCliEntryPoint(import.meta.url)) {
  const force = process.argv.includes("--force");
  const targetArgIndex = process.argv.findIndex((arg) => arg === "--target");
  const targetDir = targetArgIndex >= 0 ? process.argv[targetArgIndex + 1] : undefined;
  installBrainCreatorAssets({ targetDir, force })
    .then((result) => {
      console.log(`Brain Creator assets installed into ${result.targetDir}`);
      console.log(`Installed: ${result.installed.length}`);
      console.log(`Skipped: ${result.skipped.length}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
