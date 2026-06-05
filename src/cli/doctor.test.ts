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
        expect.objectContaining({ name: "Claude bridge command", status: "pass" }),
        expect.objectContaining({ name: "Claude bridge args", status: "pass" }),
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
          name: "Claude bridge command",
          status: "fail",
          remediation: expect.stringContaining("BRAIN_CREATOR_AGENT_COMMAND")
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
});
