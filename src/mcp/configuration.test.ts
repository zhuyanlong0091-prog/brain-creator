import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const skillNames = ["bc-system", "bc-auth", "bc-rules", "bc-plan", "bc-run", "bc-assets"];

describe("Brain Creator local integration files", () => {
  it("defines Claude Code MCP server settings for Brain Creator", async () => {
    const settings = JSON.parse(await readFile(".claude/settings.json", "utf8"));
    const mcpConfig = JSON.parse(await readFile(".mcp.json", "utf8"));

    expect(settings.mcpServers["brain-creator"]).toEqual({
      command: "npm",
      args: ["run", "mcp"],
      cwd: "."
    });
    expect(mcpConfig.mcpServers["brain-creator"]).toEqual({
      command: "npm",
      args: ["run", "mcp"]
    });
    expect(mcpConfig.mcpServers["playwright-test"]).toBeDefined();
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
