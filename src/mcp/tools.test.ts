import { describe, expect, it } from "vitest";
import { BRAIN_CREATOR_TOOLS, registerBrainCreatorTools } from "./tools.js";

describe("BRAIN_CREATOR_TOOLS", () => {
  it("defines the core Brain Creator v2 MCP tools", () => {
    expect(BRAIN_CREATOR_TOOLS.map((tool) => tool.name)).toEqual([
      "bc_create_system",
      "bc_list_systems",
      "bc_system_overview",
      "bc_create_auth",
      "bc_verify_auth",
      "bc_add_term",
      "bc_list_terms",
      "bc_update_term",
      "bc_delete_term",
      "bc_batch_confirm_terms",
      "bc_add_rule",
      "bc_list_rules",
      "bc_generate_plan",
      "bc_update_plan",
      "bc_approve_plan",
      "bc_run_chain",
      "bc_list_cases",
      "bc_list_gaps",
      "bc_resolve_gap",
      "bc_search_assets"
    ]);
  });

  it("registers every tool on a compatible MCP server", () => {
    const registered: string[] = [];
    const fakeServer = {
      registerTool(name: string) {
        registered.push(name);
      }
    };

    registerBrainCreatorTools(fakeServer, async () => ({
      content: [{ type: "text", text: "{}" }]
    }));

    expect(registered).toEqual(BRAIN_CREATOR_TOOLS.map((tool) => tool.name));
  });
});
