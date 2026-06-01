import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type BrainCreatorToolName =
  | "bc_create_system"
  | "bc_list_systems"
  | "bc_system_overview"
  | "bc_create_auth"
  | "bc_verify_auth"
  | "bc_add_term"
  | "bc_list_terms"
  | "bc_batch_confirm_terms"
  | "bc_add_rule"
  | "bc_list_rules"
  | "bc_generate_plan"
  | "bc_approve_plan"
  | "bc_run_chain"
  | "bc_list_cases"
  | "bc_list_gaps"
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
    },
    handler: (input: Record<string, unknown>) => Promise<CallToolResult>
  ) => unknown;
};

export const BRAIN_CREATOR_TOOLS: ToolDefinition[] = [
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
    name: "bc_system_overview",
    title: "Business system overview",
    description: "Show asset counts and onboarding state for a business system.",
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
    name: "bc_verify_auth",
    title: "Verify auth profile",
    description: "Mark an auth profile verified for local MVP use.",
    inputSchema: z.object({ id: z.string() })
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
    name: "bc_approve_plan",
    title: "Approve test plan",
    description: "Approve a draft test case before code generation.",
    inputSchema: z.object({ caseId: z.string() })
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
  handler: (name: BrainCreatorToolName, input: Record<string, unknown>) => Promise<CallToolResult>
) {
  for (const tool of BRAIN_CREATOR_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      (input) => handler(tool.name, input)
    );
  }
}
