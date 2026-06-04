import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Agent-native usage documentation", () => {
  it("documents Brain Creator as a Claude Code and Codex agent workflow in the README", async () => {
    const content = await readFile("README.md", "utf8");

    expect(content).toContain("Brain Creator");
    expect(content).toContain("## 中文版");
    expect(content).toContain("## English Version");
    expect(content).toContain("Claude Code / Codex");
    expect(content).toContain("Skill(\"brain-creator\")");
    expect(content).toContain("MCP");
    expect(content).toContain("No Web UI");
    expect(content).toContain("无 Web UI");
    expect(content).toContain("智能体入口");
    expect(content).toContain("docs/agent-usage.md");
    expect(content).toContain("npm run verify:live-claude-skill-workflow");
  });

  it("documents the end-user agent flow without requiring users to know tool internals", async () => {
    const content = await readFile("docs/agent-usage.md", "utf8");

    expect(content).toContain("# Brain Creator Agent Usage Guide");
    expect(content).toContain("one sentence");
    expect(content).toContain("connect a business system");
    expect(content).toContain("configure auth");
    expect(content).toContain("add business rules");
    expect(content).toContain("generate a draft plan");
    expect(content).toContain("approve the plan");
    expect(content).toContain("run the chain");
    expect(content).toContain("review artifacts and gaps");
    expect(content).toContain("Skill(\"brain-creator\")");
    expect(content).toContain("bc_run_chain");
  });
});
