import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("v2 quickstart documentation", () => {
  it("documents the full Brain Creator MCP workflow and verification commands", async () => {
    const content = await readFile("docs/v2-quickstart.md", "utf8");

    expect(content).toContain("# Brain Creator v2 Quickstart");
    expect(content).toContain("npm run mcp");
    expect(content).toContain("bc_create_system");
    expect(content).toContain("bc_create_auth");
    expect(content).toContain("bc_list_auth");
    expect(content).toContain("bc_add_term");
    expect(content).toContain("bc_generate_seed");
    expect(content).toContain("bc_batch_confirm_terms");
    expect(content).toContain("bc_list_terms");
    expect(content).toContain("bc_update_term");
    expect(content).toContain("bc_delete_term");
    expect(content).toContain("bc_add_rule");
    expect(content).toContain("bc_delete_rule");
    expect(content).toContain("bc_generate_plan");
    expect(content).toContain("bc_update_plan");
    expect(content).toContain("bc_approve_plan");
    expect(content).toContain("bc_run_agent");
    expect(content).toContain("bc_list_agent_runs");
    expect(content).toContain("bc_run_chain");
    expect(content).toContain("bc_list_chain_runs");
    expect(content).toContain("bc_list_specs");
    expect(content).toContain("bc_list_tests");
    expect(content).toContain("bc_read_spec");
    expect(content).toContain("bc_read_test");
    expect(content).toContain("bc_artifact_overview");
    expect(content).toContain("bc_list_cases");
    expect(content).toContain("bc_list_gaps");
    expect(content).toContain("bc_resolve_gap");
    expect(content).toContain("bc_search_assets");
    expect(content).toContain("npm test");
    expect(content).toContain("npx tsc --noEmit");
    expect(content).toContain("Known Limits");
    expect(content).toContain("AgentBridge");
    expect(content).toContain(".claude/skills/brain-creator/SKILL.md");
    expect(content).toContain("current Playwright CLI does not expose `playwright agent`");
    expect(content).toContain("Claude subagent bridge required");
  });

  it("documents the live Claude planner/generator/healer chain smoke command", async () => {
    const content = await readFile("docs/v2-quickstart.md", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.scripts["verify:live-claude-chain"]).toContain(
      "scripts/liveClaudeChainSmoke.ts"
    );
    expect(content).toContain("npm run verify:live-claude-chain");
    expect(content).toContain("planner -> generator -> healer");
    expect(content).not.toContain(
      "full Claude Code subagent validation in a live Claude Code session is still a follow-up"
    );
  });

  it("documents the live Claude artifact smoke command", async () => {
    const content = await readFile("docs/v2-quickstart.md", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.scripts["verify:live-agent-artifacts"]).toContain(
      "scripts/liveAgentArtifactSmoke.ts"
    );
    expect(content).toContain("npm run verify:live-agent-artifacts");
    expect(content).toContain("writes a Planner spec artifact");
    expect(content).toContain("writes and runs a Generator Playwright test");
    expect(content).toContain("repairs a controlled failing test through Healer");
  });

  it("documents the live MCP workflow smoke command for one-sentence agent usage", async () => {
    const content = await readFile("docs/v2-quickstart.md", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.scripts["verify:live-mcp-workflow"]).toContain(
      "scripts/liveMcpWorkflowSmoke.ts"
    );
    expect(content).toContain("npm run verify:live-mcp-workflow");
    expect(content).toContain("one-sentence");
    expect(content).toContain("bc_generate_plan");
    expect(content).toContain("bc_approve_plan");
    expect(content).toContain("bc_run_chain");
    expect(content).toContain("--permission-mode");
    expect(content).toContain("acceptEdits");
  });

  it("documents the live Claude Code skill workflow command", async () => {
    const content = await readFile("docs/v2-quickstart.md", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(packageJson.scripts["verify:live-claude-skill-workflow"]).toContain(
      "scripts/liveClaudeSkillWorkflowSmoke.ts"
    );
    expect(content).toContain("npm run verify:live-claude-skill-workflow");
    expect(content).toContain("Claude Code session");
    expect(content).toContain("Skill(\"brain-creator\")");
    expect(content).toContain("bc_run_chain");
  });
});
