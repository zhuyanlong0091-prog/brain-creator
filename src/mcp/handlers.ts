import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BrainCreatorService } from "../domain/service.js";
import { formatScenariosAsMarkdown, parseSpecMarkdown } from "../agent/caseFormatter.js";
import { JsonFileBrainCreatorRepository } from "../domain/repository.js";
import { generateSeedFile } from "../agent/seedGenerator.js";
import { buildAgentPrompt } from "../agent/promptBuilder.js";
import { checkBusinessRules } from "../agent/qualityGate.js";
import { extractCandidateTerms } from "../agent/termExtractor.js";
import { createConfiguredAgentBridge } from "../agent/bridgeProvider.js";
import {
  verifyStoredBrowserAuth,
  type AuthStateVerifier
} from "../agent/authStateVerifier.js";
import { errorEnvelope, successEnvelope } from "../shared/envelope.js";
import {
  resolveBrainCreatorDataFile,
  resolveBrainCreatorKnowledgeDir,
  resolveBrainCreatorWorkspace
} from "../shared/workspace.js";
import { KnowledgeService } from "../knowledge/service.js";
import {
  resolveRequirementSource,
  type RequirementSourceReader
} from "../knowledge/sourceAdapters.js";
import { FeishuOpenApiAdapter } from "../knowledge/feishuAdapter.js";
import { normalizeHostSkillAnalysis } from "../knowledge/policies.js";
import { buildContextPack } from "../knowledge/retriever.js";
import {
  SystemExplorationCoordinator,
  type SystemExplorer
} from "../knowledge/systemExplorer.js";
import {
  TestDataProviderService,
  type TestDataSubmitResult
} from "../knowledge/testDataProvider.js";
import { ExecutionPreflightService } from "../knowledge/executionPreflight.js";
import { RequirementSuiteRunService } from "../knowledge/requirementSuiteRun.js";
import { RunLedgerService } from "../knowledge/runLedger.js";
import {
  classifyExecutionFailure as classifyFailure,
  isEnvironmentConfigurationFailure,
  isGeneratedTestImplementationFailure
} from "../knowledge/failureClassifier.js";
import {
  commandRunnerAgentBridge,
  generatePlanDraft,
  preflightAgentBridge,
  runAgent,
  runChain,
  spawnCommand,
  type AgentBridge,
  type AgentBridgeWithMetadata,
  type CommandResult,
  type CommandRunner
} from "../agent/orchestrator.js";
import { parseCaseSource, summarizeDocumentCases, type ParsedCaseSource } from "../caseSource/parser.js";
import { writeXlsxCaseSourceResults } from "../caseSource/writeBack.js";
import { id } from "../shared/id.js";
import type {
  AgentRun,
  AgentTask,
  AuthCheckpoint,
  AuthProfile,
  BugReport,
  CaseSuiteRun,
  CaseSuite,
  CaseSuiteCaseResult,
  ChainRun,
  DocumentCase,
  ExecutableCase,
  ExecutionPlan,
  ExecutionFailureType,
  ExecutionPreflightCheck,
  Gap,
  RequirementSuiteCaseOutcome,
  RequirementSuiteRun,
  RequirementContentPackage,
  TestArtifact,
  TestCaseScenario,
  TestCaseStep,
  TestDataTask,
  KnowledgeNodeType
} from "../domain/types.js";
import type { BrainCreatorToolName } from "./tools.js";

export type BrainCreatorMcpContext = {
  repository: JsonFileBrainCreatorRepository;
  service: BrainCreatorService;
  knowledgeService: KnowledgeService;
  testDataProvider: TestDataProviderService;
  executionPreflight: ExecutionPreflightService;
  requirementSuiteRuns: RequirementSuiteRunService;
  runLedger: RunLedgerService;
  systemExploration: SystemExplorationCoordinator;
  workDir: string;
  agentBridge?: AgentBridgeWithMetadata;
  runner?: CommandRunner;
  authStateVerifier: AuthStateVerifier;
  feishuReader?: RequirementSourceReader;
};

type HostAgentTaskPackage = {
  status: "needs_agent_execution";
  task: AgentTask;
  promptPath: string;
  contextPath: string;
  outputPaths: string[];
  submitTool: "bc_submit_agent_output";
  nextAction: string;
};

type CreateContextInput = {
  dataFilePath?: string;
  workDir?: string;
  agentBridge?: AgentBridgeWithMetadata;
  runner?: CommandRunner;
  authStateVerifier?: AuthStateVerifier;
  knowledgeDir?: string;
  feishuReader?: RequirementSourceReader;
  systemExplorer?: SystemExplorer;
};

export function createBrainCreatorMcpContext(
  input: CreateContextInput = {}
): BrainCreatorMcpContext {
  const workDir = input.workDir ?? resolveBrainCreatorWorkspace();
  const repository = new JsonFileBrainCreatorRepository(
    input.dataFilePath ?? resolveBrainCreatorDataFile(workDir)
  );
  const service = new BrainCreatorService(repository);
  const knowledgeService = new KnowledgeService(
    repository,
    input.knowledgeDir ?? resolveBrainCreatorKnowledgeDir(workDir)
  );
  const testDataProvider = new TestDataProviderService(
    repository,
    knowledgeService,
    join(workDir, ".brain-creator")
  );
  const executionPreflight = new ExecutionPreflightService(repository);
  const runLedger = new RunLedgerService(repository);
  const requirementSuiteRuns = new RequirementSuiteRunService(
    repository,
    runLedger
  );
  return {
    repository,
    service,
    knowledgeService,
    testDataProvider,
    executionPreflight,
    requirementSuiteRuns,
    runLedger,
    systemExploration: new SystemExplorationCoordinator({
      repository,
      service,
      knowledgeService,
      workDir,
      explorer: input.systemExplorer
    }),
    workDir,
    agentBridge:
      input.agentBridge ??
      (input.runner ? commandRunnerAgentBridge(input.runner) : createConfiguredAgentBridge()),
    runner: input.runner,
    authStateVerifier: input.authStateVerifier ?? verifyStoredBrowserAuth,
    feishuReader: input.feishuReader ?? configuredFeishuReader()
  };
}

export async function handleBrainCreatorTool(
  context: BrainCreatorMcpContext,
  name: BrainCreatorToolName,
  input: Record<string, unknown>
): Promise<CallToolResult> {
  try {
    switch (name) {
      case "bc_prepare":
        return textResult(await prepareFacade(context, input));
      case "bc_command":
        return textResult(await commandFacade(context, input));
      case "bc_intent_preview":
        return textResult(intentPreviewFacade(context, input));
      case "bc_status":
        return textResult(await statusFacade(context, input));
      case "bc_run":
        return textResult(await runFacade(context, input));
      case "bc_review":
        return textResult(await reviewFacade(context, input));
      case "bc_configure":
        return textResult(await configureFacade(context, input));
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
      case "bc_prepare_agent_task":
        return textResult(await prepareAgentTask(context, input));
      case "bc_submit_agent_output":
        return textResult(await submitAgentOutput(context, input));
      case "bc_list_agent_runs":
        return textResult(context.service.listAgentRuns(stringArg(input, "systemId")));
      case "bc_run_chain":
        return textResult(await runApprovedChain(context, input));
      case "bc_full_workflow":
        return textResult(await fullWorkflow(context, input));
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

async function commandFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const command = stringArg(input, "command");
  const commandInput = commandWithSystemReference(command);
  if (isBrainCreatorHelpCommand(commandInput.tokens)) {
    validateHelpCommandTokens(commandInput.tokens);
    const resolution = hasCommandSystemContext(input, commandInput.systemReference)
      ? resolveSystemReference(context, input, commandInput.systemReference)
      : undefined;
    return {
      command,
      action: "help",
      userMessage: "Brain Creator shortcuts are available through /bc commands.",
      helpMarkdown: brainCreatorCommandHelpMarkdown(),
      shortcuts: brainCreatorCommandShortcuts(),
      ...(resolution ? { systemResolution: resolution } : {})
    };
  }
  if (
    isBrainCreatorStatusCommand(commandInput.tokens) &&
    !hasCommandSystemIdentity(input, commandInput.systemReference)
  ) {
    const toolInput = {
      ...(optionalStringArg(input, "environment") || commandInput.systemReference.environment
        ? {
            environment:
              optionalStringArg(input, "environment") ?? commandInput.systemReference.environment
          }
        : {})
    };
    return {
      command,
      tool: "bc_status",
      toolInput,
      result: await statusFacade(context, toolInput)
    };
  }
  const resolution = resolveSystemReference(context, input, commandInput.systemReference);
  const parsed = parseBrainCreatorCommandTokens(commandInput.tokens, resolution.systemId);
  const result =
    parsed.tool === "bc_status"
      ? await statusFacade(context, parsed.toolInput)
      : parsed.tool === "bc_review"
        ? await reviewFacade(context, parsed.toolInput)
        : await runFacade(context, parsed.toolInput);
  return {
    command,
    tool: parsed.tool,
    toolInput: parsed.toolInput,
    systemResolution: resolution,
    result
  };
}

function isBrainCreatorHelpCommand(tokens: string[]) {
  return tokens[0]?.toLowerCase() === "/bc" && tokens[1]?.toLowerCase() === "help";
}

function isBrainCreatorStatusCommand(tokens: string[]) {
  return (
    tokens.length === 2 &&
    tokens[0]?.toLowerCase() === "/bc" &&
    tokens[1]?.toLowerCase() === "status"
  );
}

function validateHelpCommandTokens(tokens: string[]) {
  for (const token of tokens.slice(2)) {
    if (token.startsWith("--")) {
      throw new Error(`Unsupported /bc help option: ${token}`);
    }
    throw new Error(`Unexpected /bc help argument: ${token}`);
  }
}

function hasCommandSystemContext(
  input: Record<string, unknown>,
  systemReference: { systemName?: string; environment?: string }
) {
  return Boolean(
    optionalStringArg(input, "systemId") ||
      optionalStringArg(input, "systemName") ||
      optionalStringArg(input, "environment") ||
      systemReference.systemName ||
      systemReference.environment
  );
}

function hasCommandSystemIdentity(
  input: Record<string, unknown>,
  systemReference: { systemName?: string; environment?: string }
) {
  return Boolean(
    optionalStringArg(input, "systemId") ||
      optionalStringArg(input, "systemName") ||
      systemReference.systemName
  );
}

function intentPreviewFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const request = stringArg(input, "request");
  const systemName = optionalStringArg(input, "systemName") ?? inferSystemName(context, request);
  const resolution = resolveSystemReference(context, { ...input, systemName });
  const source = optionalStringArg(input, "source") ?? extractCaseSource(request);
  const normalizedRequest = request.toLowerCase();
  const filters = intentCaseSourceFilters(input, request);
  const bugFilters = intentBugRegressionFilters(input, request);

  if (isContinueRequest(normalizedRequest)) {
    return {
      request,
      intent: "continue-suite",
      tool: "bc_run",
      toolInput: {
        mode: "case-source-suite",
        systemId: resolution.systemId,
        resume: true,
        confirm: true
      },
      systemResolution: resolution,
      requiresConfirmation: false,
      userMessage: "Continue the latest unfinished suite for the selected system."
    };
  }

  if (isBugRegressionRequest(normalizedRequest)) {
    return {
      request,
      intent: "regress-open-bugs",
      tool: "bc_run",
      toolInput: {
        mode: "bug-regression",
        systemId: resolution.systemId,
        ...bugFilters
      },
      systemResolution: resolution,
      requiresConfirmation: false,
      userMessage: "Run regression for open BugReports in the selected system."
    };
  }

  if (isBugReviewRequest(normalizedRequest)) {
    return {
      request,
      intent: "review-open-bugs",
      tool: "bc_review",
      toolInput: {
        target: "bug",
        systemId: resolution.systemId,
        status: "open"
      },
      systemResolution: resolution,
      requiresConfirmation: false,
      userMessage: "Review open BugReports for the selected system."
    };
  }

  if (isDocumentSuiteRequest(normalizedRequest, source)) {
    if (!source) {
      throw new Error("A test case document path is required for a document suite request.");
    }
    return {
      request,
      intent: "case-source-suite-preview",
      tool: "bc_run",
      toolInput: {
        mode: "case-source-suite",
        systemId: resolution.systemId,
        source,
        ...filters,
        confirm: false
      },
      systemResolution: resolution,
      requiresConfirmation: true,
      userMessage: "Preview the document suite first; ask the user to confirm before executing."
    };
  }

  return {
    request,
    intent: "status",
    tool: "bc_status",
    toolInput: {
      systemId: resolution.systemId
    },
    systemResolution: resolution,
    requiresConfirmation: false,
    userMessage: "Inspect the selected system status before choosing the next facade action."
  };
}

async function prepareFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const action = prepareActionArg(input, "action");
  if (action === "ingest-requirement" || action === "refresh-requirement") {
    const knowledgeProjectId = stringArg(input, "knowledgeProjectId");
    const source = stringArg(input, "source");
    let resolved;
    try {
      resolved = await resolveRequirementSource(
        { source, contentPackage: requirementContentPackageArg(input, "contentPackage") },
        {
          baseDir: context.workDir,
          allowPrivateNetwork: optionalBooleanArg(input, "allowPrivateNetwork"),
          feishuReader: context.feishuReader
        }
      );
    } catch (error) {
      if (!isFeishuRequirementSource(source)) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      const gap = reportKnowledgeGap(
        context,
        knowledgeProjectId,
        source,
        `Feishu connector failed: ${reason}`
      );
      return {
        status: "connector-error",
        connector: "feishu",
        error: reason,
        gap,
        nextAction: "Fix Feishu access or retry with a host-provided contentPackage."
      };
    }
    if (resolved.status === "needs-host-connector") {
      const gap = reportKnowledgeGap(
        context,
        knowledgeProjectId,
        source,
        "Feishu content requires a host lark connector. Submit a RequirementContentPackage or export DOCX/PDF/Markdown."
      );
      return {
        ...resolved,
        gap,
        nextAction: "Read the Feishu document through the host lark capability and retry with contentPackage."
      };
    }
    const result = await context.knowledgeService.ingestRequirement({
      projectId: knowledgeProjectId,
      contentPackage: resolved.contentPackage
    });
    return {
      ...result,
      status: result.changed ? "draft-created" : "unchanged",
      nextAction: result.changed ? "generate-test-design" : "review-existing-baseline"
    };
  }
  if (action === "generate-analysis" || action === "generate-test-design") {
    const provider = policyProviderArg(input, "provider");
    if (provider === "host-skill" && input.analysisPackage === undefined) {
      return {
        status: "needs-host-skill",
        requirementSetId: stringArg(input, "requirementSetId"),
        requiredSkills: ["RequirementAnalysis.skill", "TestCaseDesign.skill"],
        requiredOutput: "Brain Creator RequirementAnalysis schema",
        nextAction:
          "Run the available host Skill against the requirement source, then retry with analysisPackage."
      };
    }
    const requirementSetId = stringArg(input, "requirementSetId");
    return context.knowledgeService.generateTestDesign(
      requirementSetId,
      provider,
      provider === "host-skill"
        ? normalizeHostSkillAnalysis(input.analysisPackage, requirementSetId)
        : undefined
    );
  }
  if (action === "confirm-eval-actions") {
    const requirementSetId = stringArg(input, "requirementSetId");
    if (!optionalBooleanArg(input, "confirm")) {
      const requirementSet = context.repository.requirementSets.find(
        (item) => item.id === requirementSetId
      );
      if (!requirementSet) throw new Error("Requirement set not found");
      return {
        status: "preview",
        requirementSetId,
        evaluationGate: requirementSet.evaluationGate,
        requiresConfirmation: true,
        nextAction: "Present every pending Eval action and ask the user for an explicit resolution note."
      };
    }
    return context.knowledgeService.confirmEvaluationActions({
      requirementSetId,
      actionIds: stringArrayArg(input, "actionIds"),
      note: stringArg(input, "confirmationNote"),
      confirm: true
    });
  }
  if (action === "approve-baseline") {
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        requirementSetId: stringArg(input, "requirementSetId"),
        requiresConfirmation: true,
        nextAction: "Ask the user to confirm the requirement baseline before approval."
      };
    }
    return context.knowledgeService.approveRequirementSet(stringArg(input, "requirementSetId"));
  }
  if (action === "resolve-test-data") {
    const executableCaseId = stringArg(input, "executableCaseId");
    const executableCase = context.repository.executableCases.find(
      (item) => item.id === executableCaseId
    );
    if (!executableCase) throw new Error("Executable case not found");
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        executableCaseId,
        testDataPlan: executableCase.dataPlan,
        requiresConfirmation: true,
        nextAction:
          "Present lookup, reuse, create, cleanup, and value decisions before resolving test data."
      };
    }
    return context.knowledgeService.resolveExecutableCaseTestData({
      executableCaseId,
      resolutions: testDataResolutionsArg(input, "testDataResolutions")
    });
  }
  if (action === "prepare-test-data") {
    return context.testDataProvider.prepare({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      executableCaseId: stringArg(input, "executableCaseId"),
      confirm: optionalBooleanArg(input, "confirm"),
      allowCreate: optionalBooleanArg(input, "allowCreate")
    });
  }
  if (action === "submit-test-data") {
    const submitted = context.testDataProvider.submit({
      taskId: stringArg(input, "taskId"),
      status: testDataTaskResultStatusArg(input, "taskStatus"),
      decision: optionalTestDataProviderDecisionArg(input, "dataDecision"),
      reference: optionalStringArg(input, "dataReference"),
      value: optionalStringArg(input, "dataValue"),
      sourceRefs: stringArrayArg(input, "sourceRefs"),
      error: optionalStringArg(input, "error")
    });
    return continueRequirementSuiteAfterTestData(context, submitted);
  }
  if (action === "prepare-execution") {
    const executableCaseId = stringArg(input, "executableCaseId");
    const confirm = optionalBooleanArg(input, "confirm");
    const executableCase = context.repository.executableCases.find(
      (item) => item.id === executableCaseId
    );
    if (!executableCase) throw new Error("Executable case not found");
    if (
      confirm &&
      executableCase.dataPlan?.verdict === "ready" &&
      executableCase.dataPlan.requiresConfirmation &&
      !executableCase.dataPlan.confirmedAt
    ) {
      context.knowledgeService.confirmExecutableCaseTestData(executableCase.id);
    }
    return context.executionPreflight.prepare({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      executableCaseId,
      authProfileId: optionalStringArg(input, "authProfileId"),
      confirm
    });
  }
  if (action === "explore-system") {
    return context.systemExploration.explore({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      authProfileId: optionalStringArg(input, "authProfileId"),
      startUrl: optionalStringArg(input, "startUrl"),
      interactionMode: explorationInteractionModeArg(input, "interactionMode"),
      budget: {
        maxPages: optionalNumberArg(input, "maxPages"),
        maxDepth: optionalNumberArg(input, "maxDepth"),
        maxDurationMs: optionalNumberArg(input, "maxDurationMs"),
        maxInteractionsPerPage: optionalNumberArg(input, "maxInteractionsPerPage")
      }
    });
  }
  if (action === "record-observation") {
    return context.knowledgeService.recordSystemObservation({
      projectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      type: knowledgeNodeTypeArg(input, "observationType"),
      title: stringArg(input, "title"),
      content: stringArg(input, "content"),
      module: optionalStringArg(input, "module") ?? "General",
      sourceRefs: stringArrayArg(input, "sourceRefs"),
      confidence: optionalNumberArg(input, "confidence")
    });
  }
  if (action === "record-page-evidence") {
    const knowledgeProjectId = stringArg(input, "knowledgeProjectId");
    const systemId = stringArg(input, "systemId");
    context.knowledgeService.getSystemBrain(knowledgeProjectId, systemId);
    const evidence = pageEvidenceArg(input, "pageEvidence");
    assertSystemEvidenceUrl(context, systemId, evidence.finalUrl);
    const authProfileId = optionalStringArg(input, "authProfileId");
    if (
      authProfileId &&
      !context.repository.authProfiles.some(
        (profile) => profile.id === authProfileId && profile.projectId === systemId
      )
    ) {
      throw new Error("Auth profile does not belong to the selected business system");
    }
    const result = context.service.discoverPageModel({
      projectId: systemId,
      route: evidence.finalUrl,
      name: evidence.title,
      authProfileId: authProfileId ?? "",
      domText: evidence.domText,
      captureMode: "browser",
      targetUrl: evidence.finalUrl,
      browserCapture: evidence
    });
    return {
      ...result,
      brain: await context.knowledgeService.refreshSystemBrain(
        knowledgeProjectId,
        systemId
      )
    };
  }
  if (action === "record-training-evidence") {
    const knowledgeProjectId = stringArg(input, "knowledgeProjectId");
    const systemId = stringArg(input, "systemId");
    const pageModelId = stringArg(input, "pageModelId");
    const brain = context.knowledgeService.getSystemBrain(knowledgeProjectId, systemId);
    const page = brain.pages.find((candidate) => candidate.pageModelId === pageModelId);
    if (!page) {
      throw new Error("Page model does not belong to the selected System Brain");
    }
    const evidence = trainingEvidenceArg(input, "trainingEvidence");
    if (
      evidence.actions.some(
        (action) => !page.locators.some((locator) => locator.id === action.targetLocatorId)
      )
    ) {
      throw new Error("Training action locator does not belong to the selected page model");
    }
    const session = context.service.createTrainingSession({ projectId: systemId, pageModelId });
    const result = context.service.completeTrainingSession({
      sessionId: session.id,
      actions: evidence.actions,
      apiRequests: evidence.apiRequests,
      artifacts: evidence.artifacts
    });
    return {
      ...result,
      brain: await context.knowledgeService.refreshSystemBrain(
        knowledgeProjectId,
        systemId
      )
    };
  }
  if (action === "refresh-system-brain") {
    return context.knowledgeService.refreshSystemBrain(
      stringArg(input, "knowledgeProjectId"),
      stringArg(input, "systemId")
    );
  }
  const compiled = context.knowledgeService.compileExecutableCases(
    stringArg(input, "testIntentId"),
    optionalStringArg(input, "systemId")
  );
  return {
    ...compiled,
    workflowPath: compiled.executableCase.pathPlan,
    stateActions: compiled.executableCase.statePlan,
    testDataPlan: compiled.executableCase.dataPlan,
    nextAction:
      compiled.executableCase.status === "ready"
        ? "preview-requirement-suite"
        : compiled.executableCase.dataPlan?.verdict === "blocked"
          ? "resolve-test-data"
          : "review-system-brain-gaps"
  };
}

async function statusFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const knowledgeProjectId = optionalStringArg(input, "knowledgeProjectId");
  if (knowledgeProjectId) {
    return knowledgeStatus(context, knowledgeProjectId);
  }
  const systemIdInput = optionalStringArg(input, "systemId");
  const systemNameInput = optionalStringArg(input, "systemName");
  const environment = optionalStringArg(input, "environment");
  const candidates =
    systemIdInput || systemNameInput
      ? []
      : context.service
          .listSystemProfiles()
          .filter((system) => system.status !== "cancelled")
          .filter((system) => !environment || system.environment === environment);
  if (!systemIdInput && !systemNameInput && candidates.length !== 1) {
    return statusSystemSelection(candidates, environment);
  }
  const resolution = resolveSystemReference(
    context,
    candidates.length === 1 ? { ...input, systemId: candidates[0].id } : input
  );
  const systemId = resolution.systemId;
  const snapshot = await sessionResume(context, { systemId });
  const caseSources = context.service.listCaseSources(systemId);
  const suites = context.service.listCaseSuites(systemId);
  const suiteRuns = context.service.listCaseSuiteRuns(systemId);
  const bugs = context.service.listBugReports({ systemId });
  const openBugs = bugs.filter((bug) => bug.status === "open" || bug.status === "retest-failed");
  const unfinishedSuites = unfinishedCaseSuites(context, systemId);
  const pendingAgentTasks = context.service
    .listAgentTasks(systemId)
    .filter((task) => task.status === "pending");
  const awaitingAuthCheckpoints = snapshot.auth.checkpoints.filter(
    (checkpoint) => checkpoint.status === "awaiting-user"
  );
  const nextAction = facadeNextAction({
    bridgeOk: snapshot.bridge.ok,
    awaitingAuthCheckpoints: awaitingAuthCheckpoints.length,
    pendingAgentTasks: pendingAgentTasks.length,
    openBugs: openBugs.length,
    openGaps: snapshot.openGaps.length,
    approvedCases: snapshot.cases.byStatus.approved,
    caseSources: caseSources.length,
    unfinishedSuites: unfinishedSuites.length
  });
  const userSummary = statusUserSummary({
    systemName: snapshot.system.name,
    bridgeOk: snapshot.bridge.ok,
    authProfiles: snapshot.auth.profiles.length,
    awaitingAuthCheckpoints: awaitingAuthCheckpoints.length,
    pendingAgentTasks: pendingAgentTasks.length,
    openBugs: openBugs.length,
    openGaps: snapshot.openGaps.length,
    unfinishedSuites: unfinishedSuites.length,
    nextAction
  });
  return {
    ...snapshot,
    systemResolution: resolution,
    caseSources: {
      total: caseSources.length,
      recent: caseSources.slice(-5)
    },
    suites: {
      total: suites.length,
      byStatus: countBy(suites, (suite) => suite.status),
      unfinished: unfinishedSuites,
      recent: suites.slice(-5)
    },
    suiteRuns: {
      total: suiteRuns.length,
      byStatus: countBy(suiteRuns, (run) => run.status),
      recent: suiteRuns.slice(-5)
    },
    agentTasks: {
      pending: pendingAgentTasks
    },
    bugs: {
      total: bugs.length,
      open: openBugs.length,
      recent: bugs.slice(-5)
    },
    facadeNextAction: nextAction,
    userSummary,
    statusMarkdown: statusMarkdown(userSummary),
    quickCommands: statusQuickCommands({
      openBugs: openBugs.length,
      openGaps: snapshot.openGaps.length,
      unfinishedSuites: unfinishedSuites.length
    }),
    toolGuidance: statusToolGuidance(nextAction)
  };
}

function statusSystemSelection(
  systems: Array<{ id: string; name: string; environment: string }>,
  environment?: string
) {
  const grouped = new Map<
    string,
    { name: string; environment: string; systemIds: string[] }
  >();
  for (const system of systems) {
    const key = `${normalizeSystemLookup(system.name)}\u0000${normalizeSystemLookup(system.environment)}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.systemIds.push(system.id);
      continue;
    }
    grouped.set(key, {
      name: system.name,
      environment: system.environment,
      systemIds: [system.id]
    });
  }
  const systemOptions = [...grouped.values()]
    .map((option) => ({
      ...option,
      instanceCount: option.systemIds.length
    }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.environment.localeCompare(right.environment)
    );
  const noSystems = systemOptions.length === 0;
  const selectionMarkdown = noSystems
    ? [
        "# Select a Brain Creator system",
        "",
        environment
          ? `No active systems were found in environment "${environment}".`
          : "No active systems are configured.",
        "Ask Brain Creator to connect a business system first."
      ].join("\n")
    : [
        "# Select a Brain Creator system",
        "",
        "Choose a system context before continuing:",
        "",
        ...systemOptions.flatMap((option) => [
          `- ${option.name} (${option.environment}) - ${option.instanceCount} ${
            option.instanceCount === 1 ? "instance" : "instances"
          }`,
          option.instanceCount === 1
            ? `  Command: \`/bc status --system "${option.name}" --env "${option.environment}"\``
            : "  Ask the Agent to choose a specific instance."
        ])
      ].join("\n");
  return {
    status: noSystems ? "no_systems" : "needs_system_selection",
    userMessage: noSystems
      ? "Connect a business system before using Brain Creator status."
      : "Choose a business system before continuing.",
    environment,
    systemOptions,
    selectionMarkdown,
    nextAction: noSystems ? "configure_system" : "select_system",
    quickCommands: systemOptions
      .filter((option) => option.instanceCount === 1)
      .map((option) => ({
        command: `/bc status --system "${option.name}" --env "${option.environment}"`,
        description: `Inspect ${option.name} in ${option.environment}.`
      })),
    toolGuidance: statusToolGuidance(noSystems ? "configure_system" : "select_system")
  };
}

async function runFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const mode = runModeArg(input, "mode");
  if (mode === "approved-case") {
    return runApprovedChain(context, { ...input, caseId: stringArg(input, "caseId") });
  }
  if (mode === "full-workflow") {
    return fullWorkflow(context, { ...input, caseId: stringArg(input, "caseId") });
  }
  if (mode === "requirement-suite") {
    return runRequirementSuite(context, input);
  }
  const resolution = resolveSystemReference(context, input);
  const inputWithSystem = { ...input, systemId: resolution.systemId };
  if (mode === "case-source-suite") {
    return {
      ...(await runCaseSourceSuite(context, inputWithSystem)),
      systemResolution: resolution
    };
  }
  return {
    ...(await runBugRegression(context, inputWithSystem)),
    systemResolution: resolution
  };
}

async function runCaseSourceSuite(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const resumeTarget = optionalBooleanArg(input, "resume")
    ? latestUnfinishedCaseSuite(context, systemId)
    : undefined;
  const source = optionalStringArg(input, "source") ?? resumeTarget?.source;
  if (!source) {
    throw new Error("source is required unless resume is true and an unfinished suite exists");
  }
  const parsed = await parseCaseSource(source);
  const filters = caseSourceFilters(input);
  const selectedCases = filterDocumentCases(parsed.cases, filters);
  const caseSource = context.service.upsertCaseSource({
    systemId,
    source: parsed.source,
    sourceType: parsed.sourceType,
    contentHash: parsed.contentHash,
    caseCount: parsed.cases.length,
    moduleStats: parsed.moduleStats,
    priorityStats: parsed.priorityStats
  });
  const bridge = await preflightAgentBridge(context.agentBridge);

  if (!optionalBooleanArg(input, "confirm")) {
    return {
      mode: "case-source-suite",
      status: "preview",
      source: caseSource,
      summary: previewSummary(parsed, selectedCases),
      selection: selectionSummary(parsed.cases, selectedCases, filters),
      executionPolicy: {
        continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked")
      },
      bridge,
      requiresConfirmation: true,
      nextAction: "Ask the user to confirm before running the full suite."
    };
  }

  if (selectedCases.length === 0) {
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "case-source",
      sourceId: caseSource.id,
      reason:
        parsed.cases.length === 0
          ? "Case source has no executable document cases."
          : "Case source filters selected no executable document cases.",
      severity: "high",
      owner: "qa"
    });
    return { mode: "case-source-suite", status: "blocked", source: caseSource, gap, bridge };
  }

  if (context.service.listAuthProfiles(systemId).length === 0) {
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "case-source-suite",
      sourceId: caseSource.id,
      reason: "Auth profile is required before executing a document case suite.",
      severity: "high",
      owner: "qa"
    });
    return { mode: "case-source-suite", status: "blocked", source: caseSource, gap, bridge };
  }

  const awaitingAuthCheckpoints = context.service.listAuthCheckpoints(systemId, "awaiting-user");
  if (awaitingAuthCheckpoints.length > 0) {
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "case-source-suite",
      sourceId: caseSource.id,
      reason: "Manual authentication checkpoint must be completed before executing a document case suite.",
      severity: "high",
      owner: "qa"
    });
    return {
      mode: "case-source-suite",
      status: "blocked",
      source: caseSource,
      gap,
      bridge,
      authCheckpoints: awaitingAuthCheckpoints
    };
  }

  const authState = await verifyCaseSourceSuiteAuthState(context, systemId);
  if (authState?.status === "expired") {
    const authProfile = findAuthProfile(context, systemId);
    const authCheckpoint = context.service.createAuthCheckpoint({
      systemId,
      authProfileId: authProfile.id,
      reason: authState.reason ?? "Stored browser authentication has expired.",
      resumeInstruction:
        "Complete login in an isolated browser, save refreshed storage state, verify it in a fresh context, then resume the suite."
    });
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "case-source-suite-auth",
      sourceId: caseSource.id,
      reason: authState.reason ?? "Stored browser authentication has expired.",
      severity: "high",
      owner: "qa"
    });
    return {
      mode: "case-source-suite",
      status: "blocked",
      source: caseSource,
      authState,
      authCheckpoint,
      gap,
      bridge
    };
  }
  if (authState?.status === "unavailable") {
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "case-source-suite-auth",
      sourceId: caseSource.id,
      reason: authState.reason ?? "Stored browser authentication could not be verified.",
      severity: "high",
      owner: "qa"
    });
    return { mode: "case-source-suite", status: "blocked", source: caseSource, authState, gap, bridge };
  }

  if (!bridge.ok) {
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "case-source-suite",
      sourceId: caseSource.id,
      reason: `Agent bridge unavailable: ${bridge.error}`,
      severity: "high",
      owner: "qa"
    });
    return { mode: "case-source-suite", status: "blocked", source: caseSource, gap, bridge };
  }

  const requestedSuiteId = optionalStringArg(input, "suiteId") ?? resumeTarget?.suiteId;
  const suite = requestedSuiteId
    ? existingCaseSuite(context, requestedSuiteId, systemId, caseSource.id)
    : context.service.createCaseSuite({
        systemId,
        sourceId: caseSource.id,
        totalCases: selectedCases.length,
        selectedCaseNos: selectedCases.map((documentCase) => documentCase.caseNo),
        continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked"),
        status: "approved"
      });
  if (optionalBooleanArg(input, "continueOnBlocked") && suite.continueOnBlocked !== true) {
    context.service.enableCaseSuiteContinueOnBlocked(suite.id);
  }
  const alreadyPassed = passedCaseNosForSuite(context, systemId, suite.id);
  const casesToRun = parsed.cases.filter(
    (documentCase) =>
      suite.selectedCaseNos.includes(documentCase.caseNo) && !alreadyPassed.has(documentCase.caseNo)
  );
  if (context.agentBridge?.provider === "host-agent") {
    const pendingTask = context.service
      .listAgentTasks(systemId)
      .find(
        (task) =>
          task.status === "pending" &&
          task.suiteContext?.suiteId === suite.id
      );
    if (pendingTask?.suiteContext) {
      const currentCase = parsed.cases.find(
        (documentCase) => documentCase.caseNo === pendingTask.suiteContext?.caseNo
      );
      const waitingSuite = context.service.updateCaseSuiteStatus(suite.id, "waiting-for-agent");
      return {
        ...taskPackageFromStoredTask(pendingTask),
        mode: "case-source-suite",
        stage: pendingTask.agent,
        source: caseSource,
        suite: waitingSuite,
        currentCase: {
          caseNo: pendingTask.suiteContext.caseNo,
          title: pendingTask.suiteContext.title,
          status: "waiting-for-agent",
          testCaseId: pendingTask.chainContext?.testCaseId,
          gapIds: []
        },
        progress: caseSuiteProgress(context, waitingSuite),
        documentCase: currentCase
      };
    }
    const documentCase = casesToRun[0];
    if (!documentCase) {
      const completedSuite = context.service.updateCaseSuiteStatus(suite.id, "completed");
      return {
        mode: "case-source-suite",
        status: "completed",
        source: caseSource,
        suite: completedSuite,
        progress: caseSuiteProgress(context, completedSuite)
      };
    }
    const result = await executeDocumentCase(context, {
      systemId,
      sourceId: caseSource.id,
      suiteId: suite.id,
      documentCase,
      maxHealAttempts: optionalNumberArg(input, "maxHealAttempts"),
      createBugOnFailure: true
    });
    if (result.taskPackage) {
      const waitingSuite = context.service.updateCaseSuiteStatus(suite.id, "waiting-for-agent");
      return {
        ...result.taskPackage,
        mode: "case-source-suite",
        stage: result.taskPackage.task.agent,
        source: caseSource,
        suite: waitingSuite,
        currentCase: result.caseResult,
        progress: caseSuiteProgress(context, waitingSuite)
      };
    }
  }
  context.service.updateCaseSuiteStatus(suite.id, "running");
  const caseResults: CaseSuiteCaseResult[] = [];
  const artifactPaths: string[] = [];
  const bugReportIds: string[] = [];
  const gapIds: string[] = [];

  for (const documentCase of casesToRun) {
    const result = await executeDocumentCase(context, {
      systemId,
      sourceId: caseSource.id,
      suiteId: suite.id,
      documentCase,
      maxHealAttempts: optionalNumberArg(input, "maxHealAttempts"),
      createBugOnFailure: true
    });
    caseResults.push(result.caseResult);
    if (result.artifactPaths) {
      artifactPaths.push(...result.artifactPaths);
    }
    if (result.bugReportId) {
      bugReportIds.push(result.bugReportId);
    }
    gapIds.push(...result.caseResult.gapIds);
  }

  const counts = countBy(caseResults, (result) => result.status);
  const nowPassed = new Set(alreadyPassed);
  for (const result of caseResults.filter((item) => item.status === "passed")) {
    nowPassed.add(result.caseNo);
  }
  const allSuiteCasesPassed = suite.selectedCaseNos.every((caseNo) => nowPassed.has(caseNo));
  const suiteRun = context.service.recordCaseSuiteRun({
    systemId,
    suiteId: suite.id,
    sourceId: caseSource.id,
    status: (counts.blocked ?? 0) > 0 ? "blocked" : (counts.failed ?? 0) > 0 ? "failed" : "completed",
    total: casesToRun.length,
    passed: counts.passed ?? 0,
    failed: counts.failed ?? 0,
    blocked: counts.blocked ?? 0,
    caseResults,
    artifactPaths: [...new Set(artifactPaths)],
    bugReportIds,
    gapIds,
    completedAt: new Date().toISOString()
  });
  context.service.updateCaseSuiteStatus(
    suite.id,
    allSuiteCasesPassed ? "completed" : "failed"
  );
  const bugs = context.service.listBugReports({ systemId }).filter((bug) =>
    bugReportIds.includes(bug.id)
  );
  const writeBack = await maybeWriteCaseSourceResults({
    source: parsed.source,
    cases: parsed.cases,
    results: caseResults,
    bugs,
    requested: optionalBooleanArg(input, "writeBack"),
    confirmed: optionalBooleanArg(input, "confirmWriteBack")
  });

  return {
    mode: "case-source-suite",
    status: suiteRun.status,
    source: caseSource,
    suite,
    suiteRun,
    progress: caseSuiteProgress(context, suite),
    bugs,
    writeBack
  };
}

async function executeDocumentCase(
  context: BrainCreatorMcpContext,
  input: {
    systemId: string;
    sourceId: string;
    suiteId?: string;
    documentCase: DocumentCase;
    maxHealAttempts?: number;
    createBugOnFailure?: boolean;
  }
): Promise<{
  caseResult: CaseSuiteCaseResult;
  artifactPaths?: string[];
  bugReportId?: string;
  taskPackage?: HostAgentTaskPackage;
}> {
  const testCase = context.service.createTestCaseFromDocumentCase({
    systemId: input.systemId,
    documentCase: input.documentCase
  });
  context.service.approveTestCase(testCase.id);
  try {
    const result = await runApprovedChain(context, {
      caseId: testCase.id,
      maxHealAttempts: input.maxHealAttempts,
      suiteContext: input.suiteId
        ? {
            suiteId: input.suiteId,
            sourceId: input.sourceId,
            caseNo: input.documentCase.caseNo,
            title: input.documentCase.title
          }
        : undefined
    });
    if (!("chainRun" in result)) {
      return {
        caseResult: {
          caseNo: input.documentCase.caseNo,
          title: input.documentCase.title,
          status: "waiting-for-agent",
          testCaseId: testCase.id,
          gapIds: [],
          error: "Waiting for the current host agent to generate the requested test output."
        },
        artifactPaths: [result.specPath, result.testPath],
        taskPackage: result
      };
    }
    const artifactPaths = [result.chainRun.specPath, result.chainRun.testPath].filter(
      (item): item is string => typeof item === "string"
    );
    if (result.chainRun.status === "succeeded") {
      return {
        caseResult: {
          caseNo: input.documentCase.caseNo,
          title: input.documentCase.title,
          status: "passed",
          testCaseId: testCase.id,
          chainRunId: result.chainRun.id,
          gapIds: []
        },
        artifactPaths
      };
    }
    if (input.createBugOnFailure === false) {
      return {
        caseResult: {
          caseNo: input.documentCase.caseNo,
          title: input.documentCase.title,
          status: "failed",
          testCaseId: testCase.id,
          chainRunId: result.chainRun.id,
          gapIds: result.chainRun.gaps.map((gap) => gap.id),
          error: chainFailureReason(result.chainRun)
        },
        artifactPaths
      };
    }
    const bug = context.service.createBugReport({
      systemId: input.systemId,
      sourceId: input.sourceId,
      caseNo: input.documentCase.caseNo,
      caseTitle: input.documentCase.title,
      module: input.documentCase.module,
      priority: input.documentCase.priority,
      expectedResult: input.documentCase.expectedResult,
      actualResult: chainFailureReason(result.chainRun),
      reproductionSteps: reproductionSteps(input.documentCase),
      evidencePaths: artifactPaths,
      chainRunId: result.chainRun.id,
      gapIds: result.chainRun.gaps.map((gap) => gap.id)
    });
    return {
      caseResult: {
        caseNo: input.documentCase.caseNo,
        title: input.documentCase.title,
        status: "failed",
        testCaseId: testCase.id,
        chainRunId: result.chainRun.id,
        bugReportId: bug.id,
        gapIds: result.chainRun.gaps.map((gap) => gap.id)
      },
      artifactPaths,
      bugReportId: bug.id
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const gap = context.service.reportGap({
      projectId: input.systemId,
      sourceType: "case-source-suite",
      sourceId: `${input.sourceId}:${input.documentCase.caseNo}`,
      reason,
      severity: "high",
      owner: "qa"
    });
    return {
      caseResult: {
        caseNo: input.documentCase.caseNo,
        title: input.documentCase.title,
        status: "blocked",
        testCaseId: testCase.id,
        gapIds: [gap.id],
        error: reason
      }
    };
  }
}

async function runBugRegression(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const requestedBugIds = stringArrayArg(input, "bugIds");
  const filters = bugRegressionFilters(input);
  const candidates = context.service
    .listBugReports({ systemId })
    .filter((bug) =>
      requestedBugIds.length > 0
        ? requestedBugIds.includes(bug.id)
        : bug.status === "open" || bug.status === "retest-failed"
    )
    .filter((bug) => matchesBugRegressionFilters(bug, filters));
  const bridge = await preflightAgentBridge(context.agentBridge);
  if (!bridge.ok) {
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "bug-regression",
      sourceId: requestedBugIds.join(",") || "open-bugs",
      reason: `Agent bridge unavailable: ${bridge.error}`,
      severity: "high",
      owner: "qa"
    });
    return { mode: "bug-regression", status: "blocked", bridge, gap };
  }

  const results: CaseSuiteCaseResult[] = [];
  for (const bug of candidates) {
    context.service.updateBugReportStatus(bug.id, "retest-running");
    try {
      const source = context.service
        .listCaseSources(systemId)
        .find((candidate) => candidate.id === bug.sourceId);
      if (!source) {
        throw new Error(`Original case source not found for bug ${bug.id}`);
      }
      const parsed = await parseCaseSource(source.source);
      const documentCase = parsed.cases.find((item) => item.caseNo === bug.caseNo);
      if (!documentCase) {
        throw new Error(`Original document case ${bug.caseNo} not found`);
      }
      const result = await executeDocumentCase(context, {
        systemId,
        sourceId: source.id,
        documentCase,
        maxHealAttempts: optionalNumberArg(input, "maxHealAttempts"),
        createBugOnFailure: false
      });
      results.push(result.caseResult);
      context.service.updateBugReportStatus(
        bug.id,
        result.caseResult.status === "passed" ? "retest-passed" : "retest-failed"
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const gap = context.service.reportGap({
        projectId: systemId,
        sourceType: "bug-regression",
        sourceId: bug.id,
        reason,
        severity: "high",
        owner: "qa"
      });
      results.push({
        caseNo: bug.caseNo,
        title: bug.caseTitle,
        status: "blocked",
        bugReportId: bug.id,
        gapIds: [gap.id],
        error: reason
      });
      context.service.updateBugReportStatus(bug.id, "retest-failed");
    }
  }
  const counts = countBy(results, (result) => result.status);
  const bugs = context.service.listBugReports({ systemId }).filter((bug) =>
    candidates.some((candidate) => candidate.id === bug.id)
  );
  const summary = bugRegressionSummary(candidates, bugs, results);
  return {
    mode: "bug-regression",
    status: (counts.blocked ?? 0) > 0 ? "blocked" : (counts.failed ?? 0) > 0 ? "failed" : "completed",
    total: results.length,
    passed: counts.passed ?? 0,
    failed: counts.failed ?? 0,
    blocked: counts.blocked ?? 0,
    summary,
    results,
    bugs,
    regressionMarkdown: bugRegressionMarkdown(summary, bugs)
  };
}

async function reviewFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const knowledgeProjectId = optionalStringArg(input, "knowledgeProjectId");
  const requestedTarget = reviewTargetArg(input, "target");
  if (knowledgeProjectId && isKnowledgeReviewTarget(requestedTarget)) {
    return knowledgeReview(
      context,
      knowledgeProjectId,
      requestedTarget,
      requestedTarget === "system-brain"
        ? optionalStringArg(input, "systemId") ?? optionalStringArg(input, "id")
        : optionalStringArg(input, "id")
    );
  }
  if (isKnowledgeReviewTarget(requestedTarget)) {
    throw new Error("knowledgeProjectId is required for knowledge review targets");
  }
  const resolution = resolveSystemReference(context, input);
  const systemId = resolution.systemId;
  const target = requestedTarget;
  const failureTypes = failureTypeFilters(input);
  if (target === "bug") {
    const bugs = context.service
      .listBugReports({
        systemId,
        status: bugStatusArg(input, "status")
      })
      .filter((bug) => matchesFailureTypes(classifyFailure(bug.actualResult), failureTypes));
    const regressionCandidates = bugRegressionCandidates(bugs);
    const summary = bugReviewSummary(bugs);
    const nextAction = bugs.some((bug) => bug.status === "open" || bug.status === "retest-failed")
      ? "run_bug_regression"
      : "no_open_bug";
    const reviewSummary = bugReviewResultSummary(summary, bugs, nextAction);
    return {
      summary,
      bugs,
      regressionCandidates: regressionCandidateSummary(regressionCandidates),
      reportMarkdown: bugReviewMarkdown(bugs),
      reviewSummary,
      reviewMarkdown: reviewMarkdownFromSummary(reviewSummary),
      nextAction,
      systemResolution: resolution
    };
  }
  if (target === "suite-run") {
    const review = suiteRunReview(context, systemId, optionalStringArg(input, "id"), failureTypes);
    const reviewSummary = suiteRunReviewSummary(review);
    return {
      ...review,
      reviewSummary,
      reviewMarkdown: reviewMarkdownFromSummary(reviewSummary),
      systemResolution: resolution
    };
  }
  if (target === "case") {
    return {
      items: context.service.listTestCases(systemId),
      systemResolution: resolution
    };
  }
  if (target === "gap") {
    const gaps = context.service
      .listGaps({
        projectId: systemId,
        status: gapStatusArg(input, "status")
      })
      .filter((gap) => matchesFailureTypes(classifyFailure(gap.reason, gap.sourceType), failureTypes));
    const reviewSummary = gapReviewSummary(gaps);
    return {
      items: gaps,
      reviewSummary,
      reviewMarkdown: reviewMarkdownFromSummary(reviewSummary),
      systemResolution: resolution
    };
  }
  const overview = await artifactOverview(context, { systemId });
  const reviewSummary = artifactReviewSummary(overview);
  return {
    ...overview,
    reviewSummary,
    reviewMarkdown: reviewMarkdownFromSummary(reviewSummary),
    systemResolution: resolution
  };
}

async function configureFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const target = configureTargetArg(input, "target");
  if (target === "knowledge-project") {
    return context.knowledgeService.createProject({
      name: stringArg(input, "name"),
      key: stringArg(input, "key"),
      defaultLocale: optionalStringArg(input, "defaultLocale") ?? "zh-CN"
    });
  }
  if (target === "system-binding") {
    return context.knowledgeService.bindSystem(
      stringArg(input, "knowledgeProjectId"),
      stringArg(input, "systemId")
    );
  }
  if (target === "connector") {
    const connector = optionalStringArg(input, "connector") ?? "feishu";
    if (connector !== "feishu") throw new Error("Only the Feishu connector is supported in this phase");
    return connectorStatus(context, optionalStringArg(input, "knowledgeProjectId"));
  }
  if (target === "system") {
    return context.service.createSystemProfile({
      name: stringArg(input, "name"),
      environment: stringArg(input, "environment"),
      baseUrl: stringArg(input, "baseUrl"),
      defaultLocale: optionalStringArg(input, "defaultLocale") ?? "zh-CN",
      urlAllowlist: stringArrayArg(input, "urlAllowlist")
    });
  }
  if (target === "auth") {
    return context.service.createAuthProfile({
      projectId: stringArg(input, "systemId"),
      env: stringArg(input, "env"),
      role: stringArg(input, "role"),
      loginMethod: loginMethodArg(input, "loginMethod"),
      secrets: recordArg(input, "secrets")
    });
  }
  if (target === "term") {
    return context.service.createGlossaryTerm({
      projectId: stringArg(input, "systemId"),
      key: stringArg(input, "key"),
      zhCN: stringArg(input, "zhCN"),
      enUS: stringArg(input, "enUS"),
      aliases: stringArrayArg(input, "aliases"),
      pageScope: optionalStringArg(input, "pageScope") ?? "/"
    });
  }
  if (target === "rule") {
    return context.service.createBusinessRule({
      systemId: stringArg(input, "systemId"),
      name: stringArg(input, "name"),
      condition: stringArg(input, "condition"),
      severity: severityArg(input, "severity")
    });
  }
  return context.service.createAuthCheckpoint({
    systemId: stringArg(input, "systemId"),
    authProfileId: stringArg(input, "authProfileId"),
    testCaseId: optionalStringArg(input, "testCaseId"),
    reason: stringArg(input, "reason"),
    resumeInstruction: stringArg(input, "resumeInstruction")
  });
}

function isRequirementSuiteCandidate(
  context: BrainCreatorMcpContext,
  executableCase: ExecutableCase
) {
  if (executableCase.status === "ready") return true;
  if (
    executableCase.status !== "blocked" ||
    executableCase.dataPlan?.verdict !== "blocked"
  ) {
    return false;
  }
  const openGaps = context.repository.gaps.filter(
    (gap) =>
      executableCase.gapIds.includes(gap.id) && gap.status === "open"
  );
  return (
    openGaps.length > 0 &&
    openGaps.every((gap) => gap.sourceType === "test-data-plan") &&
    executableCase.dataPlan.operations.some(
      (operation) =>
        operation.decision === "lookup" &&
        operation.status === "needs-resolution"
    ) &&
    executableCase.dataPlan.operations.every(
      (operation) => operation.status !== "blocked"
    )
  );
}

function requirementSuitePreflightBlockers(
  context: BrainCreatorMcpContext,
  executableCase: ExecutableCase,
  checks: ExecutionPreflightCheck[]
) {
  const dataResolutionCandidate =
    executableCase.status === "blocked" &&
    isRequirementSuiteCandidate(context, executableCase);
  return checks.filter((check) => {
    if (check.status === "pass") return false;
    if (
      check.id === "test-data" ||
      check.id === "test-data-tasks" ||
      check.id === "test-data-cleanup"
    ) {
      return false;
    }
    if (
      dataResolutionCandidate &&
      (check.id === "executable-case" || check.id === "open-gaps")
    ) {
      return false;
    }
    return true;
  });
}

async function runRequirementSuite(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const projectId = stringArg(input, "knowledgeProjectId");
  const project = context.repository.knowledgeProjects.find((item) => item.id === projectId);
  if (!project) throw new Error("Knowledge project not found");
  const suiteAction = suiteActionArg(input);
  if (suiteAction !== "continue") {
    return controlRequirementSuite(context, projectId, suiteAction, input);
  }
  const requestedCaseId = optionalStringArg(input, "executableCaseId");
  const candidates = context.knowledgeService
    .listExecutableCases(projectId)
    .filter((item) => isRequirementSuiteCandidate(context, item))
    .filter((item) => !requestedCaseId || item.id === requestedCaseId);
  const selectedSystemId =
    optionalStringArg(input, "systemId") ?? project.systemIds[0];
  const authProfileId = optionalStringArg(input, "authProfileId");
  if (!optionalBooleanArg(input, "confirm")) {
    const executionPreflights = selectedSystemId
      ? candidates.map((executableCase) => ({
          executableCaseId: executableCase.id,
          ...context.executionPreflight.prepare({
            knowledgeProjectId: projectId,
            systemId: selectedSystemId,
            executableCaseId: executableCase.id,
            authProfileId,
            confirm: false
          })
        }))
      : [];
    return {
      mode: "requirement-suite",
      status: "preview",
      project,
      executableCases: candidates,
      executionPreflights,
      boundSystemIds: project.systemIds,
      requiresConfirmation: true,
      nextAction:
        project.systemIds.length === 0
          ? "Bind a runtime system before confirming execution."
          : "Ask the user to confirm the requirement suite execution."
    };
  }
  const requestedSuiteRunId = optionalStringArg(input, "suiteId");
  const activeRequirementSuiteRun = requestedSuiteRunId
    ? context.requirementSuiteRuns.get(requestedSuiteRunId)
    : context.requirementSuiteRuns
        .list(projectId)
        .filter(
          (item) =>
            item.status === "running" ||
            item.status === "waiting-for-test-data" ||
            item.status === "waiting-for-agent" ||
            item.status === "blocked"
        )
        .filter(
          (item) => !selectedSystemId || item.systemId === selectedSystemId
        )
        .at(-1);
  if (activeRequirementSuiteRun) {
    if (activeRequirementSuiteRun.knowledgeProjectId !== projectId) {
      throw new Error(
        "Requirement suite run belongs to another knowledge project"
      );
    }
    if (
      selectedSystemId &&
      activeRequirementSuiteRun.systemId !== selectedSystemId
    ) {
      throw new Error(
        "Requirement suite run belongs to another business system"
      );
    }
    if (
      authProfileId &&
      activeRequirementSuiteRun.authProfileId !== authProfileId
    ) {
      throw new Error(
        "Requirement suite run cannot change its selected auth profile"
      );
    }
    if (
      optionalBooleanArg(input, "allowCreateTestData") &&
      !activeRequirementSuiteRun.allowCreateTestData
    ) {
      context.requirementSuiteRuns.authorizeTestDataCreation(
        activeRequirementSuiteRun.id
      );
    }
    if (activeRequirementSuiteRun.status === "blocked") {
      if (!optionalBooleanArg(input, "resume")) {
        return {
          mode: "requirement-suite",
          status: "blocked",
          requirementSuiteRun: activeRequirementSuiteRun,
          nextAction:
            "Retry with resume=true and continueOnBlocked=true after reviewing the blocked case."
        };
      }
      context.requirementSuiteRuns.resume(activeRequirementSuiteRun.id, {
        continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked")
      });
    }
    return executeNextRequirementSuiteCase(
      context,
      activeRequirementSuiteRun.id,
      { maxHealAttempts: optionalNumberArg(input, "maxHealAttempts") }
    );
  }
  if (candidates.length === 0) throw new Error("No ready executable cases were selected");
  const systemId = selectedSystemId;
  if (!systemId || !project.systemIds.includes(systemId)) {
    throw new Error("Requirement suite must use a system bound to the knowledge project");
  }
  const blockingKnowledgeGaps = context.repository.gaps.filter(
    (gap) =>
      gap.projectId === projectId &&
      gap.status === "open" &&
      ["requirement-clarification", "system-observation"].includes(gap.sourceType)
  );
  if (blockingKnowledgeGaps.length > 0) {
    return {
      mode: "requirement-suite",
      status: "blocked",
      knowledgeProjectId: projectId,
      systemId,
      gaps: blockingKnowledgeGaps,
      nextAction: "Resolve requirement or observed-system conflicts before execution."
    };
  }
  for (const candidate of candidates) {
    if (candidate.systemId && candidate.systemId !== systemId) {
      throw new Error(
        `Executable case ${candidate.id} was compiled for another business system`
      );
    }
    if (
      candidate.dataPlan?.requiresConfirmation &&
      !candidate.dataPlan.confirmedAt
    ) {
      context.knowledgeService.confirmExecutableCaseTestData(candidate.id);
    }
  }
  const executionPreflights = candidates.map((candidate) => {
    const prepared = context.executionPreflight.prepare({
      knowledgeProjectId: projectId,
      systemId,
      executableCaseId: candidate.id,
      authProfileId,
      confirm: false
    });
    return {
      executableCaseId: candidate.id,
      ...prepared,
      status: prepared.draft.verdict
    };
  });
  const blockedPreflights = executionPreflights.filter(
    (item) =>
      requirementSuitePreflightBlockers(
        context,
        candidates.find(
          (candidate) => candidate.id === item.executableCaseId
        )!,
        item.draft.checks
      ).length > 0
  );
  if (blockedPreflights.length > 0) {
    return {
      mode: "requirement-suite",
      status: "blocked",
      knowledgeProjectId: projectId,
      systemId,
      executionPreflight: executionPreflights[0],
      executionPreflights,
      nextAction:
        blockedPreflights.some(
          (item) =>
            requirementSuitePreflightBlockers(
              context,
              candidates.find(
                (candidate) => candidate.id === item.executableCaseId
              )!,
              item.draft.checks
            ).some((check) => check.status === "action-required")
        )
          ? "Confirm proposed execution inputs before retrying."
          : "Resolve execution preflight blockers before retrying."
    };
  }
  let requirementSuiteRun = context.requirementSuiteRuns.create({
    knowledgeProjectId: projectId,
    systemId,
    authProfileId,
    cases: candidates.map((candidate) => ({
      executableCaseId: candidate.id,
      title: candidate.title
    })),
    continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked"),
    allowCreateTestData: optionalBooleanArg(input, "allowCreateTestData"),
    maxHealAttempts: optionalNumberArg(input, "maxHealAttempts")
  });
  if (optionalBooleanArg(input, "resume")) {
    requirementSuiteRun = context.requirementSuiteRuns.resume(
      requirementSuiteRun.id,
      {
        continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked")
      }
    );
  }
  return executeNextRequirementSuiteCase(context, requirementSuiteRun.id, {
    maxHealAttempts: optionalNumberArg(input, "maxHealAttempts")
  });
}

async function controlRequirementSuite(
  context: BrainCreatorMcpContext,
  projectId: string,
  action: "cancel" | "retry" | "skip",
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const suiteId = optionalStringArg(input, "suiteId");
  const systemId = optionalStringArg(input, "systemId");
  const run = suiteId
    ? context.requirementSuiteRuns.get(suiteId)
    : context.requirementSuiteRuns
        .list(projectId)
        .filter((item) => !systemId || item.systemId === systemId)
        .at(-1);
  if (!run) throw new Error("Requirement suite run not found");
  if (run.knowledgeProjectId !== projectId) {
    throw new Error("Requirement suite run belongs to another knowledge project");
  }
  if (systemId && run.systemId !== systemId) {
    throw new Error("Requirement suite run belongs to another business system");
  }
  const requestedCaseId = optionalStringArg(input, "executableCaseId");
  const targetCase =
    requestedCaseId
      ? run.caseRuns.find((item) => item.executableCaseId === requestedCaseId)
      : [...run.caseRuns]
          .reverse()
          .find((item) =>
            action === "skip"
              ? item.status === "blocked"
              : item.status === "failed" || item.status === "blocked"
          );
  if (action !== "cancel" && !targetCase) {
    throw new Error(
      action === "retry"
        ? "No failed or blocked requirement suite case is available to retry"
        : "No blocked requirement suite case is available to skip"
    );
  }
  if (!optionalBooleanArg(input, "confirm")) {
    return {
      mode: "requirement-suite",
      status: "control-preview",
      action,
      requirementSuiteRun: run,
      targetCase,
      requiresConfirmation: true,
      nextAction: `Confirm the requirement suite ${action} action.`
    };
  }

  const updated =
    action === "cancel"
      ? context.requirementSuiteRuns.cancel(run.id)
      : action === "retry"
        ? context.requirementSuiteRuns.retry(
            run.id,
            targetCase!.executableCaseId
          )
        : context.requirementSuiteRuns.skip(
            run.id,
            targetCase!.executableCaseId
          );
  if (updated.status === "running") {
    return executeNextRequirementSuiteCase(context, updated.id, {
      maxHealAttempts:
        optionalNumberArg(input, "maxHealAttempts") ??
        updated.maxHealAttempts
    });
  }
  return {
    mode: "requirement-suite",
    status: updated.status,
    action,
    requirementSuiteRun: updated
  };
}

async function executeNextRequirementSuiteCase(
  context: BrainCreatorMcpContext,
  requirementSuiteRunId: string,
  input: { maxHealAttempts?: number }
): Promise<Record<string, unknown>> {
  let requirementSuiteRun = context.requirementSuiteRuns.get(
    requirementSuiteRunId
  );
  const activeCase = requirementSuiteRun.caseRuns.find(
    (item) =>
      item.status === "running" ||
      item.status === "waiting-for-test-data" ||
      item.status === "waiting-for-agent"
  );
  if (activeCase) {
    if (activeCase.status === "waiting-for-test-data") {
      const testDataTask = context.repository.testDataTasks.find(
        (task) => task.id === activeCase.testDataTaskId
      );
      if (!testDataTask || testDataTask.status !== "pending") {
        throw new Error(
          "Requirement suite is waiting for test data, but no pending TestDataTask exists"
        );
      }
      return requirementSuiteTestDataTaskPackage(
        requirementSuiteRun,
        activeCase.executableCaseId,
        testDataTask,
        activeCase.testDataPhase ?? "prepare"
      );
    }
    const pendingTask = context.repository.agentTasks.find(
      (task) =>
        task.status === "pending" &&
        task.chainContext?.requirementSuiteRunId === requirementSuiteRun.id &&
        task.chainContext.executableCaseId === activeCase.executableCaseId
    );
    if (pendingTask) {
      if (activeCase.status === "running") {
        const executionEvidenceId =
          pendingTask.chainContext?.executionEvidenceId ??
          activeCase.executionEvidenceId;
        if (!executionEvidenceId) {
          throw new Error(
            "Requirement suite AgentTask is missing execution evidence"
          );
        }
        requirementSuiteRun = context.requirementSuiteRuns.markWaiting(
          requirementSuiteRun.id,
          activeCase.executableCaseId,
          {
            testCaseId: pendingTask.chainContext!.testCaseId,
            agentTaskId: pendingTask.id,
            executionEvidenceId
          }
        );
      }
      return {
        ...taskPackageFromStoredTask(pendingTask),
        mode: "requirement-suite",
        stage: pendingTask.agent,
        specPath: pendingTask.chainContext?.specPath,
        seedPath: pendingTask.chainContext?.seedPath,
        testPath: pendingTask.chainContext?.testPath,
        requirementSuiteRun,
        currentExecutableCaseId: activeCase.executableCaseId
      };
    }
    if (activeCase.status === "waiting-for-agent") {
      throw new Error(
        "Requirement suite is waiting for an agent, but no pending AgentTask exists"
      );
    }
  }
  const started = context.requirementSuiteRuns.beginNext(
    requirementSuiteRun.id
  );
  requirementSuiteRun = started.run;
  if (!started.caseRun) {
    return {
      mode: "requirement-suite",
      status: requirementSuiteRun.status,
      requirementSuiteRun
    };
  }
  const executableCase = context.repository.executableCases.find(
    (item) =>
      item.id === started.caseRun!.executableCaseId &&
      item.knowledgeProjectId === requirementSuiteRun.knowledgeProjectId
  );
  if (!executableCase) throw new Error("Executable case not found");
  if (!executableCase.systemId) {
    executableCase.systemId = requirementSuiteRun.systemId;
    executableCase.updatedAt = new Date().toISOString();
    context.repository.persist();
  }
  const testDataPhase =
    started.caseRun.testDataPhase === "cleanup" &&
    started.caseRun.pendingOutcome
      ? "cleanup"
      : "prepare";
  const testDataPreparation = await context.testDataProvider.prepare({
    knowledgeProjectId: requirementSuiteRun.knowledgeProjectId,
    systemId: requirementSuiteRun.systemId,
    executableCaseId: executableCase.id,
    confirm: true,
    allowCreate: requirementSuiteRun.allowCreateTestData,
    phase: testDataPhase
  });
  if (testDataPreparation.task) {
    const waitingRun =
      context.requirementSuiteRuns.markWaitingForTestData(
        requirementSuiteRun.id,
        executableCase.id,
        {
          taskId: testDataPreparation.task.id,
          phase: testDataPhase,
          pendingOutcome: started.caseRun.pendingOutcome
        }
      );
    return requirementSuiteTestDataTaskPackage(
      waitingRun,
      executableCase.id,
      testDataPreparation.task,
      testDataPhase
    );
  }
  if (testDataPhase === "cleanup" && started.caseRun.pendingOutcome) {
    const cleanedRun = context.requirementSuiteRuns.completeCase(
      requirementSuiteRun.id,
      executableCase.id,
      started.caseRun.pendingOutcome
    );
    if (cleanedRun.status === "running") {
      return executeNextRequirementSuiteCase(context, cleanedRun.id, {
        maxHealAttempts: input.maxHealAttempts
      });
    }
    return {
      mode: "requirement-suite",
      status: cleanedRun.status,
      requirementSuiteRun: cleanedRun
    };
  }
  if (
    executableCase.dataPlan?.verdict === "ready" &&
    executableCase.dataPlan.requiresConfirmation &&
    !executableCase.dataPlan.confirmedAt
  ) {
    context.knowledgeService.confirmExecutableCaseTestData(
      executableCase.id
    );
  }
  const executionPreflight = context.executionPreflight.prepare({
    knowledgeProjectId: requirementSuiteRun.knowledgeProjectId,
    systemId: requirementSuiteRun.systemId,
    executableCaseId: executableCase.id,
    authProfileId: requirementSuiteRun.authProfileId,
    confirm: true
  });
  if (
    executionPreflight.status !== "ready" ||
    !executionPreflight.executionPlan
  ) {
    const reason =
      executionPreflight.draft.blockers.join("; ") ||
      "Execution preflight did not produce a ready execution plan";
    const gap = context.service.reportGap({
      projectId: requirementSuiteRun.systemId,
      sourceType: "requirement-suite-preflight",
      sourceId: requirementSuiteRun.id,
      reason,
      severity: "high",
      owner: "qa"
    });
    const blockedRun = context.requirementSuiteRuns.completeCase(
      requirementSuiteRun.id,
      executableCase.id,
      {
        status: "blocked",
        gapIds: [gap.id],
        failureType: classifyFailure(
          reason,
          "requirement-suite-preflight"
        ),
        error: reason
      }
    );
    return {
      mode: "requirement-suite",
      status: "blocked",
      executionPreflight,
      gap,
      requirementSuiteRun: blockedRun,
      nextAction:
        "Resolve the execution preflight Gap, then explicitly resume the requirement suite."
    };
  }
  const executionPlan = executionPreflight.executionPlan;
  context.requirementSuiteRuns.bindExecutionPlan(
    requirementSuiteRun.id,
    executableCase.id,
    executionPlan.id
  );
  return executeRequirementSuiteCase(context, {
    requirementSuiteRunId: requirementSuiteRun.id,
    executableCase,
    executionPlan,
    maxHealAttempts: input.maxHealAttempts
  });
}

async function executeRequirementSuiteCase(
  context: BrainCreatorMcpContext,
  input: {
    requirementSuiteRunId: string;
    executableCase: ExecutableCase;
    executionPlan: ExecutionPlan;
    maxHealAttempts?: number;
  }
): Promise<Record<string, unknown>> {
  const { executableCase, executionPlan } = input;
  const requirementSuiteRun = context.requirementSuiteRuns.get(
    input.requirementSuiteRunId
  );
  const projectId = requirementSuiteRun.knowledgeProjectId;
  const systemId = requirementSuiteRun.systemId;
  executableCase.systemId = systemId;
  executableCase.updatedAt = new Date().toISOString();
  context.repository.persist();
  const contextPack = executionPlan.contextPack;
  const contextPackPath = join(
    context.workDir,
    ".brain-creator",
    "knowledge-context",
    `${executionPlan.id}.json`
  );
  await mkdir(dirname(contextPackPath), { recursive: true });
  await writeFile(contextPackPath, `${JSON.stringify(contextPack, null, 2)}\n`, "utf8");
  const scenario: TestCaseScenario = {
    id: id("scenario"),
    title: executionPlan.title,
    priority: "high",
    steps: executionPlan.steps.map((step) => ({
      action: step.action === "api" ? "wait" : step.action,
      target: step.targetSemantic,
      value: step.value,
      expected: step.expected
    }))
  };
  const testCase = context.service.createTestCase({
    systemId,
    requirement: executionPlan.title,
    scenarios: [scenario],
    newTerms: [],
    ruleCheckResult: { passed: true, checks: [] }
  });
  context.service.approveTestCase(testCase.id);
  const executionEvidence = context.knowledgeService.createExecutionEvidence({
    projectId,
    systemId,
    executableCaseId: executableCase.id,
    executionPlanId: executionPlan.id,
    testCaseId: testCase.id,
    contextPackPath
  });
  const knowledgeContext = formatRequirementGeneratorContext(
    executionPlan,
    contextPack,
    executionEvidence.id,
    context.workDir
  );
  let result;
  try {
    result = await runApprovedChain(context, {
      caseId: testCase.id,
      authProfileId: requirementSuiteRun.authProfileId,
      maxHealAttempts: input.maxHealAttempts,
      knowledgeProjectId: projectId,
      executableCaseId: executableCase.id,
      executionPlanId: executionPlan.id,
      requirementSuiteRunId: requirementSuiteRun.id,
      executionEvidenceId: executionEvidence.id,
      contextPackPath,
      knowledgeContext
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await context.knowledgeService.completeExecutionEvidence(executionEvidence.id, {
      status: "blocked",
      actualResult: reason,
      artifactPaths: [contextPackPath]
    });
    const gap = context.service.reportGap({
      projectId: systemId,
      sourceType: "requirement-suite-run",
      sourceId: requirementSuiteRun.id,
      reason,
      severity: "high",
      owner: "qa"
    });
    return finalizeRequirementSuiteCase(context, {
      requirementSuiteRunId: requirementSuiteRun.id,
      executableCase,
      outcome: {
        status: "blocked",
        gapIds: [gap.id],
        failureType: classifyFailure(reason, "requirement-suite-run"),
        error: reason
      },
      completedCase: {
        mode: "requirement-suite",
        status: "blocked",
        knowledgeProjectId: projectId,
        executableCaseId: executableCase.id,
        executionPlan,
        contextPackPath,
        executionEvidence: context.repository.executionEvidence.find(
          (item) => item.id === executionEvidence.id
        ),
        gap
      },
      completionField: "completedCase",
      maxHealAttempts: input.maxHealAttempts
    });
  }
  if (
    "task" in result &&
    result.task?.status === "pending" &&
    !("chainRun" in result)
  ) {
    const waitingRun = context.requirementSuiteRuns.markWaiting(
      requirementSuiteRun.id,
      executableCase.id,
      {
        testCaseId: testCase.id,
        agentTaskId: result.task.id,
        executionEvidenceId: executionEvidence.id
      }
    );
    return {
      ...result,
      mode: "requirement-suite",
      knowledgeProjectId: projectId,
      executableCaseId: executableCase.id,
      executionPlan,
      contextPackPath,
      executionEvidence,
      requirementSuiteRun: waitingRun,
      remainingExecutableCaseIds: waitingRun.caseRuns
        .filter((item) => item.status === "queued")
        .map((item) => item.executableCaseId)
    };
  }
  const requirementFailure =
    "chainRun" in result && result.chainRun?.status === "failed"
      ? [
          "testResult" in result ? result.testResult?.stderr : undefined,
          "testResult" in result ? result.testResult?.stdout : undefined,
          result.chainRun.gaps.map((gap) => gap.reason).join("; ")
        ].find((value): value is string => Boolean(value?.trim()))
      : undefined;
  const requirementBug =
    requirementFailure && isDocumentExpectationFailure(requirementFailure) && "chainRun" in result
      ? createRequirementBugReport(context, {
          executableCase,
          chainRun: result.chainRun,
          failureReason: requirementFailure,
          artifactPaths: [contextPackPath, result.specPath, result.testPath].filter(
            (path): path is string => typeof path === "string"
          )
        })
      : undefined;
  if (requirementBug && "chainRun" in result) result.chainRun.gaps = [];
  const completedEvidence =
    "chainRun" in result && result.chainRun?.status !== "partial"
      ? await completeRequirementEvidence(
          context,
          executionEvidence.id,
          result.chainRun,
          "testResult" in result ? result.testResult : undefined,
          [contextPackPath, result.specPath, result.testPath].filter(
            (path): path is string => typeof path === "string"
          )
        )
      : executionEvidence;
  const caseStatus =
    "chainRun" in result && result.chainRun?.status === "succeeded"
      ? "passed"
      : requirementBug
        ? "failed"
        : "blocked";
  const outcome: RequirementSuiteCaseOutcome = {
    status: caseStatus,
    chainRunId:
      "chainRun" in result ? result.chainRun?.id : undefined,
    bugReportId: requirementBug?.id,
    gapIds:
      "chainRun" in result
        ? result.chainRun?.gaps.map((gap) => gap.id) ?? []
        : [],
    failureType:
      caseStatus === "passed"
        ? undefined
        : requirementBug
          ? "assertion_failure"
          : classifyFailure(
              requirementFailure ?? "Requirement suite execution blocked",
              "requirement-suite-run"
            ),
    error: requirementFailure
  };
  const completedCase = {
    ...result,
    executableCaseId: executableCase.id,
    executionPlan,
    contextPackPath,
    executionEvidence: completedEvidence,
    bugReport: requirementBug
  };
  return finalizeRequirementSuiteCase(context, {
    requirementSuiteRunId: requirementSuiteRun.id,
    executableCase,
    outcome,
    completedCase,
    completionField: "completedCase",
    maxHealAttempts: input.maxHealAttempts
  });
}

async function finalizeRequirementSuiteCase(
  context: BrainCreatorMcpContext,
  input: {
    requirementSuiteRunId: string;
    executableCase: ExecutableCase;
    outcome: RequirementSuiteCaseOutcome;
    completedCase: Record<string, unknown>;
    completionField: "completedCase" | "submittedCase";
    maxHealAttempts?: number;
  }
): Promise<Record<string, unknown>> {
  const run = context.requirementSuiteRuns.get(
    input.requirementSuiteRunId
  );
  let cleanup;
  try {
    cleanup = await context.testDataProvider.prepare({
      knowledgeProjectId: run.knowledgeProjectId,
      systemId: run.systemId,
      executableCaseId: input.executableCase.id,
      confirm: true,
      phase: "cleanup"
    });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);
    const gap = context.service.reportGap({
      projectId: run.systemId,
      sourceType: "test-data-cleanup",
      sourceId: run.id,
      reason: `Could not prepare test-data cleanup: ${reason}`,
      severity: "high",
      owner: "qa"
    });
    const blockedRun = context.requirementSuiteRuns.completeCase(
      run.id,
      input.executableCase.id,
      {
        status: "blocked",
        gapIds: [...input.outcome.gapIds, gap.id],
        failureType: classifyFailure(reason, "test-data-cleanup"),
        error: reason
      }
    );
    return {
      ...input.completedCase,
      mode: "requirement-suite",
      status: "blocked",
      gap,
      requirementSuiteRun: blockedRun
    };
  }
  if (cleanup.task) {
    const waitingRun =
      context.requirementSuiteRuns.markWaitingForTestData(
        run.id,
        input.executableCase.id,
        {
          taskId: cleanup.task.id,
          phase: "cleanup",
          pendingOutcome: input.outcome
        }
      );
    return {
      ...requirementSuiteTestDataTaskPackage(
        waitingRun,
        input.executableCase.id,
        cleanup.task,
        "cleanup"
      ),
      [input.completionField]: input.completedCase
    };
  }

  const updatedRun = context.requirementSuiteRuns.completeCase(
    run.id,
    input.executableCase.id,
    input.outcome
  );
  if (updatedRun.status === "running") {
    const next = await executeNextRequirementSuiteCase(
      context,
      updatedRun.id,
      { maxHealAttempts: input.maxHealAttempts }
    );
    return {
      ...next,
      [input.completionField]: input.completedCase,
      requirementSuiteRun: context.requirementSuiteRuns.get(updatedRun.id)
    };
  }
  return {
    ...input.completedCase,
    mode: "requirement-suite",
    status: updatedRun.status,
    requirementSuiteRun: updatedRun,
    remainingExecutableCaseIds: updatedRun.caseRuns
      .filter((item) => item.status === "queued")
      .map((item) => item.executableCaseId)
  };
}

function formatRequirementGeneratorContext(
  executionPlan: ExecutionPlan,
  contextPack: ReturnType<typeof buildContextPack>,
  evidenceId: string,
  workDir: string
) {
  const evidenceDir = join(workDir, ".brain-creator", "evidence", evidenceId);
  return [
    "## Brain Creator Knowledge Context",
    "",
    contextPack.content || "No additional confirmed knowledge was retrieved.",
    "",
    "### Context References",
    ...(contextPack.references.length > 0
      ? contextPack.references.map(
          (reference) =>
            `- ${reference.nodeId} [${reference.type}] sources=${reference.sourceRefs.join(",")}`
        )
      : ["- None"]),
    "",
    "## Executable Step Traceability",
    "",
    ...(executionPlan.preconditions.length > 0
      ? executionPlan.preconditions.map(
          (precondition) => `- Precondition: ${precondition}`
        )
      : ["- Preconditions: none"]),
    ...executionPlan.steps.map(
      (step) =>
        `- Step ${step.order} ${step.action}: ${step.instruction}; target=${step.targetSemantic}; dataProfile=${step.dataProfileId ?? "none"}; origin=${step.origin}; sources=${step.sourceRefs.join(",")}`
    ),
    "",
    "## Execution Plan",
    "",
    `- Plan ID: ${executionPlan.id}`,
    `- Snapshot hash: ${executionPlan.snapshotHash}`,
    `- System: ${executionPlan.systemId}`,
    `- Auth profile: ${executionPlan.auth?.profileId ?? "public-or-host-managed"}`,
    ...executionPlan.checks.map(
      (check) => `- ${check.id}: ${check.status}; ${check.message}`
    ),
    "",
    "## Test Data Plan",
    "",
    ...(executionPlan.dataBindings.length
      ? executionPlan.dataBindings.map((binding) =>
          [
            `- ${binding.field}: decision=${binding.decision}`,
            `value=${binding.decision === "resolve-secret" ? "[secret-reference]" : binding.value ?? "runtime"}`,
            `reference=${binding.reference ?? binding.secretRef ?? "none"}`,
            `lease=${binding.leaseId ?? "none"}`,
            `cleanup=${binding.cleanup}`,
            `sources=${binding.sourceRefs.join(",")}`
          ].join("; ")
        )
      : ["- No planned test data"]),
    "",
    "## Evidence Contract",
    "",
    "- Wrap each executable step in Playwright test.step with its step number and instruction.",
    ...executionPlan.steps.map(
      (step) =>
        `- After step ${step.order}, capture a screenshot at ${join(
          evidenceDir,
          `step-${String(step.order).padStart(2, "0")}.png`
        )}.`
    ),
    `- Record browser console errors and failed network requests under ${evidenceDir}.`,
    "- Keep requirement assertions explicit. Do not replace them with navigation-only checks.",
    "- Do not invent selectors or data. Fail with a precise evidence message when proof is unavailable."
  ].join("\n");
}

async function completeRequirementEvidence(
  context: BrainCreatorMcpContext,
  evidenceId: string,
  chainRun: ChainRun,
  testResult: CommandResult | undefined,
  baseArtifactPaths: string[]
) {
  const output = [testResult?.stdout, testResult?.stderr].filter(Boolean).join("\n").trim();
  const outputLines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const discoveredArtifacts = output.match(
    /(?:[a-z]:[\\/]|\.{0,2}[\\/])?[^\s"'<>]+\.(?:png|zip|har|webm)/gi
  ) ?? [];
  const artifactPaths = [...new Set([...baseArtifactPaths, ...discoveredArtifacts])];
  const status =
    chainRun.status === "succeeded"
      ? "passed"
      : chainRun.gaps.length > 0
        ? "blocked"
        : "failed";
  const actualResult =
    status === "passed"
      ? "Playwright assertions passed."
      : output || chainRun.gaps.map((gap) => gap.reason).join("; ") || "Execution failed.";
  return context.knowledgeService.completeExecutionEvidence(evidenceId, {
    status,
    chainRunId: chainRun.id,
    actualResult,
    artifactPaths,
    tracePaths: artifactPaths.filter((path) => /trace[^\\/]*\.zip$/i.test(path)),
    consoleErrors: outputLines.filter((line) => /console.*error/i.test(line)),
    networkFailures: outputLines.filter((line) =>
      /net::|network|request failed|response.*\b[45]\d\d\b/i.test(line)
    )
  });
}

function knowledgeStatus(context: BrainCreatorMcpContext, projectId: string) {
  const project = context.repository.knowledgeProjects.find((item) => item.id === projectId);
  if (!project) throw new Error("Knowledge project not found");
  const sources = context.repository.requirementSources.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const requirementSets = context.repository.requirementSets.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const activeRequirementSets = requirementSets.filter((item) => item.status !== "superseded");
  const nodes = context.repository.knowledgeNodes.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const testIntents = context.knowledgeService.listTestIntents(projectId);
  const executableCases = context.knowledgeService.listExecutableCases(projectId);
  const blockedDataPlans = executableCases.filter(
    (item) => item.dataPlan?.verdict === "blocked"
  );
  const executionEvidence = context.knowledgeService.listExecutionEvidence(projectId);
  const executionPlans = context.repository.executionPlans.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const requirementSuiteRuns = context.requirementSuiteRuns.list(projectId);
  const runLedgerEntries = context.runLedger.list({
    knowledgeProjectId: projectId
  });
  const activeRequirementSuiteRun = requirementSuiteRuns
    .filter(
      (item) =>
        item.status === "running" ||
        item.status === "waiting-for-test-data" ||
        item.status === "waiting-for-agent" ||
        item.status === "blocked"
    )
    .at(-1);
  const testDataTasks = context.repository.testDataTasks.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const testDataLeases = context.repository.testDataLeases.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const pendingTestDataTasks = testDataTasks.filter(
    (item) => item.status === "pending"
  );
  const cleanupDue = testDataLeases.filter(
    (lease) =>
      lease.decision === "create" &&
      lease.cleanup !== "none" &&
      (lease.status === "active" || lease.status === "cleanup-failed") &&
      executionEvidence.some(
        (evidence) =>
          evidence.executableCaseId === lease.executableCaseId &&
          evidence.status !== "running"
      )
  );
  const gaps = context.service.listGaps({ projectId, status: "open" });
  const evaluationGates = activeRequirementSets.flatMap((item) =>
    item.evaluationGate ? [item.evaluationGate] : []
  );
  const pendingEvalActions = evaluationGates.flatMap((gate) =>
    gate.actions.filter((action) => action.status === "pending")
  );
  const blockedEvalActions = evaluationGates.flatMap((gate) =>
    gate.actions.filter((action) => action.status === "blocked")
  );
  const systemBrains = project.systemIds.map((systemId) => {
    const brain = context.knowledgeService.getSystemBrain(projectId, systemId);
    const explorations = context.systemExploration.list(projectId, systemId);
    return {
      systemId,
      readiness: brain.readiness,
      pages: brain.pages.length,
      workflows: brain.workflows.length,
      behaviorRules: brain.behaviorRules.length,
      apiFlows: brain.apiFlows.length,
      navigationEdges: brain.navigationEdges.length,
      states: brain.states.length,
      stateTransitions: brain.stateTransitions.length,
      latestExploration: explorations.at(-1),
      conflicts: brain.conflicts.length
    };
  });
  const explorations = context.systemExploration.list(projectId);
  const runningExplorations = explorations.filter((item) => item.status === "running");
  const unresolvedExplorations = explorations.filter(
    (item) =>
      (item.status === "blocked" || item.status === "partial") &&
      item.gapIds.some((gapId) =>
        context.repository.gaps.some((gap) => gap.id === gapId && gap.status === "open")
      )
  );
  let nextAction = "generate_test_design";
  if (activeRequirementSuiteRun?.status === "waiting-for-test-data") {
    nextAction = "complete_requirement_suite_test_data_task";
  } else if (activeRequirementSuiteRun?.status === "waiting-for-agent") {
    nextAction = "complete_requirement_suite_agent_task";
  } else if (activeRequirementSuiteRun?.status === "blocked") {
    nextAction = "review_and_resume_requirement_suite";
  } else if (activeRequirementSuiteRun?.status === "running") {
    nextAction = "continue_requirement_suite";
  } else if (pendingTestDataTasks.length > 0) {
    nextAction = "complete_test_data_task";
  } else if (cleanupDue.length > 0) {
    nextAction = "prepare_test_data_cleanup";
  } else if (sources.length === 0) nextAction = "ingest_requirement";
  else if (blockedEvalActions.length > 0) nextAction = "revise_blocked_requirement";
  else if (pendingEvalActions.length > 0) nextAction = "confirm_requirement_eval";
  else if (activeRequirementSets.some((item) => item.status === "draft")) {
    nextAction = "review_and_approve_baseline";
  } else if (executableCases.some((item) => item.status === "ready")) {
    nextAction = project.systemIds.length > 0 ? "run_requirement_suite" : "bind_system";
  } else if (blockedDataPlans.length > 0) {
    nextAction = project.systemIds.length > 0 ? "prepare_test_data" : "resolve_test_data";
  } else if (testIntents.some((item) => item.status === "approved")) {
    if (project.systemIds.length === 0) nextAction = "bind_system";
    else if (runningExplorations.length > 0) nextAction = "review_system_exploration";
    else if (
      unresolvedExplorations.length > 0 &&
      !systemBrains.some((brain) => brain.readiness.readyForCompilation)
    ) {
      nextAction = "resolve_system_exploration_gap";
    }
    else if (!systemBrains.some((brain) => brain.readiness.readyForCompilation)) {
      nextAction = "explore_system";
    } else {
      nextAction = "compile_cases";
    }
  }
  return {
    knowledge: {
      project,
      sources: { total: sources.length, recent: sources.slice(-5) },
      requirementSets: {
        total: requirementSets.length,
        byStatus: countBy(requirementSets, (item) => item.status),
        recent: requirementSets.slice(-5)
      },
      evaluationGates: {
        total: evaluationGates.length,
        byStatus: countBy(evaluationGates, (item) => item.status),
        pendingActions: pendingEvalActions.length,
        blockedActions: blockedEvalActions.length
      },
      nodes: { total: nodes.length, byType: countBy(nodes, (item) => item.type) },
      testIntents: { total: testIntents.length, byStatus: countBy(testIntents, (item) => item.status) },
      executableCases: {
        total: executableCases.length,
        byStatus: countBy(executableCases, (item) => item.status),
        dataPlans: {
          byVerdict: countBy(
            executableCases.flatMap((item) => item.dataPlan ? [item.dataPlan] : []),
            (item) => item.verdict
          ),
          blocked: blockedDataPlans.map((item) => ({
            executableCaseId: item.id,
            reasons: item.dataPlan?.reasons ?? []
          }))
        }
      },
      executionEvidence: {
        total: executionEvidence.length,
        byStatus: countBy(executionEvidence, (item) => item.status)
      },
      executionPlans: {
        total: executionPlans.length,
        recent: executionPlans.slice(-5)
      },
      requirementSuiteRuns: {
        total: requirementSuiteRuns.length,
        byStatus: countBy(requirementSuiteRuns, (item) => item.status),
        active: activeRequirementSuiteRun,
        recent: requirementSuiteRuns.slice(-5)
      },
      runLedger: {
        total: runLedgerEntries.length,
        activeSummary:
          activeRequirementSuiteRun &&
          runLedgerEntries.some(
            (entry) =>
              entry.requirementSuiteRunId === activeRequirementSuiteRun.id
          )
          ? context.runLedger.summary(activeRequirementSuiteRun.id)
          : undefined,
        recent: runLedgerEntries.slice(-20)
      },
      testData: {
        tasks: {
          total: testDataTasks.length,
          byStatus: countBy(testDataTasks, (item) => item.status),
          pending: pendingTestDataTasks
        },
        leases: {
          total: testDataLeases.length,
          byStatus: countBy(testDataLeases, (item) => item.status),
          cleanupDue
        }
      },
      requirementEvalHistory: context.knowledgeService.requirementEvalAccuracy(projectId),
      explorations: {
        total: explorations.length,
        byStatus: countBy(explorations, (item) => item.status),
        running: runningExplorations,
        unresolved: unresolvedExplorations,
        recent: explorations.slice(-5)
      },
      systemBrains,
      openGaps: gaps
    },
    connectors: connectorStatus(context, projectId),
    nextAction
  };
}

function knowledgeReview(
  context: BrainCreatorMcpContext,
  projectId: string,
  target: KnowledgeReviewTarget,
  idValue?: string
) {
  const status = knowledgeStatus(context, projectId);
  const project = status.knowledge.project;
  if (target === "requirement") {
    const items = context.repository.requirementSets.filter(
      (item) => item.knowledgeProjectId === projectId && (!idValue || item.id === idValue)
    );
    return {
      project,
      items,
      impacts: items.map((item) => context.knowledgeService.requirementImpact(item.id))
    };
  }
  if (target === "test-intent") {
    return {
      project,
      items: context.knowledgeService
        .listTestIntents(projectId)
        .filter((item) => !idValue || item.id === idValue)
    };
  }
  if (target === "executable-case") {
    return {
      project,
      items: context.knowledgeService
        .listExecutableCases(projectId)
        .filter((item) => !idValue || item.id === idValue)
    };
  }
  if (target === "execution-plan") {
    return {
      project,
      items: context.repository.executionPlans.filter(
        (item) =>
          item.knowledgeProjectId === projectId &&
          (!idValue || item.id === idValue)
      )
    };
  }
  if (target === "requirement-suite-run") {
    return {
      project,
      items: context.requirementSuiteRuns
        .list(projectId)
        .filter((item) => !idValue || item.id === idValue)
    };
  }
  if (target === "run-ledger") {
    const entries = context.runLedger
      .list({ knowledgeProjectId: projectId })
      .filter(
        (entry) => !idValue || entry.requirementSuiteRunId === idValue
      );
    const runIds = [...new Set(
      entries.map((entry) => entry.requirementSuiteRunId)
    )];
    return {
      project,
      summaries: runIds.map((runId) => context.runLedger.summary(runId)),
      entries
    };
  }
  if (target === "coverage") {
    const intents = context.knowledgeService.listTestIntents(projectId);
    const sets = context.repository.requirementSets.filter(
      (item) => item.knowledgeProjectId === projectId && item.status !== "superseded"
    );
    return {
      project,
      requirements: sets.length,
      coveredRequirements: new Set(intents.map((item) => item.requirementSetId)).size,
      traceableIntents: intents.filter(
        (item) => item.requirementRefs.length > 0 && item.knowledgeNodeRefs.length > 0
      ).length,
      totalIntents: intents.length
    };
  }
  if (target === "requirement-eval-accuracy") {
    return {
      project,
      accuracy: context.knowledgeService.requirementEvalAccuracy(projectId, idValue)
    };
  }
  if (target === "system-brain") {
    if (!idValue) throw new Error("systemId is required to review System Brain");
    return {
      project,
      brain: context.knowledgeService.getSystemBrain(projectId, idValue)
    };
  }
  if (target === "system-exploration") {
    return {
      project,
      items: context.systemExploration
        .list(projectId)
        .filter((item) => !idValue || item.id === idValue)
    };
  }
  if (target === "evidence") {
    return {
      project,
      systems: project.systemIds,
      executionEvidence: context.knowledgeService.listExecutionEvidence(projectId),
      artifacts: project.systemIds.flatMap((systemId) => [
        ...context.service.listTestSpecs(systemId),
        ...context.service.listTestFiles(systemId),
        ...context.service.listChainRuns(systemId)
      ])
    };
  }
  return { ...status.knowledge };
}

function reportKnowledgeGap(
  context: BrainCreatorMcpContext,
  projectId: string,
  sourceId: string,
  reason: string
) {
  if (!context.repository.knowledgeProjects.some((item) => item.id === projectId)) {
    throw new Error("Knowledge project not found");
  }
  const now = new Date().toISOString();
  const gap: Gap = {
    id: id("gap"),
    projectId,
    sourceType: "requirement-connector",
    sourceId,
    reason,
    severity: "high",
    owner: "product",
    status: "open",
    createdAt: now,
    updatedAt: now
  };
  context.repository.gaps.push(gap);
  context.repository.persist();
  return gap;
}

function connectorStatus(context?: BrainCreatorMcpContext, projectId?: string) {
  const directConfigured = Boolean(
    process.env.BRAIN_CREATOR_FEISHU_APP_ID && process.env.BRAIN_CREATOR_FEISHU_APP_SECRET
  );
  const recentSource = context?.repository.requirementSources
    .filter((source) => source.sourceType === "feishu")
    .filter((source) => !projectId || source.knowledgeProjectId === projectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return {
    feishu: {
      hostMode: "available-via-content-package",
      directMode: directConfigured ? "configured" : "not-configured",
      readMode: directConfigured ? "openapi-with-host-fallback" : "host-content-package",
      credentialStorage: "environment-reference-only",
      lastSyncedAt: recentSource?.updatedAt,
      lastSourceId: recentSource?.id
    }
  };
}

function configuredFeishuReader(): RequirementSourceReader | undefined {
  const appId = process.env.BRAIN_CREATOR_FEISHU_APP_ID;
  const appSecret = process.env.BRAIN_CREATOR_FEISHU_APP_SECRET;
  return appId && appSecret ? new FeishuOpenApiAdapter({ appId, appSecret }) : undefined;
}

function isFeishuRequirementSource(source: string) {
  try {
    const hostname = new URL(source).hostname.toLowerCase();
    return hostname.endsWith(".feishu.cn") || hostname.endsWith(".larksuite.com");
  } catch {
    return false;
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
  if (context.agentBridge?.provider === "host-agent") {
    const prompt = await buildAgentPrompt({
      outputDir: join(context.workDir, "specs", "_context"),
      system,
      requirement,
      glossaryTerms: context.service.listGlossaryTerms({ projectId: systemId, query: "" }),
      businessRules: context.service.listBusinessRules(systemId),
      authProfiles: [authProfile]
    });
    const seed = await generateSeedFile({
      workDir: context.workDir,
      outputDir: join(context.workDir, "tests"),
      system,
      authProfile
    });
    await mkdir(dirname(specPath), { recursive: true });
    const taskPackage = await prepareAgentTask(context, {
      systemId,
      agent: "planner",
      inputSummary: requirement,
      args: ["--prompt", prompt.promptPath, "--seed", seed.seedPath, "--output", specPath],
      outputPaths: [specPath],
      planContext: {
        requirement,
        specPath,
        promptPath: prompt.promptPath,
        seedPath: seed.seedPath
      }
    });
    return {
      ...taskPackage,
      stage: "planner",
      promptPath: prompt.promptPath,
      seedPath: seed.seedPath,
      specPath
    };
  }
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
  const executionPlanId = optionalStringArg(input, "executionPlanId");
  const executionPlan = executionPlanId
    ? assertExecutionPlanIsCurrent(context, executionPlanId)
    : undefined;
  const bridgeCheck = await preflightAgentBridge(context.agentBridge);
  if (!bridgeCheck.ok) {
    throw new Error(`Agent bridge unavailable: ${bridgeCheck.error}`);
  }
  const testCase = context.service.getTestCase(stringArg(input, "caseId"));
  if (testCase.status !== "approved") {
    throw new Error("Test case must be approved before running chain");
  }
  const system = context.repository.systemProfiles.find((item) => item.id === testCase.systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  if (executionPlan && executionPlan.systemId !== testCase.systemId) {
    throw new Error("Execution plan belongs to another business system");
  }
  const authProfile = executionPlan?.auth
    ? findAuthProfileById(
        context,
        testCase.systemId,
        executionPlan.auth.profileId
      )
    : optionalStringArg(input, "authProfileId")
      ? findAuthProfileById(
          context,
          testCase.systemId,
          optionalStringArg(input, "authProfileId")!
        )
      : findAuthProfile(context, testCase.systemId);
  if (context.agentBridge?.provider === "host-agent") {
    const specsDir = join(context.workDir, "specs");
    const generatedDir = join(context.workDir, "tests", "generated");
    const specPath = join(specsDir, `${testCase.id}.md`);
    const testPath = join(generatedDir, `${testCase.id}.spec.ts`);
    await mkdir(specsDir, { recursive: true });
    await mkdir(generatedDir, { recursive: true });
    await writeFile(
      specPath,
      [formatScenariosAsMarkdown(testCase.scenarios), optionalStringArg(input, "knowledgeContext")]
        .filter(Boolean)
        .join("\n\n"),
      "utf8"
    );
    const seed = await generateSeedFile({
      workDir: context.workDir,
      outputDir: join(context.workDir, "tests"),
      system,
      authProfile
    });
    const taskPackage = await prepareAgentTask(context, {
      systemId: system.id,
      agent: "generator",
      inputSummary: testCase.requirement,
      args: ["--spec", specPath, "--seed", seed.seedPath, "--output", testPath],
      outputPaths: [testPath],
      chainContext: {
        testCaseId: testCase.id,
        specPath,
        seedPath: seed.seedPath,
        testPath,
        maxHealAttempts: optionalNumberArg(input, "maxHealAttempts") ?? 1,
        healAttempts: 0,
        knowledgeProjectId: optionalStringArg(input, "knowledgeProjectId"),
        executableCaseId: optionalStringArg(input, "executableCaseId"),
        executionPlanId: optionalStringArg(input, "executionPlanId"),
        requirementSuiteRunId: optionalStringArg(
          input,
          "requirementSuiteRunId"
        ),
        executionEvidenceId: optionalStringArg(input, "executionEvidenceId"),
        contextPackPath: optionalStringArg(input, "contextPackPath")
      },
      suiteContext: suiteContextArg(input)
    });
    return {
      ...taskPackage,
      mode: "host-agent",
      stage: "generator",
      testCase,
      specPath,
      seedPath: seed.seedPath,
      testPath
    };
  }
  const result = await runChain({
    workDir: context.workDir,
    system,
    authProfile,
    testCase,
    agentBridge: context.agentBridge,
    runner: context.runner,
    maxHealAttempts: optionalNumberArg(input, "maxHealAttempts"),
    knowledgeContext: optionalStringArg(input, "knowledgeContext")
  });
  context.service.recordAgentRun(result.generateRun);
  for (const healerRun of result.healerRuns) {
    context.service.recordAgentRun(healerRun);
  }
  context.service.recordChainRun(result.chainRun);
  return result;
}

/**
 * bc_full_workflow — 一键审批 + 执行。
 * 封装 bc_approve_plan → bc_run_chain，用于用户已审核计划、确认可执行的场景。
 * 不减损审批门禁：只对 draft 状态用例执行审批，等效于用户手动确认。
 */
async function fullWorkflow(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const caseId = stringArg(input, "caseId");
  const approved = context.service.approveTestCase(caseId);
  const chainInput = { ...input, caseId: approved.id };
  return runApprovedChain(context, chainInput);
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
    hasAwaitingAuth: authCheckpoints.some((checkpoint) => checkpoint.status === "awaiting-user"),
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
  hasAwaitingAuth: boolean;
  hasRules: boolean;
  hasApprovedCases: boolean;
  hasFailedCases: boolean;
  hasOpenGaps: boolean;
  bridgeOk: boolean;
}): string {
  if (!state.hasAuth) {
    return "complete_onboarding: 配置鉴权 (bc_create_auth)";
  }
  if (state.hasAwaitingAuth) {
    return "complete_auth_checkpoint: complete the pending manual authentication step";
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
    workDir: context.workDir,
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

async function prepareAgentTask(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>
): Promise<HostAgentTaskPackage> {
  const systemId = stringArg(input, "systemId");
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  const taskId = id("agentTask");
  const taskDir = join(context.workDir, ".brain-creator", "agent-tasks", taskId);
  const promptPath = join(taskDir, "input.prompt.md");
  const contextPath = join(taskDir, "input.context.json");
  const agent = agentArg(input, "agent");
  const args = stringArrayArg(input, "args");
  const outputPaths = stringArrayArg(input, "outputPaths");
  const inputSummary = stringArg(input, "inputSummary");
  const planContext = planContextArg(input);
  const chainContext = chainContextArg(input);
  const suiteContext = suiteContextArg(input);
  const task = context.service.createAgentTask({
    id: taskId,
    systemId,
    agent,
    inputSummary,
    args,
    outputPaths,
    promptPath,
    contextPath,
    planContext,
    chainContext,
    suiteContext
  });
  await mkdir(taskDir, { recursive: true });
  await writeFile(promptPath, hostAgentPrompt({ systemId, agent, inputSummary, args, outputPaths }), "utf8");
  await writeFile(
    contextPath,
    `${JSON.stringify(
      {
        taskId,
        systemId,
        system,
        agent,
        inputSummary,
        args,
        outputPaths,
        planContext,
        chainContext,
        suiteContext,
        workDir: context.workDir,
        submitTool: "bc_submit_agent_output"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return {
    status: "needs_agent_execution",
    task,
    promptPath,
    contextPath,
    outputPaths,
    submitTool: "bc_submit_agent_output",
    nextAction: "The host agent should read the prompt/context, create requested outputs, then call bc_submit_agent_output."
  };
}

function taskPackageFromStoredTask(task: AgentTask): HostAgentTaskPackage {
  return {
    status: "needs_agent_execution",
    task,
    promptPath: task.promptPath,
    contextPath: task.contextPath,
    outputPaths: task.outputPaths,
    submitTool: task.submitTool,
    nextAction:
      "The host agent should read the prompt/context, create requested outputs, then call bc_submit_agent_output."
  };
}

function requirementSuiteTestDataTaskPackage(
  requirementSuiteRun: RequirementSuiteRun,
  executableCaseId: string,
  task: TestDataTask,
  phase: "prepare" | "cleanup"
): Record<string, unknown> {
  return {
    mode: "requirement-suite",
    status: "needs_test_data",
    stage:
      phase === "cleanup"
        ? "test-data-cleanup"
        : "test-data-prepare",
    task,
    contextPath: task.contextPath,
    promptPath: task.promptPath,
    submitTool: "bc_prepare",
    submitInput: {
      action: "submit-test-data",
      taskId: task.id
    },
    currentExecutableCaseId: executableCaseId,
    requirementSuiteRun,
    nextAction:
      phase === "cleanup"
        ? "Complete the cleanup task and submit evidence before the suite advances."
        : "Complete the test-data task and submit its decision and evidence before generation."
  };
}

async function continueRequirementSuiteAfterTestData(
  context: BrainCreatorMcpContext,
  submitted: TestDataSubmitResult
): Promise<Record<string, unknown>> {
  const matched = context.repository.requirementSuiteRuns
    .flatMap((run) =>
      run.caseRuns.map((caseRun) => ({ run, caseRun }))
    )
    .find(({ caseRun }) => caseRun.testDataTaskId === submitted.task.id);
  if (!matched) return submitted as unknown as Record<string, unknown>;

  if (submitted.task.status === "failed") {
    const gapIds = submitted.gap ? [submitted.gap.id] : [];
    const blockedRun = context.requirementSuiteRuns.failTestDataTask(
      matched.run.id,
      matched.caseRun.executableCaseId,
      {
        gapIds,
        error:
          submitted.task.error ??
          "Requirement suite test-data task failed"
      }
    );
    return {
      mode: "requirement-suite",
      status: "blocked",
      stage:
        matched.caseRun.testDataPhase === "cleanup"
          ? "test-data-cleanup"
          : "test-data-prepare",
      submittedTestData: submitted,
      gap: submitted.gap,
      requirementSuiteRun: blockedRun,
      nextAction:
        "Resolve the test-data Gap, then explicitly resume the requirement suite to retry the same case."
    };
  }

  const continuedRun = context.requirementSuiteRuns.completeTestDataTask(
    matched.run.id,
    matched.caseRun.executableCaseId
  );
  if (continuedRun.status === "running") {
    const next = await executeNextRequirementSuiteCase(
      context,
      continuedRun.id,
      { maxHealAttempts: continuedRun.maxHealAttempts }
    );
    return {
      ...next,
      submittedTestData: submitted,
      requirementSuiteRun: context.requirementSuiteRuns.get(continuedRun.id)
    };
  }
  return {
    mode: "requirement-suite",
    status: continuedRun.status,
    submittedTestData: submitted,
    requirementSuiteRun: continuedRun
  };
}

async function submitAgentOutput(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const taskId = stringArg(input, "taskId");
  const pendingTask = context.repository.agentTasks.find(
    (item) => item.id === taskId
  );
  if (!pendingTask) throw new Error("Agent task not found");
  if (pendingTask.status !== "pending") {
    throw new Error("Agent task already submitted");
  }
  if (pendingTask.chainContext?.executionPlanId) {
    assertExecutionPlanIsCurrent(
      context,
      pendingTask.chainContext.executionPlanId
    );
  }
  const result = context.service.submitAgentTask({
    taskId,
    status: agentOutputStatusArg(input, "status"),
    stdout: optionalStringArg(input, "stdout") ?? "",
    stderr: optionalStringArg(input, "stderr") ?? "",
    outputPaths: optionalStringArrayArg(input, "outputPaths")
  });
  if (result.task.planContext) {
    return finalizeHostAgentPlan(context, result);
  }
  const { chainContext } = result.task;
  if (!chainContext) {
    return result;
  }
  const testResult =
    result.agentRun.status === "succeeded" &&
    (result.task.agent === "generator" || result.task.agent === "healer")
      ? await runSubmittedTest(context, chainContext.testPath)
      : undefined;
  const healAttempts = chainContext.healAttempts ?? 0;
  const maxHealAttempts = chainContext.maxHealAttempts ?? 1;
  if (
    (result.task.agent === "generator" || result.task.agent === "healer") &&
    testResult &&
    testResult.exitCode !== 0 &&
    healAttempts < maxHealAttempts
  ) {
    const chainRun: ChainRun = {
      id: id("chain"),
      systemId: result.task.systemId,
      testCaseId: chainContext.testCaseId,
      status: "partial",
      generateRunId:
        result.task.agent === "generator" ? result.agentRun.id : chainContext.generateRunId,
      healRunId: result.task.agent === "healer" ? result.agentRun.id : undefined,
      specPath: chainContext.specPath,
      testPath: chainContext.testPath,
      gaps: [],
      createdAt: result.agentRun.createdAt,
      completedAt: new Date().toISOString()
    };
    context.service.recordChainRun(chainRun);
    const failureOutput = testResult.stderr || testResult.stdout || "Generated test failed";
    const healerTaskPackage = await prepareAgentTask(context, {
      systemId: result.task.systemId,
      agent: "healer",
      inputSummary: `Heal ${result.task.inputSummary}: ${failureOutput}`,
      args: [
        "--test",
        chainContext.testPath,
        ...(chainContext.seedPath ? ["--seed", chainContext.seedPath] : []),
        "--error",
        failureOutput
      ],
      outputPaths: [chainContext.testPath],
      chainContext: {
        ...chainContext,
        generateRunId:
          result.task.agent === "generator" ? result.agentRun.id : chainContext.generateRunId,
        healAttempts: healAttempts + 1
      },
      suiteContext: result.task.suiteContext
    });
    if (
      chainContext.requirementSuiteRunId &&
      chainContext.executableCaseId &&
      chainContext.executionEvidenceId
    ) {
      context.requirementSuiteRuns.markWaiting(
        chainContext.requirementSuiteRunId,
        chainContext.executableCaseId,
        {
          testCaseId: chainContext.testCaseId,
          agentTaskId: healerTaskPackage.task.id,
          executionEvidenceId: chainContext.executionEvidenceId
        }
      );
    }
    return {
      ...result,
      ...healerTaskPackage,
      stage: "healer",
      chainRun,
      testResult
    };
  }
  const status =
    result.agentRun.status === "succeeded" && (!testResult || testResult.exitCode === 0)
      ? "succeeded"
      : "failed";
  const failureReason =
    status === "failed"
      ? hostAgentFailureReason(result.task.agent, result.agentRun.error, testResult)
      : undefined;
  const chainRunId = id("chain");
  const artifactPaths = [chainContext.specPath, chainContext.testPath];
  const bugReport =
    status === "failed" && failureReason
      ? await maybeCreateHostAgentBugReport(context, {
          task: result.task,
          chainRunId,
          failureReason,
          artifactPaths
        })
      : undefined;
  const gaps =
    status === "failed" && !bugReport && failureReason
      ? [
          context.service.reportGap({
            projectId: result.task.systemId,
            sourceType:
              result.task.agent === "healer" ? "host-agent-healer" : "host-agent-generator",
            sourceId: result.task.id,
            reason: failureReason,
            severity: "high",
            owner: "qa"
          })
        ]
      : [];
  const chainRun: ChainRun = {
    id: chainRunId,
    systemId: result.task.systemId,
    testCaseId: chainContext.testCaseId,
    status,
    generateRunId: result.task.agent === "healer" ? chainContext.generateRunId : result.agentRun.id,
    healRunId: result.task.agent === "healer" ? result.agentRun.id : undefined,
    specPath: chainContext.specPath,
    testPath: chainContext.testPath,
    gaps,
    createdAt: result.agentRun.createdAt,
    completedAt: new Date().toISOString()
  };
  context.service.recordChainRun(chainRun);
  if (chainContext.executionEvidenceId) {
    await completeRequirementEvidence(
      context,
      chainContext.executionEvidenceId,
      chainRun,
      testResult,
      [chainContext.contextPackPath, chainContext.specPath, chainContext.testPath].filter(
        (path): path is string => typeof path === "string"
      )
    );
  }
  if (
    chainContext.requirementSuiteRunId &&
    chainContext.executableCaseId
  ) {
    const requirementCaseStatus =
      status === "succeeded"
        ? "passed"
        : bugReport
          ? "failed"
          : "blocked";
    const completedCase = {
      task: result.task,
      agentRun: result.agentRun,
      chainRun,
      testResult,
      bugReport,
      gaps
    };
    const executableCase = context.repository.executableCases.find(
      (item) => item.id === chainContext.executableCaseId
    );
    if (!executableCase) {
      throw new Error("Requirement suite executable case not found");
    }
    return finalizeRequirementSuiteCase(context, {
      requirementSuiteRunId: chainContext.requirementSuiteRunId,
      executableCase,
      outcome: {
        status: requirementCaseStatus,
        chainRunId: chainRun.id,
        bugReportId: bugReport?.id,
        gapIds: gaps.map((gap) => gap.id),
        error: failureReason
      },
      completedCase,
      completionField: "submittedCase",
      maxHealAttempts: chainContext.maxHealAttempts
    });
  }
  const suiteRun = result.task.suiteContext
    ? context.service.recordCaseSuiteRun({
        systemId: result.task.systemId,
        suiteId: result.task.suiteContext.suiteId,
        sourceId: result.task.suiteContext.sourceId,
        status: status === "succeeded" ? "completed" : bugReport ? "failed" : "blocked",
        total: 1,
        passed: status === "succeeded" ? 1 : 0,
        failed: status === "failed" && bugReport ? 1 : 0,
        blocked: status === "failed" && !bugReport ? 1 : 0,
        caseResults: [
          {
            caseNo: result.task.suiteContext.caseNo,
            title: result.task.suiteContext.title,
            status: status === "succeeded" ? "passed" : bugReport ? "failed" : "blocked",
            testCaseId: chainContext.testCaseId,
            chainRunId: chainRun.id,
            bugReportId: bugReport?.id,
            gapIds: gaps.map((gap) => gap.id),
            error: failureReason
          }
        ],
        artifactPaths,
        bugReportIds: bugReport ? [bugReport.id] : [],
        gapIds: gaps.map((gap) => gap.id),
        completedAt: new Date().toISOString()
      })
    : undefined;
  if (suiteRun) {
    const suite = context.service.getCaseSuite(suiteRun.suiteId);
    const passed = passedCaseNosForSuite(context, suiteRun.systemId, suiteRun.suiteId);
    if (suite.selectedCaseNos.every((caseNo) => passed.has(caseNo))) {
      const completedSuite = context.service.updateCaseSuiteStatus(suiteRun.suiteId, "completed");
      return {
        ...result,
        status: "completed",
        chainRun,
        suiteRun,
        suite: completedSuite,
        testResult
      };
    }
    if (
      suite.continueOnBlocked !== true &&
      (suiteRun.status === "blocked" ||
        (suiteRun.gapIds.length > 0 && suiteRun.bugReportIds.length === 0))
    ) {
      const blockedSuite = context.service.updateCaseSuiteStatus(suiteRun.suiteId, "blocked");
      return {
        ...result,
        status: "blocked",
        chainRun,
        suiteRun,
        suite: blockedSuite,
        testResult
      };
    }
    const nextTask = await prepareNextHostAgentSuiteTask(
      context,
      suiteRun.suiteId,
      result.task.chainContext?.maxHealAttempts
    );
    if (nextTask) {
      return {
        ...result,
        submittedTask: result.task,
        submittedAgentRun: result.agentRun,
        chainRun,
        suiteRun,
        testResult,
        ...nextTask
      };
    }
    const finalStatus = hostAgentSuiteFailureStatus(context, suite);
    const failedSuite = context.service.updateCaseSuiteStatus(suiteRun.suiteId, finalStatus);
    return {
      ...result,
      status: finalStatus,
      chainRun,
      suiteRun,
      suite: failedSuite,
      testResult
    };
  }
  return { ...result, chainRun, testResult };
}

function assertExecutionPlanIsCurrent(
  context: BrainCreatorMcpContext,
  executionPlanId: string
) {
  const validation = context.executionPreflight.validatePlan(executionPlanId);
  if (!validation.valid) {
    throw new Error(
      `Execution plan is ${validation.status}: ${validation.reasons.join("; ")}`
    );
  }
  return validation.executionPlan;
}

async function finalizeHostAgentPlan(
  context: BrainCreatorMcpContext,
  result: { task: AgentTask; agentRun: AgentRun }
) {
  const planContext = result.task.planContext;
  if (!planContext) {
    return result;
  }
  if (result.agentRun.status !== "succeeded") {
    const gap = context.service.reportGap({
      projectId: result.task.systemId,
      sourceType: "host-agent-planner",
      sourceId: result.task.id,
      reason: result.agentRun.error ?? "Host-agent planner failed",
      severity: "high",
      owner: "qa"
    });
    return { ...result, status: "blocked", stage: "planner", gap };
  }

  let specContent: string;
  try {
    specContent = await readFile(planContext.specPath, "utf8");
  } catch (error) {
    const gap = context.service.reportGap({
      projectId: result.task.systemId,
      sourceType: "host-agent-planner",
      sourceId: result.task.id,
      reason: `Planner did not create the requested spec output: ${error instanceof Error ? error.message : String(error)}`,
      severity: "high",
      owner: "qa"
    });
    return { ...result, status: "blocked", stage: "planner", gap };
  }
  const scenarios = parseSpecMarkdown(specContent);
  if (scenarios.length === 0) {
    const gap = context.service.reportGap({
      projectId: result.task.systemId,
      sourceType: "host-agent-planner",
      sourceId: result.task.id,
      reason: "Planner output did not contain any executable scenarios.",
      severity: "high",
      owner: "qa"
    });
    return { ...result, status: "blocked", stage: "planner", gap };
  }

  const glossaryTerms = context.service.listGlossaryTerms({
    projectId: result.task.systemId,
    query: ""
  });
  const businessRules = context.service.listBusinessRules(result.task.systemId);
  const ruleCheckResult = checkBusinessRules({ specContent, rules: businessRules });
  const newTerms = extractCandidateTerms({
    systemId: result.task.systemId,
    specContent,
    existingTerms: glossaryTerms,
    pageScope: "/"
  });
  const testCase = context.service.createTestCase({
    systemId: result.task.systemId,
    requirement: planContext.requirement,
    scenarios,
    newTerms,
    ruleCheckResult
  });
  return {
    ...result,
    status: "plan_ready",
    stage: "planner",
    specPath: planContext.specPath,
    promptPath: planContext.promptPath,
    seedPath: planContext.seedPath,
    scenarios,
    newTerms,
    ruleCheckResult,
    testCase
  };
}

async function maybeCreateHostAgentBugReport(
  context: BrainCreatorMcpContext,
  input: {
    task: AgentTask;
    chainRunId: string;
    failureReason: string;
    artifactPaths: string[];
  }
) {
  if (
    input.task.chainContext?.executableCaseId &&
    isDocumentExpectationFailure(input.failureReason)
  ) {
    const executableCase = context.repository.executableCases.find(
      (item) => item.id === input.task.chainContext?.executableCaseId
    );
    if (executableCase) {
      return createRequirementBugReport(context, {
        executableCase,
        chainRun: {
          id: input.chainRunId,
          systemId: input.task.systemId,
          testCaseId: input.task.chainContext.testCaseId,
          status: "failed",
          gaps: [],
          createdAt: input.task.createdAt
        },
        failureReason: input.failureReason,
        artifactPaths: input.artifactPaths
      });
    }
  }
  if (
    !input.task.suiteContext ||
    !isDocumentExpectationFailure(input.failureReason)
  ) {
    return undefined;
  }
  const source = context.service
    .listCaseSources(input.task.systemId)
    .find((item) => item.id === input.task.suiteContext?.sourceId);
  if (!source) {
    return undefined;
  }
  let documentCase: DocumentCase | undefined;
  try {
    const parsed = await parseCaseSource(source.source);
    documentCase = parsed.cases.find((item) => item.caseNo === input.task.suiteContext?.caseNo);
  } catch {
    return undefined;
  }
  if (!documentCase) {
    return undefined;
  }
  return context.service.createBugReport({
    systemId: input.task.systemId,
    sourceId: source.id,
    caseNo: documentCase.caseNo,
    caseTitle: documentCase.title,
    module: documentCase.module,
    priority: documentCase.priority,
    expectedResult: documentCase.expectedResult,
    actualResult: input.failureReason,
    reproductionSteps: reproductionSteps(documentCase),
    evidencePaths: input.artifactPaths,
    chainRunId: input.chainRunId,
    gapIds: []
  });
}

function isDocumentExpectationFailure(reason: string) {
  if (
    isEnvironmentConfigurationFailure(reason) ||
    isGeneratedTestImplementationFailure(reason)
  ) {
    return false;
  }
  return /\b(expected|actual|assert|assertion|toBe|toEqual|toContain|not visible)\b/i.test(
    reason
  );
}

function hostAgentFailureReason(
  agent: AgentRun["agent"],
  agentError: string | undefined,
  testResult: Awaited<ReturnType<typeof runSubmittedTest>> | undefined
) {
  const detail = [agentError, testResult?.stderr, testResult?.stdout].find(
    (value): value is string => Boolean(value?.trim())
  ) ?? "Host agent task failed";
  if (agent === "healer") {
    return `Playwright still failing after healer: ${detail}`;
  }
  if (agent === "generator" && testResult) {
    return `Playwright failed after generator: ${detail}`;
  }
  return detail;
}

async function runSubmittedTest(context: BrainCreatorMcpContext, testPath: string) {
  const runner = context.runner ?? spawnCommand;
  const testRunPath = relative(context.workDir, testPath).replace(/\\/g, "/");
  try {
    return await runner("npx", ["playwright", "test", testRunPath], {
      cwd: context.workDir
    });
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error)
    };
  }
}

function hostAgentPrompt(input: {
  systemId: string;
  agent: AgentRun["agent"];
  inputSummary: string;
  args: string[];
  outputPaths: string[];
}) {
  return [
    `# Brain Creator Host Agent Task`,
    "",
    `Agent: ${input.agent}`,
    `System id: ${input.systemId}`,
    `Task: ${input.inputSummary}`,
    "",
    "Execution contract:",
    "- Execute this task as the current host agent; do not start a Claude or Codex subprocess.",
    "- Do not ask the user for permission or clarification during this task.",
    "- Keep secrets out of stdout and summaries.",
    "- Write every requested output file exactly where specified.",
    ...(input.agent === "generator" || input.agent === "healer"
      ? [
          "- When Arguments include --seed, import test and expect from that seed instead of @playwright/test; the seed owns authenticated browser setup."
        ]
      : []),
    "",
    "Arguments:",
    input.args.length > 0 ? input.args.join(" ") : "(none)",
    "",
    "Expected output paths:",
    input.outputPaths.length > 0 ? input.outputPaths.join("\n") : "(none)",
    "",
    "When complete, call `bc_submit_agent_output` with this task id and status."
  ].join("\n");
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

function suiteRunReview(
  context: BrainCreatorMcpContext,
  systemId: string,
  id?: string,
  failureTypes = new Set<FailureType>()
) {
  const runs = context.service
    .listCaseSuiteRuns(systemId)
    .filter((run) => id === undefined || run.id === id || run.suiteId === id);
  const bugIds = new Set(runs.flatMap((run) => run.bugReportIds));
  const gapIds = new Set(
    runs.flatMap((run) => [
      ...run.gapIds,
      ...run.caseResults.flatMap((caseResult) => caseResult.gapIds)
    ])
  );
  const bugReports = context.service
    .listBugReports({ systemId })
    .filter((bug) => bugIds.has(bug.id))
    .filter((bug) => matchesFailureTypes(classifyFailure(bug.actualResult), failureTypes));
  const gaps = context.service
    .listGaps({ projectId: systemId })
    .filter((gap) => gapIds.has(gap.id))
    .filter((gap) => matchesFailureTypes(classifyFailure(gap.reason, gap.sourceType), failureTypes));
  const filteredBugIds = new Set(bugReports.map((bug) => bug.id));
  const filteredGapIds = new Set(gaps.map((gap) => gap.id));
  const failedCases = runs.flatMap((run) =>
    run.caseResults
      .filter((caseResult) => caseResult.status !== "passed")
      .filter(
        (caseResult) =>
          failureTypes.size === 0 ||
          (caseResult.bugReportId !== undefined && filteredBugIds.has(caseResult.bugReportId)) ||
          caseResult.gapIds.some((gapId) => filteredGapIds.has(gapId))
      )
      .map((caseResult) => ({
        suiteRunId: run.id,
        suiteId: run.suiteId,
        sourceId: run.sourceId,
        caseNo: caseResult.caseNo,
        title: caseResult.title,
        status: caseResult.status,
        bugReportId: caseResult.bugReportId,
        gapIds: caseResult.gapIds,
        error: caseResult.error
      }))
  );
  const summary = suiteRunSummary(runs, bugReports, gaps);
  return {
    summary,
    runs,
    failedCases,
    bugReports,
    gaps,
    reportMarkdown: suiteRunMarkdown(summary, failedCases, bugReports, gaps),
    nextAction: suiteRunNextAction(bugReports, gaps)
  };
}

function suiteRunSummary(runs: CaseSuiteRun[], bugReports: BugReport[], gaps: Gap[]) {
  const latest = runs.at(-1);
  const failed = sumBy(runs, (run) => run.failed);
  const blocked = sumBy(runs, (run) => run.blocked);
  const byType = failureTypeCounts([
    ...bugReports.map((bug) => classifyFailure(bug.actualResult)),
    ...gaps.map((gap) => classifyFailure(gap.reason, gap.sourceType))
  ]);
  return {
    totalRuns: runs.length,
    totalCases: sumBy(runs, (run) => run.total),
    passed: sumBy(runs, (run) => run.passed),
    failed,
    blocked,
    bugReports: bugReports.length,
    gaps: gaps.length,
    failureClassification: {
      businessBugs: bugReports.length,
      evidenceGaps: gaps.length,
      failedCases: failed,
      blockedCases: blocked,
      byType
    },
    latestStatus: latest?.status,
    byStatus: countBy(runs, (run) => run.status)
  };
}

function suiteRunMarkdown(
  summary: ReturnType<typeof suiteRunSummary>,
  failedCases: Array<{
    caseNo: string;
    title: string;
    status: string;
    bugReportId?: string;
    gapIds: string[];
    error?: string;
  }>,
  bugReports: BugReport[],
  gaps: Gap[]
) {
  const lines = [
    "## Suite Run Summary",
    "",
    `Runs: ${summary.totalRuns}`,
    `Cases: ${summary.totalCases}`,
    `Passed: ${summary.passed}`,
    `Failed: ${summary.failed}`,
    `Blocked: ${summary.blocked}`,
    `BugReports: ${summary.bugReports}`,
    `Gaps: ${summary.gaps}`,
    ""
  ];
  if (failedCases.length > 0) {
    lines.push("### Failed / Blocked Cases", "");
    for (const item of failedCases) {
      lines.push(
        `- ${item.caseNo} ${item.title} [${item.status}]` +
          `${item.bugReportId ? ` bug=${item.bugReportId}` : ""}` +
          `${item.gapIds.length > 0 ? ` gaps=${item.gapIds.join(",")}` : ""}` +
          `${item.error ? ` error=${item.error}` : ""}`
      );
    }
    lines.push("");
  }
  if (bugReports.length > 0) {
    lines.push("### BugReports", "");
    for (const bug of bugReports) {
      lines.push(`- ${bug.caseNo} ${bug.caseTitle} [${bug.status}] ${bug.actualResult}`);
    }
    lines.push("");
  }
  if (gaps.length > 0) {
    lines.push("### Gaps", "");
    for (const gap of gaps) {
      lines.push(`- ${gap.id} [${gap.status}] ${gap.reason}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function suiteRunNextAction(bugReports: BugReport[], gaps: Gap[]) {
  if (bugReports.some((bug) => bug.status === "open" || bug.status === "retest-failed")) {
    return "review_bugs";
  }
  if (gaps.some((gap) => gap.status === "open")) {
    return "review_gaps";
  }
  return "no_action";
}

function suiteRunReviewSummary(review: ReturnType<typeof suiteRunReview>) {
  return {
    title: "Suite Run Review",
    status: review.summary.latestStatus ?? "empty",
    metrics: review.summary,
    evidencePaths: uniqueStrings(review.runs.flatMap((run) => run.artifactPaths)),
    nextAction: review.nextAction,
    userMessage:
      `Suite review: ${review.summary.totalCases} cases, ` +
      `${review.summary.passed} passed, ${review.summary.failed} failed, ` +
      `${review.summary.blocked} blocked; ` +
      `${review.summary.failureClassification.businessBugs} business bugs, ` +
      `${review.summary.failureClassification.evidenceGaps} evidence gaps.`
  };
}

function bugReviewResultSummary(
  summary: ReturnType<typeof bugReviewSummary>,
  bugs: BugReport[],
  nextAction: string
) {
  return {
    title: "Bug Review",
    status: summary.open > 0 || summary.retestFailed > 0 ? "action_required" : "completed",
    metrics: summary,
    evidencePaths: uniqueStrings(bugs.flatMap((bug) => bug.evidencePaths)),
    nextAction,
    userMessage:
      `Bug review: ${summary.open} open, ${summary.retestFailed} retest failed, ` +
      `${summary.retestPassed} retest passed.`
  };
}

function gapReviewSummary(gaps: Gap[]) {
  const metrics = {
    total: gaps.length,
    open: gaps.filter((gap) => gap.status === "open").length,
    resolved: gaps.filter((gap) => gap.status === "resolved").length,
    bySeverity: countBy(gaps, (gap) => gap.severity),
    byFailureType: failureTypeCounts(gaps.map((gap) => classifyFailure(gap.reason, gap.sourceType)))
  };
  return {
    title: "Gap Review",
    status: metrics.open > 0 ? "action_required" : "completed",
    metrics,
    evidencePaths: [],
    nextAction: metrics.open > 0 ? "resolve_gaps" : "no_action",
    userMessage: `Gap review: ${metrics.open} open, ${metrics.resolved} resolved.`
  };
}

function artifactReviewSummary(overview: Awaited<ReturnType<typeof artifactOverview>>) {
  const evidencePaths = uniqueStrings([
    overview.latestSpec?.path,
    overview.latestTest?.path
  ].filter((path): path is string => Boolean(path)));
  const hasArtifacts = overview.counts.specs > 0 || overview.counts.tests > 0;
  return {
    title: "Artifact Review",
    status: hasArtifacts ? "ready" : "empty",
    metrics: overview.counts,
    evidencePaths,
    nextAction: hasArtifacts ? "read_artifacts" : "no_artifact",
    userMessage: `Artifact review: ${overview.counts.specs} specs, ${overview.counts.tests} tests.`
  };
}

function reviewMarkdownFromSummary(summary: {
  title: string;
  status: string;
  metrics: Record<string, unknown>;
  evidencePaths: string[];
  nextAction: string;
  userMessage: string;
}) {
  const lines = [
    `# ${summary.title}`,
    "",
    `- Status: ${summary.status}`,
    `- Next action: ${summary.nextAction}`,
    `- Message: ${summary.userMessage}`,
    "",
    "## Metrics"
  ];
  for (const [key, value] of Object.entries(summary.metrics)) {
    lines.push(`- ${key}: ${JSON.stringify(value)}`);
  }
  if (summary.evidencePaths.length > 0) {
    lines.push("", "## Evidence");
    for (const path of summary.evidencePaths) {
      lines.push(`- ${path}`);
    }
  }
  return lines.join("\n");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

async function maybeWriteCaseSourceResults(input: {
  source: string;
  cases: DocumentCase[];
  results: CaseSuiteCaseResult[];
  bugs: BugReport[];
  requested: boolean;
  confirmed: boolean;
}) {
  if (!input.requested) {
    return { status: "skipped", updatedRows: 0 };
  }
  if (!input.confirmed) {
    return {
      status: "requires_confirmation",
      updatedRows: 0,
      reason: "Set confirmWriteBack=true to modify the source .xlsx file."
    };
  }
  return writeXlsxCaseSourceResults({
    source: input.source,
    cases: input.cases,
    results: input.results,
    bugs: input.bugs
  });
}

function previewSummary(parsed: ParsedCaseSource, selectedCases: DocumentCase[] = parsed.cases) {
  const selectedStats = summarizeDocumentCases(selectedCases);
  return {
    total: selectedCases.length,
    moduleStats: selectedStats.moduleStats,
    priorityStats: selectedStats.priorityStats,
    warnings: parsed.warnings,
    sampleCases: selectedCases.slice(0, 3).map((item) => ({
      caseNo: item.caseNo,
      title: item.title,
      module: item.module,
      priority: item.priority,
      sourceRow: item.sourceRow
    }))
  };
}

function caseSourceFilters(input: Record<string, unknown>) {
  return {
    caseNos: new Set(stringArrayArg(input, "caseNos").map((item) => item.trim()).filter(Boolean)),
    modules: new Set(stringArrayArg(input, "modules").map((item) => item.trim()).filter(Boolean)),
    priorities: new Set(stringArrayArg(input, "priorities").map((item) => item.trim()).filter(Boolean))
  };
}

function filterDocumentCases(
  cases: DocumentCase[],
  filters: ReturnType<typeof caseSourceFilters>
) {
  return cases.filter((documentCase) => {
    if (filters.caseNos.size > 0 && !filters.caseNos.has(documentCase.caseNo)) {
      return false;
    }
    if (filters.modules.size > 0 && !filters.modules.has(documentCase.module)) {
      return false;
    }
    if (filters.priorities.size > 0 && !filters.priorities.has(documentCase.priority)) {
      return false;
    }
    return true;
  });
}

function selectionSummary(
  allCases: DocumentCase[],
  selectedCases: DocumentCase[],
  filters: ReturnType<typeof caseSourceFilters>
) {
  return {
    totalAvailable: allCases.length,
    selected: selectedCases.length,
    selectedCaseNos: selectedCases.map((documentCase) => documentCase.caseNo),
    filters: {
      caseNos: [...filters.caseNos],
      modules: [...filters.modules],
      priorities: [...filters.priorities]
    }
  };
}

function caseSuiteProgress(context: BrainCreatorMcpContext, suite: CaseSuite) {
  const snapshot = caseSuiteExecutionSnapshot(context, suite);
  return {
    selected: suite.selectedCaseNos.length,
    alreadyPassed: snapshot.passedCaseNos.length,
    attempted: snapshot.attemptedCaseNos.length,
    passed: snapshot.passedCaseNos.length,
    failed: snapshot.failedCaseNos.length,
    blocked: snapshot.blockedCaseNos.length,
    waiting: snapshot.waitingCaseNos.length,
    pending: snapshot.pendingCaseNos.length,
    remaining: snapshot.remainingCaseNos.length,
    ...snapshot
  };
}

async function prepareNextHostAgentSuiteTask(
  context: BrainCreatorMcpContext,
  suiteId: string,
  maxHealAttempts?: number
) {
  const suite = context.service.getCaseSuite(suiteId);
  const source = context.service
    .listCaseSources(suite.systemId)
    .find((candidate) => candidate.id === suite.sourceId);
  if (!source) {
    throw new Error("Case source not found for host-agent suite continuation");
  }
  const parsed = await parseCaseSource(source.source);
  const attempted = attemptedCaseNosForSuite(context, suite.systemId, suite.id);
  const documentCase = parsed.cases.find(
    (candidate) =>
      suite.selectedCaseNos.includes(candidate.caseNo) && !attempted.has(candidate.caseNo)
  );
  if (!documentCase) {
    return undefined;
  }
  const result = await executeDocumentCase(context, {
    systemId: suite.systemId,
    sourceId: source.id,
    suiteId: suite.id,
    documentCase,
    maxHealAttempts,
    createBugOnFailure: true
  });
  if (!result.taskPackage) {
    return undefined;
  }
  const waitingSuite = context.service.updateCaseSuiteStatus(suite.id, "waiting-for-agent");
  return {
    ...result.taskPackage,
    mode: "case-source-suite",
    stage: result.taskPackage.task.agent,
    source,
    suite: waitingSuite,
    currentCase: result.caseResult,
    progress: caseSuiteProgress(context, waitingSuite)
  };
}

function unfinishedCaseSuites(context: BrainCreatorMcpContext, systemId: string) {
  const sourcesById = new Map(context.service.listCaseSources(systemId).map((source) => [source.id, source]));
  return context.service
    .listCaseSuites(systemId)
    .filter((suite) => suite.status !== "completed" && suite.status !== "cancelled")
    .map((suite) => {
      const progress = caseSuiteExecutionSnapshot(context, suite);
      const lastRun = context.service
        .listCaseSuiteRuns(systemId)
        .filter((run) => run.suiteId === suite.id)
        .at(-1);
      return {
        suiteId: suite.id,
        sourceId: suite.sourceId,
        source: sourcesById.get(suite.sourceId)?.source,
        status: suite.status,
        totalCases: suite.totalCases,
        ...progress,
        lastRunId: lastRun?.id,
        updatedAt: suite.updatedAt
      };
    })
    .filter((suite) => suite.remainingCaseNos.length > 0 && suite.source)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}

function caseSuiteExecutionSnapshot(context: BrainCreatorMcpContext, suite: CaseSuite) {
  const latestResultByCaseNo = new Map<string, CaseSuiteCaseResult>();
  const attempted = new Set<string>();
  for (const run of context.service
    .listCaseSuiteRuns(suite.systemId)
    .filter((item) => item.suiteId === suite.id)) {
    for (const result of run.caseResults) {
      attempted.add(result.caseNo);
      const current = latestResultByCaseNo.get(result.caseNo);
      if (current?.status === "passed") {
        continue;
      }
      latestResultByCaseNo.set(result.caseNo, result);
    }
  }
  const pendingTasks = context.service
    .listAgentTasks(suite.systemId)
    .filter((task) => task.status === "pending" && task.suiteContext?.suiteId === suite.id)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  const waitingByCaseNo = new Map(
    pendingTasks.flatMap((task) =>
      task.suiteContext ? [[task.suiteContext.caseNo, task] as const] : []
    )
  );
  const passedCaseNos: string[] = [];
  const failedCaseNos: string[] = [];
  const blockedCaseNos: string[] = [];
  const waitingCaseNos: string[] = [];
  const pendingCaseNos: string[] = [];
  for (const caseNo of suite.selectedCaseNos) {
    const result = latestResultByCaseNo.get(caseNo);
    if (result?.status === "passed") {
      passedCaseNos.push(caseNo);
    } else if (waitingByCaseNo.has(caseNo) || result?.status === "waiting-for-agent") {
      waitingCaseNos.push(caseNo);
    } else if (result?.status === "failed") {
      failedCaseNos.push(caseNo);
    } else if (result?.status === "blocked") {
      blockedCaseNos.push(caseNo);
    } else {
      pendingCaseNos.push(caseNo);
    }
  }
  const passed = new Set(passedCaseNos);
  const remainingCaseNos = suite.selectedCaseNos.filter(
    (caseNo) => !passed.has(caseNo)
  );
  const activeTask = pendingTasks.at(-1);
  return {
    attemptedCaseNos: suite.selectedCaseNos.filter((caseNo) => attempted.has(caseNo)),
    passedCaseNos,
    failedCaseNos,
    blockedCaseNos,
    waitingCaseNos,
    pendingCaseNos,
    retryableCaseNos: [...failedCaseNos, ...blockedCaseNos],
    remainingCaseNos,
    nextCaseNo:
      activeTask?.suiteContext?.caseNo ??
      waitingCaseNos[0] ??
      pendingCaseNos[0] ??
      failedCaseNos[0] ??
      blockedCaseNos[0],
    activeTask: activeTask?.suiteContext
      ? {
          taskId: activeTask.id,
          agent: activeTask.agent,
          caseNo: activeTask.suiteContext.caseNo,
          title: activeTask.suiteContext.title,
          createdAt: activeTask.createdAt
        }
      : undefined,
    stateIssues:
      suite.status === "waiting-for-agent" && pendingTasks.length === 0
        ? ["Suite is waiting for an agent, but no pending AgentTask exists."]
        : pendingTasks.length > 1
          ? [`Suite has ${pendingTasks.length} pending AgentTasks; only the latest is active.`]
          : []
  };
}

function latestUnfinishedCaseSuite(context: BrainCreatorMcpContext, systemId: string) {
  const suites = unfinishedCaseSuites(context, systemId);
  return suites.at(-1);
}

function existingCaseSuite(
  context: BrainCreatorMcpContext,
  suiteId: string,
  systemId: string,
  sourceId: string
): CaseSuite {
  const suite = context.service.getCaseSuite(suiteId);
  if (suite.systemId !== systemId) {
    throw new Error("Case suite belongs to another business system");
  }
  if (suite.sourceId !== sourceId) {
    throw new Error("Case suite belongs to another case source");
  }
  return suite;
}

function passedCaseNosForSuite(context: BrainCreatorMcpContext, systemId: string, suiteId: string) {
  const passed = new Set<string>();
  for (const run of context.service.listCaseSuiteRuns(systemId).filter((item) => item.suiteId === suiteId)) {
    for (const result of run.caseResults) {
      if (result.status === "passed") {
        passed.add(result.caseNo);
      }
    }
  }
  return passed;
}

function attemptedCaseNosForSuite(
  context: BrainCreatorMcpContext,
  systemId: string,
  suiteId: string
) {
  const attempted = new Set<string>();
  for (const run of context.service
    .listCaseSuiteRuns(systemId)
    .filter((item) => item.suiteId === suiteId)) {
    for (const result of run.caseResults) {
      attempted.add(result.caseNo);
    }
  }
  return attempted;
}

function hostAgentSuiteFailureStatus(
  context: BrainCreatorMcpContext,
  suite: CaseSuite
): "blocked" | "failed" {
  const runs = context.service
    .listCaseSuiteRuns(suite.systemId)
    .filter((run) => run.suiteId === suite.id);
  return runs.some((run) => run.status === "blocked" || run.blocked > 0)
    ? "blocked"
    : "failed";
}

function facadeNextAction(state: {
  bridgeOk: boolean;
  awaitingAuthCheckpoints: number;
  pendingAgentTasks: number;
  openBugs: number;
  openGaps: number;
  approvedCases: number;
  caseSources: number;
  unfinishedSuites: number;
}) {
  if (state.awaitingAuthCheckpoints > 0) {
    return "complete_auth_checkpoint";
  }
  if (!state.bridgeOk) {
    return "configure_bridge";
  }
  if (state.pendingAgentTasks > 0) {
    return "continue_case_source_suite";
  }
  if (state.openGaps > 0) {
    return "review_gaps";
  }
  if (state.unfinishedSuites > 0) {
    return "continue_case_source_suite";
  }
  if (state.openBugs > 0) {
    return "review_bugs";
  }
  if (state.approvedCases > 0) {
    return "run_approved_case";
  }
  if (state.caseSources > 0) {
    return "run_case_source_suite";
  }
  return "configure_or_generate_plan";
}

function statusUserSummary(state: {
  systemName: string;
  bridgeOk: boolean;
  authProfiles: number;
  awaitingAuthCheckpoints: number;
  pendingAgentTasks: number;
  openBugs: number;
  openGaps: number;
  unfinishedSuites: number;
  nextAction: string;
}) {
  return {
    systemName: state.systemName,
    readiness:
      !state.bridgeOk || state.awaitingAuthCheckpoints > 0
        ? "blocked"
        : state.pendingAgentTasks > 0 ||
            state.openBugs > 0 ||
            state.openGaps > 0 ||
            state.unfinishedSuites > 0
          ? "action-required"
          : "ready",
    nextAction: state.nextAction,
    nextCommand: nextCommandForAction(state.nextAction),
    nextStep: nextStepForAction(state.nextAction),
    counts: {
      authProfiles: state.authProfiles,
      awaitingAuthCheckpoints: state.awaitingAuthCheckpoints,
      pendingAgentTasks: state.pendingAgentTasks,
      openBugs: state.openBugs,
      openGaps: state.openGaps,
      unfinishedSuites: state.unfinishedSuites
    }
  };
}

function statusMarkdown(summary: ReturnType<typeof statusUserSummary>) {
  return [
    `# Brain Creator Status: ${summary.systemName}`,
    "",
    `- Readiness: ${summary.readiness}`,
    `- Auth profiles: ${summary.counts.authProfiles}`,
    `- Awaiting auth checkpoints: ${summary.counts.awaitingAuthCheckpoints}`,
    `- Pending agent tasks: ${summary.counts.pendingAgentTasks}`,
    `- Open bugs: ${summary.counts.openBugs}`,
    `- Open gaps: ${summary.counts.openGaps}`,
    `- Unfinished suites: ${summary.counts.unfinishedSuites}`,
    "",
    `Next: ${summary.nextStep}`,
    `Command: \`${summary.nextCommand}\``
  ].join("\n");
}

function statusQuickCommands(state: { openBugs: number; openGaps: number; unfinishedSuites: number }) {
  const commands = [
    { command: "/bc status", description: "Inspect the current Brain Creator system status." },
    { command: `/bc run "<path>"`, description: "Preview a test case document suite before execution." }
  ];
  if (state.unfinishedSuites > 0) {
    commands.push({ command: "/bc continue", description: "Resume the latest unfinished suite." });
  }
  if (state.openBugs > 0) {
    commands.push({ command: "/bc bugs", description: "Review open BugReports." });
    commands.push({ command: "/bc regress bugs", description: "Run regression for open BugReports." });
  }
  if (state.openGaps > 0) {
    commands.push({ command: "/bc gaps", description: "Review open Gaps." });
  }
  return commands;
}

function statusToolGuidance(nextAction: string) {
  return {
    defaultLayer: "facade",
    primaryTools: [
      { name: "bc_command", use: "Parse explicit /bc shortcuts into facade calls." },
      { name: "bc_status", use: "Restore session state, readiness, next action, and quick commands." },
      { name: "bc_configure", use: "Configure systems, auth, terms, rules, and checkpoints." },
      { name: "bc_run", use: "Execute approved cases, document suites, workflows, and bug regression." },
      { name: "bc_review", use: "Review suites, cases, bugs, gaps, and artifacts." }
    ],
    nextFacadeTool: nextFacadeToolForAction(nextAction),
    internalToolsPolicy:
      "Use fine-grained bc_* tools only for debugging, audit, or unsupported facade details."
  };
}

function nextFacadeToolForAction(action: string) {
  if (action === "configure_bridge") {
    return "brain-creator-doctor";
  }
  if (action === "configure_system") {
    return "bc_configure";
  }
  if (action === "complete_auth_checkpoint") {
    return "bc_configure";
  }
  if (action === "review_gaps" || action === "review_bugs") {
    return "bc_review";
  }
  if (
    action === "continue_case_source_suite" ||
    action === "run_approved_case" ||
    action === "run_case_source_suite" ||
    action === "configure_or_generate_plan"
  ) {
    return "bc_run";
  }
  return "bc_status";
}

function nextCommandForAction(action: string) {
  if (action === "configure_bridge") {
    return "brain-creator-doctor";
  }
  if (action === "complete_auth_checkpoint") {
    return "complete authentication";
  }
  if (action === "continue_case_source_suite") {
    return "/bc continue";
  }
  if (action === "review_gaps") {
    return "/bc gaps";
  }
  if (action === "review_bugs") {
    return "/bc bugs";
  }
  if (action === "run_case_source_suite" || action === "configure_or_generate_plan") {
    return `/bc run "<path>"`;
  }
  if (action === "run_approved_case") {
    return "confirm and run";
  }
  return "/bc status";
}

function brainCreatorCommandShortcuts() {
  return [
    {
      command: "/bc status",
      description: "Show current system readiness, auth, suites, bugs, gaps, artifacts, and next action."
    },
    {
      command: `/bc run "<path>"`,
      description: "Preview a test case document suite. Add --case, --module, or --priority filters when needed."
    },
    {
      command: "/bc continue",
      description: "Continue the latest unfinished suite for the selected system."
    },
    {
      command: "/bc bugs",
      description: "Review open BugReports. Add --failure-type to focus on one failure class."
    },
    {
      command: "/bc gaps",
      description: "Review open Gaps. Add --failure-type to focus on one failure class."
    },
    {
      command: "/bc review suite",
      description: "Review the latest suite run. Add --failure-type for focused failure analysis."
    },
    {
      command: "/bc regress bugs",
      description: "Run regression for open bugs. Add --bug, --module, or --priority filters when needed."
    }
  ];
}

function brainCreatorCommandHelpMarkdown() {
  return [
    "# Brain Creator shortcuts",
    "",
    "Use natural language first. When you want a compact command, use these `/bc` shortcuts:",
    "",
    ...brainCreatorCommandShortcuts().map(
      (shortcut) => `- \`${shortcut.command}\`: ${shortcut.description}`
    ),
    "",
    "Useful filters:",
    "- `--system <name>` / `--env <environment>` choose a system context.",
    "- `--case TC-001,TC-002` limits document suite preview or execution to case numbers.",
    "- `--module Recruiting` limits document suite preview, execution, or bug regression to modules.",
    "- `--priority P0` limits document suite preview, execution, or bug regression to priorities.",
    "- `--failure-type assertion_failure` filters bug, gap, or suite review by failure classification."
  ].join("\n");
}

function nextStepForAction(action: string) {
  if (action === "configure_bridge") {
    return "Configure the Brain Creator agent bridge before running generation or suites.";
  }
  if (action === "complete_auth_checkpoint") {
    return "Complete the pending manual authentication checkpoint.";
  }
  if (action === "continue_case_source_suite") {
    return "Continue the latest unfinished test case suite.";
  }
  if (action === "review_gaps") {
    return "Review open gaps before claiming the system is ready.";
  }
  if (action === "review_bugs") {
    return "Review open bugs or run bug regression.";
  }
  if (action === "run_approved_case") {
    return "Run the approved test case chain.";
  }
  if (action === "run_case_source_suite") {
    return "Run or preview an existing test case document suite.";
  }
  return "Add a requirement or preview a test case document suite.";
}

function chainFailureReason(chainRun: ChainRun) {
  return (
    chainRun.gaps.map((gap) => gap.reason).filter(Boolean).join("\n") ||
    `Chain run ${chainRun.id} failed`
  );
}

function reproductionSteps(documentCase: DocumentCase) {
  return [
    documentCase.precondition ? `Precondition: ${documentCase.precondition}` : "",
    ...documentCase.steps
  ].filter(Boolean);
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((result, item) => {
    const key = getKey(item);
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}

function sumBy<T>(items: T[], getValue: (item: T) => number) {
  return items.reduce((total, item) => total + getValue(item), 0);
}

function bugReviewSummary(bugs: Array<{ status: string; actualResult: string }>) {
  const counts = countBy(bugs, (bug) => bug.status);
  return {
    total: bugs.length,
    open: counts.open ?? 0,
    retestRunning: counts["retest-running"] ?? 0,
    retestPassed: counts["retest-passed"] ?? 0,
    retestFailed: counts["retest-failed"] ?? 0,
    closed: counts.closed ?? 0,
    byFailureType: failureTypeCounts(bugs.map((bug) => classifyFailure(bug.actualResult)))
  };
}

type FailureType = ExecutionFailureType;

function failureTypeCounts(types: FailureType[]) {
  return countBy(types, (type) => type);
}

function failureTypeFilters(input: Record<string, unknown>) {
  return new Set(stringArrayArg(input, "failureTypes").map((item) => failureTypeArg(item)));
}

function failureTypeArg(value: string): FailureType {
  const valid: FailureType[] = [
    "assertion_failure",
    "auth_failure",
    "locator_failure",
    "network_failure",
    "automation_failure",
    "test_data_failure",
    "environment_failure",
    "execution_failure",
    "unknown_failure"
  ];
  if (!valid.includes(value as FailureType)) {
    throw new Error(`failureTypes contains invalid value: ${value}`);
  }
  return value as FailureType;
}

function matchesFailureTypes(type: FailureType, filters: Set<FailureType>) {
  return filters.size === 0 || filters.has(type);
}

function bugRegressionCandidates(bugs: BugReport[]) {
  return bugs.filter((bug) => bug.status === "open" || bug.status === "retest-failed");
}

function regressionCandidateSummary(bugs: BugReport[]) {
  return {
    total: bugs.length,
    bugIds: bugs.map((bug) => bug.id),
    caseNos: bugs.map((bug) => bug.caseNo),
    byModule: countBy(bugs, (bug) => bug.module || "未分组"),
    byPriority: countBy(bugs, (bug) => bug.priority || "未标记")
  };
}

function bugRegressionSummary(
  candidates: BugReport[],
  bugs: BugReport[],
  results: CaseSuiteCaseResult[]
) {
  const counts = countBy(bugs, (bug) => bug.status);
  return {
    candidates: candidates.length,
    attempted: results.length,
    retestPassed: counts["retest-passed"] ?? 0,
    retestFailed: counts["retest-failed"] ?? 0,
    blocked: results.filter((result) => result.status === "blocked").length,
    remainingOpen: counts.open ?? 0
  };
}

function bugRegressionMarkdown(
  summary: ReturnType<typeof bugRegressionSummary>,
  bugs: BugReport[]
) {
  const lines = [
    "## Bug Regression Summary",
    "",
    `Candidates: ${summary.candidates}`,
    `Attempted: ${summary.attempted}`,
    `Retest passed: ${summary.retestPassed}`,
    `Retest failed: ${summary.retestFailed}`,
    `Blocked: ${summary.blocked}`,
    `Remaining open: ${summary.remainingOpen}`,
    ""
  ];
  for (const bug of bugs) {
    lines.push(
      `### ${bug.caseNo} ${bug.caseTitle}`,
      "",
      `Status: ${bug.status}`,
      `Priority: ${bug.priority}`,
      `Module: ${bug.module}`,
      `Expected: ${bug.expectedResult}`,
      `Actual: ${bug.actualResult}`,
      `Evidence: ${bug.evidencePaths.join(", ") || "N/A"}`,
      ""
    );
  }
  return lines.join("\n");
}

function bugReviewMarkdown(
  bugs: Array<{
    caseNo: string;
    caseTitle: string;
    status: string;
    priority: string;
    module: string;
    expectedResult: string;
    actualResult: string;
    reproductionSteps: string[];
    evidencePaths: string[];
  }>
) {
  const summary = bugReviewSummary(bugs);
  const lines = [
    "## BugReport Summary",
    "",
    `Total: ${summary.total}`,
    `Open: ${summary.open}`,
    `Retest passed: ${summary.retestPassed}`,
    `Retest failed: ${summary.retestFailed}`,
    ""
  ];
  for (const bug of bugs) {
    lines.push(
      `### ${bug.caseNo} ${bug.caseTitle}`,
      "",
      `Status: ${bug.status}`,
      `Priority: ${bug.priority}`,
      `Module: ${bug.module}`,
      `Expected: ${bug.expectedResult}`,
      `Actual: ${bug.actualResult}`,
      `Steps: ${bug.reproductionSteps.join(" -> ") || "N/A"}`,
      `Evidence: ${bug.evidencePaths.join(", ") || "N/A"}`,
      ""
    );
  }
  return lines.join("\n");
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

async function verifyCaseSourceSuiteAuthState(
  context: BrainCreatorMcpContext,
  systemId: string
) {
  const profile = findAuthProfile(context, systemId);
  if (profile.loginMethod !== "script") {
    return undefined;
  }
  const storageStatePath = context.service.getCaptureAuth(profile.id)?.secrets.storageStatePath;
  if (!storageStatePath) {
    return undefined;
  }
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  return context.authStateVerifier({
    storageStatePath: isAbsolute(storageStatePath)
      ? resolve(storageStatePath)
      : resolve(context.workDir, storageStatePath),
    targetUrl: system.baseUrl,
    allowedUrls: system.urlAllowlist
  });
}

function findAuthProfile(context: BrainCreatorMcpContext, systemId: string): AuthProfile {
  const profile = context.repository.authProfiles
    .filter((item) => item.projectId === systemId && item.status !== "cancelled")
    .sort((left, right) => {
      const statusDifference = authProfileStatusRank(right) - authProfileStatusRank(left);
      return statusDifference || right.updatedAt.localeCompare(left.updatedAt);
    })[0];
  if (!profile) {
    throw new Error("Auth profile not found");
  }
  return profile;
}

function authProfileStatusRank(profile: AuthProfile) {
  if (profile.status === "succeeded") {
    return 3;
  }
  if (profile.status === "running") {
    return 2;
  }
  if (profile.status === "pending") {
    return 1;
  }
  return 0;
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

function numberArg(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function optionalBooleanArg(input: Record<string, unknown>, key: string): boolean {
  return input[key] === true;
}

function planContextArg(input: Record<string, unknown>): AgentTask["planContext"] | undefined {
  const value = input.planContext;
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object") {
    throw new Error("planContext must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const requirement = candidate.requirement;
  const specPath = candidate.specPath;
  const promptPath = candidate.promptPath;
  const seedPath = candidate.seedPath;
  if (
    typeof requirement !== "string" ||
    typeof specPath !== "string" ||
    typeof promptPath !== "string" ||
    typeof seedPath !== "string"
  ) {
    throw new Error("planContext requires requirement, specPath, promptPath, and seedPath");
  }
  return { requirement, specPath, promptPath, seedPath };
}

function chainContextArg(input: Record<string, unknown>): AgentTask["chainContext"] | undefined {
  const value = input.chainContext;
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object") {
    throw new Error("chainContext must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const testCaseId = candidate.testCaseId;
  const specPath = candidate.specPath;
  const seedPath = candidate.seedPath;
  const testPath = candidate.testPath;
  const generateRunId = candidate.generateRunId;
  const maxHealAttempts = candidate.maxHealAttempts;
  const healAttempts = candidate.healAttempts;
  const knowledgeProjectId = candidate.knowledgeProjectId;
  const executableCaseId = candidate.executableCaseId;
  const executionPlanId = candidate.executionPlanId;
  const requirementSuiteRunId = candidate.requirementSuiteRunId;
  const executionEvidenceId = candidate.executionEvidenceId;
  const contextPackPath = candidate.contextPackPath;
  if (typeof testCaseId !== "string" || typeof specPath !== "string" || typeof testPath !== "string") {
    throw new Error("chainContext requires testCaseId, specPath, and testPath");
  }
  if (generateRunId !== undefined && typeof generateRunId !== "string") {
    throw new Error("chainContext generateRunId must be a string when provided");
  }
  if (seedPath !== undefined && typeof seedPath !== "string") {
    throw new Error("chainContext seedPath must be a string when provided");
  }
  if (maxHealAttempts !== undefined && (typeof maxHealAttempts !== "number" || maxHealAttempts < 0)) {
    throw new Error("chainContext maxHealAttempts must be a non-negative number when provided");
  }
  if (healAttempts !== undefined && (typeof healAttempts !== "number" || healAttempts < 0)) {
    throw new Error("chainContext healAttempts must be a non-negative number when provided");
  }
  for (const [name, value] of Object.entries({
    knowledgeProjectId,
    executableCaseId,
    executionPlanId,
    requirementSuiteRunId,
    executionEvidenceId,
    contextPackPath
  })) {
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`chainContext ${name} must be a string when provided`);
    }
  }
  return {
    testCaseId,
    specPath,
    seedPath,
    testPath,
    generateRunId,
    maxHealAttempts,
    healAttempts,
    knowledgeProjectId: knowledgeProjectId as string | undefined,
    executableCaseId: executableCaseId as string | undefined,
    executionPlanId: executionPlanId as string | undefined,
    requirementSuiteRunId: requirementSuiteRunId as string | undefined,
    executionEvidenceId: executionEvidenceId as string | undefined,
    contextPackPath: contextPackPath as string | undefined
  };
}

function createRequirementBugReport(
  context: BrainCreatorMcpContext,
  input: {
    executableCase: ExecutableCase;
    chainRun: ChainRun;
    failureReason: string;
    artifactPaths: string[];
  }
) {
  const intent = context.repository.testIntents.find(
    (item) => item.id === input.executableCase.testIntentId
  );
  return context.service.createBugReport({
    systemId: input.chainRun.systemId,
    sourceId: input.executableCase.id,
    caseNo: input.executableCase.id,
    caseTitle: input.executableCase.title,
    module: intent?.module ?? "General",
    priority: intent?.priority ?? "P0",
    expectedResult:
      intent?.expectedResults.join("; ") ?? "Behavior matches the approved requirement",
    actualResult: input.failureReason,
    reproductionSteps: input.executableCase.steps.map(
      (step) => `${step.order}. ${step.instruction}`
    ),
    evidencePaths: input.artifactPaths,
    chainRunId: input.chainRun.id,
    gapIds: []
  });
}

function suiteContextArg(input: Record<string, unknown>): AgentTask["suiteContext"] | undefined {
  const value = input.suiteContext;
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object") {
    throw new Error("suiteContext must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const suiteId = candidate.suiteId;
  const sourceId = candidate.sourceId;
  const caseNo = candidate.caseNo;
  const title = candidate.title;
  if (
    typeof suiteId !== "string" ||
    typeof sourceId !== "string" ||
    typeof caseNo !== "string" ||
    typeof title !== "string"
  ) {
    throw new Error("suiteContext requires suiteId, sourceId, caseNo, and title");
  }
  return { suiteId, sourceId, caseNo, title };
}

function runModeArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (
    ![
      "approved-case",
      "full-workflow",
      "case-source-suite",
      "bug-regression",
      "requirement-suite"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as
    | "approved-case"
    | "full-workflow"
    | "case-source-suite"
    | "bug-regression"
    | "requirement-suite";
}

function suiteActionArg(input: Record<string, unknown>) {
  const value = optionalStringArg(input, "suiteAction") ?? "continue";
  if (!["continue", "cancel", "retry", "skip"].includes(value)) {
    throw new Error("suiteAction is invalid");
  }
  return value as "continue" | "cancel" | "retry" | "skip";
}

type KnowledgeReviewTarget =
  | "requirement"
  | "knowledge"
  | "coverage"
  | "requirement-eval-accuracy"
  | "system-brain"
  | "system-exploration"
  | "test-intent"
  | "executable-case"
  | "execution-plan"
  | "requirement-suite-run"
  | "run-ledger"
  | "evidence";

function reviewTargetArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (
    ![
      "suite-run",
      "case",
      "bug",
      "gap",
      "artifact",
      "requirement",
      "knowledge",
      "coverage",
      "requirement-eval-accuracy",
      "system-brain",
      "system-exploration",
      "test-intent",
      "executable-case",
      "execution-plan",
      "requirement-suite-run",
      "run-ledger",
      "evidence"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as
    | "suite-run"
    | "case"
    | "bug"
    | "gap"
    | "artifact"
    | KnowledgeReviewTarget;
}

function isKnowledgeReviewTarget(value: ReturnType<typeof reviewTargetArg>): value is KnowledgeReviewTarget {
  return [
    "requirement",
    "knowledge",
    "coverage",
    "requirement-eval-accuracy",
    "system-brain",
    "system-exploration",
    "test-intent",
    "executable-case",
    "execution-plan",
    "requirement-suite-run",
    "run-ledger",
    "evidence"
  ].includes(value);
}

function resolveSystemReference(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>,
  commandReference: { systemName?: string; environment?: string } = {}
) {
  const systemId = optionalStringArg(input, "systemId");
  const systemName = optionalStringArg(input, "systemName") ?? commandReference.systemName;
  const environment = optionalStringArg(input, "environment") ?? commandReference.environment;
  const systems = context.service.listSystemProfiles().filter((system) => system.status !== "cancelled");

  if (systemId) {
    const system = systems.find((item) => item.id === systemId);
    if (!system) {
      throw new Error(`Brain Creator system not found: ${systemId}`);
    }
    return {
      systemId: system.id,
      systemName: system.name,
      environment: system.environment,
      matchedBy: "id"
    };
  }

  if (!systemName) {
    if (systems.length === 1) {
      const [system] = systems;
      return {
        systemId: system.id,
        systemName: system.name,
        environment: system.environment,
        matchedBy: "single-active-system"
      };
    }
    throw new Error(
      `systemId or systemName is required. Available systems: ${systemCandidatesText(systems)}`
    );
  }

  const normalizedName = normalizeSystemLookup(systemName);
  const normalizedEnvironment = environment ? normalizeSystemLookup(environment) : undefined;
  const nameMatches = systems.filter((system) =>
    normalizeSystemLookup(system.name).includes(normalizedName)
  );
  const matches = normalizedEnvironment
    ? nameMatches.filter((system) => normalizeSystemLookup(system.environment) === normalizedEnvironment)
    : nameMatches;

  if (matches.length === 1) {
    const [system] = matches;
    return {
      systemId: system.id,
      systemName: system.name,
      environment: system.environment,
      matchedBy: normalizedEnvironment ? "name-environment" : "name"
    };
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple Brain Creator systems match "${systemName}". Add environment or systemId. Candidates: ${systemCandidatesText(matches)}`
    );
  }
  throw new Error(
    `No Brain Creator system matches "${systemName}". Available systems: ${systemCandidatesText(systems)}`
  );
}

function systemCandidatesText(systems: Array<{ id: string; name: string; environment: string }>) {
  return systems.length === 0
    ? "none"
    : systems.map((system) => `${system.name} (${system.environment}, ${system.id})`).join("; ");
}

function normalizeSystemLookup(value: string) {
  return value.trim().toLowerCase();
}

function inferSystemName(context: BrainCreatorMcpContext, request: string) {
  const normalizedRequest = normalizeSystemLookup(request);
  const matches = context.service
    .listSystemProfiles()
    .filter((system) => system.status !== "cancelled")
    .filter((system) => normalizedRequest.includes(normalizeSystemLookup(system.name)));
  if (matches.length === 1) {
    return matches[0].name;
  }
  return undefined;
}

function extractCaseSource(request: string) {
  const match = request.match(/(?:[A-Za-z]:[\\/][^\r\n]*?\.(?:xlsx|md)|[./\\][^\r\n]*?\.(?:xlsx|md))/i);
  return match?.[0]?.trim();
}

function intentCaseSourceFilters(input: Record<string, unknown>, request: string) {
  const caseNos = mergeUniqueStrings(stringArrayArg(input, "caseNos"), extractCaseNos(request));
  const modules = mergeUniqueStrings(stringArrayArg(input, "modules"), extractTaggedValues(request, ["模块", "module"], [
    "优先级",
    "priority",
    "用例",
    "case"
  ]));
  const priorities = mergeUniqueStrings(
    stringArrayArg(input, "priorities"),
    extractTaggedValues(request, ["优先级", "priority"], ["模块", "module", "用例", "case"]),
    extractPriorities(request)
  );
  const filters: Record<string, string[]> = {};
  if (caseNos.length > 0) {
    filters.caseNos = caseNos;
  }
  if (modules.length > 0) {
    filters.modules = modules;
  }
  if (priorities.length > 0) {
    filters.priorities = priorities;
  }
  return filters;
}

function intentBugRegressionFilters(input: Record<string, unknown>, request: string) {
  const bugIds = mergeUniqueStrings(stringArrayArg(input, "bugIds"), extractBugIds(request));
  const modules = mergeUniqueStrings(
    stringArrayArg(input, "modules"),
    extractTaggedValues(request, ["模块", "module"], ["优先级", "priority", "bug", "用例", "case"]),
    extractPrecedingTaggedValues(request, ["模块", "module"])
  ).filter((item) => !isPriorityToken(item));
  const priorities = mergeUniqueStrings(
    stringArrayArg(input, "priorities"),
    extractTaggedValues(request, ["优先级", "priority"], ["模块", "module", "bug", "用例", "case"]),
    extractPriorities(request)
  );
  const filters: Record<string, string[]> = {};
  if (bugIds.length > 0) {
    filters.bugIds = bugIds;
  }
  if (modules.length > 0) {
    filters.modules = modules;
  }
  if (priorities.length > 0) {
    filters.priorities = priorities;
  }
  return filters;
}

function bugRegressionFilters(input: Record<string, unknown>) {
  return {
    modules: new Set(stringArrayArg(input, "modules").map((item) => normalizeSystemLookup(item))),
    priorities: new Set(stringArrayArg(input, "priorities").map((item) => normalizeSystemLookup(item)))
  };
}

function matchesBugRegressionFilters(bug: BugReport, filters: ReturnType<typeof bugRegressionFilters>) {
  if (filters.modules.size > 0 && !filters.modules.has(normalizeSystemLookup(bug.module))) {
    return false;
  }
  if (filters.priorities.size > 0 && !filters.priorities.has(normalizeSystemLookup(bug.priority))) {
    return false;
  }
  return true;
}

function mergeUniqueStrings(...groups: string[][]) {
  return [...new Set(groups.flat().map((item) => item.trim()).filter(Boolean))];
}

function extractBugIds(request: string) {
  return request.match(/\bbug[_-][a-z0-9_-]+\b/gi) ?? [];
}

function extractCaseNos(request: string) {
  return request.match(/\bTC[-_\s]?\d+\b/gi)?.map((item) => item.replace(/\s+/, "-")) ?? [];
}

function extractPriorities(request: string) {
  return request.match(/\bP[0-3]\b/gi)?.map((item) => item.toUpperCase()) ?? [];
}

function isPriorityToken(value: string) {
  return /^P[0-3]$/i.test(value);
}

function extractTaggedValues(request: string, labels: string[], stopLabels: string[]) {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const stopPattern = stopLabels.map(escapeRegExp).join("|");
  const match = request.match(
    new RegExp(`(?:${labelPattern})\\s*[:：]?\\s*(.+?)(?=\\s*(?:${stopPattern})(?:\\s|[:：]|$)|$)`, "i")
  );
  return match ? splitCommandValues([match[1]]) : [];
}

function extractPrecedingTaggedValues(request: string, labels: string[]) {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const matches = [...request.matchAll(new RegExp(`(?:^|\\s)([A-Za-z0-9_-]+)\\s*(?:${labelPattern})(?=\\s|$)`, "gi"))];
  return matches.map((match) => match[1]).filter(Boolean);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isContinueRequest(normalizedRequest: string) {
  return (
    normalizedRequest.includes("continue") ||
    normalizedRequest.includes("resume") ||
    normalizedRequest.includes("继续")
  );
}

function isBugRegressionRequest(normalizedRequest: string) {
  return (
    normalizedRequest.includes("bug") &&
    (normalizedRequest.includes("regress") ||
      normalizedRequest.includes("retest") ||
      normalizedRequest.includes("回归") ||
      normalizedRequest.includes("重测"))
  );
}

function isBugReviewRequest(normalizedRequest: string) {
  return normalizedRequest.includes("bug") && !normalizedRequest.includes("regress");
}

function isDocumentSuiteRequest(normalizedRequest: string, source?: string) {
  return Boolean(
    source ||
      normalizedRequest.includes("excel") ||
      normalizedRequest.includes(".xlsx") ||
      normalizedRequest.includes(".md") ||
      normalizedRequest.includes("测试用例文档")
  );
}

function parseBrainCreatorCommand(command: string, systemId: string): {
  tool: "bc_status" | "bc_run" | "bc_review";
  toolInput: Record<string, unknown>;
} {
  return parseBrainCreatorCommandTokens(commandTokens(command), systemId);
}

function parseBrainCreatorCommandTokens(tokens: string[], systemId: string): {
  tool: "bc_status" | "bc_run" | "bc_review";
  toolInput: Record<string, unknown>;
} {
  if (tokens[0]?.toLowerCase() !== "/bc") {
    throw new Error("Brain Creator command must start with /bc");
  }
  const action = tokens[1]?.toLowerCase();
  if (action === "status") {
    return { tool: "bc_status", toolInput: { systemId } };
  }
  if (action === "run") {
    return {
      tool: "bc_run",
      toolInput: parseRunCommandInput(tokens.slice(2), systemId)
    };
  }
  if (action === "continue") {
    return {
      tool: "bc_run",
      toolInput: {
        mode: "case-source-suite",
        systemId,
        resume: true,
        confirm: true
      }
    };
  }
  if (action === "regress" && tokens[2]?.toLowerCase() === "bugs") {
    return {
      tool: "bc_run",
      toolInput: parseBugRegressionCommandInput(tokens.slice(3), systemId)
    };
  }
  if (action === "bugs") {
    return {
      tool: "bc_review",
      toolInput: parseReviewCommandInput(["bug", ...tokens.slice(2)], systemId)
    };
  }
  if (action === "gaps") {
    return {
      tool: "bc_review",
      toolInput: parseReviewCommandInput(["gap", ...tokens.slice(2)], systemId)
    };
  }
  if (action === "review" && tokens[2]) {
    return {
      tool: "bc_review",
      toolInput: parseReviewCommandInput(tokens.slice(2), systemId)
    };
  }
  throw new Error(`Unsupported Brain Creator command: ${tokens.join(" ")}`);
}

function commandWithSystemReference(command: string) {
  const tokens = commandTokens(command);
  const stripped: string[] = [];
  const systemReference: { systemName?: string; environment?: string } = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const normalized = token.toLowerCase();
    if (normalized === "--system" || normalized === "--system-name") {
      const value = tokens[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${token} requires a value`);
      }
      systemReference.systemName = value;
      index += 1;
      continue;
    }
    if (normalized === "--env" || normalized === "--environment") {
      const value = tokens[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${token} requires a value`);
      }
      systemReference.environment = value;
      index += 1;
      continue;
    }
    stripped.push(token);
  }
  return { tokens: stripped, systemReference };
}

function parseRunCommandInput(tokens: string[], systemId: string) {
  const flagIndex = tokens.findIndex((token) => token.startsWith("--"));
  const sourceTokens = flagIndex >= 0 ? tokens.slice(0, flagIndex) : tokens;
  const source = sourceTokens.join(" ").trim();
  if (!source) {
    throw new Error("/bc run requires a case source path");
  }
  const toolInput: Record<string, unknown> = {
    mode: "case-source-suite",
    systemId,
    source,
    confirm: false
  };
  if (flagIndex >= 0) {
    for (let index = flagIndex; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!token.startsWith("--")) {
        throw new Error(`Unexpected /bc run argument: ${token}`);
      }
      const values: string[] = [];
      while (tokens[index + 1] && !tokens[index + 1].startsWith("--")) {
        values.push(tokens[index + 1]);
        index += 1;
      }
      const parsedValues = splitCommandValues(values);
      if (parsedValues.length === 0) {
        throw new Error(`${token} requires a value`);
      }
      if (token === "--case" || token === "--cases") {
        toolInput.caseNos = parsedValues;
      } else if (token === "--module" || token === "--modules") {
        toolInput.modules = parsedValues;
      } else if (token === "--priority" || token === "--priorities") {
        toolInput.priorities = parsedValues;
      } else {
        throw new Error(`Unsupported /bc run option: ${token}`);
      }
    }
  }
  return toolInput;
}

function parseBugRegressionCommandInput(tokens: string[], systemId: string) {
  const toolInput: Record<string, unknown> = {
    mode: "bug-regression",
    systemId
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected /bc regress bugs argument: ${token}`);
    }
    const values: string[] = [];
    while (tokens[index + 1] && !tokens[index + 1].startsWith("--")) {
      values.push(tokens[index + 1]);
      index += 1;
    }
    const parsedValues = splitCommandValues(values);
    if (parsedValues.length === 0) {
      throw new Error(`${token} requires a value`);
    }
    if (token === "--bug" || token === "--bugs") {
      toolInput.bugIds = parsedValues;
    } else if (token === "--module" || token === "--modules") {
      toolInput.modules = parsedValues;
    } else if (token === "--priority" || token === "--priorities") {
      toolInput.priorities = parsedValues;
    } else {
      throw new Error(`Unsupported /bc regress bugs option: ${token}`);
    }
  }
  return toolInput;
}

function parseReviewCommandInput(tokens: string[], systemId: string) {
  const target = commandReviewTarget(tokens[0]);
  const toolInput: Record<string, unknown> = {
    target,
    systemId
  };
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected /bc review argument: ${token}`);
    }
    const values: string[] = [];
    while (tokens[index + 1] && !tokens[index + 1].startsWith("--")) {
      values.push(tokens[index + 1]);
      index += 1;
    }
    const parsedValues = splitCommandValues(values);
    if (parsedValues.length === 0) {
      throw new Error(`${token} requires a value`);
    }
    if (token === "--failure-type" || token === "--failure-types") {
      toolInput.failureTypes = parsedValues;
    } else {
      throw new Error(`Unsupported /bc review option: ${token}`);
    }
  }
  return toolInput;
}

function splitCommandValues(values: string[]) {
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function commandReviewTarget(token: string) {
  const normalized = token.toLowerCase();
  if (normalized === "suite" || normalized === "suites" || normalized === "suite-run") {
    return "suite-run";
  }
  if (normalized === "bug" || normalized === "bugs") {
    return "bug";
  }
  if (normalized === "gap" || normalized === "gaps") {
    return "gap";
  }
  if (normalized === "case" || normalized === "cases") {
    return "case";
  }
  if (normalized === "artifact" || normalized === "artifacts") {
    return "artifact";
  }
  throw new Error(`Unsupported /bc review target: ${token}`);
}

function commandTokens(command: string) {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of command.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

function configureTargetArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (
    ![
      "system",
      "auth",
      "term",
      "rule",
      "checkpoint",
      "knowledge-project",
      "system-binding",
      "connector"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as
    | "system"
    | "auth"
    | "term"
    | "rule"
    | "checkpoint"
    | "knowledge-project"
    | "system-binding"
    | "connector";
}

function prepareActionArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (
    ![
      "ingest-requirement",
      "refresh-requirement",
      "generate-analysis",
      "generate-test-design",
      "confirm-eval-actions",
      "approve-baseline",
      "compile-cases",
      "resolve-test-data",
      "prepare-test-data",
      "submit-test-data",
      "prepare-execution",
      "record-observation",
      "record-page-evidence",
      "record-training-evidence",
      "explore-system",
      "refresh-system-brain"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as
    | "ingest-requirement"
    | "refresh-requirement"
    | "generate-analysis"
    | "generate-test-design"
    | "confirm-eval-actions"
    | "approve-baseline"
    | "compile-cases"
    | "resolve-test-data"
    | "prepare-test-data"
    | "submit-test-data"
    | "prepare-execution"
    | "record-observation"
    | "record-page-evidence"
    | "record-training-evidence"
    | "explore-system"
    | "refresh-system-brain";
}

function testDataTaskResultStatusArg(
  input: Record<string, unknown>,
  key: string
) {
  const value = stringArg(input, key);
  if (value !== "succeeded" && value !== "failed") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

function optionalTestDataProviderDecisionArg(
  input: Record<string, unknown>,
  key: string
) {
  const value = optionalStringArg(input, key);
  if (value === undefined) return undefined;
  if (value !== "reuse" && value !== "create") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

function testDataResolutionsArg(
  input: Record<string, unknown>,
  key: string
) {
  const value = input[key] ?? [];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  const decisions = new Set([
    "use-value",
    "reuse",
    "create",
    "capture",
    "secret-reference"
  ]);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${key}[${index}] must be an object`);
    }
    const resolution = item as Record<string, unknown>;
    if (
      typeof resolution.profileId !== "string" ||
      typeof resolution.decision !== "string" ||
      !decisions.has(resolution.decision) ||
      (resolution.value !== undefined && typeof resolution.value !== "string") ||
      (resolution.reference !== undefined &&
        typeof resolution.reference !== "string")
    ) {
      throw new Error(`${key}[${index}] is invalid`);
    }
    return {
      profileId: resolution.profileId,
      decision: resolution.decision as
        | "use-value"
        | "reuse"
        | "create"
        | "capture"
        | "secret-reference",
      value: resolution.value as string | undefined,
      reference: resolution.reference as string | undefined
    };
  });
}

function knowledgeNodeTypeArg(input: Record<string, unknown>, key: string): KnowledgeNodeType {
  const value = stringArg(input, key);
  const allowed: KnowledgeNodeType[] = [
    "module", "actor", "object", "field", "rule", "workflow", "state", "permission",
    "integration", "data-constraint", "term", "requirement"
  ];
  if (!allowed.includes(value as KnowledgeNodeType)) throw new Error(`${key} is invalid`);
  return value as KnowledgeNodeType;
}

function policyProviderArg(input: Record<string, unknown>, key: string) {
  const value = optionalStringArg(input, key) ?? "builtin";
  if (value !== "builtin" && value !== "host-skill") throw new Error(`${key} is invalid`);
  return value;
}

function explorationInteractionModeArg(
  input: Record<string, unknown>,
  key: string
): "off" | "safe" {
  const value = optionalStringArg(input, key) ?? "off";
  if (value !== "off" && value !== "safe") throw new Error(`${key} is invalid`);
  return value;
}

function requirementContentPackageArg(
  input: Record<string, unknown>,
  key: string
): RequirementContentPackage | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  const candidate = value as RequirementContentPackage;
  if (
    typeof candidate.title !== "string" ||
    typeof candidate.content !== "string" ||
    typeof candidate.source !== "string" ||
    typeof candidate.sourceType !== "string" ||
    typeof candidate.contentHash !== "string" ||
    !Array.isArray(candidate.blocks) ||
    !Array.isArray(candidate.attachments) ||
    !Array.isArray(candidate.warnings)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return candidate;
}

function pageEvidenceArg(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const interactiveElements = record.interactiveElements;
  if (!Array.isArray(interactiveElements)) {
    throw new Error(`${key}.interactiveElements must be an array`);
  }
  return {
    title: stringArg(record, "title"),
    finalUrl: stringArg(record, "finalUrl"),
    domText: stringArg(record, "domText"),
    screenshotPath: stringArg(record, "screenshotPath"),
    interactiveElements: interactiveElements.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`${key}.interactiveElements[${index}] must be an object`);
      }
      const element = item as Record<string, unknown>;
      return {
        name: stringArg(element, "name"),
        role: stringArg(element, "role"),
        text: stringArg(element, "text"),
        selector: stringArg(element, "selector")
      };
    }),
    consoleErrors: stringArrayArg(record, "consoleErrors"),
    networkFailures: stringArrayArg(record, "networkFailures"),
    issues: stringArrayArg(record, "issues")
  };
}

function trainingEvidenceArg(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.actions) || !Array.isArray(record.apiRequests)) {
    throw new Error(`${key} requires actions and apiRequests arrays`);
  }
  const actions = record.actions.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${key}.actions[${index}] must be an object`);
    }
    const action = item as Record<string, unknown>;
    const type = stringArg(action, "type");
    if (!["click", "fill", "select", "assert", "navigate", "wait"].includes(type)) {
      throw new Error(`${key}.actions[${index}].type is invalid`);
    }
    return {
      type,
      targetLocatorId: stringArg(action, "targetLocatorId"),
      inputValue: optionalStringArg(action, "inputValue") ?? "",
      assertion: optionalStringArg(action, "assertion") ?? ""
    };
  });
  const apiRequests = record.apiRequests.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${key}.apiRequests[${index}] must be an object`);
    }
    const request = item as Record<string, unknown>;
    const status = numberArg(request, "status");
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new Error(`${key}.apiRequests[${index}].status is invalid`);
    }
    return {
      method: stringArg(request, "method").toUpperCase(),
      url: stringArg(request, "url"),
      status
    };
  });
  const artifactValue = record.artifacts;
  let artifacts: { traceUrl: string; harUrl: string; screenshotUrl: string } | undefined;
  if (artifactValue !== undefined) {
    if (!artifactValue || typeof artifactValue !== "object" || Array.isArray(artifactValue)) {
      throw new Error(`${key}.artifacts must be an object`);
    }
    const artifact = artifactValue as Record<string, unknown>;
    artifacts = {
      traceUrl: stringArg(artifact, "traceUrl"),
      harUrl: stringArg(artifact, "harUrl"),
      screenshotUrl: stringArg(artifact, "screenshotUrl")
    };
  }
  return { actions, apiRequests, artifacts };
}

function assertSystemEvidenceUrl(
  context: BrainCreatorMcpContext,
  systemId: string,
  value: string
) {
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) throw new Error("Business system not found");
  const target = new URL(value);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Page evidence URL must use http or https");
  }
  const allowed = [system.baseUrl, ...system.urlAllowlist].some((candidate) => {
    try {
      const allowedUrl = new URL(candidate);
      const allowedPath = allowedUrl.pathname.replace(/\/+$/, "") || "/";
      return (
        target.origin === allowedUrl.origin &&
        (allowedPath === "/" ||
          target.pathname === allowedPath ||
          target.pathname.startsWith(`${allowedPath}/`))
      );
    } catch {
      return false;
    }
  });
  if (!allowed) throw new Error("Page evidence URL is outside the system URL allowlist");
}

function stringArrayArg(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function optionalStringArrayArg(input: Record<string, unknown>, key: string): string[] | undefined {
  return Array.isArray(input[key]) ? stringArrayArg(input, key) : undefined;
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

function bugStatusArg(input: Record<string, unknown>, key: string) {
  const value = optionalStringArg(input, key);
  if (value === undefined) {
    return undefined;
  }
  if (!["open", "retest-running", "retest-passed", "retest-failed", "closed"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as "open" | "retest-running" | "retest-passed" | "retest-failed" | "closed";
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

function agentOutputStatusArg(input: Record<string, unknown>, key: string): "succeeded" | "failed" {
  const value = stringArg(input, key);
  if (!["succeeded", "failed"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as "succeeded" | "failed";
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
