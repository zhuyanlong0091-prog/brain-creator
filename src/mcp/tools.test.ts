import { describe, expect, it } from "vitest";
import { BRAIN_CREATOR_TOOLS, registerBrainCreatorTools } from "./tools.js";

describe("BRAIN_CREATOR_TOOLS", () => {
  it("defines the core Brain Creator v2 MCP tools", () => {
    expect(BRAIN_CREATOR_TOOLS.map((tool) => tool.name)).toEqual([
      "bc_agent_run",
      "bc_agent_status",
      "bc_list_ledger",
      "bc_retrieve_context",
      "bc_create_system",
      "bc_list_systems",
      "bc_system_overview",
      "bc_archive_system",
      "bc_create_auth",
      "bc_list_auth",
      "bc_verify_auth",
      "bc_archive_auth",
      "bc_generate_seed",
      "bc_create_auth_checkpoint",
      "bc_list_auth_checkpoints",
      "bc_complete_auth_checkpoint",
      "bc_cancel_auth_checkpoint",
      "bc_add_term",
      "bc_list_terms",
      "bc_update_term",
      "bc_delete_term",
      "bc_batch_confirm_terms",
      "bc_add_rule",
      "bc_list_rules",
      "bc_delete_rule",
      "bc_generate_plan",
      "bc_update_plan",
      "bc_approve_plan",
      "bc_cancel_plan",
      "bc_resume_plan",
      "bc_run_agent",
      "bc_list_agent_runs",
      "bc_run_chain",
      "bc_list_chain_runs",
      "bc_list_specs",
      "bc_list_tests",
      "bc_read_spec",
      "bc_read_test",
      "bc_artifact_overview",
      "bc_list_cases",
      "bc_list_gaps",
      "bc_report_gap",
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
