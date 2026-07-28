import { z } from "zod";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type BrainCreatorToolName =
  | "bc_command"
  | "bc_intent_preview"
  | "bc_status"
  | "bc_prepare"
  | "bc_run"
  | "bc_review"
  | "bc_configure"
  | "bc_create_system"
  | "bc_list_systems"
  | "bc_session_resume"
  | "bc_system_overview"
  | "bc_archive_system"
  | "bc_create_auth"
  | "bc_list_auth"
  | "bc_verify_auth"
  | "bc_archive_auth"
  | "bc_generate_seed"
  | "bc_create_auth_checkpoint"
  | "bc_list_auth_checkpoints"
  | "bc_complete_auth_checkpoint"
  | "bc_cancel_auth_checkpoint"
  | "bc_add_term"
  | "bc_list_terms"
  | "bc_update_term"
  | "bc_delete_term"
  | "bc_batch_confirm_terms"
  | "bc_add_rule"
  | "bc_list_rules"
  | "bc_delete_rule"
  | "bc_generate_plan"
  | "bc_update_plan"
  | "bc_approve_plan"
  | "bc_cancel_plan"
  | "bc_resume_plan"
  | "bc_run_agent"
  | "bc_prepare_agent_task"
  | "bc_submit_agent_output"
  | "bc_list_agent_runs"
  | "bc_run_chain"
  | "bc_full_workflow"
  | "bc_list_chain_runs"
  | "bc_list_specs"
  | "bc_list_tests"
  | "bc_read_spec"
  | "bc_read_test"
  | "bc_artifact_overview"
  | "bc_list_cases"
  | "bc_list_gaps"
  | "bc_report_gap"
  | "bc_resolve_gap"
  | "bc_search_assets";

type ToolDefinition = {
  name: BrainCreatorToolName;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
};

type RegisterableMcpServer = {
  registerTool: (
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: z.ZodObject<z.ZodRawShape>;
      annotations?: ToolAnnotations;
    },
    handler: (input: Record<string, unknown>) => Promise<CallToolResult>
  ) => unknown;
};

export type BrainCreatorToolProfile = "facade" | "full";

export const FACADE_TOOL_NAMES = new Set<BrainCreatorToolName>([
  "bc_command",
  "bc_intent_preview",
  "bc_prepare",
  "bc_status",
  "bc_run",
  "bc_review",
  "bc_configure",
  "bc_submit_agent_output"
]);

const READ_ONLY_TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true
};

const READ_ONLY_TOOL_NAMES = new Set<BrainCreatorToolName>([
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

export const BRAIN_CREATOR_TOOLS: ToolDefinition[] = [
  {
    name: "bc_prepare",
    title: "Brain Creator prepare requirement",
    description:
      "Requirement-first facade for ingesting or refreshing requirement sources, generating analysis and test design, approving a baseline, and compiling executable cases.",
    inputSchema: z.object({
      action: z.enum([
        "ingest-requirement",
        "refresh-requirement",
        "generate-analysis",
        "generate-test-design",
        "approve-baseline",
        "compile-cases",
        "record-observation"
      ]),
      knowledgeProjectId: z.string().optional(),
      requirementSetId: z.string().optional(),
      testIntentId: z.string().optional(),
      systemId: z.string().optional(),
      observationType: z.enum([
        "module", "actor", "object", "field", "rule", "workflow", "state", "permission",
        "integration", "data-constraint", "term", "requirement"
      ]).optional(),
      title: z.string().optional(),
      content: z.string().optional(),
      module: z.string().optional(),
      sourceRefs: z.array(z.string()).default([]),
      confidence: z.number().min(0).max(1).optional(),
      source: z.string().optional(),
      provider: z.enum(["builtin", "host-skill"]).default("builtin"),
      confirm: z.boolean().default(false),
      allowPrivateNetwork: z.boolean().default(false),
      contentPackage: z
        .object({
          title: z.string(),
          content: z.string(),
          blocks: z.array(z.object({ type: z.string(), text: z.string(), level: z.number().optional() })),
          attachments: z.array(z.object({ name: z.string(), url: z.string().optional(), type: z.string().optional() })),
          source: z.string(),
          sourceType: z.enum(["local-file", "http", "feishu", "obsidian", "host-connector"]),
          contentHash: z.string(),
          updatedAt: z.string().optional(),
          warnings: z.array(z.string())
        })
        .optional(),
      analysisPackage: z.record(z.string(), z.unknown()).optional()
    })
  },
  {
    name: "bc_command",
    title: "Brain Creator command",
    description:
      "Minimal slash-command facade. Parses /bc help, /bc status, /bc run <path> with optional --system/--env and --case/--module/--priority filters, /bc continue, /bc bugs, /bc gaps, and /bc regress bugs into existing facade tools.",
    inputSchema: z.object({
      systemId: z.string().optional(),
      knowledgeProjectId: z.string().optional(),
      systemName: z.string().optional(),
      environment: z.string().optional(),
      command: z.string()
    })
  },
  {
    name: "bc_intent_preview",
    title: "Brain Creator intent preview",
    description:
      "Preview how a natural-language Brain Creator request maps to a facade tool call. Does not execute the suggested tool.",
    inputSchema: z.object({
      request: z.string(),
      systemId: z.string().optional(),
      systemName: z.string().optional(),
      environment: z.string().optional(),
      source: z.string().optional(),
      bugIds: z.array(z.string()).default([]),
      caseNos: z.array(z.string()).default([]),
      modules: z.array(z.string()).default([]),
      priorities: z.array(z.string()).default([])
    })
  },
  {
    name: "bc_status",
    title: "Brain Creator status",
    description:
      "Facade status entry for agents. Resolves by systemId or systemName and returns system, auth, bridge, cases, suites, bugs, gaps, artifacts, user summary, quick commands, and next action.",
    inputSchema: z.object({
      systemId: z.string().optional(),
      knowledgeProjectId: z.string().optional(),
      systemName: z.string().optional(),
      environment: z.string().optional(),
      include: z.array(z.string()).default([])
    })
  },
  {
    name: "bc_run",
    title: "Brain Creator run",
    description:
      "Facade execution entry for approved cases, full workflow, document case suites, and bug regression.",
    inputSchema: z.object({
      mode: z.enum(["approved-case", "full-workflow", "case-source-suite", "bug-regression", "requirement-suite"]),
      systemId: z.string().optional(),
      systemName: z.string().optional(),
      environment: z.string().optional(),
      caseId: z.string().optional(),
      source: z.string().optional(),
      suiteId: z.string().optional(),
      resume: z.boolean().default(false),
      continueOnBlocked: z.boolean().default(false),
      caseNos: z.array(z.string()).default([]),
      modules: z.array(z.string()).default([]),
      priorities: z.array(z.string()).default([]),
      writeBack: z.boolean().default(false),
      confirmWriteBack: z.boolean().default(false),
      confirm: z.boolean().default(false),
      maxHealAttempts: z.number().int().min(0).max(10).optional(),
      bugIds: z.array(z.string()).default([]),
      knowledgeProjectId: z.string().optional(),
      executableCaseId: z.string().optional()
    })
  },
  {
    name: "bc_review",
    title: "Brain Creator review",
    description: "Facade review entry for suite runs, cases, bugs, gaps, and artifacts.",
    inputSchema: z.object({
      target: z.enum([
        "suite-run",
        "case",
        "bug",
        "gap",
        "artifact",
        "requirement",
        "knowledge",
        "coverage",
        "test-intent",
        "executable-case",
        "evidence"
      ]),
      knowledgeProjectId: z.string().optional(),
      systemId: z.string().optional(),
      systemName: z.string().optional(),
      environment: z.string().optional(),
      status: z.string().optional(),
      id: z.string().optional(),
      failureTypes: z
        .array(
          z.enum([
            "assertion_failure",
            "auth_failure",
            "locator_failure",
            "network_failure",
            "automation_failure",
            "execution_failure",
            "unknown_failure"
          ])
        )
        .default([])
    })
  },
  {
    name: "bc_configure",
    title: "Brain Creator configure",
    description: "Facade configuration entry for system, auth, term, rule, and auth checkpoint setup.",
    inputSchema: z.object({
      target: z.enum(["system", "auth", "term", "rule", "checkpoint", "knowledge-project", "system-binding", "connector"]),
      knowledgeProjectId: z.string().optional(),
      connector: z.enum(["feishu"]).optional(),
      systemId: z.string().optional(),
      name: z.string().optional(),
      environment: z.string().optional(),
      baseUrl: z.string().optional(),
      defaultLocale: z.string().default("zh-CN"),
      urlAllowlist: z.array(z.string()).default([]),
      env: z.string().optional(),
      role: z.string().optional(),
      loginMethod: z.enum(["password", "cookie", "token", "script"]).optional(),
      secrets: z.record(z.string(), z.string()).default({}),
      key: z.string().optional(),
      zhCN: z.string().optional(),
      enUS: z.string().optional(),
      aliases: z.array(z.string()).default([]),
      pageScope: z.string().default("/"),
      condition: z.string().optional(),
      severity: z.enum(["block", "warn"]).optional(),
      authProfileId: z.string().optional(),
      testCaseId: z.string().optional(),
      reason: z.string().optional(),
      resumeInstruction: z.string().optional()
    })
  },
  {
    name: "bc_create_system",
    title: "Create business system",
    description: "Create a reusable business system context.",
    inputSchema: z.object({
      name: z.string(),
      environment: z.string(),
      baseUrl: z.string(),
      defaultLocale: z.string().default("zh-CN"),
      urlAllowlist: z.array(z.string()).default([])
    })
  },
  {
    name: "bc_list_systems",
    title: "List business systems",
    description: "List all connected business systems.",
    inputSchema: z.object({})
  },
  {
    name: "bc_session_resume",
    title: "Resume session",
    description:
      "只读返回系统完整快照：系统配置、鉴权、规则、术语、用例状态、最近执行记录、Open Gap、Agent Bridge 状态和推荐下一步。替代新会话时的多次独立查询。",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_system_overview",
    title: "Business system overview",
    description: "Show asset counts and onboarding state for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_archive_system",
    title: "Archive business system",
    description: "Non-destructively archive a business system by marking it cancelled.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_create_auth",
    title: "Create auth profile",
    description: "Create an encrypted auth profile for a business system.",
    inputSchema: z.object({
      projectId: z.string(),
      env: z.string(),
      role: z.string(),
      loginMethod: z.enum(["password", "cookie", "token", "script"]),
      secrets: z.record(z.string(), z.string())
    })
  },
  {
    name: "bc_list_auth",
    title: "List auth profiles",
    description: "List redacted auth profiles for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_verify_auth",
    title: "Verify auth profile",
    description: "Mark an auth profile verified for local MVP use.",
    inputSchema: z.object({ id: z.string() })
  },
  {
    name: "bc_archive_auth",
    title: "Archive auth profile",
    description: "Non-destructively archive an auth profile by marking it cancelled.",
    inputSchema: z.object({ id: z.string() })
  },
  {
    name: "bc_generate_seed",
    title: "Generate seed file",
    description: "Generate a local Playwright seed fixture from a business system auth profile.",
    inputSchema: z.object({
      systemId: z.string(),
      authProfileId: z.string().optional(),
      outputDir: z.string().optional()
    })
  },
  {
    name: "bc_create_auth_checkpoint",
    title: "Create manual auth checkpoint",
    description: "Record that a user must complete protected authentication outside Brain Creator.",
    inputSchema: z.object({
      systemId: z.string(),
      authProfileId: z.string(),
      testCaseId: z.string().optional(),
      reason: z.string(),
      resumeInstruction: z.string()
    })
  },
  {
    name: "bc_list_auth_checkpoints",
    title: "List manual auth checkpoints",
    description: "List manual authentication checkpoints for a business system.",
    inputSchema: z.object({
      systemId: z.string(),
      status: z.enum(["awaiting-user", "completed", "cancelled"]).optional()
    })
  },
  {
    name: "bc_complete_auth_checkpoint",
    title: "Complete manual auth checkpoint",
    description: "Mark a manual authentication checkpoint completed without storing credentials.",
    inputSchema: z.object({ checkpointId: z.string() })
  },
  {
    name: "bc_cancel_auth_checkpoint",
    title: "Cancel manual auth checkpoint",
    description: "Mark a manual authentication checkpoint cancelled.",
    inputSchema: z.object({ checkpointId: z.string() })
  },
  {
    name: "bc_add_term",
    title: "Add glossary term",
    description: "Add a business glossary term for a system.",
    inputSchema: z.object({
      projectId: z.string(),
      key: z.string(),
      zhCN: z.string(),
      enUS: z.string(),
      aliases: z.array(z.string()).default([]),
      pageScope: z.string().default("/")
    })
  },
  {
    name: "bc_list_terms",
    title: "List glossary terms",
    description: "List glossary terms for a system.",
    inputSchema: z.object({
      projectId: z.string(),
      query: z.string().default("")
    })
  },
  {
    name: "bc_update_term",
    title: "Update glossary term",
    description: "Update a glossary term inside a business system.",
    inputSchema: z.object({
      projectId: z.string(),
      termId: z.string(),
      key: z.string(),
      zhCN: z.string(),
      enUS: z.string(),
      aliases: z.array(z.string()).default([]),
      pageScope: z.string().default("/")
    })
  },
  {
    name: "bc_delete_term",
    title: "Delete glossary term",
    description: "Delete a glossary term from a business system.",
    inputSchema: z.object({
      projectId: z.string(),
      termId: z.string()
    })
  },
  {
    name: "bc_batch_confirm_terms",
    title: "Confirm candidate terms",
    description: "Confirm or ignore Planner-discovered glossary term candidates from a draft test case.",
    inputSchema: z.object({
      caseId: z.string(),
      confirmTermIds: z.array(z.string()).default([]),
      ignoreTermIds: z.array(z.string()).default([])
    })
  },
  {
    name: "bc_add_rule",
    title: "Add business rule",
    description: "Add a quality gate business rule for a system.",
    inputSchema: z.object({
      systemId: z.string(),
      name: z.string(),
      condition: z.string(),
      severity: z.enum(["block", "warn"])
    })
  },
  {
    name: "bc_list_rules",
    title: "List business rules",
    description: "List business rules for a system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_delete_rule",
    title: "Delete business rule",
    description: "Delete a business rule from a business system.",
    inputSchema: z.object({
      systemId: z.string(),
      ruleId: z.string()
    })
  },
  {
    name: "bc_generate_plan",
    title: "Generate test plan",
    description: "Run planner flow and store a draft structured test case.",
    inputSchema: z.object({
      systemId: z.string(),
      requirement: z.string(),
      specPath: z.string().optional()
    })
  },
  {
    name: "bc_update_plan",
    title: "Update test plan",
    description: "Replace scenarios on a draft structured test case before approval.",
    inputSchema: z.object({
      caseId: z.string(),
      scenarios: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          priority: z.enum(["critical", "high", "medium", "low"]),
          businessRuleRef: z.string().optional(),
          steps: z.array(
            z.object({
              action: z.enum(["navigate", "fill", "click", "assert", "wait", "select"]),
              target: z.string(),
              value: z.string().optional(),
              expected: z.string().optional()
            })
          )
        })
      )
    })
  },
  {
    name: "bc_approve_plan",
    title: "Approve test plan",
    description: "Approve a draft test case before code generation.",
    inputSchema: z.object({ caseId: z.string() })
  },
  {
    name: "bc_cancel_plan",
    title: "Cancel test plan",
    description: "Record a user-interrupted draft or approved plan and create a gap.",
    inputSchema: z.object({
      caseId: z.string(),
      reason: z.string()
    })
  },
  {
    name: "bc_resume_plan",
    title: "Resume cancelled test plan",
    description: "Resume a cancelled plan after manual auth checkpoints are handled.",
    inputSchema: z.object({ caseId: z.string() })
  },
  {
    name: "bc_run_agent",
    title: "Run agent",
    description: "Run a single Planner, Generator, or Healer agent and record the AgentRun.",
    inputSchema: z.object({
      systemId: z.string(),
      agent: z.enum(["planner", "generator", "healer"]),
      inputSummary: z.string(),
      args: z.array(z.string()).default([]),
      outputPaths: z.array(z.string()).default([]),
      timeoutMs: z.number().int().positive().optional()
    })
  },
  {
    name: "bc_prepare_agent_task",
    title: "Prepare host-agent task",
    description:
      "Prepare a Planner, Generator, or Healer task for the current host agent to execute without starting a subprocess.",
    inputSchema: z.object({
      systemId: z.string(),
      agent: z.enum(["planner", "generator", "healer"]),
      inputSummary: z.string(),
      args: z.array(z.string()).default([]),
      outputPaths: z.array(z.string()).default([])
    })
  },
  {
    name: "bc_submit_agent_output",
    title: "Submit host-agent output",
    description: "Submit the result of a prepared host-agent task and record an AgentRun.",
    inputSchema: z.object({
      taskId: z.string(),
      status: z.enum(["succeeded", "failed"]),
      stdout: z.string().default(""),
      stderr: z.string().default(""),
      outputPaths: z.array(z.string()).optional()
    })
  },
  {
    name: "bc_list_agent_runs",
    title: "List agent runs",
    description: "List Planner, Generator, and Healer agent runs for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_run_chain",
    title: "Run test chain",
    description: "Run generator/test/healer chain for an approved test case.",
    inputSchema: z.object({
      caseId: z.string(),
      maxHealAttempts: z.number().int().min(0).max(10).optional()
    })
  },
  {
    name: "bc_full_workflow",
    title: "Full workflow: approve + run",
    description:
      "一键审批并执行：对草稿用例先调用 bc_approve_plan，审批通过后自动执行 bc_run_chain。用于用户已审核计划、确认可执行的场景，减少两次独立工具调用。",
    inputSchema: z.object({
      caseId: z.string(),
      maxHealAttempts: z.number().int().min(0).max(10).optional()
    })
  },
  {
    name: "bc_list_chain_runs",
    title: "List chain runs",
    description: "List generator/test/healer chain runs for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_list_specs",
    title: "List test specs",
    description: "List generated Markdown test specs for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_list_tests",
    title: "List test files",
    description: "List generated Playwright test files for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_read_spec",
    title: "Read test spec",
    description: "Read a generated Markdown test spec that belongs to a business system.",
    inputSchema: z.object({
      systemId: z.string(),
      path: z.string()
    })
  },
  {
    name: "bc_read_test",
    title: "Read test file",
    description: "Read a generated Playwright test file that belongs to a business system.",
    inputSchema: z.object({
      systemId: z.string(),
      path: z.string()
    })
  },
  {
    name: "bc_artifact_overview",
    title: "Artifact overview",
    description: "Summarize generated spec and test artifacts for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_list_cases",
    title: "List test cases",
    description: "List structured test cases for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_list_gaps",
    title: "List gaps",
    description: "List open or resolved gaps for a business system.",
    inputSchema: z.object({
      projectId: z.string(),
      status: z.enum(["open", "resolved"]).optional()
    })
  },
  {
    name: "bc_report_gap",
    title: "Report gap",
    description: "Record an external preflight, manual workflow, or evidence gap.",
    inputSchema: z.object({
      projectId: z.string(),
      sourceType: z.string(),
      sourceId: z.string(),
      reason: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      owner: z.string()
    })
  },
  {
    name: "bc_resolve_gap",
    title: "Resolve gap",
    description: "Mark a gap resolved inside a business system.",
    inputSchema: z.object({
      projectId: z.string(),
      gapId: z.string()
    })
  },
  {
    name: "bc_search_assets",
    title: "Search assets",
    description: "Search Brain Creator assets inside a business system.",
    inputSchema: z.object({
      projectId: z.string(),
      query: z.string()
    })
  }
];

export function registerBrainCreatorTools(
  server: RegisterableMcpServer,
  handler: (name: BrainCreatorToolName, input: Record<string, unknown>) => Promise<CallToolResult>,
  profile: BrainCreatorToolProfile = "full"
) {
  for (const tool of BRAIN_CREATOR_TOOLS.filter(
    (candidate) => profile === "full" || FACADE_TOOL_NAMES.has(candidate.name)
  )) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: READ_ONLY_TOOL_NAMES.has(tool.name)
          ? READ_ONLY_TOOL_ANNOTATIONS
          : undefined
      },
      (input) => handler(tool.name, input)
    );
  }
}

export function parseBrainCreatorToolProfile(value?: string): BrainCreatorToolProfile {
  const profile = value ?? "full";
  if (profile === "facade" || profile === "full") return profile;
  throw new Error(`Unsupported Brain Creator tool profile: ${profile}`);
}
