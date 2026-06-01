import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("v2 quickstart documentation", () => {
  it("documents the full Brain Creator MCP workflow and verification commands", async () => {
    const content = await readFile("docs/v2-quickstart.md", "utf8");

    expect(content).toContain("# Brain Creator v2 Quickstart");
    expect(content).toContain("npm run mcp");
    expect(content).toContain("bc_create_system");
    expect(content).toContain("bc_create_auth");
    expect(content).toContain("bc_add_term");
    expect(content).toContain("bc_batch_confirm_terms");
    expect(content).toContain("bc_list_terms");
    expect(content).toContain("bc_add_rule");
    expect(content).toContain("bc_generate_plan");
    expect(content).toContain("bc_update_plan");
    expect(content).toContain("bc_approve_plan");
    expect(content).toContain("bc_run_chain");
    expect(content).toContain("bc_list_cases");
    expect(content).toContain("bc_list_gaps");
    expect(content).toContain("bc_resolve_gap");
    expect(content).toContain("bc_search_assets");
    expect(content).toContain("npm test");
    expect(content).toContain("npx tsc --noEmit");
    expect(content).toContain("Known Limits");
    expect(content).toContain("AgentBridge");
    expect(content).toContain("current Playwright CLI does not expose `playwright agent`");
    expect(content).toContain("Claude subagent bridge required");
  });
});
