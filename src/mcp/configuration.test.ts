import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const skillNames = [
  "brain-creator",
  "bc-system",
  "bc-auth",
  "bc-rules",
  "bc-plan",
  "bc-run",
  "bc-assets"
];

describe("Brain Creator local integration files", () => {
  it("defines Claude Code MCP server settings for Brain Creator", async () => {
    const settings = JSON.parse(await readFile(".claude/settings.json", "utf8"));
    const mcpConfig = JSON.parse(await readFile(".mcp.json", "utf8"));

    expect(settings.mcpServers["brain-creator"]).toEqual({
      command: "brain-creator-mcp",
      env: {
        BRAIN_CREATOR_WORKSPACE: ".",
        BRAIN_CREATOR_AGENT_COMMAND: "claude",
        BRAIN_CREATOR_AGENT_ARGS: "[\"--print\",\"--permission-mode\",\"acceptEdits\"]",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      }
    });
    expect(mcpConfig.mcpServers["brain-creator"]).toEqual({
      command: "brain-creator-mcp",
      env: {
        BRAIN_CREATOR_WORKSPACE: ".",
        BRAIN_CREATOR_AGENT_COMMAND: "claude",
        BRAIN_CREATOR_AGENT_ARGS: "[\"--print\",\"--permission-mode\",\"acceptEdits\"]",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      }
    });
    expect(mcpConfig.mcpServers["playwright-test"]).toBeDefined();
  });

  it("packages Brain Creator MCP as an installable CLI entrypoint", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.bin).toEqual({
      "brain-creator-mcp": "dist/cli/brainCreatorMcp.js",
      "brain-creator-doctor": "dist/cli/doctor.js",
      "brain-creator-install-assets": "dist/cli/installAssets.js",
      "brain-creator-write-mcp-config": "dist/cli/writeMcpConfig.js"
    });
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        "dist/",
        "skills/",
        ".claude/agents/",
        "plugin/",
        "docs/mcp-installation.md",
        "README.md"
      ])
    );
    expect(packageJson.scripts.build).toContain("tsc");
    expect(packageJson.scripts.prepack).toBe("npm run build");
    expect(packageJson.scripts.mcp).toContain("dist/cli/brainCreatorMcp.js");
    expect(packageJson.scripts["dev:mcp"]).toContain("src/mcp/server.ts");
    expect(packageJson.scripts["verify:installed-mcp"]).toContain(
      "scripts/verifyInstalledMcpSmoke.ts"
    );
    expect(packageJson.scripts["verify:package-install"]).toContain(
      "scripts/verifyPackageInstallSmoke.ts"
    );
    expect(packageJson.scripts["verify:package-contents"]).toContain(
      "scripts/verifyPackageContents.ts"
    );
    expect(packageJson.scripts["release:check"]).toContain(
      "scripts/releaseReadiness.ts"
    );
  });

  it("defines a plugin installation manifest draft", async () => {
    const manifest = JSON.parse(await readFile("plugin/manifest.json", "utf8"));

    expect(manifest.name).toBe("brain-creator");
    expect(manifest.mcpServers["brain-creator"]).toEqual({
      command: "brain-creator-mcp",
      env: {
        BRAIN_CREATOR_WORKSPACE: ".",
        BRAIN_CREATOR_AGENT_COMMAND: "claude",
        BRAIN_CREATOR_AGENT_ARGS: "[\"--print\",\"--permission-mode\",\"acceptEdits\"]",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      }
    });
    expect(manifest.skills).toEqual([
      expect.objectContaining({
        name: "brain-creator",
        path: "skills/brain-creator/SKILL.md"
      })
    ]);
    expect(manifest.doctor.command).toBe("brain-creator-doctor");
  });

  it("defines all Brain Creator skills with tool-oriented usage guidance", async () => {
    for (const skillName of skillNames) {
      const content = await readFile(`skills/${skillName}/SKILL.md`, "utf8");

      expect(content).toContain("---");
      expect(content).toContain("Brain Creator");
      expect(content).toContain("MCP");
      expect(content).toMatch(/bc_[a-z_]+/);
    }
  });

  it("defines a one-sentence Brain Creator workflow entrypoint for agent clients", async () => {
    const content = await readFile("skills/brain-creator/SKILL.md", "utf8");

    expect(content).toContain("one-sentence");
    expect(content).toContain("bc_list_systems");
    expect(content).toContain("bc_create_system");
    expect(content).toContain("bc_generate_plan");
    expect(content).toContain("bc_approve_plan");
    expect(content).toContain("bc_run_chain");
    expect(content).toContain("bc_artifact_overview");
    expect(content).toContain("bc_list_gaps");
    expect(content).toContain("Do not create or prioritize a Web UI");
  });

  it("registers the Brain Creator entrypoint as a Claude Code project skill", async () => {
    const canonical = await readFile("skills/brain-creator/SKILL.md", "utf8");
    const claudeSkill = await readFile(".claude/skills/brain-creator/SKILL.md", "utf8");

    expect(claudeSkill).toBe(canonical);
    expect(claudeSkill).toContain("one-sentence");
    expect(claudeSkill).toContain("bc_run_chain");
  });

  it("keeps Playwright agent definitions and default seed file available", async () => {
    const planner = await readFile(".claude/agents/playwright-test-planner.md", "utf8");
    const generator = await readFile(".claude/agents/playwright-test-generator.md", "utf8");
    const healer = await readFile(".claude/agents/playwright-test-healer.md", "utf8");
    const seed = await readFile("tests/generated/seed.spec.ts", "utf8");

    expect(planner).toContain("playwright-test-planner");
    expect(generator).toContain("playwright-test-generator");
    expect(healer).toContain("playwright-test-healer");
    expect(seed).toContain("generate code here");
  });

  it("keeps Playwright browser config portable across local and CI environments", async () => {
    const config = await readFile("playwright.config.ts", "utf8");

    expect(config).toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE");
    expect(config).not.toContain("C:\\Users\\");
  });
});
