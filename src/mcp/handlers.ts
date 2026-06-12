import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BrainCreatorService } from "../domain/service.js";
import { JsonFileBrainCreatorRepository } from "../domain/repository.js";
import { generateSeedFile } from "../agent/seedGenerator.js";
import { createClaudeSubagentBridge } from "../agent/claudeBridge.js";
import { errorEnvelope, successEnvelope } from "../shared/envelope.js";
import {
  resolveBrainCreatorDataFile,
  resolveBrainCreatorWorkspace
} from "../shared/workspace.js";
import {
  commandRunnerAgentBridge,
  generatePlanDraft,
  preflightAgentBridge,
  runAgent,
  runChain,
  type AgentBridge,
  type CommandRunner
} from "../agent/orchestrator.js";
import type {
  AgentRun,
  AuthCheckpoint,
  AuthProfile,
  TestArtifact,
  TestCaseScenario,
  TestCaseStep
} from "../domain/types.js";
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
  const workDir = input.workDir ?? resolveBrainCreatorWorkspace();
  const repository = new JsonFileBrainCreatorRepository(
    input.dataFilePath ?? resolveBrainCreatorDataFile(workDir)
  );
  return {
    repository,
    service: new BrainCreatorService(repository),
    workDir,
    agentBridge:
      input.agentBridge ??
      (input.runner ? commandRunnerAgentBridge(input.runner) : configuredClaudeBridge()),
    runner: input.runner
  };
}

function configuredClaudeBridge(): AgentBridge | undefined {
  const command = process.env.BRAIN_CREATOR_AGENT_COMMAND;
  if (!command) {
    return undefined;
  }
  return createClaudeSubagentBridge({
    command,
    baseArgs: parseAgentArgs(process.env.BRAIN_CREATOR_AGENT_ARGS),
    timeoutMs: parseAgentTimeout(process.env.BRAIN_CREATOR_AGENT_TIMEOUT_MS)
  });
}

function parseAgentArgs(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : undefined;
  } catch {
    return value.split(" ").map((item) => item.trim()).filter(Boolean);
  }
}

function parseAgentTimeout(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
      case "bc_session_resume":
        return textResult(await sessionResume(context, input));
      case "bc_system_overview":
        return textResult(context.service.getSystemOverview(stringArg(input, "systemId")));
      case "bc_archive_system":
        return textResult(context.service.archiveSystemProfile(stringArg(input, "systemId")));
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
      case "bc_list_auth":
        return textResult(context.service.listAuthProfiles(stringArg(input, "systemId")));
      case "bc_verify_auth":
        return textResult(context.service.verifyAuthProfile(stringArg(input, "id")));
      case "bc_archive_auth":
        return textResult(context.service.archiveAuthProfile(stringArg(input, "id")));
      case "bc_generate_seed":
        return textResult(await generateSeed(context, input));
      case "bc_create_auth_checkpoint":
        return textResult(
          context.service.createAuthCheckpoint({
            systemId: stringArg(input, "systemId"),
            authProfileId: stringArg(input, "authProfileId"),
            testCaseId: optionalStringArg(input, "testCaseId"),
            reason: stringArg(input, "reason"),
            resumeInstruction: stringArg(input, "resumeInstruction")
          })
        );
      case "bc_list_auth_checkpoints":
        return textResult(
          context.service.listAuthCheckpoints(
            stringArg(input, "systemId"),
            authCheckpointStatusArg(input, "status")
          )
        );
      case "bc_complete_auth_checkpoint":
        return textResult(context.service.completeAuthCheckpoint(stringArg(input, "checkpointId")));
      case "bc_cancel_auth_checkpoint":
        return textResult(context.service.cancelAuthCheckpoint(stringArg(input, "checkpointId")));
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
      case "bc_update_term":
        return textResult(
          context.service.updateGlossaryTerm({
            projectId: stringArg(input, "projectId"),
            termId: stringArg(input, "termId"),
            key: stringArg(input, "key"),
            zhCN: stringArg(input, "zhCN"),
            enUS: stringArg(input, "enUS"),
            aliases: stringArrayArg(input, "aliases"),
            pageScope: optionalStringArg(input, "pageScope") ?? "/"
          })
        );
      case "bc_delete_term":
        return textResult(
          context.service.deleteGlossaryTerm({
            projectId: stringArg(input, "projectId"),
            termId: stringArg(input, "termId")
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
      case "bc_delete_rule":
        return textResult(
          context.service.deleteBusinessRule({
            systemId: stringArg(input, "systemId"),
            ruleId: stringArg(input, "ruleId")
          })
        );
      case "bc_generate_plan":
        return textResult(await generatePlan(context, input));
      case "bc_update_plan":
        return textResult(
          context.service.updateTestCaseScenarios(
            stringArg(input, "caseId"),
            scenarioArrayArg(input, "scenarios")
          )
        );
      case "bc_approve_plan":
        return textResult(context.service.approveTestCase(stringArg(input, "caseId")));
      case "bc_cancel_plan":
        return textResult(
          context.service.cancelTestCase(stringArg(input, "caseId"), stringArg(input, "reason"))
        );
      case "bc_resume_plan":
        return textResult(context.service.resumeTestCase(stringArg(input, "caseId")));
      case "bc_run_agent":
        return textResult(await runSingleAgent(context, input));
      case "bc_list_agent_runs":
        return textResult(context.service.listAgentRuns(stringArg(input, "systemId")));
      case "bc_run_chain":
        return textResult(await runApprovedChain(context, input));
      case "bc_list_chain_runs":
        return textResult(context.service.listChainRuns(stringArg(input, "systemId")));
      case "bc_list_specs":
        return textResult(context.service.listTestSpecs(stringArg(input, "systemId")));
      case "bc_list_tests":
        return textResult(context.service.listTestFiles(stringArg(input, "systemId")));
      case "bc_read_spec":
        return textResult(await readArtifact(context, input, "test-spec"));
      case "bc_read_test":
        return textResult(await readArtifact(context, input, "test-file"));
      case "bc_artifact_overview":
        return textResult(await artifactOverview(context, input));
      case "bc_list_cases":
        return textResult(context.service.listTestCases(stringArg(input, "systemId")));
      case "bc_list_gaps":
        return textResult(
          context.service.listGaps({
            projectId: stringArg(input, "projectId"),
            status: gapStatusArg(input, "status")
          })
        );
      case "bc_report_gap":
        return textResult(
          context.service.reportGap({
            projectId: stringArg(input, "projectId"),
            sourceType: stringArg(input, "sourceType"),
            sourceId: stringArg(input, "sourceId"),
            reason: stringArg(input, "reason"),
            severity: gapSeverityArg(input, "severity"),
            owner: stringArg(input, "owner")
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
  const bridgeCheck = await preflightAgentBridge(context.agentBridge);
  if (!bridgeCheck.ok) {
    throw new Error(`Agent bridge unavailable: ${bridgeCheck.error}`);
  }
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
  const bridgeCheck = await preflightAgentBridge(context.agentBridge);
  if (!bridgeCheck.ok) {
    throw new Error(`Agent bridge unavailable: ${bridgeCheck.error}`);
  }
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

/**
 * bc_session_resume — 一次调用返回系统完整快照，替代新会话时的 6-7 次独立查询。
 * 只读，不做任何写入操作。
 */
async function sessionResume(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }

  const authProfiles = context.service.listAuthProfiles(systemId);
  const authCheckpoints = context.service.listAuthCheckpoints(systemId);
  const rules = context.service.listBusinessRules(systemId);
  const terms = context.service.listGlossaryTerms({ projectId: systemId, query: "" });
  const cases = context.service.listTestCases(systemId);
  const agentRuns = context.service.listAgentRuns(systemId);
  const chainRuns = context.service.listChainRuns(systemId);
  const openGaps = context.service.listGaps({ projectId: systemId, status: "open" });
  const specs = context.service.listTestSpecs(systemId);
  const tests = context.service.listTestFiles(systemId);
  const bridgeStatus = await preflightAgentBridge(context.agentBridge);

  const caseCounts = { draft: 0, approved: 0, generating: 0, passed: 0, failed: 0, cancelled: 0 };
  for (const item of cases) {
    caseCounts[item.status] += 1;
  }

  const nextAction = computeNextAction({
    hasAuth: authProfiles.length > 0,
    hasRules: rules.length > 0,
    hasApprovedCases: caseCounts.approved > 0,
    hasFailedCases: caseCounts.failed > 0,
    hasOpenGaps: openGaps.length > 0,
    bridgeOk: bridgeStatus.ok
  });

  return {
    system,
    auth: { profiles: authProfiles, checkpoints: authCheckpoints },
    rules,
    terms,
    cases: { total: cases.length, byStatus: caseCounts },
    recentRuns: {
      agentRuns: agentRuns.slice(-5),
      chainRuns: chainRuns.slice(-5)
    },
    artifacts: { specs: specs.length, tests: tests.length },
    openGaps,
    bridge: bridgeStatus,
    nextAction
  };
}

function computeNextAction(state: {
  hasAuth: boolean;
  hasRules: boolean;
  hasApprovedCases: boolean;
  hasFailedCases: boolean;
  hasOpenGaps: boolean;
  bridgeOk: boolean;
}): string {
  if (!state.hasAuth) {
    return "complete_onboarding: 配置鉴权 (bc_create_auth)";
  }
  if (!state.bridgeOk) {
    return "configure_bridge: 设置 BRAIN_CREATOR_AGENT_COMMAND 环境变量以启用 Planner/Generator/Healer";
  }
  if (state.hasOpenGaps) {
    return "resolve_gaps: 存在待处理的 Gap，建议优先处理 (bc_list_gaps → bc_resolve_gap)";
  }
  if (state.hasFailedCases) {
    return "review_failures: 存在失败用例，建议复盘或 healer 修复 (bc_review / bc_run_agent healer)";
  }
  if (state.hasApprovedCases) {
    return "run_chain: 已批准用例等待执行 (bc_run_chain)";
  }
  return "generate_plan: 系统就绪，可以生成新测试计划 (bc_generate_plan)";
}

async function generateSeed(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  const authProfile = optionalStringArg(input, "authProfileId")
    ? findAuthProfileById(context, systemId, optionalStringArg(input, "authProfileId")!)
    : findAuthProfile(context, systemId);
  return generateSeedFile({
    outputDir: optionalStringArg(input, "outputDir") ?? join(context.workDir, "tests"),
    system,
    authProfile
  });
}

async function runSingleAgent(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  const agentRun = await runAgent({
    systemId,
    agent: agentArg(input, "agent"),
    inputSummary: stringArg(input, "inputSummary"),
    args: stringArrayArg(input, "args"),
    outputPaths: stringArrayArg(input, "outputPaths"),
    cwd: context.workDir,
    timeoutMs: optionalNumberArg(input, "timeoutMs"),
    agentBridge: context.agentBridge
  });
  context.service.recordAgentRun(agentRun);
  return agentRun;
}

async function readArtifact(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>,
  type: TestArtifact["type"]
) {
  const systemId = stringArg(input, "systemId");
  const requestedPath = stringArg(input, "path");
  const resolvedPath = resolveWorkspacePath(context.workDir, requestedPath);
  const artifacts =
    type === "test-spec"
      ? context.service.listTestSpecs(systemId)
      : context.service.listTestFiles(systemId);
  const artifact = artifacts.find((item) => {
    try {
      return resolveWorkspacePath(context.workDir, item.path) === resolvedPath;
    } catch {
      return false;
    }
  });
  if (!artifact) {
    throw new Error("Artifact not found");
  }
  const content = await readFile(resolvedPath, "utf8");
  return {
    ...artifact,
    content,
    bytes: Buffer.byteLength(content, "utf8")
  };
}

async function artifactOverview(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const specs = context.service.listTestSpecs(systemId);
  const tests = context.service.listTestFiles(systemId);
  const latestSpec = specs.at(-1);
  const latestTest = tests.at(-1);
  return {
    systemId,
    counts: {
      specs: specs.length,
      tests: tests.length
    },
    latestSpec: latestSpec ? await artifactSummary(context, latestSpec) : undefined,
    latestTest: latestTest ? await artifactSummary(context, latestTest) : undefined
  };
}

async function artifactSummary(context: BrainCreatorMcpContext, artifact: TestArtifact) {
  const resolvedPath = resolveWorkspacePath(context.workDir, artifact.path);
  const content = await readFile(resolvedPath, "utf8");
  return {
    ...artifact,
    snippet: content.slice(0, 500),
    bytes: Buffer.byteLength(content, "utf8")
  };
}

function findAuthProfile(context: BrainCreatorMcpContext, systemId: string): AuthProfile {
  const profile = context.repository.authProfiles.find(
    (item) => item.projectId === systemId && item.status !== "cancelled"
  );
  if (!profile) {
    throw new Error("Auth profile not found");
  }
  return profile;
}

function findAuthProfileById(
  context: BrainCreatorMcpContext,
  systemId: string,
  authProfileId: string
): AuthProfile {
  const profile = context.repository.authProfiles.find((item) => item.id === authProfileId);
  if (!profile) {
    throw new Error("Auth profile not found");
  }
  if (profile.projectId !== systemId) {
    throw new Error("Auth profile belongs to another business system");
  }
  if (profile.status === "cancelled") {
    throw new Error("Auth profile is archived");
  }
  return profile;
}

function resolveWorkspacePath(workDir: string, candidatePath: string) {
  const root = resolve(workDir);
  const candidate = isAbsolute(candidatePath)
    ? resolve(candidatePath)
    : resolve(root, candidatePath);
  const offset = relative(root, candidate);
  if (offset.startsWith("..") || isAbsolute(offset)) {
    throw new Error("Artifact path must stay inside workspace");
  }
  return candidate;
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

function gapSeverityArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (!["low", "medium", "high"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as "low" | "medium" | "high";
}

function authCheckpointStatusArg(
  input: Record<string, unknown>,
  key: string
): AuthCheckpoint["status"] | undefined {
  const value = optionalStringArg(input, key);
  if (value === undefined) {
    return undefined;
  }
  if (!["awaiting-user", "completed", "cancelled"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as AuthCheckpoint["status"];
}

function agentArg(input: Record<string, unknown>, key: string): AgentRun["agent"] {
  const value = stringArg(input, key);
  if (!["planner", "generator", "healer"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as AgentRun["agent"];
}

function scenarioArrayArg(input: Record<string, unknown>, key: string): TestCaseScenario[] {
  const value = input[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array`);
  }
  return value.map((scenario, index) => {
    if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
      throw new Error(`${key}[${index}] must be an object`);
    }
    const record = scenario as Record<string, unknown>;
    return {
      id: stringArg(record, "id"),
      title: stringArg(record, "title"),
      priority: priorityArg(record, "priority"),
      steps: stepArrayArg(record, "steps"),
      businessRuleRef: optionalStringArg(record, "businessRuleRef")
    };
  });
}

function stepArrayArg(input: Record<string, unknown>, key: string): TestCaseStep[] {
  const value = input[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array`);
  }
  return value.map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`${key}[${index}] must be an object`);
    }
    const record = step as Record<string, unknown>;
    return {
      action: actionArg(record, "action"),
      target: stringArg(record, "target"),
      value: optionalStringArg(record, "value"),
      expected: optionalStringArg(record, "expected")
    };
  });
}

function priorityArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (!["critical", "high", "medium", "low"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as TestCaseScenario["priority"];
}

function actionArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (!["navigate", "fill", "click", "assert", "wait", "select"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as TestCaseStep["action"];
}
