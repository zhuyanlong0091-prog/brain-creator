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
        BRAIN_CREATOR_KNOWLEDGE_DIR: "business-project/knowledge",
        BRAIN_CREATOR_TOOL_PROFILE: "facade",
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
    expect(report.storeDir).toBe(join(cwd, ".brain-creator", "store"));
    expect(report.knowledgeDir).toBe(resolve("business-project/knowledge"));
    expect(report.toolProfile).toBe("facade");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Agent bridge provider", status: "pass" }),
        expect.objectContaining({ name: "Agent bridge args", status: "pass" }),
        expect.objectContaining({ name: "Playwright browser", status: "warn" }),
        expect.objectContaining({ name: "Playwright agent definitions", status: "pass" })
      ])
    );
    expect(formatDoctorReport(report)).toContain("Brain Creator doctor: ready");
    expect(formatDoctorReport(report)).toContain("Sharded store:");
    expect(formatDoctorReport(report)).toContain("npx brain-creator-install-codex-plugin");
  });

  it("fails fast for invalid tool profiles and partial Feishu credentials", () => {
    const report = buildDoctorReport({
      cwd: resolve("business-project"),
      env: {
        BRAIN_CREATOR_TOOL_PROFILE: "small",
        BRAIN_CREATOR_FEISHU_APP_ID: "app-id",
        BRAIN_CREATOR_AGENT_PROVIDER: "host-agent",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      },
      commandExists: () => false,
      fileExists: () => true
    });

    expect(report.ok).toBe(false);
    expect(report.connectors.feishu).toBe("invalid");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "MCP tool profile", status: "fail" }),
        expect.objectContaining({ name: "Feishu connector", status: "fail" })
      ])
    );
    expect(formatDoctorReport(report)).not.toContain("app-id");
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
        }),
        expect.objectContaining({
          name: "Playwright browser",
          status: "warn",
          remediation: expect.stringContaining("playwright install chromium")
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
    expect(report.agentBridge).toEqual(
      expect.objectContaining({
        provider: "codex",
        recommendedAction: expect.stringContaining("Codex subprocess bridge")
      })
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Agent bridge provider", status: "pass", message: expect.stringContaining("codex") }),
        expect.objectContaining({ name: "Agent bridge args", status: "pass" })
      ])
    );
    expect(formatDoctorReport(report)).toContain("Recommended action: Run confirmed workflows through the Codex subprocess bridge.");
  });

  it("reports Claude provider guidance without leaking raw args", () => {
    const report = buildDoctorReport({
      cwd: resolve("business-project"),
      env: {
        BRAIN_CREATOR_AGENT_PROVIDER: "claude",
        BRAIN_CREATOR_CLAUDE_COMMAND: "claude",
        BRAIN_CREATOR_CLAUDE_ARGS: "[\"--print\",\"--api-key\",\"secret-value\"]",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      },
      commandExists: (command) => command === "claude",
      fileExists: () => true
    });

    expect(report.ok).toBe(true);
    expect(report.agentBridge).toEqual(
      expect.objectContaining({
        provider: "claude",
        recommendedAction: expect.stringContaining("Claude subprocess bridge")
      })
    );
    const formatted = formatDoctorReport(report);
    expect(formatted).toContain("Recommended action: Run confirmed workflows through the Claude subprocess bridge.");
    expect(formatted).not.toContain("secret-value");
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

  it("resolves explicit auto provider commands to the concrete provider", () => {
    const codexReport = buildDoctorReport({
      cwd: resolve("business-project"),
      env: {
        BRAIN_CREATOR_AGENT_PROVIDER: "auto",
        BRAIN_CREATOR_CODEX_COMMAND: "codex",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      },
      commandExists: (command) => command === "codex",
      fileExists: () => true
    });
    const claudeReport = buildDoctorReport({
      cwd: resolve("business-project"),
      env: {
        BRAIN_CREATOR_AGENT_PROVIDER: "auto",
        BRAIN_CREATOR_CLAUDE_COMMAND: "claude",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      },
      commandExists: (command) => command === "claude",
      fileExists: () => true
    });

    expect(codexReport.agentBridge).toEqual(
      expect.objectContaining({
        provider: "codex",
        command: "codex",
        recommendedAction: expect.stringContaining("Codex subprocess bridge")
      })
    );
    expect(claudeReport.agentBridge).toEqual(
      expect.objectContaining({
        provider: "claude",
        command: "claude",
        recommendedAction: expect.stringContaining("Claude subprocess bridge")
      })
    );
  });

  it("reports host-agent provider as ready without requiring a subprocess command", () => {
    const report = buildDoctorReport({
      cwd: resolve("business-project"),
      env: {
        BRAIN_CREATOR_AGENT_PROVIDER: "host-agent",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      },
      commandExists: () => false,
      fileExists: () => true
    });

    expect(report.ok).toBe(true);
    expect(report.agentBridge).toEqual(
      expect.objectContaining({
        provider: "host-agent",
        recommendedAction: expect.stringContaining("Planner, Generator, or Healer")
      })
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Agent bridge provider",
          status: "pass",
          message: expect.stringContaining("without a Claude or Codex subprocess")
        }),
        expect.objectContaining({
          name: "Playwright browser",
          status: "pass"
        })
      ])
    );
  });

  it("reports disabled provider as preview-only", () => {
    const report = buildDoctorReport({
      cwd: resolve("business-project"),
      env: {
        BRAIN_CREATOR_AGENT_PROVIDER: "disabled",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      },
      commandExists: () => false,
      fileExists: () => true
    });

    expect(report.ok).toBe(false);
    expect(report.agentBridge).toEqual(
      expect.objectContaining({
        provider: "disabled",
        recommendedAction: expect.stringContaining("preview/status")
      })
    );
  });

  it("fails on invalid provider instead of falling back to auto", () => {
    const report = buildDoctorReport({
      cwd: resolve("business-project"),
      env: {
        BRAIN_CREATOR_AGENT_PROVIDER: "cursor",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      },
      commandExists: (command) => command === "codex",
      fileExists: () => true
    });

    expect(report.ok).toBe(false);
    expect(report.agentBridge).toEqual(
      expect.objectContaining({
        provider: "invalid",
        recommendedAction: expect.stringContaining("Set BRAIN_CREATOR_AGENT_PROVIDER")
      })
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Agent bridge provider",
          status: "fail",
          message: expect.stringContaining("Unsupported agent bridge provider cursor")
        })
      ])
    );
  });
});
