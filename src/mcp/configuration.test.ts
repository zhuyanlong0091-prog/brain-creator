import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

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

  it("defines explicit npm publish exclusions instead of relying on gitignore", async () => {
    const npmIgnore = await readFile(".npmignore", "utf8");

    expect(npmIgnore).toContain("src/");
    expect(npmIgnore).toContain("scripts/");
    expect(npmIgnore).toContain("tests/");
    expect(npmIgnore).toContain(".obsidian/");
    expect(npmIgnore).toContain(".playwright-mcp/");
    expect(npmIgnore).toContain("*.tgz");
  });

  it("defines a plugin installation manifest draft", async () => {
    const manifest = JSON.parse(await readFile("plugin/manifest.json", "utf8"));

    expect(manifest.name).toBe("brain-creator");
    expect(manifest.mcpServers["brain-creator"]).toEqual({
      command: "npx",
      args: ["brain-creator-mcp"],
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
    expect(manifest.doctor).toEqual({
      command: "npx",
      args: ["brain-creator-doctor"]
    });
  });

  it("publishes a repo-local Codex plugin with MCP defaults and marketplace metadata", async () => {
    const pluginManifest = JSON.parse(
      await readFile("plugins/brain-creator/.codex-plugin/plugin.json", "utf8")
    );
    const pluginMcp = JSON.parse(await readFile("plugins/brain-creator/.mcp.json", "utf8"));
    const marketplace = JSON.parse(await readFile(".agents/plugins/marketplace.json", "utf8"));

    expect(pluginManifest.name).toBe("brain-creator");
    expect(pluginManifest.version).toBe("2.0.1");
    expect(pluginManifest.description).toContain("Agent-native testing brain");
    expect(pluginManifest.skills).toBe("./skills/");
    expect(pluginManifest.mcpServers).toBe("./.mcp.json");
    expect(pluginManifest.interface.displayName).toBe("Brain Creator");
    expect(pluginManifest.interface.category).toBe("Productivity");
    expect(pluginManifest.interface.defaultPrompt).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Use Brain Creator"),
        expect.stringContaining("brain-creator-doctor")
      ])
    );

    expect(pluginMcp.mcpServers["brain-creator"]).toEqual({
      command: "npx",
      args: ["brain-creator-mcp"],
      env: {
        BRAIN_CREATOR_WORKSPACE: ".",
        BRAIN_CREATOR_AGENT_COMMAND: "claude",
        BRAIN_CREATOR_AGENT_ARGS: "[\"--print\",\"--permission-mode\",\"acceptEdits\"]",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      }
    });

    expect(marketplace.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "brain-creator",
          source: {
            source: "local",
            path: "./plugins/brain-creator"
          },
          policy: {
            installation: "AVAILABLE",
            authentication: "ON_INSTALL"
          },
          category: "Productivity"
        })
      ])
    );
  });

  it("defines a single Brain Creator skill with all tool-oriented workflow guidance", async () => {
    const content = await readFile("skills/brain-creator/SKILL.md", "utf8");

    expect(content).toContain("---");
    expect(content).toContain("Brain Creator");
    expect(content).toContain("MCP");
    expect(content).toContain('Skill("brain-creator")` only as an explicit fallback');
    expect(content).toContain("## System");
    expect(content).toContain("## Auth");
    expect(content).toContain("## Glossary");
    expect(content).toContain("## Rules");
    expect(content).toContain("## Plan");
    expect(content).toContain("## Run");
    expect(content).toContain("## Assets And Gaps");
    expect(content).toContain("bc_create_system");
    expect(content).toContain("bc_create_auth");
    expect(content).toContain("bc_add_term");
    expect(content).toContain("bc_add_rule");
    expect(content).toContain("bc_generate_plan");
    expect(content).toContain("bc_run_chain");
    expect(content).toContain("bc_search_assets");
  });

  it("defines a one-sentence Brain Creator workflow entrypoint for agent clients", async () => {
    const content = await readFile("skills/brain-creator/SKILL.md", "utf8");

    expect(content).toContain("One-Sentence");
    expect(content).toContain("Use Brain Creator to connect this system");
    expect(content).toContain("bc_list_systems");
    expect(content).toContain("bc_create_system");
    expect(content).toContain("bc_create_auth_checkpoint");
    expect(content).toContain("bc_batch_confirm_terms");
    expect(content).toContain("bc_delete_rule");
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
    expect(claudeSkill).toContain("One-Sentence");
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
