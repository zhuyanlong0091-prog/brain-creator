import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Agent-native usage documentation", () => {
  it("keeps a bilingual requirement-first README", async () => {
    const content = await readFile("README.md", "utf8");

    for (const marker of [
      "Brain Creator",
      "## 中文版",
      "## English Version",
      "Claude Code / Codex",
      "Use Brain Creator to connect this system",
      "MCP",
      "source checkout mode",
      "MCP CLI connection mode",
      "repo-local plugin installation mode",
      "brain-creator init",
      "brain-creator doctor",
      "brain-creator config",
      "brain-creator plugin install",
      "brain-creator help legacy",
      "业务项目安装步骤",
      "Business Project Setup",
      "npm run verify:package-install",
      "发布前检查",
      "Release Readiness",
      "npm run verify:package-contents",
      "npm run release:check",
      "MIT license",
      "docs/release-checklist.md",
      "No Web UI",
      "无 Web UI",
      "智能体入口",
      "docs/agent-usage.md",
      "npm run verify:live-claude-skill-workflow"
    ]) {
      expect(content).toContain(marker);
    }
  });

  it("documents the requirement-first Agent flow and legacy compatibility", async () => {
    const content = await readFile("docs/agent-usage.md", "utf8");

    for (const marker of [
      "# Brain Creator Agent Usage Guide",
      "one sentence",
      "Requirement-First Flow",
      "Ingest The Requirement",
      "Analyze And Design",
      "Approve The Baseline",
      "Compile Executable Cases",
      "Preview And Execute",
      "Review Evidence",
      "Use Brain Creator to connect the order admin system",
      "source checkout mode",
      "MCP CLI connection mode",
      "repo-local plugin installation mode",
      "brain-creator init",
      "brain-creator doctor",
      "brain-creator help legacy",
      "bc_run_chain",
      "bc_create_auth_checkpoint",
      "bc_cancel_plan",
      "bc_resume_plan",
      "bc_report_gap"
    ]) {
      expect(content).toContain(marker);
    }
  });

  it("documents the session resume new-session entry point", async () => {
    const content = await readFile("docs/agent-usage.md", "utf8");

    expect(content).toContain("Session Resume: The New-Session Entry Point");
    expect(content).toContain("bc_session_resume");
    expect(content).toContain("6-7 independent queries");
    expect(content).toContain("Bridge preflight status");
    expect(content).toContain("docs/e2e-session-resume-workflow.md");
    expect(content).toContain("check the order-admin system status");
    expect(content).toContain("resume where I left off");
  });

  it("lists the session resume smoke command in verification commands", async () => {
    const content = await readFile("docs/agent-usage.md", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(content).toContain("npm run verify:live-session-resume-workflow");
    expect(packageJson.scripts["verify:live-session-resume-workflow"]).toContain(
      "scripts/liveSessionResumeWorkflowSmoke.ts"
    );
  });
});
