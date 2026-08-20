// @vitest-environment node

import { join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  artifactFileName,
  resolveArtifactRunLayout,
  writeArtifactPlaywrightConfig
} from "./artifactWorkspace.js";

describe("artifact workspace", () => {
  it("owns every artifact category by system, requirement revision, and suite", () => {
    const layout = resolveArtifactRunLayout({
      workDir: "C:\\workspace",
      systemKey: "HR System",
      requirementKey: "Intern Headcount",
      requirementVersion: 2,
      suiteRunId: "suite_run_1"
    });

    expect(layout.root).toBe(
      join(
        "C:\\workspace",
        ".brain-creator",
        "artifacts",
        "hr-system",
        "intern-headcount-v2",
        "suite_run_1"
      )
    );
    expect(layout).toEqual(expect.objectContaining({
      sourceDir: join(layout.root, "source"),
      analysisDir: join(layout.root, "analysis"),
      casesDir: join(layout.root, "cases"),
      specsDir: join(layout.root, "specs"),
      testsDir: join(layout.root, "tests"),
      evidenceDir: join(layout.root, "evidence"),
      reportDir: join(layout.root, "report"),
      manifestPath: join(layout.root, "manifest.json"),
      indexPath: join(layout.root, "index.md")
    }));
  });

  it("builds stable human-readable names and blocks traversal", () => {
    expect(artifactFileName({ caseNo: "TC-001", title: "Create order", extension: ".spec.ts" }))
      .toBe("tc-001-create-order.spec.ts");
    expect(artifactFileName({ caseNo: "HC-REQ-001", title: "实习生占编", extension: "md" }))
      .toBe("hc-req-001-实习生占编.md");
    expect(() => resolveArtifactRunLayout({
      workDir: "C:\\workspace",
      systemKey: "../outside",
      requirementKey: "orders",
      suiteRunId: "suite"
    })).toThrow("Artifact ownership parts cannot contain traversal");
  });

  it("writes a Suite-scoped Playwright config that inherits project settings", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "brain-artifact-config-"));
    try {
      await writeFile(join(workDir, "playwright.config.ts"), "export default {};", "utf8");
      const layout = resolveArtifactRunLayout({
        workDir,
        systemKey: "orders",
        requirementKey: "checkout",
        requirementVersion: 1,
        suiteRunId: "run_1"
      });
      const configPath = await writeArtifactPlaywrightConfig({ workDir, layout });
      const source = await readFile(configPath, "utf8");

      expect(source).toContain('testDir: "./tests"');
      expect(source).toContain('outputDir: "./evidence/test-results"');
      expect(source).toContain("playwright.config.ts");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
