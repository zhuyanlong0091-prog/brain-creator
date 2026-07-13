import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installBrainCreatorAssets } from "./installAssets.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("installBrainCreatorAssets", () => {
  it("installs the Brain Creator skill and Playwright agent definitions into a business project", async () => {
    const targetDir = await tempDir();
    const result = await installBrainCreatorAssets({ targetDir, packageRoot: resolve(".") });

    expect(result.installed).toEqual(
      expect.arrayContaining([
        join(targetDir, "playwright.config.ts"),
        join(targetDir, ".claude", "skills", "brain-creator", "SKILL.md"),
        join(targetDir, ".claude", "agents", "playwright-test-planner.md"),
        join(targetDir, ".claude", "agents", "playwright-test-generator.md"),
        join(targetDir, ".claude", "agents", "playwright-test-healer.md")
      ])
    );
    await expect(
      readFile(join(targetDir, ".claude", "skills", "brain-creator", "SKILL.md"), "utf8")
    ).resolves.toContain("bc_run_chain");
    await expect(readFile(join(targetDir, "playwright.config.ts"), "utf8")).resolves.toContain(
      "PLAYWRIGHT_CHROMIUM_EXECUTABLE"
    );
  });

  it("does not overwrite existing business project assets unless force is enabled", async () => {
    const targetDir = await tempDir();
    const skillPath = join(targetDir, ".claude", "skills", "brain-creator", "SKILL.md");
    await mkdir(join(targetDir, ".claude", "skills", "brain-creator"), { recursive: true });
    await writeFile(skillPath, "custom user skill", "utf8");

    const result = await installBrainCreatorAssets({ targetDir, packageRoot: resolve(".") });

    expect(result.skipped).toContain(skillPath);
    await expect(readFile(skillPath, "utf8")).resolves.toBe("custom user skill");

    const forced = await installBrainCreatorAssets({
      targetDir,
      packageRoot: resolve("."),
      force: true
    });
    expect(forced.installed).toContain(skillPath);
    await expect(readFile(skillPath, "utf8")).resolves.toContain("bc_run_chain");
  });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-assets-"));
  tempDirs.push(dir);
  return dir;
}
