import { describe, expect, it } from "vitest";
import {
  buildReleaseReadinessReport,
  formatReleaseReadinessReport
} from "./releaseReadiness.js";

const publishableFiles = [
  "dist/",
  "skills/",
  ".claude/agents/",
  "plugin/",
  "plugins/brain-creator/",
  ".agents/plugins/marketplace.json",
  "README.md"
];

const legacyPackageFiles = ["dist/", "skills/", ".claude/agents/", "plugin/", "README.md"];

const publishableScripts = {
  "verify:package-contents": "node --loader ts-node/esm scripts/verifyPackageContents.ts",
  "verify:package-install": "node --loader ts-node/esm scripts/verifyPackageInstallSmoke.ts",
  "verify:codex-native-entry": "node --loader ts-node/esm scripts/codexNativeEntrySmoke.ts",
  "verify:codex-plugin-install": "node --loader ts-node/esm scripts/codexPluginInstallSmoke.ts"
};

const publishableBins = {
  "brain-creator": "dist/cli/brainCreator.js",
  "brain-creator-mcp": "dist/cli/brainCreatorMcp.js",
  "brain-creator-doctor": "dist/cli/doctor.js",
  "brain-creator-install-assets": "dist/cli/installAssets.js",
  "brain-creator-write-mcp-config": "dist/cli/writeMcpConfig.js",
  "brain-creator-install-codex-plugin": "dist/cli/installCodexPlugin.js"
};

describe("release readiness report", () => {
  it("reports blockers for the current safe non-publishable package state", () => {
    const report = buildReleaseReadinessReport({
      packageJson: {
        name: "brain-creator",
        version: "2.0.1",
        private: true,
        bin: {
          "brain-creator-mcp": "dist/cli/brainCreatorMcp.js"
        },
        files: legacyPackageFiles,
        scripts: {
          "verify:package-contents": "node --loader ts-node/esm scripts/verifyPackageContents.ts",
          "verify:package-install": "node --loader ts-node/esm scripts/verifyPackageInstallSmoke.ts"
        }
      },
      npmAuth: "missing",
      packageNameStatus: "available"
    });

    expect(report.ready).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "private flag",
          status: "blocker",
          message: expect.stringContaining("private")
        }),
        expect.objectContaining({
          name: "license",
          status: "blocker",
          message: expect.stringContaining("license")
        }),
        expect.objectContaining({
          name: "npm authentication",
          status: "blocker"
        })
      ])
    );
    expect(formatReleaseReadinessReport(report)).toContain("Release readiness: blocked");
  });

  it("passes when package metadata and npm state are publishable", () => {
    const report = buildReleaseReadinessReport({
      packageJson: {
        name: "brain-creator",
        version: "2.0.1",
        private: false,
        license: "MIT",
        bin: publishableBins,
        files: publishableFiles,
        scripts: publishableScripts
      },
      npmAuth: "authenticated",
      packageNameStatus: "available"
    });

    expect(report.ready).toBe(true);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(formatReleaseReadinessReport(report)).toContain("Release readiness: ready");
  });

  it("passes for an existing npm package when publishing a new version", () => {
    const report = buildReleaseReadinessReport({
      packageJson: {
        name: "brain-creator",
        version: "2.0.1",
        private: false,
        license: "MIT",
        bin: publishableBins,
        files: publishableFiles,
        scripts: publishableScripts
      },
      npmAuth: "authenticated",
      packageNameStatus: "published"
    });

    expect(report.ready).toBe(true);
    expect(formatReleaseReadinessReport(report)).toContain("package already exists on npm");
  });

  it("blocks publish readiness when Codex-native verification scripts are missing", () => {
    const report = buildReleaseReadinessReport({
      packageJson: {
        name: "brain-creator",
        version: "2.0.2",
        private: false,
        license: "MIT",
        bin: publishableBins,
        files: publishableFiles,
        scripts: {
          "verify:package-contents": "node --loader ts-node/esm scripts/verifyPackageContents.ts",
          "verify:package-install": "node --loader ts-node/esm scripts/verifyPackageInstallSmoke.ts"
        }
      },
      npmAuth: "authenticated",
      packageNameStatus: "published"
    });

    expect(report.ready).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "verify:codex-native-entry",
          status: "blocker"
        }),
        expect.objectContaining({
          name: "verify:codex-plugin-install",
          status: "blocker"
        })
      ])
    );
  });

  it("blocks publish readiness when Codex plugin package files are missing", () => {
    const report = buildReleaseReadinessReport({
      packageJson: {
        name: "brain-creator",
        version: "2.0.2",
        private: false,
        license: "MIT",
        bin: publishableBins,
        files: legacyPackageFiles,
        scripts: publishableScripts
      },
      npmAuth: "authenticated",
      packageNameStatus: "published"
    });

    expect(report.ready).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "package files",
          status: "blocker",
          message: expect.stringContaining("plugins/brain-creator/")
        }),
        expect.objectContaining({
          name: "package files",
          status: "blocker",
          message: expect.stringContaining(".agents/plugins/marketplace.json")
        })
      ])
    );
  });
});
