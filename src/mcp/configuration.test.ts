import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BRAIN_CREATOR_VERSION } from "../version.js";

describe("Brain Creator local integration files", () => {
  it("defines Claude Code MCP server settings for Brain Creator", async () => {
    const settings = JSON.parse(await readFile(".claude/settings.json", "utf8"));
    const mcpConfig = JSON.parse(await readFile(".mcp.json", "utf8"));

    expect(settings.mcpServers["brain-creator"]).toEqual({
      command: "brain-creator-mcp",
      env: {
        BRAIN_CREATOR_WORKSPACE: ".",
        BRAIN_CREATOR_TOOL_PROFILE: "facade",
        BRAIN_CREATOR_AGENT_PROVIDER: "auto",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      }
    });
    expect(mcpConfig.mcpServers["brain-creator"]).toEqual({
      command: "brain-creator-mcp",
      env: {
        BRAIN_CREATOR_WORKSPACE: ".",
        BRAIN_CREATOR_TOOL_PROFILE: "facade",
        BRAIN_CREATOR_AGENT_PROVIDER: "host-agent",
        BRAIN_CREATOR_AGENT_TIMEOUT_MS: "120000"
      }
    });
    expect(mcpConfig.mcpServers["playwright-test"]).toBeDefined();
  });

  it("packages Brain Creator MCP as an installable CLI entrypoint", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));
    const serverModule = await readFile("src/mcp/server.ts", "utf8");

    expect(BRAIN_CREATOR_VERSION).toBe("2.1.1");
    expect(packageJson.version).toBe(BRAIN_CREATOR_VERSION);
    expect(packageLock.version).toBe(BRAIN_CREATOR_VERSION);
    expect(packageLock.packages[""].version).toBe(BRAIN_CREATOR_VERSION);
    expect(serverModule).toContain("version: BRAIN_CREATOR_VERSION");
    expect(packageJson.bin).toEqual({
      "brain-creator": "dist/cli/brainCreator.js",
      "brain-creator-mcp": "dist/cli/brainCreatorMcp.js",
      "brain-creator-doctor": "dist/cli/doctor.js",
      "brain-creator-install-assets": "dist/cli/installAssets.js",
      "brain-creator-write-mcp-config": "dist/cli/writeMcpConfig.js",
      "brain-creator-install-codex-plugin": "dist/cli/installCodexPlugin.js"
    });
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        "dist/",
        "skills/",
        ".claude/agents/",
        "plugin/",
        "playwright.config.ts",
        "docs/**/*.md",
        "docs/llms.txt",
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
    expect(packageJson.scripts["verify:host-agent-chain"]).toContain(
      "scripts/hostAgentChainSmoke.ts"
    );
    expect(packageJson.scripts["verify:host-agent-document-suite"]).toContain(
      "scripts/hostAgentDocumentSuiteSmoke.ts"
    );
    expect(packageJson.scripts["verify:codex-native-entry"]).toContain(
      "scripts/codexNativeEntrySmoke.ts"
    );
    expect(packageJson.scripts["verify:codex-plugin-install"]).toContain(
      "scripts/codexPluginInstallSmoke.ts"
    );
    expect(packageJson.scripts["release:check"]).toContain(
      "scripts/releaseReadiness.ts"
    );
  });

  it("verifies the installed package over stdio with the requirement-first facade", async () => {
    const smoke = await readFile("scripts/verifyPackageInstallSmoke.ts", "utf8");

    expect(smoke).toContain("StdioClientTransport");
    expect(smoke).toContain('BRAIN_CREATOR_AGENT_PROVIDER: "host-agent"');
    expect(smoke).toContain('BRAIN_CREATOR_TOOL_PROFILE: "facade"');
    expect(smoke).toContain('command: "/bc help"');
    expect(smoke).toContain('name: "bc_prepare"');
    expect(smoke).toContain('target: "knowledge-project"');
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
    expect(manifest.version).toBe(BRAIN_CREATOR_VERSION);
    expect(manifest.mcpServers["brain-creator"]).toEqual({
      command: "npx",
      args: ["brain-creator-mcp"],
      env: {
        BRAIN_CREATOR_WORKSPACE: ".",
        BRAIN_CREATOR_TOOL_PROFILE: "facade",
        BRAIN_CREATOR_AGENT_PROVIDER: "auto",
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
    expect(pluginManifest.version).toBe(BRAIN_CREATOR_VERSION);
    expect(pluginManifest.description).toContain("Agent-native testing brain");
    expect(pluginManifest.skills).toBe("./skills/");
    expect(pluginManifest.mcpServers).toBe("./.mcp.json");
    expect(pluginManifest.interface.displayName).toBe("Brain Creator");
    expect(pluginManifest.interface.category).toBe("Productivity");
    expect(pluginManifest.interface.defaultPrompt).toEqual([
      "Use Brain Creator to analyze this requirement document or link and prepare a test design for review.",
      "Use Brain Creator to bind the approved requirement baseline to this system.",
      "Use Brain Creator to preview this test case document, then wait for my confirmation before execution."
    ]);
    expect(pluginManifest.interface.defaultPrompt).toHaveLength(3);
    expect(pluginManifest.interface.longDescription).toContain("host-agent");
    expect(pluginManifest.interface.longDescription).toContain("bc_submit_agent_output");

    expect(pluginMcp.mcpServers["brain-creator"]).toEqual({
      command: "npx",
      args: ["brain-creator-mcp"],
      env: {
        BRAIN_CREATOR_WORKSPACE: ".",
        BRAIN_CREATOR_TOOL_PROFILE: "facade",
        BRAIN_CREATOR_AGENT_PROVIDER: "host-agent",
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

  it("defines a single Brain Creator skill with facade-first workflow guidance", async () => {
    const content = await readFile("skills/brain-creator/SKILL.md", "utf8");

    expect(content).toContain("---");
    expect(content).toContain("Brain Creator");
    expect(content).toContain("MCP");
    expect(content).toContain('Skill("brain-creator")` only as an explicit fallback');
    expect(content).toContain("## Facade-First Tool Policy");
    expect(content).toContain("## System");
    expect(content).toContain("## Auth");
    expect(content).toContain("## Glossary");
    expect(content).toContain("## Rules");
    expect(content).toContain("## Plan");
    expect(content).toContain("## Run");
    expect(content).toContain("## Assets And Gaps");
    expect(content).toContain("bc_status");
    expect(content).toContain("bc_configure");
    expect(content).toContain("bc_run");
    expect(content).toContain("bc_review");
    expect(content).toContain("case-source-suite");
    expect(content).toContain("confirm: false");
    expect(content).toContain("confirm: true");
    expect(content).toContain("bc_create_auth");
    expect(content).toContain("bc_add_term");
    expect(content).toContain("bc_add_rule");
    expect(content).toContain("bc_generate_plan");
    expect(content).toContain("bc_run_chain");
    expect(content).toContain("mode: \"full-workflow\"");
    expect(content).toContain("bc_search_assets");
  });

  it("defines a one-sentence Brain Creator workflow entrypoint for agent clients", async () => {
    const content = await readFile("skills/brain-creator/SKILL.md", "utf8");

    expect(content).toContain("One-Sentence");
    expect(content).toContain("Use Brain Creator to connect this system");
    expect(content).toContain("bc_status");
    expect(content).toContain("bc_configure target=system");
    expect(content).toContain("bc_configure target=auth");
    expect(content).toContain("bc_run mode=case-source-suite confirm=false");
    expect(content).toContain("bc_run mode=case-source-suite confirm=true");
    expect(content).toContain("bc_review");
    expect(content).toContain("bc_list_systems");
    expect(content).toContain("Do not retry a cancelled or denied facade call");
    expect(content).not.toContain("Call `bc_create_system`");
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

  it("documents the user entrypoint map in the Agent guide and Brain Creator skill", async () => {
    const readme = await readFile("README.md", "utf8");
    const skill = await readFile("skills/brain-creator/SKILL.md", "utf8");
    const agentUsage = await readFile("docs/agent-usage.md", "utf8");

    expect(readme).toContain("docs/agent-usage.md");
    expect(agentUsage).toContain("## User Entrypoints");
    expect(skill).toContain("## User Entrypoint Map");

    for (const marker of [
      "bc_status",
      "bc_intent_preview",
      "bc_configure target=system",
      "bc_configure target=auth",
      "bc_configure target=checkpoint",
      "bc_run mode=case-source-suite confirm=false",
      "bc_run mode=case-source-suite confirm=true",
      "bc_run mode=bug-regression",
      "statusMarkdown",
      "reviewMarkdown",
      "bc_review target=\"bug\"",
      "bc_review target=\"gap\"",
      "bc_report_gap",
      "/bc help"
    ]) {
      expect(agentUsage).toContain(marker);
      expect(skill).toContain(marker);
    }
    expect(agentUsage).toContain("/bc help");
    expect(agentUsage).toContain("Brain Creator shortcuts");
    expect(await readFile("docs/release-checklist.md", "utf8")).toContain(
      "verify:codex-native-entry"
    );
    expect(await readFile("docs/mcp-installation.md", "utf8")).toContain(
      "verify:codex-native-entry"
    );
  });

  it("registers the Brain Creator entrypoint as a Claude Code project skill", async () => {
    const canonical = await readFile("skills/brain-creator/SKILL.md", "utf8");
    const claudeSkill = await readFile(".claude/skills/brain-creator/SKILL.md", "utf8");
    const pluginSkill = await readFile("plugins/brain-creator/skills/brain-creator/SKILL.md", "utf8");

    expect(claudeSkill).toBe(canonical);
    expect(pluginSkill).toBe(canonical);
    expect(claudeSkill).toContain("One-Sentence");
    expect(claudeSkill).toContain("bc_status");
    expect(claudeSkill).toContain("bc_run");
    expect(claudeSkill).toContain("Codex plugin");
    expect(claudeSkill).toContain("needs_agent_execution");
    expect(claudeSkill).toContain("bc_submit_agent_output");
  });

  it("includes facade and session resume tools in the MCP tool registry", async () => {
    const toolsModule = await readFile("src/mcp/tools.ts", "utf8");

    expect(toolsModule).toContain("bc_status");
    expect(toolsModule).toContain("bc_run");
    expect(toolsModule).toContain("bc_review");
    expect(toolsModule).toContain("bc_configure");
    expect(toolsModule).toContain("bc_prepare_agent_task");
    expect(toolsModule).toContain("bc_submit_agent_output");
    expect(toolsModule).toContain("bc_session_resume");
    expect(toolsModule).toContain("Resume session");
  });

  it("requires agent bridge preflight before plan and chain execution", async () => {
    const handlersModule = await readFile("src/mcp/handlers.ts", "utf8");

    expect(handlersModule).toContain("preflightAgentBridge");
    // generatePlan 和 runApprovedChain 都应该在开头检查 bridge
    const planIndex = handlersModule.indexOf("async function generatePlan");
    const bridgeCheckInPlan = handlersModule.indexOf("preflightAgentBridge", planIndex);
    expect(bridgeCheckInPlan).toBeGreaterThan(planIndex);

    const chainIndex = handlersModule.indexOf("async function runApprovedChain");
    const bridgeCheckInChain = handlersModule.indexOf("preflightAgentBridge", chainIndex);
    expect(bridgeCheckInChain).toBeGreaterThan(chainIndex);
  });

  it("exports preflightAgentBridge from the orchestrator", async () => {
    const orchestratorModule = await readFile("src/agent/orchestrator.ts", "utf8");

    expect(orchestratorModule).toContain("export async function preflightAgentBridge");
    expect(orchestratorModule).toContain("BridgePreflight");
    expect(orchestratorModule).toContain("_preflight");
    expect(orchestratorModule).toContain("preflight-ping");
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
    expect(config).toContain("Google\\\\Chrome");
    expect(config).toContain("Microsoft\\\\Edge");
    expect(config).not.toContain("C:\\Users\\");
  });

  it("documents the 2.0.3 patch release notes", async () => {
    const notes = await readFile("docs/release-notes-2.0.3.md", "utf8");

    expect(notes).toContain("Brain Creator 2.0.3");
    expect(notes).toContain("brain-creator-install-codex-plugin");
    expect(notes).toContain("Codex plugin");
    expect(notes).toContain("npm install");
    expect(notes).toContain("npm publish");
  });
});
