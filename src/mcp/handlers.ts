import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BrainCreatorService } from "../domain/service.js";
import { JsonFileBrainCreatorRepository } from "../domain/repository.js";
import { errorEnvelope, successEnvelope } from "../shared/envelope.js";
import {
  commandRunnerAgentBridge,
  generatePlanDraft,
  runChain,
  type AgentBridge,
  type CommandRunner
} from "../agent/orchestrator.js";
import type { AuthProfile } from "../domain/types.js";
import type { BrainCreatorToolName } from "./tools.js";

export type BrainCreatorMcpContext = {
  repository: JsonFileBrainCreatorRepository;
  service: BrainCreatorService;
  workDir: string;
  agentBridge?: AgentBridge;
  runner?: CommandRunner;
};

type CreateContextInput = {
  dataFilePath?: string;
  workDir?: string;
  agentBridge?: AgentBridge;
  runner?: CommandRunner;
};

export function createBrainCreatorMcpContext(
  input: CreateContextInput = {}
): BrainCreatorMcpContext {
  const workDir = input.workDir ?? process.cwd();
  const repository = new JsonFileBrainCreatorRepository(
    input.dataFilePath ?? join(workDir, ".brain-creator", "local-assets.json")
  );
  return {
    repository,
    service: new BrainCreatorService(repository),
    workDir,
    agentBridge:
      input.agentBridge ?? (input.runner ? commandRunnerAgentBridge(input.runner) : undefined),
    runner: input.runner
  };
}

export async function handleBrainCreatorTool(
  context: BrainCreatorMcpContext,
  name: BrainCreatorToolName,
  input: Record<string, unknown>
): Promise<CallToolResult> {
  try {
    switch (name) {
      case "bc_create_system":
        return textResult(
          context.service.createSystemProfile({
            name: stringArg(input, "name"),
            environment: stringArg(input, "environment"),
            baseUrl: stringArg(input, "baseUrl"),
            defaultLocale: optionalStringArg(input, "defaultLocale") ?? "zh-CN",
            urlAllowlist: stringArrayArg(input, "urlAllowlist")
          })
        );
      case "bc_list_systems":
        return textResult(context.service.listSystemProfiles());
      case "bc_system_overview":
        return textResult(context.service.getSystemOverview(stringArg(input, "systemId")));
      case "bc_create_auth":
        return textResult(
          context.service.createAuthProfile({
            projectId: stringArg(input, "projectId"),
            env: stringArg(input, "env"),
            role: stringArg(input, "role"),
            loginMethod: loginMethodArg(input, "loginMethod"),
            secrets: recordArg(input, "secrets")
          })
        );
      case "bc_verify_auth":
        return textResult(context.service.verifyAuthProfile(stringArg(input, "id")));
      case "bc_add_term":
        return textResult(
          context.service.createGlossaryTerm({
            projectId: stringArg(input, "projectId"),
            key: stringArg(input, "key"),
            zhCN: stringArg(input, "zhCN"),
            enUS: stringArg(input, "enUS"),
            aliases: stringArrayArg(input, "aliases"),
            pageScope: optionalStringArg(input, "pageScope") ?? "/"
          })
        );
      case "bc_list_terms":
        return textResult(
          context.service.listGlossaryTerms({
            projectId: stringArg(input, "projectId"),
            query: optionalStringArg(input, "query") ?? ""
          })
        );
      case "bc_batch_confirm_terms":
        return textResult(
          context.service.confirmCandidateTerms({
            caseId: stringArg(input, "caseId"),
            confirmTermIds: stringArrayArg(input, "confirmTermIds"),
            ignoreTermIds: stringArrayArg(input, "ignoreTermIds")
          })
        );
      case "bc_add_rule":
        return textResult(
          context.service.createBusinessRule({
            systemId: stringArg(input, "systemId"),
            name: stringArg(input, "name"),
            condition: stringArg(input, "condition"),
            severity: severityArg(input, "severity")
          })
        );
      case "bc_list_rules":
        return textResult(context.service.listBusinessRules(stringArg(input, "systemId")));
      case "bc_generate_plan":
        return textResult(await generatePlan(context, input));
      case "bc_approve_plan":
        return textResult(context.service.approveTestCase(stringArg(input, "caseId")));
      case "bc_run_chain":
        return textResult(await runApprovedChain(context, input));
      case "bc_list_cases":
        return textResult(context.service.listTestCases(stringArg(input, "systemId")));
      case "bc_list_gaps":
        return textResult(
          context.service.listGaps({
            projectId: stringArg(input, "projectId"),
            status: gapStatusArg(input, "status")
          })
        );
      case "bc_resolve_gap":
        return textResult(
          context.service.resolveGap({
            projectId: stringArg(input, "projectId"),
            gapId: stringArg(input, "gapId")
          })
        );
      case "bc_search_assets":
        return textResult(
          context.service.searchAssets({
            projectId: stringArg(input, "projectId"),
            query: stringArg(input, "query")
          })
        );
      default:
        throw new Error(`Unknown Brain Creator tool: ${name}`);
    }
  } catch (error) {
    return envelopeResult(errorEnvelope(error), true);
  }
}

async function generatePlan(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const requirement = stringArg(input, "requirement");
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  const authProfile = findAuthProfile(context, systemId);
  const specPath =
    optionalStringArg(input, "specPath") ?? join(context.workDir, "specs", `${systemId}-plan.md`);
  const result = await generatePlanDraft({
    workDir: context.workDir,
    system,
    authProfile,
    requirement,
    glossaryTerms: context.service.listGlossaryTerms({ projectId: systemId, query: "" }),
    businessRules: context.service.listBusinessRules(systemId),
    specPath,
    agentBridge: context.agentBridge
  });
  context.service.recordAgentRun(result.agentRun);
  const testCase = context.service.createTestCase({
    systemId,
    requirement,
    scenarios: result.scenarios,
    newTerms: result.newTerms,
    ruleCheckResult: result.ruleCheckResult
  });
  return { ...result, testCase };
}

async function runApprovedChain(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const testCase = context.service.getTestCase(stringArg(input, "caseId"));
  const system = context.repository.systemProfiles.find((item) => item.id === testCase.systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  const authProfile = findAuthProfile(context, testCase.systemId);
  const result = await runChain({
    workDir: context.workDir,
    system,
    authProfile,
    testCase,
    agentBridge: context.agentBridge,
    runner: context.runner,
    maxHealAttempts: optionalNumberArg(input, "maxHealAttempts")
  });
  context.service.recordAgentRun(result.generateRun);
  for (const healerRun of result.healerRuns) {
    context.service.recordAgentRun(healerRun);
  }
  context.service.recordChainRun(result.chainRun);
  return result;
}

function findAuthProfile(context: BrainCreatorMcpContext, systemId: string): AuthProfile {
  const profile = context.repository.authProfiles.find((item) => item.projectId === systemId);
  if (!profile) {
    throw new Error("Auth profile not found");
  }
  return profile;
}

function textResult(data: unknown): CallToolResult {
  return envelopeResult(successEnvelope(data), false);
}

function envelopeResult(envelope: unknown, isError: boolean): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    isError
  };
}

function stringArg(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalStringArg(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function optionalNumberArg(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" ? value : undefined;
}

function stringArrayArg(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recordArg(input: Record<string, unknown>, key: string): Record<string, string> {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function loginMethodArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (!["password", "cookie", "token", "script"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as "password" | "cookie" | "token" | "script";
}

function severityArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (value !== "block" && value !== "warn") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

function gapStatusArg(input: Record<string, unknown>, key: string) {
  const value = optionalStringArg(input, key);
  if (value === undefined) {
    return undefined;
  }
  if (value !== "open" && value !== "resolved") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}
