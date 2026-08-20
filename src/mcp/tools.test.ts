import { describe, expect, it } from "vitest";
import {
  BRAIN_CREATOR_TOOLS,
  FACADE_TOOL_NAMES,
  parseBrainCreatorToolProfile,
  registerBrainCreatorTools
} from "./tools.js";

describe("BRAIN_CREATOR_TOOLS", () => {
  it("defines the core Brain Creator v2 MCP tools", () => {
    expect(BRAIN_CREATOR_TOOLS.map((tool) => tool.name)).toEqual([
      "bc_prepare",
      "bc_command",
      "bc_intent_preview",
      "bc_status",
      "bc_run",
      "bc_review",
      "bc_configure",
      "bc_create_system",
      "bc_list_systems",
      "bc_session_resume",
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
      "bc_prepare_agent_task",
      "bc_submit_agent_output",
      "bc_list_agent_runs",
      "bc_run_chain",
      "bc_full_workflow",
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

  it("registers only high-level tools for the facade profile", () => {
    const registered: string[] = [];
    const fakeServer = {
      registerTool(name: string) {
        registered.push(name);
      }
    };

    registerBrainCreatorTools(
      fakeServer,
      async () => ({ content: [{ type: "text", text: "{}" }] }),
      "facade"
    );

    expect(registered).toEqual(
      BRAIN_CREATOR_TOOLS.filter((tool) => FACADE_TOOL_NAMES.has(tool.name)).map((tool) => tool.name)
    );
    expect(parseBrainCreatorToolProfile()).toBe("full");
    expect(parseBrainCreatorToolProfile("facade")).toBe("facade");
    expect(() => parseBrainCreatorToolProfile("small")).toThrow("Unsupported Brain Creator tool profile");
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

  it("forwards MCP request progress metadata to the tool handler", async () => {
    let registeredHandler:
      | ((input: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    const fakeServer = {
      registerTool(
        name: string,
        _config: Record<string, unknown>,
        handler: (input: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>
      ) {
        if (name === "bc_run") registeredHandler = handler;
      }
    } as any;
    const calls: unknown[] = [];
    registerBrainCreatorTools(fakeServer, async (_name, _input, request) => {
      calls.push(request);
      return { content: [{ type: "text", text: "{}" }] };
    }, "facade");

    const sendNotification = async () => undefined;
    await registeredHandler?.(
      { mode: "requirement-suite" },
      { _meta: { progressToken: "progress-1" }, sendNotification }
    );

    expect(calls).toEqual([{
      progressToken: "progress-1",
      sendNotification
    }]);
  });

  it("exposes the controlled facade operations without adding more tools", () => {
    const prepare = BRAIN_CREATOR_TOOLS.find((tool) => tool.name === "bc_prepare");
    const configure = BRAIN_CREATOR_TOOLS.find((tool) => tool.name === "bc_configure");
    const review = BRAIN_CREATOR_TOOLS.find((tool) => tool.name === "bc_review");

    expect(
      prepare?.inputSchema.safeParse({
        action: "compile-cases",
        requirementSetId: "requirement-1",
        testIntentIds: [],
        modules: ["Orders"],
        responseMode: "summary"
      }).success
    ).toBe(true);
    expect(
      prepare?.inputSchema.safeParse({
        action: "submit-attachment-analysis",
        requirementSourceId: "source-1",
        attachmentId: "attachment-1",
        attachmentAnalysis: {
          kind: "flowchart",
          markdown: "Start -> End",
          nodes: [],
          edges: [],
          confidence: 0.8
        }
      }).success
    ).toBe(true);
    expect(
      prepare?.inputSchema.safeParse({
        action: "resolve-gap",
        gapId: "gap-1",
        systemId: "system-1",
        confirmationNote: "Resolved with browser evidence.",
        evidenceRefs: ["evidence:1"],
        confirm: true
      }).success
    ).toBe(true);
    expect(
      prepare?.inputSchema.safeParse({
        action: "explore-system",
        knowledgeProjectId: "project-1",
        systemId: "system-1",
        interactionMode: "safe",
        explorationScenario: {
          name: "Intern replacement field discovery",
          role: "recruiter",
          prerequisiteState: "empty recruiting form",
          dataRefs: ["fixture:intern-recruiting"],
          testDataLeaseIds: [],
          selectorValues: { '[id="employee-type"]': "intern" }
        }
      }).success
    ).toBe(true);
    expect(
      configure?.inputSchema.safeParse({
        target: "auth",
        operation: "verify",
        systemId: "system-1",
        authProfileId: "auth-1"
      }).success
    ).toBe(true);
    expect(
      configure?.inputSchema.safeParse({
        target: "runtime",
        operation: "reload-store"
      }).success
    ).toBe(true);
    expect(
      review?.inputSchema.safeParse({
        target: "compile-run",
        id: "compile-run-1",
        limit: 25
      }).success
    ).toBe(true);
    expect(
      BRAIN_CREATOR_TOOLS.find((tool) => tool.name === "bc_run")?.inputSchema.parse({
        mode: "requirement-suite"
      }).observationMode
    ).toBe("summary");
    expect(
      BRAIN_CREATOR_TOOLS.find((tool) => tool.name === "bc_run")?.inputSchema.safeParse({
        mode: "requirement-suite",
        browserMode: "observe"
      }).success
    ).toBe(true);
    expect(
      BRAIN_CREATOR_TOOLS.find((tool) => tool.name === "bc_run")?.inputSchema.safeParse({
        mode: "requirement-suite",
        browserMode: "debug"
      }).success
    ).toBe(false);
    expect(prepare?.inputSchema.parse({ action: "approve-baseline" }).responseMode).toBe("summary");
    expect(review?.inputSchema.parse({ target: "test-intent" }).responseMode).toBe("summary");
  });

  it("registers facade inspection tools as read-only", () => {
    const registered = new Map<string, Record<string, unknown>>();
    const fakeServer = {
      registerTool(name: string, config: Record<string, unknown>) {
        registered.set(name, config);
      }
    };

    registerBrainCreatorTools(fakeServer, async () => ({
      content: [{ type: "text", text: "{}" }]
    }));

    for (const name of ["bc_intent_preview", "bc_status", "bc_review"]) {
      expect(registered.get(name)?.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true
      });
    }
    expect(registered.get("bc_run")?.annotations).toBeUndefined();
    expect(registered.get("bc_configure")?.annotations).toBeUndefined();
    expect(
      [...registered.entries()]
        .filter(([, config]) => {
          const annotations = config.annotations as { readOnlyHint?: boolean } | undefined;
          return annotations?.readOnlyHint;
        })
        .map(([name]) => name)
    ).toEqual([
      "bc_intent_preview",
      "bc_status",
      "bc_review",
      "bc_list_systems",
      "bc_session_resume",
      "bc_system_overview",
      "bc_list_auth",
      "bc_list_auth_checkpoints",
      "bc_list_terms",
      "bc_list_rules",
      "bc_list_agent_runs",
      "bc_list_chain_runs",
      "bc_list_specs",
      "bc_list_tests",
      "bc_read_spec",
      "bc_read_test",
      "bc_artifact_overview",
      "bc_list_cases",
      "bc_list_gaps",
      "bc_search_assets"
    ]);
  });
});
