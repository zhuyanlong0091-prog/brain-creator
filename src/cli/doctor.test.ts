import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { buildDoctorReport, formatDoctorReport } from "./doctor.js";

describe("Brain Creator doctor", () => {
  it("reports workspace, data file, bridge, and agent definition readiness", () => {
    const cwd = resolve("business-project");
    const report = buildDoctorReport({
      cwd,
      env: {
        BRAIN_CREATOR_WORKSPACE: "business-project",
        BRAIN_CREATOR_AGENT_COMMAND: "claude",
        BRAIN_CREATOR_AGENT_ARGS: "[\"--print\",\"--permission-mode\",\"acceptEdits\"]",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      },
      commandExists: (command) => command === "claude",
      fileExists: (path) =>
        [
          join(cwd, ".claude", "agents", "playwright-test-planner.md"),
          join(cwd, ".claude", "agents", "playwright-test-generator.md"),
          join(cwd, ".claude", "agents", "playwright-test-healer.md")
        ].includes(path)
    });

    expect(report.ok).toBe(true);
    expect(report.workspace).toBe(cwd);
    expect(report.dataFile).toBe(join(cwd, ".brain-creator", "local-assets.json"));
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Agent bridge provider", status: "pass" }),
        expect.objectContaining({ name: "Agent bridge args", status: "pass" }),
        expect.objectContaining({ name: "Playwright agent definitions", status: "pass" })
      ])
    );
    expect(formatDoctorReport(report)).toContain("Brain Creator doctor: ready");
  });

  it("returns actionable failures before users reach plan or chain execution", () => {
    const cwd = resolve("business-project");
    const report = buildDoctorReport({
      cwd,
      env: {},
      commandExists: () => false,
      fileExists: () => false
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Agent bridge provider",
          status: "fail",
          remediation: expect.stringContaining("BRAIN_CREATOR_AGENT_PROVIDER")
        }),
        expect.objectContaining({
          name: "Playwright agent definitions",
          status: "fail",
          remediation: expect.stringContaining("npx playwright init-agents")
        })
      ])
    );
    expect(formatDoctorReport(report)).toContain("Brain Creator doctor: action required");
  });

  it("reports Codex provider readiness when configured", () => {
    const cwd = resolve("business-project");
    const report = buildDoctorReport({
      cwd,
      env: {
        BRAIN_CREATOR_AGENT_PROVIDER: "codex",
        BRAIN_CREATOR_CODEX_COMMAND: "codex",
        BRAIN_CREATOR_CODEX_ARGS: "[\"exec\",\"--json\",\"-\"]",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      },
      commandExists: (command) => command === "codex",
      fileExists: () => true
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Agent bridge provider", status: "pass", message: expect.stringContaining("codex") }),
        expect.objectContaining({ name: "Agent bridge args", status: "pass" })
      ])
    );
  });

  it("auto-detects Codex when provider is auto and codex is available", () => {
    const report = buildDoctorReport({
      cwd: resolve("business-project"),
      env: {
        BRAIN_CREATOR_AGENT_PROVIDER: "auto",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      },
      commandExists: (command) => command === "codex",
      fileExists: () => true
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Agent bridge provider", status: "pass", message: expect.stringContaining("codex") })
      ])
    );
  });
});
