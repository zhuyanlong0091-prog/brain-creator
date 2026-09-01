import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BrainCreatorService } from "../domain/service.js";
import { formatScenariosAsMarkdown, parseSpecMarkdown } from "../agent/caseFormatter.js";
import {
  InMemoryBrainCreatorRepository,
  JsonFileBrainCreatorRepository,
  ShardedFileBrainCreatorRepository,
  SHARDED_REPOSITORY_SCHEMA_VERSION
} from "../domain/repository.js";
import { generateSeedFile } from "../agent/seedGenerator.js";
import { buildAgentPrompt } from "../agent/promptBuilder.js";
import { checkBusinessRules } from "../agent/qualityGate.js";
import { extractCandidateTerms } from "../agent/termExtractor.js";
import { createConfiguredAgentBridge } from "../agent/bridgeProvider.js";
import {
  mergeRuntimeConfiguration,
  readRuntimeConfiguration,
  resolveRuntimeConfigurationPath,
  runtimeEnvironment,
  writeRuntimeConfiguration,
  type RuntimeConfiguration,
  type RuntimeConfigurationPatch
} from "../agent/runtimeConfiguration.js";
import {
  verifyStoredBrowserAuth,
  type AuthStateVerification,
  type AuthStateVerifier
} from "../agent/authStateVerifier.js";
import {
  materializeBrowserAuthState,
  type AuthStateMaterializer
} from "../agent/authStateMaterializer.js";
import {
  AuthStateRefreshRegistry,
  createDefaultAuthRefreshRegistry,
  type AuthRefreshAdapter,
  type AuthStateRefresher
} from "../agent/authStateRefresh.js";
import { createStandardAuthProviderAdapters } from "../agent/standardAuthProviders.js";
import { BrainCreatorError, errorEnvelope, successEnvelope } from "../shared/envelope.js";
import {
  resolveBrainCreatorDataFile,
  resolveBrainCreatorStoreDir,
  resolveBrainCreatorKnowledgeDir,
  resolveBrainCreatorWorkspace
} from "../shared/workspace.js";
import { KnowledgeService } from "../knowledge/service.js";
import { RequirementAnalysisHostHarness } from "../knowledge/requirementHarness.js";
import {
  resolveRequirementSource,
  type RequirementSourceReader
} from "../knowledge/sourceAdapters.js";
import { FeishuOpenApiAdapter } from "../knowledge/feishuAdapter.js";
import { writeArtifactManifest } from "../storage/artifactArchive.js";
import {
  artifactFileName,
  resolveArtifactRunLayout,
  writeArtifactPlaywrightConfig,
  type ArtifactRunLayout
} from "../storage/artifactWorkspace.js";
import { writeStaticSuiteExecutionReport } from "../execution/staticSuiteReport.js";
import {
  browserObservationCapability,
  playwrightTestArgs
} from "../execution/browserObservation.js";
import { normalizeHostSkillAnalysis } from "../knowledge/policies.js";
import { buildContextPack } from "../knowledge/retriever.js";
import { reconcileRequirementCoverage } from "../knowledge/requirementReconciliation.js";
import {
  evaluateStabilityPolicy,
  isStabilityScheduleDue
} from "../knowledge/stabilityPolicy.js";
import {
  SystemExplorationCoordinator,
  type SystemExplorer
} from "../knowledge/systemExplorer.js";
import {
  TestDataProviderService,
  type TestDataSubmitResult
} from "../knowledge/testDataProvider.js";
import { ExecutionPreflightService } from "../knowledge/executionPreflight.js";
import { StatefulExplorationPlanService } from "../knowledge/statefulExplorationPlan.js";
import { OnboardingPlanService } from "../knowledge/onboardingPlan.js";
import { buildCaseDependencyGraph } from "../knowledge/caseDependencyGraph.js";
import { RequirementSuiteRunService } from "../knowledge/requirementSuiteRun.js";
import { RunLedgerService } from "../knowledge/runLedger.js";
import { ExecutionDiagnosisService } from "../knowledge/executionDiagnosis.js";
import {
  classifyEvidenceFailure,
  recoverExecutionState
} from "../knowledge/executionRecovery.js";
import {
  classifyExecutionFailure as classifyFailure
} from "../knowledge/failureClassifier.js";
import {
  commandRunnerAgentBridge,
  generatePlanDraft,
  preflightAgentBridge,
  runAgent,
  runChain,
  spawnCommand,
  validateActorJourneyUsage,
  validateStepInstrumentation,
  type AgentBridge,
  type AgentBridgeWithMetadata,
  type CommandResult,
  type CommandRunner
} from "../agent/orchestrator.js";
import { runInHarness } from "../agent/harnessAdapter.js";
import {
  evaluateStructuredAgentOutput,
  plannerOutputFromResult
} from "../brain/harnessSchema.js";
import { HarnessRuntime } from "../brain/harness.js";
import type { BrainEvalResult } from "../brain/types.js";
import { SemanticSpineService } from "../brain/semanticSpine.js";
import { SystemBrainSnapshotService } from "../brain/systemSnapshot.js";
import {
  InMemoryTestDataProvider,
  TestDataBrainService,
  type TestDataProvider
} from "../brain/testdata.js";
import {
  normalizeReporterExitCode,
  parsePlaywrightJsonReport
} from "../execution/playwrightReporter.js";
import {
  EvaluationProviderRegistry,
  type MutationOutcome
} from "../brain/scenarioAssurance.js";
import { parseCaseSource, summarizeDocumentCases, type ParsedCaseSource } from "../caseSource/parser.js";
import { writeXlsxCaseSourceResults } from "../caseSource/writeBack.js";
import { id } from "../shared/id.js";
import { resolveProtectedStorageStatePath } from "../shared/authStorage.js";
import { decryptSecrets } from "../shared/crypto.js";
import { redactSensitiveText, scanSensitivePatterns, scanSensitiveValues } from "../shared/secretScan.js";
import type {
  AgentRun,
  AgentTask,
  AuthCheckpoint,
  AuthProfile,
  BrowserExecutionMode,
  BugReport,
  CaseSuiteRun,
  CaseSuite,
  CaseSuiteCaseResult,
  ChainRun,
  CompileRun,
  DocumentCase,
  ExecutableCase,
  ExecutionEvidence,
  ExecutionDiagnosis,
  ExecutionDiagnosisVerdict,
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
  KnowledgeNodeType,
  LegacyDiagnosisDecision,
  SystemProfile,
  StabilityPolicy,
  TestCase
} from "../domain/types.js";
import type {
  BrainCreatorToolName,
  BrainCreatorToolRequest
} from "./tools.js";

export type BrainCreatorMcpContext = {
  repository: InMemoryBrainCreatorRepository;
  service: BrainCreatorService;
  knowledgeService: KnowledgeService;
  requirementAnalysisHarness: RequirementAnalysisHostHarness;
  testDataProvider: TestDataProviderService;
  testDataBrain: TestDataBrainService;
  executionPreflight: ExecutionPreflightService;
  requirementSuiteRuns: RequirementSuiteRunService;
  runLedger: RunLedgerService;
  executionDiagnosis: ExecutionDiagnosisService;
  systemExploration: SystemExplorationCoordinator;
  statefulExplorationPlans: StatefulExplorationPlanService;
  onboardingPlans: OnboardingPlanService;
  harness: HarnessRuntime;
  semanticSpine: SemanticSpineService;
  systemBrainSnapshots: SystemBrainSnapshotService;
  providerRegistry: EvaluationProviderRegistry;
  workDir: string;
  agentBridge?: AgentBridgeWithMetadata;
  runner?: CommandRunner;
  structuredReporter?: boolean;
  authStateVerifier: AuthStateVerifier;
  authStateMaterializer: AuthStateMaterializer;
  authStateRefresher?: AuthStateRefresher;
  authRefreshRegistry: AuthStateRefreshRegistry;
  authVerificationCache: Map<string, number>;
  feishuReader?: RequirementSourceReader;
  runtimeConfiguration?: RuntimeConfiguration;
  runtimeConfigurationPath: string;
  reloadRuntimeConfiguration: (input?: {
    configuration?: RuntimeConfiguration;
    persist?: boolean;
  }) => Promise<{ configuration?: RuntimeConfiguration; bridgeProvider?: string; connectorStatus: string; path: string }>;
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
  storeDirPath?: string;
  workDir?: string;
  agentBridge?: AgentBridgeWithMetadata;
  runner?: CommandRunner;
  structuredReporter?: boolean;
  authStateVerifier?: AuthStateVerifier;
  authStateMaterializer?: AuthStateMaterializer;
  authStateRefresher?: AuthStateRefresher;
  authRefreshRegistry?: AuthStateRefreshRegistry;
  authRefreshAdapters?: AuthRefreshAdapter[];
  testDataProviders?: TestDataProvider[];
  knowledgeDir?: string;
  feishuReader?: RequirementSourceReader;
  systemExplorer?: SystemExplorer;
};

export function createBrainCreatorMcpContext(
  input: CreateContextInput = {}
): BrainCreatorMcpContext {
  const workDir = input.workDir ?? resolveBrainCreatorWorkspace();
  const initialRuntimeConfiguration = readRuntimeConfiguration(workDir);
  const initialRuntimeEnvironment = runtimeEnvironment(initialRuntimeConfiguration, process.env);
  const authStateMaterializer = input.authStateMaterializer ?? materializeBrowserAuthState;
  const genericAuthRefreshAdapters: AuthRefreshAdapter[] = [
    {
      provider: "token",
      supports: (refreshInput) => refreshInput.authProfile.loginMethod === "token",
      refresh: async (refreshInput) => {
        const materialized = await authStateMaterializer({
          workDir: refreshInput.workDir,
          system: refreshInput.system,
          authProfile: refreshInput.authProfile
        });
        return { status: "succeeded", storageStatePath: materialized.storageStatePath };
      }
    },
    {
      provider: "cookie",
      supports: (refreshInput) => refreshInput.authProfile.loginMethod === "cookie",
      refresh: async (refreshInput) => {
        const materialized = await authStateMaterializer({
          workDir: refreshInput.workDir,
          system: refreshInput.system,
          authProfile: refreshInput.authProfile
        });
        return { status: "succeeded", storageStatePath: materialized.storageStatePath };
      }
    }
  ];
  const repository = input.dataFilePath
    ? new JsonFileBrainCreatorRepository(input.dataFilePath)
    : new ShardedFileBrainCreatorRepository(
        input.storeDirPath ?? resolveBrainCreatorStoreDir(workDir),
        resolveBrainCreatorDataFile(workDir)
      );
  const harness = new HarnessRuntime(repository);
  const semanticSpine = new SemanticSpineService(repository);
  const systemBrainSnapshots = new SystemBrainSnapshotService(repository);
  const providerRegistry = new EvaluationProviderRegistry({
    environment: initialRuntimeEnvironment
  });
  const service = new BrainCreatorService(repository);
  const configuredAuthProviders = new Set(
    (input.authRefreshAdapters ?? []).map((adapter) => adapter.provider)
  );
  const authRegistryManaged = !input.authRefreshRegistry;
  const createRuntimeAuthRefreshRegistry = () =>
    createDefaultAuthRefreshRegistry(input.authStateRefresher, [
      ...(input.authRefreshAdapters ?? []),
      ...createStandardAuthProviderAdapters().filter(
        (adapter) => !configuredAuthProviders.has(adapter.provider)
      ),
      ...genericAuthRefreshAdapters
    ]);
  const knowledgeService = new KnowledgeService(
    repository,
    input.knowledgeDir ?? resolveBrainCreatorKnowledgeDir(workDir),
    workDir,
    systemBrainSnapshots,
    semanticSpine
  );
  const requirementAnalysisHarness = new RequirementAnalysisHostHarness(
    repository,
    harness,
    input.knowledgeDir ?? resolveBrainCreatorKnowledgeDir(workDir)
  );
  const testDataBrain = new TestDataBrainService(repository, [
    ...(input.testDataProviders ?? []),
    new InMemoryTestDataProvider("local-fixture-provider")
  ]);
  const testDataProvider = new TestDataProviderService(
    repository,
    knowledgeService,
    join(workDir, ".brain-creator"),
    testDataBrain
  );
  const executionPreflight = new ExecutionPreflightService(repository);
  const runLedger = new RunLedgerService(repository);
  const executionDiagnosis = new ExecutionDiagnosisService(repository);
  const requirementSuiteRuns = new RequirementSuiteRunService(
    repository,
    runLedger
  );
  const statefulExplorationPlans = new StatefulExplorationPlanService(
    repository,
    knowledgeService
  );
  const onboardingPlans = new OnboardingPlanService(
    repository,
    knowledgeService,
    statefulExplorationPlans
  );
  const runtimeManaged = !input.agentBridge && !input.runner;
  const context: BrainCreatorMcpContext = {
    repository,
    service,
    knowledgeService,
    requirementAnalysisHarness,
    testDataProvider,
    testDataBrain,
    executionPreflight,
    requirementSuiteRuns,
    runLedger,
    executionDiagnosis,
    systemExploration: new SystemExplorationCoordinator({
      repository,
      service,
      knowledgeService,
      workDir,
      explorer: input.systemExplorer
    }),
    statefulExplorationPlans,
    onboardingPlans,
    harness,
    semanticSpine,
    systemBrainSnapshots,
    providerRegistry,
    workDir,
    agentBridge:
      input.agentBridge ??
      (input.runner
        ? commandRunnerAgentBridge(input.runner)
        : createConfiguredAgentBridge({ env: initialRuntimeEnvironment })),
    runner: input.runner,
    structuredReporter: input.structuredReporter,
    authStateVerifier: input.authStateVerifier ?? verifyStoredBrowserAuth,
    authStateMaterializer,
    authStateRefresher: input.authStateRefresher,
    authRefreshRegistry: input.authRefreshRegistry ?? createRuntimeAuthRefreshRegistry(),
    authVerificationCache: new Map(),
    feishuReader: input.feishuReader ?? configuredFeishuReader(initialRuntimeEnvironment),
    runtimeConfiguration: initialRuntimeConfiguration,
    runtimeConfigurationPath: resolveRuntimeConfigurationPath(workDir),
    reloadRuntimeConfiguration: async (reloadInput = {}) => {
      const configuration = reloadInput.configuration === undefined
        ? readRuntimeConfiguration(workDir)
        : reloadInput.configuration;
      const candidateEnvironment = runtimeEnvironment(configuration, process.env);
      const candidateBridge = runtimeManaged
        ? createConfiguredAgentBridge({ env: candidateEnvironment })
        : context.agentBridge;
      const candidateAuthRefreshRegistry = authRegistryManaged
        ? createRuntimeAuthRefreshRegistry()
        : context.authRefreshRegistry;
      if (runtimeManaged && configuration?.bridgeProvider !== "disabled") {
        const bridgeCheck = await preflightAgentBridge(candidateBridge);
        if (!bridgeCheck.ok) {
          throw new BrainCreatorError({
            code: "BC_RUNTIME_PREFLIGHT_FAILED",
            message: bridgeCheck.error ?? "Runtime bridge preflight failed",
            userMessage: {
              enUS: `Runtime configuration preflight failed: ${bridgeCheck.error ?? "unknown error"}`,
              zhCN: `运行时配置预检失败：${bridgeCheck.error ?? "未知错误"}`
            },
            nextAction: "review-runtime-config",
            retryable: true
          });
        }
      }
      if (reloadInput.persist && configuration) writeRuntimeConfiguration(workDir, configuration);
      if (runtimeManaged) {
        context.agentBridge = candidateBridge;
        context.feishuReader = configuredFeishuReader(candidateEnvironment);
        context.providerRegistry = new EvaluationProviderRegistry({
          environment: candidateEnvironment
        });
      }
      if (authRegistryManaged) context.authRefreshRegistry = candidateAuthRefreshRegistry;
      context.runtimeConfiguration = configuration;
      return {
        ...(configuration ? { configuration } : {}),
        ...(candidateBridge?.provider ? { bridgeProvider: candidateBridge.provider } : {}),
        registeredAuthProviders: candidateAuthRefreshRegistry.providers(),
        connectorStatus: context.feishuReader ? "feishu-configured" : "host-agent-fallback",
        path: resolveRuntimeConfigurationPath(workDir)
      };
    }
  };
  return context;
}

export async function handleBrainCreatorTool(
  context: BrainCreatorMcpContext,
  name: BrainCreatorToolName,
  input: Record<string, unknown>,
  request?: BrainCreatorToolRequest
): Promise<CallToolResult> {
  try {
    switch (name) {
      case "bc_prepare":
        return facadeTextResult(await prepareFacade(context, input), input);
      case "bc_command":
        return textResult(await commandFacade(context, input));
      case "bc_intent_preview":
        return textResult(intentPreviewFacade(context, input));
      case "bc_status":
        return facadeTextResult(await statusFacade(context, input), input);
      case "bc_run":
        return facadeTextResult(
          await runWithProgress(context, input, request),
          input
        );
      case "bc_review":
        return facadeTextResult(await reviewFacade(context, input), input);
      case "bc_configure":
        return facadeTextResult(await configureFacade(context, input), input);
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
        return textResult(
          await submitAgentOutputWithProgress(context, input, request)
        );
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
    await notifyMcpProgress(request, {
      progress: 1,
      total: 1,
      message: "Brain Creator failed. Inspect the error envelope and trace ID."
    });
    return envelopeResult(errorEnvelope(error), true);
  }
}

async function runWithProgress(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>,
  request?: BrainCreatorToolRequest
) {
  await notifyMcpProgress(request, {
    progress: 0,
    total: 1,
    message: "Brain Creator started the requested run."
  });
  const result = await runFacade(context, input);
  await publishResultProgress(context, result, input, request);
  return result;
}

async function submitAgentOutputWithProgress(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>,
  request?: BrainCreatorToolRequest
) {
  await notifyMcpProgress(request, {
    progress: 0,
    total: 1,
    message: "Brain Creator is validating the submitted Agent output."
  });
  const result = await submitAgentOutput(context, input);
  await publishResultProgress(context, result, input, request);
  return result;
}

async function publishResultProgress(
  context: BrainCreatorMcpContext,
  result: Record<string, unknown>,
  input: Record<string, unknown>,
  request?: BrainCreatorToolRequest
) {
  const runId = findNestedString(result, "requirementSuiteRunId") ??
    findNestedString(result, "suiteId") ??
    findNestedString(result, "id", "requirementSuiteRun");
  if (!runId) {
    await notifyMcpProgress(request, {
      progress: 1,
      total: 1,
      message: "Brain Creator completed the requested operation."
    });
    return;
  }
  let progress;
  try {
    progress = context.runLedger.progress(runId);
  } catch {
    await notifyMcpProgress(request, {
      progress: 1,
      total: 1,
      message: `Brain Creator updated run ${runId}.`
    });
    return;
  }
  const events = input.observationMode === "step-by-step"
    ? progress.events.slice(-50)
    : progress.current
      ? [progress.current]
      : [];
  for (const event of events) {
    await notifyMcpProgress(request, {
      progress: event.sequence,
      message: [
        event.caseTitle,
        event.stepTitle,
        event.status
      ].filter(Boolean).join(" | ")
    });
  }
}

async function notifyMcpProgress(
  request: BrainCreatorToolRequest | undefined,
  params: { progress: number; total?: number; message?: string }
) {
  if (request?.progressToken === undefined || !request.sendNotification) return;
  try {
    await request.sendNotification({
      method: "notifications/progress",
      params: {
        progressToken: request.progressToken,
        ...params
      }
    });
  } catch {
    // Progress transport is best-effort; the durable Run Ledger remains authoritative.
  }
}

function findNestedString(
  value: unknown,
  key: string,
  parentKey?: string,
  currentKey?: string,
  depth = 0
): string | undefined {
  if (!value || typeof value !== "object" || depth > 5) return undefined;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    if (childKey === key && typeof child === "string" && (!parentKey || currentKey === parentKey)) {
      return child;
    }
    const nested = findNestedString(child, key, parentKey, childKey, depth + 1);
    if (nested) return nested;
  }
  return undefined;
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
  if (action === "rollback-legacy-diagnosis") {
    const resolution = resolveSystemReference(context, input);
    const rollbackInput = {
      systemId: resolution.systemId,
      reviewId: stringArg(input, "diagnosisReviewId")
    };
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        ...context.executionDiagnosis.previewLegacyRollback(rollbackInput),
        systemResolution: resolution,
        nextAction:
          "Present the rollback changes and ask for explicit confirmation with a human rollback note."
      };
    }
    return {
      status: "rolled-back",
      ...context.executionDiagnosis.confirmLegacyRollback({
        ...rollbackInput,
        note: stringArg(input, "confirmationNote")
      }),
      systemResolution: resolution,
      nextAction:
        "Re-audit the restored historical asset before applying another diagnosis."
    };
  }
  if (action === "review-legacy-diagnosis") {
    const resolution = resolveSystemReference(context, input);
    const reviewInput = {
      systemId: resolution.systemId,
      assetType: diagnosisAssetTypeArg(input, "diagnosisAssetType"),
      assetId: stringArg(input, "diagnosisAssetId"),
      decision: legacyDiagnosisDecisionArg(input, "diagnosisDecision"),
      correctedFailureType: optionalExecutionFailureTypeArg(
        input,
        "correctedFailureType"
      ),
      correctedVerdict: optionalExecutionDiagnosisVerdictArg(
        input,
        "correctedVerdict"
      )
    };
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        ...context.executionDiagnosis.previewLegacyReview(reviewInput),
        systemResolution: resolution,
        nextAction:
          "Present the proposed asset changes and ask for explicit confirmation with a human review note."
      };
    }
    return {
      status: "confirmed",
      ...context.executionDiagnosis.confirmLegacyReview({
        ...reviewInput,
        note: stringArg(input, "confirmationNote")
      }),
      systemResolution: resolution,
      nextAction: "Review the updated diagnosis, Bug, and Gap state."
    };
  }
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
    const pendingAttachments = result.source.attachments.filter(
      (attachment) => attachment.status !== "confirmed"
    );
    return {
      ...result,
      status: result.changed ? "draft-created" : "unchanged",
      attachmentSummary: {
        total: result.source.attachments.length,
        pending: pendingAttachments.length
      },
      nextAction:
        pendingAttachments.length > 0
          ? "analyze-attachments"
          : result.changed
            ? "generate-test-design"
            : "review-existing-baseline"
    };
  }
  if (action === "analyze-attachments") {
    const sourceId = stringArg(input, "requirementSourceId");
    const downloader = context.feishuReader?.downloadAttachment
      ? context.feishuReader.downloadAttachment.bind(context.feishuReader)
      : undefined;
    const result = await context.knowledgeService.prepareRequirementAttachments({
      sourceId,
      attachmentIds: stringArrayArg(input, "attachmentIds"),
      downloader
    });
    return {
      status: result.recognitionRequests.length > 0
        ? "needs-host-vision"
        : result.gaps.length > 0
          ? "blocked"
          : "structured",
      ...result,
      requiredOutput: result.recognitionRequests.length > 0 ? "AttachmentAnalysis" : undefined,
      nextAction:
        result.recognitionRequests.length > 0
          ? "Use the host multimodal capability on each localPath, then submit each structured result with submit-attachment-analysis."
          : result.gaps.length > 0
            ? "Restore connector access or resolve the attachment Gap before approving the requirement baseline."
            : "Review and confirm each draft attachment analysis."
    };
  }
  if (action === "submit-attachment-analysis") {
    const analysis = context.knowledgeService.submitRequirementAttachmentAnalysis({
      sourceId: stringArg(input, "requirementSourceId"),
      attachmentId: stringArg(input, "attachmentId"),
      provider: "host-agent",
      result: attachmentAnalysisArg(input, "attachmentAnalysis")
    });
    return {
      status: "draft-created",
      analysis,
      nextAction: "Present the structured visual interpretation and ask the user to confirm it."
    };
  }
  if (action === "confirm-attachment-analysis") {
    if (!optionalBooleanArg(input, "confirm")) {
      const analysisId = stringArg(input, "attachmentAnalysisId");
      const analysis = context.repository.attachmentAnalyses.find((item) => item.id === analysisId);
      if (!analysis) throw new Error("Attachment analysis not found");
      return {
        status: "preview",
        analysis,
        requiresConfirmation: true,
        nextAction: "Ask the user to confirm this visual interpretation before it enters requirement knowledge."
      };
    }
    return context.knowledgeService.confirmRequirementAttachmentAnalysis({
      analysisId: stringArg(input, "attachmentAnalysisId"),
      confirmedBy: optionalStringArg(input, "confirmedBy")
    });
  }
  if (action === "generate-analysis" || action === "generate-test-design") {
    const provider = policyProviderArg(input, "provider");
    const requirementSetId = stringArg(input, "requirementSetId");
    if (provider === "host-agent") {
      if (action === "generate-analysis") {
        return input.taskId && input.analysisPackage !== undefined
          ? context.requirementAnalysisHarness.submit({
              taskId: stringArg(input, "taskId"),
              output: input.analysisPackage
            })
          : context.requirementAnalysisHarness.start(requirementSetId);
      }
      const result = await context.requirementAnalysisHarness.latestCompletedResult(requirementSetId);
      if (!result) {
        return {
          status: "needs-host-analysis",
          requirementSetId,
          nextAction: "Run generate-analysis with provider=host-agent before generating test design."
        };
      }
      if (result.evaluation.verdict === "blocked" || result.evaluation.verdict === "retry") {
        return {
          status: "blocked",
          requirementSetId,
          evaluation: result.evaluation,
          nextAction: "Resolve the Requirement Host Harness findings before generating test design."
        };
      }
      return context.knowledgeService.generateTestDesign(
        requirementSetId,
        provider,
        result.analysis,
        result.models
      );
    }
    if (provider === "host-skill" && action === "generate-test-design" && input.analysisPackage === undefined) {
      const result = await context.requirementAnalysisHarness.latestCompletedResult(requirementSetId);
      if (result?.analysis.provider === "host-skill") {
        if (result.evaluation.verdict === "blocked" || result.evaluation.verdict === "retry") {
          return {
            status: "blocked",
            requirementSetId,
            evaluation: result.evaluation,
            nextAction: "Resolve the Requirement Host Harness findings before generating test design."
          };
        }
        return context.knowledgeService.generateTestDesign(
          requirementSetId,
          provider,
          result.analysis,
          result.models
        );
      }
    }
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
    if (provider === "host-skill") {
      return context.requirementAnalysisHarness.startFromHostSkill(
        normalizeHostSkillAnalysis(input.analysisPackage, requirementSetId)
      );
    }
    return context.knowledgeService.generateTestDesign(
      requirementSetId,
      provider,
      undefined
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
      confirm: true,
      confirmedBy: optionalStringArg(input, "confirmedBy")
    });
  }
  if (action === "assess-scenarios") {
    const result = context.knowledgeService.assessBusinessScenarios({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      requirementSetId: stringArg(input, "requirementSetId"),
      systemId: optionalStringArg(input, "systemId"),
      scenarioIds: stringArrayArg(input, "scenarioIds"),
      providerIndependence: optionalStringArg(input, "providerIndependence") as
        | "deterministic"
        | "isolated-single-provider"
        | "cross-provider"
        | "human-confirmed"
        | undefined
    });
    return {
      status: result.summary.blocked > 0 ? "blocked" : result.summary.needsReview > 0 ? "needs-review" : "passed",
      ...result
    };
  }
  if (action === "record-scenario-run") {
    const scenarioId = stringArg(input, "scenarioId");
    const scenario = context.repository.businessScenarios.find((item) => item.id === scenarioId);
    if (!scenario) throw new Error("Business scenario not found");
    const requirementSet = context.repository.requirementSets.find(
      (item) => item.id === scenario.requirementSetId
    );
    if (!requirementSet) throw new Error("Requirement set not found for business scenario");
    const executionEvidenceId = optionalStringArg(input, "executionEvidenceId");
    if (executionEvidenceId) {
      const evidence = context.repository.executionEvidence.find(
        (item) => item.id === executionEvidenceId && item.systemId === optionalStringArg(input, "systemId")
      );
      if (!evidence) throw new Error("Completed execution evidence was not found for this system");
      const trust = context.knowledgeService.recordScenarioEvidenceRun({
        scenarioId,
        evidence,
        observationMode: optionalStringArg(input, "observationMode") === "observe" ? "observe" : "headless"
      });
      if (!trust) throw new Error("Execution evidence could not be uniquely bound to the scenario");
      return {
        status: "recorded",
        trust,
        nextAction: "Review scenario trust status before enabling unattended execution."
      };
    }
    if (input.runPassed === true || input.strongEvidence === true) {
      throw new Error("executionEvidenceId is required; trust must be recorded from completed evidence");
    }
    return {
      status: "recorded",
      trust: context.knowledgeService.recordScenarioStrongRun({
        scenarioId,
        systemId: optionalStringArg(input, "systemId"),
        passed: input.runPassed === true,
        strongEvidence: input.strongEvidence === true,
        requirementHash: optionalStringArg(input, "requirementHash") ?? requirementSet.contentHash,
        systemSnapshotHash: optionalStringArg(input, "systemSnapshotHash"),
        dataPlanHash: optionalStringArg(input, "dataPlanHash"),
        evidenceRefs: stringArrayArg(input, "evidenceRefs"),
        reason: optionalStringArg(input, "reason")
      }),
      nextAction: "Review scenario trust status before enabling unattended execution."
    };
  }
  if (action === "evaluate-mutations") {
    const result = context.knowledgeService.evaluateScenarioMutations({
      mutations: mutationResultsArg(input),
      threshold: optionalNumberArg(input, "mutationThreshold")
    });
    return {
      status: result.verdict,
      ...result,
      nextAction: result.verdict === "pass"
        ? "Record the mutation evidence with the scenario assurance review."
        : "Review survived or blocked mutations before promoting the scenario."
    };
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
  if (
    action === "resolve-gap" ||
    action === "dismiss-gap" ||
    action === "reopen-gap"
  ) {
    const resolution = resolveSystemReference(context, input);
    const gapId = stringArg(input, "gapId");
    const gap = context.repository.gaps.find(
      (item) => item.id === gapId && item.projectId === resolution.systemId
    );
    if (!gap) throw new Error("Gap not found");
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        operation: action.replace("-gap", ""),
        gap,
        requiresConfirmation: true,
        nextAction: "Present the Gap transition, evidence, and note before confirmation."
      };
    }
    return context.service.transitionGap({
      projectId: resolution.systemId,
      gapId,
      operation:
        action === "resolve-gap"
          ? "resolve"
          : action === "dismiss-gap"
            ? "dismiss"
            : "reopen",
      note: stringArg(input, "confirmationNote"),
      evidenceRefs: stringArrayArg(input, "evidenceRefs")
    });
  }
  if (action === "confirm-page-binding") {
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        testIntentId: stringArg(input, "testIntentId"),
        systemId: stringArg(input, "systemId"),
        pageModelId: stringArg(input, "pageModelId"),
        role: optionalStringArg(input, "role"),
        requiresConfirmation: true,
        nextAction: "Present the selected page and evidence before confirming the binding."
      };
    }
    return context.knowledgeService.confirmPageBinding({
      testIntentId: stringArg(input, "testIntentId"),
      systemId: stringArg(input, "systemId"),
      pageModelId: stringArg(input, "pageModelId"),
      role: optionalStringArg(input, "role"),
      note: stringArg(input, "confirmationNote")
    });
  }
  if (action === "create-onboarding-plan") {
    const result = context.onboardingPlans.create({
      requirementSetId: stringArg(input, "requirementSetId"),
      systemId: stringArg(input, "systemId"),
      actorJourney: actorJourneyArg(input),
      allowedRoutes: stringArrayArg(input, "allowedRoutes"),
      allowedActions:
        input.explorationPlanActions === undefined
          ? undefined
          : explorationPlanActionsArg(input),
      forbiddenActions: stringArrayArg(input, "forbiddenActions"),
      cleanupPolicy: explorationCleanupPolicyArg(input, "cleanupPolicy"),
      maxWrites: optionalNumberArg(input, "maxWrites"),
      maxDurationMs: optionalNumberArg(input, "maxDurationMs")
    });
    return {
      status: result.onboardingPlan.status,
      ...result,
      requiresConfirmation: true,
      nextAction: "approve-onboarding-plan"
    };
  }
  if (action === "approve-onboarding-plan") {
    const onboardingPlan = context.onboardingPlans.get(
      stringArg(input, "onboardingPlanId")
    );
    const explorationPlan = context.statefulExplorationPlans.get(
      onboardingPlan.explorationPlanId
    );
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        onboardingPlan,
        explorationPlan,
        requiresConfirmation: true,
        nextAction:
          "Present the requirement baseline, unresolved questions, roles, routes, writes, duration, and cleanup policy before one explicit approval."
      };
    }
    return {
      status: "approved",
      ...context.onboardingPlans.approve({
        onboardingPlanId: onboardingPlan.id,
        note: stringArg(input, "confirmationNote"),
        approvedBy: stringArg(input, "confirmedBy")
      }),
      nextAction: "start-onboarding-plan"
    };
  }
  if (action === "start-onboarding-plan") {
    const result = context.onboardingPlans.start(
      stringArg(input, "onboardingPlanId")
    );
    return {
      ...result,
      nextAction:
        result.status === "needs-data"
          ? "prepare-test-data"
          : "execute-requirement-directed-exploration"
    };
  }
  if (action === "create-exploration-plan") {
    const plan = context.statefulExplorationPlans.create({
      explorationTaskIds: stringArrayArg(input, "explorationTaskIds"),
      actorJourney: actorJourneyArg(input),
      allowedRoutes: stringArrayArg(input, "allowedRoutes"),
      allowedActions: explorationPlanActionsArg(input),
      forbiddenActions: stringArrayArg(input, "forbiddenActions"),
      cleanupPolicy: explorationCleanupPolicyArg(input, "cleanupPolicy"),
      maxWrites: optionalNumberArg(input, "maxWrites"),
      maxDurationMs: optionalNumberArg(input, "maxDurationMs")
    });
    return {
      status: plan.status,
      plan,
      requiresConfirmation: true,
      nextAction: "approve-exploration-plan"
    };
  }
  if (action === "approve-exploration-plan") {
    const plan = context.statefulExplorationPlans.get(
      stringArg(input, "explorationPlanId")
    );
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        plan,
        requiresConfirmation: true,
        nextAction:
          "Present the roles, routes, writes, data policy, duration, and cleanup policy before one explicit approval."
      };
    }
    return {
      status: "approved",
      plan: context.statefulExplorationPlans.approve({
        planId: plan.id,
        note: stringArg(input, "confirmationNote"),
        approvedBy: stringArg(input, "confirmedBy")
      }),
      nextAction: "start-exploration-plan"
    };
  }
  if (action === "cancel-exploration-plan") {
    const plan = context.statefulExplorationPlans.get(
      stringArg(input, "explorationPlanId")
    );
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        plan,
        requiresConfirmation: true,
        nextAction: "Confirm cancellation with a reason, or approve the exploration plan."
      };
    }
    const cancelledPlan = context.statefulExplorationPlans.cancel({
      planId: plan.id,
      note: stringArg(input, "confirmationNote")
    });
    return {
      status: "cancelled",
      plan: cancelledPlan,
      onboardingPlan: context.onboardingPlans.syncFromExploration(cancelledPlan.id),
      nextAction: "review-compile-run"
    };
  }
  if (action === "start-exploration-plan") {
    const result = context.statefulExplorationPlans.start(
      stringArg(input, "explorationPlanId")
    );
    return {
      ...result,
      nextAction:
        result.status === "needs-data"
          ? "prepare-test-data"
          : "execute-authorized-exploration"
    };
  }
  if (action === "submit-exploration-result") {
    const result = await context.statefulExplorationPlans.submit(
      explorationResultArg(input)
    );
    const onboardingPlan = context.onboardingPlans.syncFromExploration(result.plan.id);
    return {
      ...result,
      onboardingPlan,
      status: result.plan.status,
      nextAction:
        result.plan.status === "completed"
          ? "review-resumed-compile-run"
          : "review-exploration-gap"
    };
  }
  if (action === "resolve-exploration-task") {
    const taskId = stringArg(input, "explorationTaskId");
    const outcome = explorationTaskOutcomeArg(input, "explorationOutcome");
    const task = context.repository.explorationTasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Exploration task not found");
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        task,
        outcome,
        evidenceRefs: stringArrayArg(input, "evidenceRefs"),
        requiresConfirmation: true,
        nextAction: "Present the exploration evidence and outcome before confirmation."
      };
    }
    const result = context.knowledgeService.resolveExplorationTask({
      taskId,
      outcome,
      evidenceRefs: stringArrayArg(input, "evidenceRefs"),
      failureReason: optionalStringArg(input, "failureReason")
    });
    const resumedStatus = result.resumed?.executableCase.status;
    return {
      ...result,
      status: outcome,
      nextAction:
        outcome === "failed"
          ? "review-gap"
          : outcome === "cancelled"
            ? "review-compile-run"
            : resumedStatus === "ready"
              ? "preview-requirement-suite"
              : resumedStatus === "needs-data"
                ? "resolve-test-data"
                : "review-exploration-task"
    };
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
      allowCreate: optionalBooleanArg(input, "allowCreate"),
      automatic: optionalBooleanArg(input, "automatic")
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
      actorJourney: actorJourneyArg(input),
      confirm
    });
  }
  if (action === "explore-system") {
    return context.systemExploration.explore({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      authProfileId: optionalStringArg(input, "authProfileId"),
      startUrl: optionalStringArg(input, "startUrl"),
      scenario: explorationScenarioArg(input),
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
  if (action === "record-interaction-evidence") {
    const evidence = interactionEvidenceArg(input, "interactionEvidence");
    return context.systemExploration.recordInteractionEvidence({
      knowledgeProjectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      pageModelId: stringArg(input, "pageModelId"),
      ...evidence
    });
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
  if (action === "confirm-system-snapshot") {
    if (!optionalBooleanArg(input, "confirm")) {
      const snapshotId = stringArg(input, "systemBrainSnapshotId");
      const snapshot = context.repository.systemBrainSnapshots.find(
        (item) => item.id === snapshotId
      );
      if (!snapshot) throw new Error("System Brain snapshot not found");
      return {
        status: "preview",
        snapshot,
        requiresConfirmation: true,
        nextAction: "Confirm this System Brain snapshot before using it as a compilation baseline."
      };
    }
    return {
      status: "confirmed",
      snapshot: context.systemBrainSnapshots.confirm(
        stringArg(input, "systemBrainSnapshotId"),
        optionalStringArg(input, "confirmedBy") ?? "agent-user"
      ),
      nextAction: "Recompile cases affected by the confirmed System Brain snapshot."
    };
  }
  if (action === "reconcile-system-brain") {
    const result = context.knowledgeService.reconcileSystemBrain(
      stringArg(input, "knowledgeProjectId"),
      stringArg(input, "systemId"),
      stringArg(input, "requirementSetId"),
      optionalStringArg(input, "systemBrainSnapshotId")
    );
    return responseModeArg(input) === "summary"
      ? {
          status: "reconciled",
          systemId: result.systemId,
          requirementSetId: result.requirementSetId,
          expectedCount: result.expectedCount,
          observedCount: result.observedCount,
          summary: result.summary,
          unresolved: result.unresolved,
          nextAction: result.unresolved.length > 0
            ? "Review unresolved System Brain bindings."
            : "Review and confirm the semantic bindings."
        }
      : result;
  }
  if (action === "confirm-semantic-binding") {
    const bindingId = stringArg(input, "semanticBindingId");
    const binding = context.repository.semanticBindings.find((item) => item.id === bindingId);
    if (!binding) throw new Error("Semantic binding not found");
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        status: "preview",
        binding,
        requiresConfirmation: true,
        nextAction: "Confirm the semantic binding only when expected and observed behavior agree."
      };
    }
    return {
      status: "confirmed",
      binding: context.knowledgeService.confirmSemanticBinding(
        bindingId,
        optionalStringArg(input, "confirmedBy") ?? "agent-user"
      ),
      nextAction: "Reconcile affected cases before compiling or executing them."
    };
  }
  if (action === "recompile-stale-cases") {
    return context.knowledgeService.recompileStaleSystemBrainCases({
      projectId: stringArg(input, "knowledgeProjectId"),
      systemId: stringArg(input, "systemId"),
      changeSetId: optionalStringArg(input, "systemBrainChangeSetId")
    });
  }
  const selectedIntentIds = stringArrayArg(input, "testIntentIds");
  const selectedModules = stringArrayArg(input, "modules");
  const requirementSetId = optionalStringArg(input, "requirementSetId");
  if (requirementSetId || selectedIntentIds.length > 0 || selectedModules.length > 0) {
    const result = context.knowledgeService.compileExecutableCasesBatch({
      requirementSetId,
      testIntentIds: selectedIntentIds,
      modules: selectedModules,
      systemId: optionalStringArg(input, "systemId")
    });
    const summary = compileRunSummary(result.compileRun);
    return responseModeArg(input) === "summary"
      ? summary
      : {
          ...result,
          summary,
          nextAction:
            result.compileRun.blocked + result.compileRun.ambiguous + result.compileRun.needsExploration + result.compileRun.needsData + result.compileRun.skipped > 0
              ? "review-compile-run"
              : "preview-requirement-suite"
        };
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
        : compiled.executableCase.status === "needs-data"
          ? "resolve-test-data"
          : compiled.executableCase.status === "needs-exploration" || compiled.executableCase.status === "ambiguous"
            ? "review-exploration-task"
            : "review-compile-blocker"
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
  const executionDiagnoses = context.executionDiagnosis.list({ systemId });
  const executionEvidence = context.repository.executionEvidence.filter(
    (item) => item.systemId === systemId
  );
  const requirementSuiteRuns = context.repository.requirementSuiteRuns.filter(
    (run) => run.systemId === systemId
  );
  const scheduledRuns = requirementSuiteRuns
    .filter((run) => Boolean(run.stabilitySchedule))
    .map((run) => {
      const schedule = run.stabilitySchedule!;
      return {
        runId: run.id,
        knowledgeProjectId: run.knowledgeProjectId,
        status: run.status,
        stabilityGroupId: run.stabilityGroupId,
        stabilityIteration: run.stabilityIteration,
        stabilityTarget: run.stabilityTarget,
        due: isStabilityScheduleDue(schedule, new Date()),
        nextRunAt: schedule.nextRunAt,
        leaseOwner: schedule.leaseOwner,
        leaseExpiresAt: schedule.leaseExpiresAt,
        lastError: schedule.lastError
      };
    })
    .sort((left, right) => Number(right.due) - Number(left.due) || left.runId.localeCompare(right.runId));
  const configuredRefreshProviders = snapshot.auth.profiles
    .map((profile) => (profile as AuthProfile & { refreshProvider?: string }).refreshProvider)
    .filter(Boolean) as string[];
  const registeredRefreshProviders = context.authRefreshRegistry.providers();
  const unavailableRefreshProviders = [...new Set(configuredRefreshProviders)]
    .filter((provider) => !registeredRefreshProviders.includes(provider as typeof registeredRefreshProviders[number]));
  const legacyDiagnosisAudit = context.executionDiagnosis.auditLegacy({
    systemId,
    limit: 1
  });
  const openBugs = bugs.filter((bug) => bug.status === "open" || bug.status === "retest-failed");
  const unfinishedSuites = unfinishedCaseSuites(context, systemId);
  const documentRunLedgerEntries = context.runLedger.list({
    runType: "document-suite",
    systemId
  });
  const activeDocumentSuite = unfinishedSuites.at(-1);
  const activeDocumentSuiteAsset = activeDocumentSuite
    ? context.service.getCaseSuite(activeDocumentSuite.suiteId)
    : undefined;
  const pendingAgentTasks = context.service
    .listAgentTasks(systemId)
    .filter((task) => task.status === "pending");
  const awaitingAuthCheckpoints = snapshot.auth.checkpoints.filter(
    (checkpoint) => checkpoint.status === "awaiting-user"
  );
  const activeDocumentLedgerSummary =
    activeDocumentSuite &&
    documentRunLedgerEntries.some(
      (entry) => entry.caseSuiteId === activeDocumentSuite.suiteId
    )
      ? context.runLedger.summary(activeDocumentSuite.suiteId)
      : undefined;
  const activeDocumentExecutionRecovery = activeDocumentLedgerSummary
    ? recoverExecutionState(context.repository, activeDocumentSuite!.suiteId)
    : undefined;
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
  const activeSuiteSummary = activeDocumentSuite
    ? {
        suiteId: activeDocumentSuite.suiteId,
        status: activeDocumentSuite.status,
        browserMode: activeDocumentSuiteAsset?.browserMode ?? "headless",
        totalCases: activeDocumentSuite.totalCases,
        attempted: activeDocumentSuite.attemptedCaseNos.length,
        passed: activeDocumentSuite.passedCaseNos.length,
        failed: activeDocumentSuite.failedCaseNos.length,
        blocked: activeDocumentSuite.blockedCaseNos.length,
        waiting: activeDocumentSuite.waitingCaseNos.length,
        pending: activeDocumentSuite.pendingCaseNos.length,
        nextCaseNo: activeDocumentSuite.nextCaseNo,
        ...(activeDocumentLedgerSummary
          ? {
              currentStage: activeDocumentLedgerSummary.currentStage,
              currentStep: activeDocumentLedgerSummary.currentStep,
              currentCaseTitle: activeDocumentLedgerSummary.currentCaseTitle,
              currentPageUrl: activeDocumentLedgerSummary.currentPageUrl,
              elapsedMs: activeDocumentLedgerSummary.elapsedMs,
              lastUpdatedAt: activeDocumentLedgerSummary.updatedAt,
              waitReason: activeDocumentLedgerSummary.waitReason,
              possiblyStalled: activeDocumentLedgerSummary.possiblyStalled,
              latestEvent: activeDocumentLedgerSummary.latestEvent,
              traceId: activeDocumentLedgerSummary.traceId,
              executionRecovery: activeDocumentExecutionRecovery
            }
          : {}),
        activeTask: activeDocumentSuite.activeTask
          ? {
              taskId: activeDocumentSuite.activeTask.taskId,
              caseNo: activeDocumentSuite.activeTask.caseNo,
              title: activeDocumentSuite.activeTask.title
            }
          : undefined
      }
    : undefined;
  const userSummary = statusUserSummary({
    systemName: snapshot.system.name,
    bridgeOk: snapshot.bridge.ok,
    authProfiles: snapshot.auth.profiles.length,
    awaitingAuthCheckpoints: awaitingAuthCheckpoints.length,
    pendingAgentTasks: pendingAgentTasks.length,
    openBugs: openBugs.length,
    openGaps: snapshot.openGaps.length,
    unfinishedSuites: unfinishedSuites.length,
    nextAction,
    activeSuite: activeSuiteSummary
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
      unfinished: unfinishedSuites.slice(-10),
      unfinishedTruncated: unfinishedSuites.length > 10,
      recent: suites.slice(-5)
    },
    suiteRuns: {
      total: suiteRuns.length,
      byStatus: countBy(suiteRuns, (run) => run.status),
      recent: suiteRuns.slice(-5)
    },
    documentRunLedger: {
      total: documentRunLedgerEntries.length,
      activeSummary:
        activeDocumentLedgerSummary,
      recovery: activeDocumentExecutionRecovery,
      recent: documentRunLedgerEntries.slice(-20),
      recentTruncated: documentRunLedgerEntries.length > 20
    },
    agentTasks: {
      pending: pendingAgentTasks.slice(-10),
      pendingTruncated: pendingAgentTasks.length > 10
    },
    bugs: {
      total: bugs.length,
      open: openBugs.length,
      recent: bugs.slice(-5)
    },
    executionDiagnoses: {
      ...context.executionDiagnosis.summary({ systemId }),
      recent: executionDiagnoses.slice(-10),
      recentTruncated: executionDiagnoses.length > 10,
      legacyAudit: legacyDiagnosisAudit.summary,
      legacyReviews: context.executionDiagnosis.legacyReviewSummary(systemId),
      humanAdjudicationEval:
        context.executionDiagnosis.legacyReviewEval(systemId)
    },
    executionEvidence: {
      total: executionEvidence.length,
      byStatus: countBy(executionEvidence, (item) => item.status),
      byAssurance: countBy(executionEvidence, (item) => item.assuranceLevel ?? "none"),
      unassured: executionEvidence.filter(
        (item) => !item.assuranceLevel || item.assuranceLevel === "none"
      ).length
    },
    authRefresh: {
      registeredProviders: registeredRefreshProviders,
      configuredProviders: [...new Set(configuredRefreshProviders)],
      unavailableProviders: unavailableRefreshProviders
    },
    runtime: {
      configurationPath: context.runtimeConfigurationPath,
      configurationConfigured: Boolean(context.runtimeConfiguration),
      bridgeProvider: context.agentBridge?.provider ?? context.runtimeConfiguration?.bridgeProvider ?? "disabled",
      connectorStatus: context.feishuReader ? "feishu-configured" : "host-agent-fallback",
      reloadOperation: "bc_configure target=runtime operation=reload-config"
    },
    providerEvaluation: {
      primary: context.providerRegistry.primary(),
      evaluator: context.providerRegistry.evaluator(),
      available: context.providerRegistry.list().filter(
        (item) => item.role === "evaluator" && item.available
      )
    },
    brainRuntime: brainRuntimeStatus(context, systemId),
    requirementSuiteRuns: {
      total: requirementSuiteRuns.length,
      byStatus: countBy(requirementSuiteRuns, (run) => run.status),
      stability: summarizeStabilityRuns(requirementSuiteRuns, executionEvidence),
      scheduledRuns,
      scheduledRunsTruncated: scheduledRuns.length > 20
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

function brainRuntimeStatus(context: BrainCreatorMcpContext, systemId?: string) {
  const tasks = context.repository.brainTasks.filter(
    (task) => !systemId || task.systemId === systemId
  );
  const taskIds = new Set(tasks.map((task) => task.id));
  const sessions = context.repository.brainSessions.filter(
    (session) => !systemId || session.currentSystemId === systemId
  );
  const events = context.repository.brainEvents.filter(
    (event) => !systemId || (event.taskId ? taskIds.has(event.taskId) : false)
  );
  const concepts = context.repository.semanticConcepts.filter(
    (concept) => !systemId || concept.systemId === systemId
  );
  const entities = context.repository.businessEntityInstances.filter(
    (entity) => !systemId || entity.systemId === systemId
  );
  const snapshots = context.repository.systemBrainSnapshots.filter(
    (snapshot) => !systemId || snapshot.systemId === systemId
  );
  return {
    tasks: {
      total: tasks.length,
      active: tasks.filter((task) => ["pending", "running"].includes(task.status)),
      byState: countBy(tasks, (task) => task.state)
    },
    sessions: {
      total: sessions.length,
      active: sessions.filter((session) => Boolean(session.activeTaskId))
    },
    events: {
      total: events.length,
      recent: events.slice(-20)
    },
    semanticSpine: {
      concepts: concepts.length,
      aliases: context.repository.semanticAliases.filter((alias) =>
        concepts.some((concept) => concept.id === alias.conceptId)
      ).length,
      relations: context.repository.semanticRelations.filter((relation) =>
        concepts.some((concept) => concept.id === relation.fromConceptId || concept.id === relation.toConceptId)
      ).length,
      businessEntities: entities.length
    },
    testdataBrain: systemId
      ? {
          entities: context.testDataBrain.graph(systemId).entities.length,
          dependencies: context.testDataBrain.graph(systemId).dependencies.length
        }
      : {
          entities: context.repository.businessEntityInstances.length,
          dependencies: context.repository.testDataDependencies.length
        },
    staleArtifacts: {
      intents: context.repository.testIntents.filter((intent) => intent.status === "stale").length,
      executableCases: context.repository.executableCases.filter(
        (executableCase) => (!systemId || executableCase.systemId === systemId) && executableCase.status === "stale"
      ).length
    },
    systemBrainSnapshots: {
      total: snapshots.length,
      confirmed: snapshots.filter((snapshot) => snapshot.status === "confirmed").length,
      candidate: snapshots.filter((snapshot) => snapshot.status === "candidate").length,
      latest: snapshots
        .sort((left, right) => right.revision - left.revision || right.createdAt.localeCompare(left.createdAt))[0]
    }
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
    if (suiteActionArg(input) === "cancel") {
      return {
        ...(cancelCaseSourceSuite(context, inputWithSystem)),
        systemResolution: resolution
      };
    }
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

function cancelCaseSourceSuite(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>
) {
  const systemId = stringArg(input, "systemId");
  const resumeTarget = optionalBooleanArg(input, "resume")
    ? latestUnfinishedCaseSuite(context, systemId)
    : undefined;
  const suiteId = optionalStringArg(input, "suiteId") ?? resumeTarget?.suiteId;
  if (!suiteId) {
    throw new Error("suiteId is required to cancel a document case suite");
  }
  const suite = context.service.getCaseSuite(suiteId);
  if (suite.systemId !== systemId) {
    throw new Error("Case suite belongs to another business system");
  }
  ensureDocumentSuiteLedger(context, suite);
  const cancelledSuite = context.service.cancelCaseSuite(suite.id);
  completeDocumentSuiteLedger(context, cancelledSuite, "cancelled");
  return {
    mode: "case-source-suite",
    status: "cancelled",
    suite: cancelledSuite,
    progress: caseSuiteProgress(context, cancelledSuite),
    nextAction: "Run a new preview and confirm the document suite again."
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
  const requestedBrowserMode = browserModeArg(input);
  const requestedAuthProfileId = optionalStringArg(input, "authProfileId");
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
        continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked"),
        browserMode: requestedBrowserMode ?? "headless"
      },
      browserObservation: browserObservationCapability(
        requestedBrowserMode ?? "headless"
      ),
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

  const selectedAuthProfile = requestedAuthProfileId
    ? findAuthProfileById(context, systemId, requestedAuthProfileId)
    : findAuthProfile(context, systemId);

  const awaitingAuthCheckpoints = context.service
    .listAuthCheckpoints(systemId, "awaiting-user")
    .filter((checkpoint) => checkpoint.authProfileId === selectedAuthProfile.id);
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

  const authState = await verifyCaseSourceSuiteAuthState(context, systemId, selectedAuthProfile);
  if (authState?.status === "expired") {
    const authCheckpoint = context.service.createAuthCheckpoint({
      systemId,
      authProfileId: selectedAuthProfile.id,
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
  const requestedBrowserCapability = browserObservationCapability(
    requestedBrowserMode ?? "headless"
  );
  if (!requestedSuiteId && !requestedBrowserCapability.available) {
    return {
      mode: "case-source-suite",
      status: "blocked",
      source: caseSource,
      browserObservation: requestedBrowserCapability,
      nextAction: requestedBrowserCapability.reason
    };
  }
  const suite = requestedSuiteId
    ? existingCaseSuite(context, requestedSuiteId, systemId, caseSource.id)
    : context.service.createCaseSuite({
        systemId,
        sourceId: caseSource.id,
        totalCases: selectedCases.length,
        selectedCaseNos: selectedCases.map((documentCase) => documentCase.caseNo),
        continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked"),
        browserMode: requestedBrowserMode ?? "headless",
        status: "approved"
      });
  const suiteBrowserMode = suite.browserMode ?? "headless";
  if (requestedBrowserMode && requestedBrowserMode !== suiteBrowserMode) {
    throw new Error("Document case suite cannot change its browser mode");
  }
  const browserCapability = browserObservationCapability(suiteBrowserMode);
  if (!browserCapability.available) {
    return {
      mode: "case-source-suite",
      status: "blocked",
      source: caseSource,
      suite,
      browserObservation: browserCapability,
      nextAction: browserCapability.reason
    };
  }
  if (optionalBooleanArg(input, "continueOnBlocked") && suite.continueOnBlocked !== true) {
    context.service.enableCaseSuiteContinueOnBlocked(suite.id);
  }
  ensureDocumentSuiteLedger(context, suite);
  if (requestedSuiteId && optionalBooleanArg(input, "resume")) {
    recordDocumentSuiteLedger(context, suite, {
      event: "suite-resumed",
      scope: "suite",
      stage: "suite",
      fromStatus: suite.status,
      toStatus: "running"
    });
  }
  const alreadyPassed = passedCaseNosForSuite(context, systemId, suite.id);
  const alreadyBlocked = blockedCaseNosForSuite(context, systemId, suite.id);
  const casesToRun = parsed.cases.filter(
    (documentCase) =>
      suite.selectedCaseNos.includes(documentCase.caseNo) &&
      !alreadyPassed.has(documentCase.caseNo) &&
      !(suite.continueOnBlocked === true && alreadyBlocked.has(documentCase.caseNo))
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
        authState,
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
      completeDocumentSuiteLedger(context, completedSuite, "completed");
      return {
        mode: "case-source-suite",
        status: "completed",
        source: caseSource,
        authState,
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
      browserMode: suiteBrowserMode,
      createBugOnFailure: true
    });
    if (result.taskPackage) {
      const waitingSuite = context.service.updateCaseSuiteStatus(suite.id, "waiting-for-agent");
      return {
        ...result.taskPackage,
        mode: "case-source-suite",
        authState,
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
      browserMode: suiteBrowserMode,
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
  const artifactManifest = await writeArtifactManifest({
    workDir: context.workDir,
    systemId,
    suiteRunId: suiteRun.id,
    artifactPaths: suiteRun.artifactPaths,
    sourceRefs: [caseSource.id, suite.id],
    protectedSecrets: protectedSecretsForSystem(context, systemId)
  });
  context.service.updateCaseSuiteStatus(
    suite.id,
    allSuiteCasesPassed ? "completed" : "failed"
  );
  completeDocumentSuiteLedger(
    context,
    suite,
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
    authState,
    suite,
    suiteRun,
    artifactManifest,
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
    browserMode?: BrowserExecutionMode;
    createBugOnFailure?: boolean;
    regressionBug?: BugReport;
    remainingBugIds?: string[];
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
  if (input.suiteId) {
    const suite = context.service.getCaseSuite(input.suiteId);
    const priorAttempts = context.runLedger.list({
      runType: "document-suite",
      systemId: input.systemId,
      caseSuiteId: input.suiteId,
      caseNo: input.documentCase.caseNo
    });
    recordDocumentSuiteLedger(context, suite, {
      event: priorAttempts.some(
        (entry) => entry.event === "case-started" || entry.event === "case-retried"
      )
        ? "case-retried"
        : "case-started",
      scope: "case",
      stage: "generator",
      toStatus: "running",
      caseNo: input.documentCase.caseNo,
      message: input.documentCase.title,
      references: { testCaseId: testCase.id }
    });
  }
  try {
    const result = await runApprovedChain(context, {
      caseId: testCase.id,
      maxHealAttempts: input.maxHealAttempts,
      browserMode: input.browserMode,
      suiteContext: input.suiteId
        ? {
            suiteId: input.suiteId,
            sourceId: input.sourceId,
            caseNo: input.documentCase.caseNo,
            title: input.documentCase.title
          }
        : undefined,
      regressionContext: input.regressionBug
        ? {
            bugReportId: input.regressionBug.id,
            sourceId: input.regressionBug.sourceId,
            caseNo: input.regressionBug.caseNo,
            title: input.regressionBug.caseTitle,
            previousStatus:
              input.regressionBug.status === "retest-failed"
                ? "retest-failed"
                : "open",
            remainingBugIds: input.remainingBugIds ?? [],
            maxHealAttempts: input.maxHealAttempts
          }
        : undefined
    });
    if (!("chainRun" in result)) {
      if (input.suiteId) {
        recordDocumentSuiteLedger(
          context,
          context.service.getCaseSuite(input.suiteId),
          {
            event: "agent-task-requested",
            scope: "case",
            stage: "generator",
            fromStatus: "running",
            toStatus: "waiting-for-agent",
            caseNo: input.documentCase.caseNo,
            references: {
              testCaseId: testCase.id,
              agentTaskId: result.task.id
            }
          }
        );
      }
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
      if (input.suiteId) {
        recordDocumentSuiteLedger(
          context,
          context.service.getCaseSuite(input.suiteId),
          {
            event: "case-completed",
            scope: "case",
            stage: "execution",
            fromStatus: "running",
            toStatus: "passed",
            outcome: "passed",
            caseNo: input.documentCase.caseNo,
            references: {
              testCaseId: testCase.id,
              chainRunId: result.chainRun.id
            }
          }
        );
      }
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
    const failureReason =
      [result.testResult?.stderr, result.testResult?.stdout]
        .find((value): value is string => Boolean(value?.trim())) ??
      chainFailureReason(result.chainRun);
    const diagnosis = context.executionDiagnosis.create({
      systemId: input.systemId,
      caseSourceId: input.sourceId,
      caseSuiteId: input.suiteId,
      caseNo: input.documentCase.caseNo,
      testCaseId: testCase.id,
      chainRunId: result.chainRun.id,
      status: "failed",
      failureReason,
      sourceType: "case-source-suite",
      healAttempts: result.healerRuns.length,
      maxHealAttempts: input.maxHealAttempts ?? 2,
      evidenceAssurance: result.testResult?.structuredReporter ? "strong" : "none",
      evidenceRefs: [
        result.chainRun.id,
        input.sourceId,
        input.suiteId
      ].filter((value): value is string => Boolean(value))
    });
    const isProductBug = diagnosis.verdict === "product_bug";
    if (isProductBug) {
      result.chainRun.gaps = [];
      context.repository.persist();
    } else {
      context.executionDiagnosis.linkGaps(
        diagnosis.id,
        result.chainRun.gaps.map((gap) => gap.id)
      );
    }
    const bug =
      isProductBug && input.createBugOnFailure !== false
        ? context.service.createBugReport({
            systemId: input.systemId,
            sourceId: input.sourceId,
            caseNo: input.documentCase.caseNo,
            caseTitle: input.documentCase.title,
            module: input.documentCase.module,
            priority: input.documentCase.priority,
            expectedResult: input.documentCase.expectedResult,
            actualResult: failureReason,
            reproductionSteps: reproductionSteps(input.documentCase),
            evidencePaths: artifactPaths,
            chainRunId: result.chainRun.id,
            diagnosisId: diagnosis.id,
            gapIds: []
          })
        : undefined;
    if (bug) {
      context.executionDiagnosis.linkBugReport(diagnosis.id, bug.id);
    }
    if (input.suiteId) {
      const suite = context.service.getCaseSuite(input.suiteId);
      recordDocumentSuiteLedger(context, suite, {
        event: "failure-diagnosed",
        scope: "case",
        stage: "execution",
        fromStatus: "running",
        toStatus: diagnosis.verdict,
        failureType: diagnosis.failureType,
        caseNo: input.documentCase.caseNo,
        references: {
          testCaseId: testCase.id,
          chainRunId: result.chainRun.id,
          diagnosisId: diagnosis.id,
          bugReportId: bug?.id,
          gapIds: result.chainRun.gaps.map((gap) => gap.id)
        }
      });
      recordDocumentSuiteLedger(context, suite, {
        event: "case-completed",
        scope: "case",
        stage: "execution",
        fromStatus: "running",
        toStatus: isProductBug ? "failed" : "blocked",
        outcome: isProductBug ? "failed" : "blocked",
        failureType: diagnosis.failureType,
        caseNo: input.documentCase.caseNo,
        message: failureReason,
        references: {
          testCaseId: testCase.id,
          chainRunId: result.chainRun.id,
          diagnosisId: diagnosis.id,
          bugReportId: bug?.id,
          gapIds: result.chainRun.gaps.map((gap) => gap.id)
        }
      });
    }
    return {
      caseResult: {
        caseNo: input.documentCase.caseNo,
        title: input.documentCase.title,
        status: isProductBug ? "failed" : "blocked",
        testCaseId: testCase.id,
        chainRunId: result.chainRun.id,
        diagnosisId: diagnosis.id,
        bugReportId: bug?.id,
        gapIds: result.chainRun.gaps.map((gap) => gap.id),
        error: failureReason
      },
      artifactPaths,
      bugReportId: bug?.id
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
    if (input.suiteId) {
      recordDocumentSuiteLedger(
        context,
        context.service.getCaseSuite(input.suiteId),
        {
          event: "case-completed",
          scope: "case",
          stage: "execution",
          fromStatus: "running",
          toStatus: "blocked",
          outcome: "blocked",
          failureType: classifyFailure(reason, "case-source-suite"),
          caseNo: input.documentCase.caseNo,
          message: reason,
          references: { testCaseId: testCase.id, gapIds: [gap.id] }
        }
      );
    }
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
  const browserMode = browserModeArg(input) ?? "headless";
  const browserCapability = browserObservationCapability(browserMode);
  if (!browserCapability.available) {
    return {
      mode: "bug-regression",
      status: "blocked",
      browserObservation: browserCapability,
      nextAction: browserCapability.reason
    };
  }
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
  for (const [candidateIndex, bug] of candidates.entries()) {
    const previousStatus = bug.status;
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
        browserMode,
        createBugOnFailure: false,
        regressionBug: { ...bug, status: previousStatus },
        remainingBugIds: candidates
          .slice(candidateIndex + 1)
          .map((item) => item.id)
      });
      if (result.taskPackage) {
        return {
          ...result.taskPackage,
          mode: "bug-regression",
          stage: result.taskPackage.task.agent,
          status: "needs_agent_execution",
          currentBug: bug,
          completedResults: results
        };
      }
      if (result.caseResult.diagnosisId) {
        context.executionDiagnosis.linkBugReport(
          result.caseResult.diagnosisId,
          bug.id
        );
      }
      result.caseResult.bugReportId = bug.id;
      results.push(result.caseResult);
      if (result.caseResult.status === "passed") {
        context.service.updateBugReportStatus(bug.id, "retest-passed");
      } else if (result.caseResult.status === "failed") {
        context.service.updateBugReportStatus(bug.id, "retest-failed");
      } else {
        context.service.updateBugReportStatus(bug.id, previousStatus);
      }
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
      context.service.updateBugReportStatus(bug.id, previousStatus);
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
  let knowledgeProjectId = optionalStringArg(input, "knowledgeProjectId");
  const requestedTarget = reviewTargetArg(input, "target");
  if (!knowledgeProjectId && requestedTarget === "onboarding-plan") {
    const projectIds = [...new Set(
      context.onboardingPlans
        .list({
          systemId: optionalStringArg(input, "systemId"),
          requirementSetId: optionalStringArg(input, "requirementSetId")
        })
        .filter((item) => !optionalStringArg(input, "id") || item.id === optionalStringArg(input, "id"))
        .map((item) => item.knowledgeProjectId)
    )];
    if (projectIds.length === 1) knowledgeProjectId = projectIds[0];
  }
  if (knowledgeProjectId && isKnowledgeReviewTarget(requestedTarget)) {
    return knowledgeReview(
      context,
      knowledgeProjectId,
      requestedTarget,
      requestedTarget === "system-brain"
        ? optionalStringArg(input, "systemId") ?? optionalStringArg(input, "id")
        : optionalStringArg(input, "id"),
      optionalNumberArg(input, "limit") ?? 50,
      optionalNumberArg(input, "minSampleSize") ?? 20,
      optionalNumberArg(input, "offset") ?? 0,
      input
    );
  }
  if (!knowledgeProjectId && requestedTarget === "run-ledger") {
    const resolution = resolveSystemReference(context, input);
    const requestedRunId = optionalStringArg(input, "id");
    const entries = context.runLedger
      .list({ runType: "document-suite", systemId: resolution.systemId })
      .filter((entry) => !requestedRunId || entry.caseSuiteId === requestedRunId);
    const runIds = [
      ...new Set(
        entries.flatMap((entry) => (entry.caseSuiteId ? [entry.caseSuiteId] : []))
      )
    ];
    return {
      runType: "document-suite",
      summaries: runIds.map((runId) => context.runLedger.summary(runId)),
      entries,
      systemResolution: resolution
    };
  }
  if (
    isKnowledgeReviewTarget(requestedTarget) &&
    requestedTarget !== "execution-diagnosis"
  ) {
    throw new Error("knowledgeProjectId is required for knowledge review targets");
  }
  const resolution = resolveSystemReference(context, input);
  const systemId = resolution.systemId;
  const target = requestedTarget;
  const failureTypes = failureTypeFilters(input);
  if (target === "execution-diagnosis") {
    const diagnosisEval = context.executionDiagnosis.legacyReviewEval(
      systemId,
      optionalNumberArg(input, "minSampleSize") ?? 20
    );
    const items = context.executionDiagnosis
      .list({ systemId })
      .filter(
        (item) =>
          (!optionalStringArg(input, "id") ||
            item.id === optionalStringArg(input, "id")) &&
          (failureTypes.size === 0 ||
            (item.failureType !== undefined &&
              failureTypes.has(item.failureType)))
      );
    const diagnosisSummary = context.executionDiagnosis.summary({ systemId });
    return {
      summary: diagnosisSummary,
      items,
      legacyAudit: context.executionDiagnosis.auditLegacy({
        systemId,
        limit: optionalNumberArg(input, "limit") ?? 50
      }),
      legacyReviews: context.executionDiagnosis.listLegacyReviews(systemId),
      humanAdjudicationEval: diagnosisEval,
      reviewSummary: executionDiagnosisReviewSummary({
        summary: diagnosisSummary,
        items,
        nextAction:
          diagnosisSummary.routing.bugEligible > 0
            ? "review_product_bugs"
            : diagnosisSummary.routing.gapRouted > 0
              ? "review_evidence_gaps"
              : "no_diagnosis_action"
      }),
      evalMarkdown: legacyDiagnosisEvalMarkdown(diagnosisEval),
      systemResolution: resolution
    };
  }
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
  if (target === "runtime") {
    const operation = optionalStringArg(input, "operation") ?? "reload-store";
    if (!["update", "reload-config", "reload-store", "rebuild-index"].includes(operation)) {
      throw new Error("runtime operation is invalid");
    }
    const active = [
      ...context.repository.requirementSuiteRuns.filter((run) =>
        ["running", "waiting-for-test-data", "waiting-for-agent"].includes(run.status)
      ),
      ...context.repository.caseSuiteRuns.filter((run) => run.status === "running"),
      ...context.repository.agentTasks.filter((task) =>
        ["pending", "running"].includes(task.status)
      )
    ];
    if (active.length > 0) {
      throw new BrainCreatorError({
        code: "BC_STORE_BUSY",
        message: "Store reload is blocked while a run is active",
        userMessage: {
          enUS: "Wait for active Brain Creator runs to finish before reloading the store.",
          zhCN: "请等待 Brain Creator 活动运行结束后再刷新存储。"
        },
        nextAction: "review-active-runs",
        retryable: true
      });
    }
    if (operation === "update") {
      const patch: RuntimeConfigurationPatch = {
        ...(optionalStringArg(input, "bridgeProvider")
          ? { bridgeProvider: optionalStringArg(input, "bridgeProvider") as RuntimeConfiguration["bridgeProvider"] }
          : {}),
        ...(optionalStringArg(input, "bridgeCommand") ? { bridgeCommand: optionalStringArg(input, "bridgeCommand") } : {}),
        ...(Array.isArray(input.bridgeArgs) ? { bridgeArgs: stringArrayArg(input, "bridgeArgs") } : {}),
        ...(optionalNumberArg(input, "bridgeTimeoutMs") !== undefined
          ? { bridgeTimeoutMs: optionalNumberArg(input, "bridgeTimeoutMs") }
          : {}),
        ...(optionalStringArg(input, "evaluationProvider")
          ? { evaluationProvider: optionalStringArg(input, "evaluationProvider") as "claude" | "codex" }
          : {}),
        ...(input.providerConfigs !== undefined ? { providerConfigs: recordArg(input, "providerConfigs") } : {}),
        ...(input.connectorConfigs !== undefined ? { connectorConfigs: recordArg(input, "connectorConfigs") } : {})
      };
      const configuration = mergeRuntimeConfiguration(context.runtimeConfiguration, patch);
      return {
        status: "config-reloaded",
        operation,
        ...(await context.reloadRuntimeConfiguration({ configuration, persist: true })),
        nextAction: "review-status"
      };
    }
    if (operation === "reload-config") {
      return {
        status: "config-reloaded",
        operation,
        ...(await context.reloadRuntimeConfiguration()),
        nextAction: "review-status"
      };
    }
    if (operation === "rebuild-index") {
      if (!(context.repository instanceof ShardedFileBrainCreatorRepository)) {
        throw new Error(`Index rebuild requires the schema ${SHARDED_REPOSITORY_SCHEMA_VERSION} sharded repository`);
      }
      return {
        status: "index-rebuilt",
        index: context.repository.rebuildIndexes(),
        nextAction: "review-status"
      };
    }
    return {
      status: "reloaded",
      counts: context.repository.reload(),
      reloadedAt: new Date().toISOString(),
      nextAction: "review-status"
    };
  }
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
    const operation = optionalStringArg(input, "operation") ?? "create";
    if (operation === "verify") {
      const systemId = stringArg(input, "systemId");
      const authProfileId = stringArg(input, "authProfileId");
      const profile = findAuthProfileById(context, systemId, authProfileId);
      const system = context.repository.systemProfiles.find((item) => item.id === systemId);
      if (!system) throw new Error("Business system not found");
      let storageStatePath: string | undefined;
      try {
        storageStatePath = await materializeAuthStorageState(context, system, profile, true);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        context.service.failAuthProfileVerification(profile.id, reason);
        throw new BrainCreatorError({
          code: "BC_AUTH_MATERIALIZATION_FAILED",
          message: reason,
          userMessage: {
            enUS: "Brain Creator could not materialize this token or cookie into a browser login state.",
            zhCN: "Token/Cookie cannot be materialized into a browser login state."
          },
          nextAction: "capture-auth-checkpoint",
          retryable: true
        });
      }
      if (!storageStatePath) {
        throw new BrainCreatorError({
          code: "BC_AUTH_EVIDENCE_REQUIRED",
          message: "Auth verification requires a protected storageState path",
          userMessage: {
            enUS: "Capture a browser login state before verifying this authentication profile.",
            zhCN: "验证该鉴权配置前需要先采集浏览器登录状态。"
          },
          nextAction: "complete-auth-checkpoint",
          retryable: false
        });
      }
      const verification = await context.authStateVerifier({
        storageStatePath: await resolveProtectedStorageStatePath(context.workDir, storageStatePath),
        targetUrl: system.baseUrl,
        allowedUrls: system.urlAllowlist
      });
      if (verification.status !== "valid" || !verification.finalUrl) {
        const reason = verification.reason ?? "Browser authentication verification failed";
        context.service.failAuthProfileVerification(profile.id, reason);
        throw new BrainCreatorError({
          code: "BC_AUTH_VERIFICATION_FAILED",
          message: reason,
          userMessage: {
            enUS: "The saved browser login could not be verified.",
            zhCN: "已保存的浏览器登录状态验证失败。"
          },
          nextAction: "complete-auth-checkpoint",
          retryable: verification.status === "unavailable"
        });
      }
      return context.service.verifyAuthProfile(profile.id, {
        targetUrl: system.baseUrl,
        finalUrl: verification.finalUrl,
        title: verification.title
      });
    }
    if (operation === "preflight") {
      const systemId = stringArg(input, "systemId");
      const authProfileId = stringArg(input, "authProfileId");
      const profile = findAuthProfileById(context, systemId, authProfileId);
      const system = context.repository.systemProfiles.find((item) => item.id === systemId);
      if (!system) throw new Error("Business system not found");
      const authRefresh = await context.authRefreshRegistry.preflight({
        workDir: context.workDir,
        system,
        authProfile: profile,
        reason: optionalStringArg(input, "reason") ?? "Authentication provider preflight requested."
      });
      return {
        authProfile: context.service.listAuthProfiles(systemId).find((item) => item.id === profile.id),
        authRefresh,
        nextAction: authRefresh.status === "ready"
          ? "Authentication provider is ready for execution."
          : "Configure the provider or complete the authentication checkpoint before execution."
      };
    }
    if (operation === "refresh") {
      const systemId = stringArg(input, "systemId");
      const authProfileId = stringArg(input, "authProfileId");
      const profile = findAuthProfileById(context, systemId, authProfileId);
      const system = context.repository.systemProfiles.find((item) => item.id === systemId);
      if (!system) throw new Error("Business system not found");
      const refreshed = await refreshAndVerifyAuthState(
        context,
        system,
        profile,
        optionalStringArg(input, "reason") ?? "Authentication refresh requested by the operator."
      );
      if (refreshed?.status === "valid" && refreshed.finalUrl) {
        return {
          authRefresh: refreshed.authRefresh,
          profile: context.service.verifyAuthProfile(profile.id, {
            targetUrl: system.baseUrl,
            finalUrl: refreshed.finalUrl,
            title: refreshed.title
          }),
          nextAction: "continue-execution"
        };
      }
      const pending = context.service.listAuthCheckpoints(system.id, "awaiting-user")
        .find((checkpoint) => checkpoint.authProfileId === profile.id);
      const checkpoint = pending ?? context.service.createAuthCheckpoint({
        systemId,
        authProfileId: profile.id,
        reason: refreshed?.reason ?? "Authentication refresh requires user intervention.",
        resumeInstruction: "Refresh the provider session or complete the login checkpoint, then retry auth refresh."
      });
      return {
        status: "needs-user",
        authRefresh: refreshed?.authRefresh,
        checkpoint,
        nextAction: "complete-auth-checkpoint"
      };
    }
    if (operation === "archive") {
      const profile = findAuthProfileById(
        context,
        stringArg(input, "systemId"),
        stringArg(input, "authProfileId")
      );
      return context.service.archiveAuthProfile(profile.id);
    }
    if (operation !== "create") throw new Error("auth operation is invalid");
    return context.service.createAuthProfile({
      projectId: stringArg(input, "systemId"),
      env: stringArg(input, "env"),
      role: stringArg(input, "role"),
      loginMethod: loginMethodArg(input, "loginMethod"),
      refreshProvider: optionalStringArg(input, "refreshProvider") as AuthProfile["refreshProvider"],
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
  const openTestDataGap = context.repository.gaps.some(
    (gap) =>
      gap.status === "open" &&
      gap.sourceType === "test-data-plan" &&
      (executableCase.gapIds.includes(gap.id) ||
        gap.sourceId === executableCase.id ||
        gap.sourceId === executableCase.testIntentId)
  );
  if (executableCase.status === "ready" && openTestDataGap) return false;
  if (executableCase.status === "ready") return true;
  if (
    executableCase.status === "needs-data" &&
    executableCase.dataPlan?.verdict === "blocked"
  ) {
    return (
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
    (executableCase.status === "blocked" || executableCase.status === "needs-data") &&
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
  const actorJourney = actorJourneyArg(input);
  const requestedBrowserMode = browserModeArg(input);
  const requestedRepeatCount = optionalNumberArg(input, "repeatCount");
  const repeatCount = Math.max(1, requestedRepeatCount ?? 1);
  const stabilityPolicy = stabilityPolicyArg(input) ?? (repeatCount > 1
    ? { targetIterations: repeatCount, minIterations: 2, maxFailureRate: 0, requireStrongEvidence: true, stopOnBlocked: true }
    : undefined);
  if (!optionalBooleanArg(input, "confirm")) {
    const executionPreflights = selectedSystemId
      ? candidates.map((executableCase) => ({
          executableCaseId: executableCase.id,
          ...context.executionPreflight.prepare({
            knowledgeProjectId: projectId,
            systemId: selectedSystemId,
            executableCaseId: executableCase.id,
            authProfileId,
            actorJourney,
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
      stability: {
        repeatCount,
        policy: repeatCount > 1
          ? "Each iteration uses an isolated RequirementSuiteRun and is aggregated in coverage review."
          : "Single execution; do not infer stability from one green run."
      },
      browserObservation: browserObservationCapability(
        requestedBrowserMode ?? "headless"
      ),
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
      actorJourney &&
      JSON.stringify(activeRequirementSuiteRun.actorJourney ?? []) !==
        JSON.stringify(actorJourney)
    ) {
      throw new Error("Requirement suite run cannot change its actor journey");
    }
    const activeBrowserMode = activeRequirementSuiteRun.browserMode ?? "headless";
    if (requestedBrowserMode && requestedBrowserMode !== activeBrowserMode) {
      throw new Error("Requirement suite run cannot change its browser mode");
    }
    const activeBrowserCapability = browserObservationCapability(activeBrowserMode);
    if (!activeBrowserCapability.available) {
      return {
        mode: "requirement-suite",
        status: "blocked",
        browserObservation: activeBrowserCapability,
        requirementSuiteRun: activeRequirementSuiteRun,
        nextAction: activeBrowserCapability.reason
      };
    }
    if (
      requestedRepeatCount !== undefined &&
      requestedRepeatCount !== (activeRequirementSuiteRun.stabilityTarget ?? 1)
    ) {
      throw new Error("Requirement suite run cannot change its stability repeat count");
    }
    if (
      optionalBooleanArg(input, "allowCreateTestData") &&
      !activeRequirementSuiteRun.allowCreateTestData
    ) {
      context.requirementSuiteRuns.authorizeTestDataCreation(
        activeRequirementSuiteRun.id
      );
    }
    if (
      optionalBooleanArg(input, "automaticTestData") &&
      !activeRequirementSuiteRun.automaticTestData
    ) {
      context.requirementSuiteRuns.enableAutomaticTestData(
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
  const browserMode = requestedBrowserMode ?? "headless";
  const browserCapability = browserObservationCapability(browserMode);
  if (!browserCapability.available) {
    return {
      mode: "requirement-suite",
      status: "blocked",
      browserObservation: browserCapability,
      nextAction: browserCapability.reason
    };
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
      actorJourney,
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
    operator: optionalStringArg(input, "operator"),
    provider: optionalStringArg(input, "provider"),
    sessionId: optionalStringArg(input, "sessionId"),
    actorJourney,
    browserMode,
    requirementSetIds: stringArrayArg(input, "requirementSetIds"),
    cases: candidates.map((candidate) => ({
      executableCaseId: candidate.id,
      title: candidate.title
    })),
    continueOnBlocked: optionalBooleanArg(input, "continueOnBlocked"),
    allowCreateTestData: optionalBooleanArg(input, "allowCreateTestData"),
    automaticTestData: optionalBooleanArg(input, "automaticTestData"),
    maxHealAttempts: optionalNumberArg(input, "maxHealAttempts")
    ,stabilityPolicy
    ,stabilityGroupId: repeatCount > 1 ? id("stabilityGroup") : undefined
    ,stabilityIteration: 1
    ,stabilityTarget: repeatCount
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
  action:
    | "cancel"
    | "retry"
    | "skip"
    | "claim-next-scheduled"
    | "process-next-scheduled"
    | "claim-scheduled"
    | "renew-scheduled"
    | "release-scheduled",
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (action === "claim-next-scheduled") {
    const scheduleOwner = optionalStringArg(input, "scheduleOwner");
    if (!scheduleOwner) throw new Error("scheduleOwner is required for schedule control");
    const systemId = optionalStringArg(input, "systemId");
    const dueRuns = context.requirementSuiteRuns
      .listDueStabilityRuns(projectId)
      .filter((item) => !systemId || item.systemId === systemId)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        mode: "requirement-suite",
        status: "control-preview",
        action,
        scheduledRuns: dueRuns.slice(0, 20),
        scheduledRunsTruncated: dueRuns.length > 20,
        requiresConfirmation: true,
        nextAction: dueRuns.length > 0
          ? "Confirm to claim the first due scheduled run."
          : "No scheduled stability run is due."
      };
    }
    const next = dueRuns[0];
    if (!next) {
      return {
        mode: "requirement-suite",
        status: "no-due-scheduled-run",
        action,
        scheduledRuns: [],
        nextAction: "Poll again when a scheduled stability run is due."
      };
    }
    const claimed = context.requirementSuiteRuns.claimScheduled(next.id, {
      owner: scheduleOwner,
      leaseMs: optionalNumberArg(input, "scheduleLeaseMs")
    });
    return {
      mode: "requirement-suite",
      status: "scheduled-control-applied",
      action,
      requirementSuiteRun: claimed,
      nextAction: "Continue the claimed requirement suite with suiteAction=continue."
    };
  }
  if (action === "process-next-scheduled") {
    const scheduleOwner = optionalStringArg(input, "scheduleOwner");
    if (!scheduleOwner) throw new Error("scheduleOwner is required for schedule control");
    const systemId = optionalStringArg(input, "systemId");
    const dueRuns = context.requirementSuiteRuns
      .listDueStabilityRuns(projectId)
      .filter((item) => !systemId || item.systemId === systemId)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        mode: "requirement-suite",
        status: "control-preview",
        action,
        scheduledRuns: dueRuns.slice(0, 20),
        scheduledRunsTruncated: dueRuns.length > 20,
        requiresConfirmation: true,
        nextAction: dueRuns.length > 0
          ? "Confirm to claim and process the first due scheduled run."
          : "No scheduled stability run is due."
      };
    }
    const next = dueRuns[0];
    if (!next) {
      return {
        mode: "requirement-suite",
        status: "no-due-scheduled-run",
        action,
        scheduledRuns: [],
        nextAction: "Poll again when a scheduled stability run is due."
      };
    }
    const claimed = context.requirementSuiteRuns.claimScheduled(next.id, {
      owner: scheduleOwner,
      leaseMs: optionalNumberArg(input, "scheduleLeaseMs")
    });
    try {
      const result = await executeNextRequirementSuiteCase(context, claimed.id, {
        maxHealAttempts: optionalNumberArg(input, "maxHealAttempts")
      });
      return {
        ...result,
        action,
        scheduleOwner,
        scheduledRunId: claimed.id,
        nextAction: result.status === "completed"
          ? "The scheduled stability iteration completed. Review stability thresholds."
          : "Renew the schedule lease while the suite is waiting, then continue the scheduled run."
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const released = context.requirementSuiteRuns.releaseScheduledLease(claimed.id, {
        owner: scheduleOwner,
        nextRunAt: new Date(Date.now() + 60_000).toISOString(),
        lastError: message
      });
      return {
        mode: "requirement-suite",
        status: "scheduled-run-failed",
        action,
        scheduledRunId: claimed.id,
        requirementSuiteRun: released,
        error: message,
        nextAction: "Inspect the failure and retry the scheduled run after the backoff."
      };
    }
  }
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
  if (["claim-scheduled", "renew-scheduled", "release-scheduled"].includes(action)) {
    const scheduleOwner = optionalStringArg(input, "scheduleOwner");
    if (!optionalBooleanArg(input, "confirm")) {
      return {
        mode: "requirement-suite",
        status: "control-preview",
        action,
        requirementSuiteRun: run,
        requiresConfirmation: true,
        nextAction: `Confirm the requirement suite ${action} action.`
      };
    }
    if (!scheduleOwner) throw new Error("scheduleOwner is required for schedule control");
    const updated =
      action === "claim-scheduled"
        ? context.requirementSuiteRuns.claimScheduled(run.id, {
            owner: scheduleOwner,
            leaseMs: optionalNumberArg(input, "scheduleLeaseMs")
          })
        : action === "renew-scheduled"
          ? context.requirementSuiteRuns.renewScheduledLease(run.id, {
              owner: scheduleOwner,
              leaseMs: optionalNumberArg(input, "scheduleLeaseMs")
            })
          : context.requirementSuiteRuns.releaseScheduledLease(run.id, {
              owner: scheduleOwner,
              nextRunAt: optionalStringArg(input, "nextRunAt"),
              lastError: optionalStringArg(input, "scheduleError")
            });
    return {
      mode: "requirement-suite",
      status: "scheduled-control-applied",
      action,
      requirementSuiteRun: updated,
      nextAction:
        action === "release-scheduled"
          ? "The schedule is released; claim it again when the next run is due."
          : "Continue the requirement suite with suiteAction=continue."
    };
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
  const archive = await archiveRequirementSuiteRun(context, updated);
  return {
    mode: "requirement-suite",
    status: updated.status,
    action,
    requirementSuiteRun: updated,
    ...(archive ? { artifactManifest: archive.artifactManifest } : {})
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
    automatic: requirementSuiteRun.automaticTestData,
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
  const suiteAuthProfileId =
    requirementSuiteRun.authProfileId ??
    requirementSuiteRun.actorJourney?.[0]?.authProfileId;
  const suiteAuthProfile = suiteAuthProfileId
    ? context.repository.authProfiles.find((item) => item.id === suiteAuthProfileId)
    : undefined;
  const requiresAuthProviderPreflight =
    suiteAuthProfile &&
    (Boolean(suiteAuthProfile.refreshProvider) ||
      suiteAuthProfile.loginMethod === "token" ||
      suiteAuthProfile.loginMethod === "cookie");
  if (suiteAuthProfile && requiresAuthProviderPreflight) {
    const authProviderPreflight = await context.authRefreshRegistry.preflight({
      workDir: context.workDir,
      system: context.repository.systemProfiles.find(
        (item) => item.id === requirementSuiteRun.systemId
      )!,
      authProfile: suiteAuthProfile,
      reason: "Requirement suite execution preflight."
    });
    if (authProviderPreflight.status !== "ready") {
      const existingGap = context.repository.gaps.find(
        (gap) =>
          gap.projectId === requirementSuiteRun.systemId &&
          gap.sourceType === "requirement-suite-auth-preflight" &&
          gap.sourceId === requirementSuiteRun.id &&
          gap.status === "open"
      );
      const gap = existingGap ?? context.service.reportGap({
        projectId: requirementSuiteRun.systemId,
        sourceType: "requirement-suite-auth-preflight",
        sourceId: requirementSuiteRun.id,
        reason:
          authProviderPreflight.reason ??
          `Authentication provider ${authProviderPreflight.provider} is not ready.`,
        severity: "high",
        owner: "qa"
      });
      const blockedRun = context.requirementSuiteRuns.completeCase(
        requirementSuiteRun.id,
        executableCase.id,
        {
          status: "blocked",
          gapIds: [gap.id],
          failureType: "auth_failure",
          error: gap.reason
        }
      );
      return {
        mode: "requirement-suite",
        status: "blocked",
        authProviderPreflight,
        gap,
        requirementSuiteRun: blockedRun,
        nextAction:
          "Configure or complete the authentication provider, resolve the Gap, then explicitly resume the requirement suite."
      };
    }
  }
  const executionPreflight = context.executionPreflight.prepare({
    knowledgeProjectId: requirementSuiteRun.knowledgeProjectId,
    systemId: requirementSuiteRun.systemId,
    executableCaseId: executableCase.id,
    authProfileId: requirementSuiteRun.authProfileId,
    actorJourney: requirementSuiteRun.actorJourney,
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
  const artifactLayout = requirementArtifactLayout(
    context,
    requirementSuiteRun,
    executableCase
  );
  const contextPackPath = join(artifactLayout.analysisDir, `${executionPlan.id}-context.json`);
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
    artifactLayout.evidenceDir
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
      knowledgeContext,
      artifactLayout,
      browserMode: requirementSuiteRun.browserMode ?? "headless"
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
  const requirementTestResult = "testResult" in result ? result.testResult : undefined;
  const requirementFailureClassification = requirementFailure
    ? classifyEvidenceFailure({
        stderr: requirementTestResult?.stderr,
        stdout: requirementTestResult?.stdout,
        reporter: requirementTestResult?.structuredReporter
      })
    : undefined;
  const diagnosis =
    "chainRun" in result && result.chainRun?.status === "failed"
      ? context.executionDiagnosis.create({
          knowledgeProjectId: projectId,
          systemId,
          requirementSuiteRunId: requirementSuiteRun.id,
          executableCaseId: executableCase.id,
          executionEvidenceId: executionEvidence.id,
          chainRunId: result.chainRun.id,
          testCaseId: testCase.id,
          status: "failed",
          failureReason: requirementFailure,
          failureType: requirementFailureClassification?.type,
          consoleErrors: requirementTestResult?.structuredReporter?.consoleErrors,
          networkFailures: requirementTestResult?.structuredReporter?.networkFailures,
          sourceType: "requirement-suite-run",
          healAttempts:
            "healerRuns" in result && Array.isArray(result.healerRuns)
              ? result.healerRuns.length
              : 0,
          maxHealAttempts: input.maxHealAttempts ?? 2,
          evidenceAssurance: executionEvidence.assuranceLevel,
          evidenceRefs: [
            executionEvidence.id,
            result.chainRun.id,
            executionPlan.id
          ]
        })
      : undefined;
  const requirementBug =
    requirementFailure &&
    diagnosis?.verdict === "product_bug" &&
    "chainRun" in result
      ? createRequirementBugReport(context, {
          executableCase,
          chainRun: result.chainRun,
          failureReason: requirementFailure,
          artifactPaths: [contextPackPath, result.specPath, result.testPath].filter(
            (path): path is string => typeof path === "string"
          ),
          diagnosisId: diagnosis.id
        })
      : undefined;
  if (requirementBug && diagnosis) {
    context.executionDiagnosis.linkBugReport(diagnosis.id, requirementBug.id);
  }
  if (
    diagnosis &&
    diagnosis.verdict !== "product_bug" &&
    "chainRun" in result
  ) {
    context.executionDiagnosis.linkGaps(
      diagnosis.id,
      result.chainRun?.gaps.map((gap) => gap.id) ?? []
    );
  }
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
          ),
          requirementSuiteRun.browserMode === "observe" ? "observe" : "headless",
          diagnosis
        )
      : executionEvidence;
  if (
    "chainRun" in result &&
    result.testResult?.actorRoleEvidencePath &&
    requirementSuiteRun.actorJourney?.length
  ) {
    context.requirementSuiteRuns.recordActorJourneyEvidence(
      requirementSuiteRun.id,
      executableCase.id,
      result.testResult.actorRoleEvidencePath
    );
  }
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
    diagnosisId: diagnosis?.id,
    bugReportId: requirementBug?.id,
    gapIds:
      "chainRun" in result
        ? result.chainRun?.gaps.map((gap) => gap.id) ?? []
        : [],
    failureType:
      caseStatus === "passed"
        ? undefined
        : diagnosis?.failureType ??
          classifyFailure(
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
    executionDiagnosis: diagnosis,
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
    const archive = await archiveRequirementSuiteRun(context, blockedRun);
    return {
      ...input.completedCase,
      mode: "requirement-suite",
      status: "blocked",
      gap,
      requirementSuiteRun: blockedRun,
      ...(archive ? { artifactManifest: archive.artifactManifest } : {})
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
  const archive = await archiveRequirementSuiteRun(context, updatedRun);
  const artifactManifest = archive?.artifactManifest;
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
  if (updatedRun.stabilityNextRunId) {
    const next = await executeNextRequirementSuiteCase(
      context,
      updatedRun.stabilityNextRunId,
      { maxHealAttempts: input.maxHealAttempts }
    );
    return {
      ...next,
      [input.completionField]: input.completedCase,
      previousStabilityRun: updatedRun,
      requirementSuiteRun: context.requirementSuiteRuns.get(updatedRun.stabilityNextRunId)
    };
  }
  return {
    ...input.completedCase,
    mode: "requirement-suite",
    status: updatedRun.status,
    requirementSuiteRun: updatedRun,
    ...(artifactManifest ? { artifactManifest } : {}),
    remainingExecutableCaseIds: updatedRun.caseRuns
      .filter((item) => item.status === "queued")
      .map((item) => item.executableCaseId)
  };
}

function formatRequirementGeneratorContext(
  executionPlan: ExecutionPlan,
  contextPack: ReturnType<typeof buildContextPack>,
  evidenceId: string,
  evidenceRoot: string
) {
  const evidenceDir = join(evidenceRoot, evidenceId);
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
    ...(executionPlan.actorJourney?.length
      ? [
          "",
          "## Actor Journey",
          ...executionPlan.actorJourney.map(
            (actor) =>
              `- Role ${actor.order}: ${actor.role}; authProfile=${actor.authProfileId}; afterStep=${actor.afterStepId ?? "start"}; sources=${actor.sourceRefs.join(",")}`
          ),
          "- Switch role only at the declared step boundary; do not infer an account or role from page text.",
          "- The generated test must call bc.runAsRole(browser, role, action) for every role transition."
        ]
      : []),
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
  baseArtifactPaths: string[],
  observationMode: "observe" | "headless" = "headless",
  diagnosis?: Pick<ExecutionDiagnosis, "verdict" | "failureType">
) {
  const output = [testResult?.stdout, testResult?.stderr].filter(Boolean).join("\n").trim();
  const reporter = testResult?.structuredReporter;
  const artifactPaths = [
    ...new Set(
      [
        ...baseArtifactPaths,
        testResult?.reporterPath,
        testResult?.actorRoleEvidencePath,
        ...(reporter?.attachments ?? [])
      ].filter((path): path is string => typeof path === "string")
    )
  ];
  const status =
    reporter?.status === "failed"
      ? "failed"
      : reporter?.status === "blocked"
        ? "blocked"
        : chainRun.status === "succeeded"
      ? "passed"
      : chainRun.gaps.length > 0
        ? "blocked"
        : "failed";
  const actualResult =
    status === "passed"
      ? reporter
        ? "Playwright structured reporter passed."
        : "Playwright exited successfully, but structured reporter evidence was unavailable."
      : output || chainRun.gaps.map((gap) => gap.reason).join("; ") || "Execution failed.";
  const completed = await context.knowledgeService.completeExecutionEvidence(evidenceId, {
    status,
    chainRunId: chainRun.id,
    actualResult,
    artifactPaths,
    tracePaths: artifactPaths.filter((path) => /trace[^\\/]*\.zip$/i.test(path)),
    consoleErrors: reporter?.consoleErrors ?? [],
    networkFailures: reporter?.networkFailures ?? [],
    reporterPath: testResult?.reporterPath,
    reporterResult: reporter,
    actorRoleEvidencePath: testResult?.actorRoleEvidencePath,
    evidenceRootDir: context.workDir,
    observationMode,
    diagnosis
  });
  recordExecutionEvidenceProgress(context, completed);
  return completed;
}

function recordExecutionEvidenceProgress(
  context: BrainCreatorMcpContext,
  evidence: ExecutionEvidence
) {
  const run = context.repository.requirementSuiteRuns.find((candidate) =>
    candidate.caseRuns.some((caseRun) =>
      caseRun.executableCaseId === evidence.executableCaseId &&
      caseRun.executionEvidenceId === evidence.id
    )
  );
  if (!run) return;
  for (const step of evidence.steps) {
    context.runLedger.appendProgress({
      knowledgeProjectId: run.knowledgeProjectId,
      systemId: run.systemId,
      requirementSuiteRunId: run.id,
      executableCaseId: evidence.executableCaseId,
      stage: "execution",
      status:
        step.assertionStatus === "passed"
          ? "passed"
          : step.assertionStatus === "failed"
            ? "failed"
            : step.assertionStatus === "blocked"
              ? "blocked"
              : "running",
      stepId: step.stepId,
      stepTitle: step.instruction,
      pageUrl: step.pageUrl,
      screenshotPath: step.screenshotPath,
      assertionSummary: [
        step.expected ? `expected=${step.expected}` : undefined,
        step.actual ? `actual=${step.actual}` : undefined
      ].filter(Boolean).join("; ") || undefined
    });
  }
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
  const explorationTasks = context.knowledgeService.listExplorationTasks()
    .filter((item) => item.knowledgeProjectId === projectId);
  const pendingExplorationTasks = explorationTasks.filter(
    (item) => item.status === "pending"
  );
  const explorationPlans = context.statefulExplorationPlans.list()
    .filter((item) => item.knowledgeProjectId === projectId);
  const activeExplorationPlan = explorationPlans
    .filter((item) => ["draft", "approved", "running"].includes(item.status))
    .at(-1);
  const onboardingPlans = context.onboardingPlans
    .list()
    .filter((item) => item.knowledgeProjectId === projectId);
  const activeOnboardingPlan = onboardingPlans
    .filter((item) => ["draft", "approved"].includes(item.status))
    .at(-1);
  const activeOnboardingExplorationPlan = activeOnboardingPlan
    ? explorationPlans.find((item) => item.id === activeOnboardingPlan.explorationPlanId)
    : undefined;
  const projectCompileRuns = context.repository.compileRuns.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const blockedDataPlans = executableCases.filter(
    (item) => item.dataPlan?.verdict === "blocked"
  );
  const onboardingNeedsData = Boolean(
    activeOnboardingPlan?.status === "approved" &&
      activeOnboardingExplorationPlan?.executableCaseIds.some((caseId) => {
        const executableCase = executableCases.find((item) => item.id === caseId);
        return executableCase?.status === "needs-data" ||
          executableCase?.dataPlan?.verdict === "blocked" ||
          Boolean(
            executableCase?.dataPlan?.requiresConfirmation &&
              !executableCase.dataPlan.confirmedAt
          );
      })
  );
  const executionEvidence = context.knowledgeService.listExecutionEvidence(projectId);
  const executionPlans = context.repository.executionPlans.filter(
    (item) => item.knowledgeProjectId === projectId
  );
  const requirementSuiteRuns = context.requirementSuiteRuns.list(projectId);
  const stability = summarizeStabilityRuns(
    requirementSuiteRuns,
    context.repository.executionEvidence
  );
  const runLedgerEntries = context.runLedger.list({
    knowledgeProjectId: projectId
  });
  const executionDiagnoses = context.executionDiagnosis.list({
    knowledgeProjectId: projectId
  });
  const legacyDiagnosisAudit = aggregateLegacyDiagnosisAudit(
    context,
    project.systemIds,
    1
  );
  const activeRequirementSuiteRun = requirementSuiteRuns
    .filter(
      (item) =>
        item.status === "running" ||
        item.status === "waiting-for-test-data" ||
        item.status === "waiting-for-agent" ||
        item.status === "blocked"
    )
    .at(-1);
  const activeRequirementRunHasLedger = Boolean(
    activeRequirementSuiteRun &&
      runLedgerEntries.some(
        (entry) => entry.requirementSuiteRunId === activeRequirementSuiteRun.id
      )
  );
  const activeRequirementExecutionRecovery = activeRequirementRunHasLedger
    ? recoverExecutionState(context.repository, activeRequirementSuiteRun!.id)
    : undefined;
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
  } else if (activeExplorationPlan?.status === "running") {
    nextAction = "complete_exploration_plan";
  } else if (onboardingNeedsData) {
    nextAction = "prepare_test_data";
  } else if (activeOnboardingPlan?.status === "approved") {
    nextAction = "start_onboarding_plan";
  } else if (activeOnboardingPlan?.status === "draft") {
    nextAction = "approve_onboarding_plan";
  } else if (activeExplorationPlan?.status === "approved") {
    nextAction = "start_exploration_plan";
  } else if (activeExplorationPlan?.status === "draft") {
    nextAction = "approve_exploration_plan";
  } else if (pendingTestDataTasks.length > 0) {
    nextAction = "complete_test_data_task";
  } else if (cleanupDue.length > 0) {
    nextAction = "prepare_test_data_cleanup";
  } else if (sources.length === 0) nextAction = "ingest_requirement";
  else if (blockedEvalActions.length > 0) nextAction = "revise_blocked_requirement";
  else if (pendingEvalActions.length > 0) nextAction = "confirm_requirement_eval";
  else if (activeRequirementSets.some((item) => item.status === "draft")) {
    const evaluatedDraft = activeRequirementSets.find(
      (item) =>
        item.status === "draft" &&
        item.evaluationGate &&
        item.evaluationGate.status !== "blocked" &&
        item.evaluationGate.actions.every((action) => action.status === "confirmed")
    );
    nextAction = evaluatedDraft && project.systemIds.length > 0
      ? "create_onboarding_plan"
      : "review_and_approve_baseline";
  } else if (pendingExplorationTasks.length > 0) {
    nextAction = "review_exploration_task";
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
    summary: {
      knowledgeProjectId: project.id,
      projectName: project.name,
      nextAction,
      openGaps: gaps.length,
      latestCompileRunId: projectCompileRuns.at(-1)?.id,
      activeExplorationTaskId: pendingExplorationTasks.at(-1)?.id,
      activeExplorationPlanId: activeExplorationPlan?.id,
      activeOnboardingPlanId: activeOnboardingPlan?.id,
      activeRun: activeRequirementSuiteRun
        ? {
            runId: activeRequirementSuiteRun.id,
            status: activeRequirementSuiteRun.status,
            browserMode: activeRequirementSuiteRun.browserMode ?? "headless",
            currentExecutableCaseId: activeRequirementSuiteRun.currentExecutableCaseId,
            progress: runLedgerEntries.some(
              (entry) => entry.requirementSuiteRunId === activeRequirementSuiteRun.id
            )
              ? context.runLedger.summary(activeRequirementSuiteRun.id).currentProgress
              : undefined,
            possiblyStalled: runLedgerEntries.some(
              (entry) => entry.requirementSuiteRunId === activeRequirementSuiteRun.id
            )
              ? context.runLedger.summary(activeRequirementSuiteRun.id).possiblyStalled
              : false,
            executionRecovery: activeRequirementExecutionRecovery
          }
        : undefined
    },
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
      onboarding: {
        total: onboardingPlans.length,
        byStatus: countBy(onboardingPlans, (item) => item.status),
        active: activeOnboardingPlan,
        recent: onboardingPlans.slice(-5)
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
      compilation: {
        compileRuns: {
          total: projectCompileRuns.length,
          recent: projectCompileRuns
            .slice(-5)
            .map(compileRunSummary)
        },
        explorationTasks: {
          total: explorationTasks.length,
          pending: pendingExplorationTasks.length,
          byStatus: countBy(explorationTasks, (item) => item.status),
          recent: explorationTasks.slice(-5)
        },
        explorationPlans: {
          total: explorationPlans.length,
          byStatus: countBy(explorationPlans, (item) => item.status),
          active: activeExplorationPlan,
          recent: explorationPlans.slice(-5)
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
        stability,
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
      executionDiagnoses: {
        ...context.executionDiagnosis.summary({
          knowledgeProjectId: projectId
        }),
        recent: executionDiagnoses.slice(-10),
        legacyAudit: legacyDiagnosisAudit.summary,
        legacyReviews: aggregateLegacyDiagnosisReviewSummary(
          context,
          project.systemIds
        ),
        humanAdjudicationEval:
          context.executionDiagnosis.legacyReviewEvalForSystems(
            project.systemIds
          )
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
      scenarios: {
        total: context.repository.businessScenarios.filter(
          (scenario) => scenario.knowledgeProjectId === projectId
        ).length,
        assurance: countBy(
          context.repository.scenarioAssuranceContracts.filter((contract) =>
            context.repository.businessScenarios.some(
              (scenario) => scenario.id === contract.scenarioId && scenario.knowledgeProjectId === projectId
            )
          ),
          (contract) => contract.verdict
        ),
        trust: countBy(
          context.repository.scenarioTrustRecords.filter((record) =>
            context.repository.businessScenarios.some(
              (scenario) => scenario.id === record.scenarioId && scenario.knowledgeProjectId === projectId
            )
          ),
          (record) => record.status
        )
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
      openGaps: gaps,
      brainRuntime: brainRuntimeStatus(
        context,
        project.systemIds.length === 1 ? project.systemIds[0] : undefined
      )
    },
    connectors: connectorStatus(context, projectId),
    latestCompileRunId: projectCompileRuns.at(-1)?.id,
    activeExplorationTaskId: pendingExplorationTasks.at(-1)?.id,
    activeExplorationPlanId: activeExplorationPlan?.id,
    activeOnboardingPlanId: activeOnboardingPlan?.id,
    nextAction
  };
}

function knowledgeReview(
  context: BrainCreatorMcpContext,
  projectId: string,
  target: KnowledgeReviewTarget,
  idValue?: string,
  limit = 50,
  minSampleSize = 20,
  offset = 0,
  input: Record<string, unknown> = {}
) {
  const status = knowledgeStatus(context, projectId);
  const project = status.knowledge.project;
  if (target === "compile-run") {
    const matchingRuns = context.repository.compileRuns
      .filter(
        (item) =>
          item.knowledgeProjectId === projectId && (!idValue || item.id === idValue)
      );
    const selectedRuns = idValue
      ? matchingRuns
      : matchingRuns.slice(offset, offset + limit);
    const itemOffset = idValue ? offset : 0;
    const runs = selectedRuns
      .map((run) => ({
        ...compileRunSummary(run),
        requirementSetId: run.requirementSetId,
        systemId: run.systemId,
        createdAt: run.createdAt,
        items: run.items.slice(itemOffset, itemOffset + limit),
        explorationTasks: context.repository.explorationTasks.filter((task) =>
          run.items.some((item) => item.explorationTaskIds?.includes(task.id))
        ),
        totalItems: run.items.length,
        returnedItems: Math.min(Math.max(run.items.length - itemOffset, 0), limit),
        nextItemOffset:
          itemOffset + limit < run.items.length ? itemOffset + limit : undefined
      }));
    return {
      project,
      items: runs,
      totalRuns: matchingRuns.length,
      offset,
      nextOffset:
        !idValue && offset + runs.length < matchingRuns.length
          ? offset + runs.length
          : undefined
    };
  }
  if (target === "semantic-binding") {
    const requestedSystemId = optionalStringArg(input, "systemId");
    const requestedRequirementSetId = optionalStringArg(input, "requirementSetId");
    const items = context.repository.semanticBindings.filter(
      (item) =>
        (!idValue || item.id === idValue) &&
        (!requestedSystemId || item.systemId === requestedSystemId) &&
        (!requestedRequirementSetId || item.requirementSetId === requestedRequirementSetId) &&
        context.repository.requirementSets.some(
          (requirementSet) =>
            requirementSet.id === item.requirementSetId &&
            requirementSet.knowledgeProjectId === projectId
        )
    );
    return {
      project,
      summary: {
        total: items.length,
        confirmed: items.filter((item) => item.status === "confirmed").length,
        candidates: items.filter((item) => item.status === "candidate").length,
        stale: items.filter((item) => item.status === "stale").length,
        conflicted: items.filter((item) => item.status === "conflicted").length
      },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "business-scenario") {
    const items = context.knowledgeService
      .listBusinessScenarios({
        knowledgeProjectId: projectId,
        requirementSetId: optionalStringArg(input, "requirementSetId"),
        systemId: optionalStringArg(input, "systemId")
      })
      .filter((item) => !idValue || item.id === idValue);
    return {
      project,
      summary: {
        total: items.length,
        byFamily: countBy(items, (item) => item.family),
        byStatus: countBy(items, (item) => item.status)
      },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "scenario-assurance") {
    const items = context.knowledgeService.listScenarioAssurance({
      knowledgeProjectId: projectId,
      requirementSetId: optionalStringArg(input, "requirementSetId"),
      systemId: optionalStringArg(input, "systemId"),
      scenarioId: idValue
    });
    return {
      project,
      summary: {
        total: items.length,
        byVerdict: countBy(items, (item) => item.verdict),
        byBinding: countBy(items, (item) => item.systemBinding),
        byOracle: countBy(items, (item) => item.oracleStrength)
      },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "scenario-trust") {
    const items = context.knowledgeService.listScenarioTrust({
      knowledgeProjectId: projectId,
      requirementSetId: optionalStringArg(input, "requirementSetId"),
      scenarioId: idValue
    });
    return {
      project,
      summary: {
        total: items.length,
        byStatus: countBy(items, (item) => item.status),
        trusted: items.filter((item) => item.status === "trusted").length
      },
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "requirement") {
    const items = context.repository.requirementSets.filter(
      (item) => item.knowledgeProjectId === projectId && (!idValue || item.id === idValue)
    );
    return {
      project,
      ...paginateReviewItems(items, input),
      impacts: items.map((item) => context.knowledgeService.requirementImpact(item.id))
    };
  }
  if (target === "test-intent") {
    const items = context.knowledgeService
      .listTestIntents(projectId)
      .filter((item) => !idValue || item.id === idValue);
    return {
      project,
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "executable-case") {
    const items = context.knowledgeService
      .listExecutableCases(projectId)
      .filter((item) => !idValue || item.id === idValue);
    return {
      project,
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "case-dependency") {
    const requestedSystemId = optionalStringArg(input, "systemId");
    if (requestedSystemId && !project.systemIds.includes(requestedSystemId)) {
      throw new Error("Requested dependency graph system is not bound to the knowledge project");
    }
    const requirementSets = context.repository.requirementSets.filter(
      (item) =>
        item.knowledgeProjectId === projectId &&
        (!optionalStringArg(input, "requirementSetId") ||
          item.id === optionalStringArg(input, "requirementSetId")) &&
        (!idValue || item.id === idValue)
    );
    const systemIds: Array<string | undefined> = requestedSystemId
      ? [requestedSystemId]
      : project.systemIds.length > 0
        ? project.systemIds
        : [undefined];
    const graphs = requirementSets.flatMap((requirementSet) =>
      systemIds.map((systemId) =>
        buildCaseDependencyGraph({
          requirementSetId: requirementSet.id,
          ...(systemId ? { systemId } : {}),
          intents: context.repository.testIntents,
          executableCases: context.repository.executableCases
        })
      )
    );
    return {
      project,
      ...paginateReviewItems(graphs, input)
    };
  }
  if (target === "execution-plan") {
    const items = context.repository.executionPlans.filter(
      (item) =>
        item.knowledgeProjectId === projectId &&
        (!idValue || item.id === idValue)
    );
    return {
      project,
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "requirement-suite-run") {
    const items = context.requirementSuiteRuns
      .list(projectId)
      .filter((item) => !idValue || item.id === idValue)
      .map((item) => ({
        ...item,
        reconciliation: requirementSuiteReconciliation(context, item)
      }));
    const reviewSummary = requirementSuiteRunCollectionSummary(items);
    return {
      project,
      ...paginateReviewItems(items, input),
      reviewSummary
    };
  }
  if (target === "run-ledger") {
    const entries = context.runLedger
      .list({ knowledgeProjectId: projectId })
      .filter(
        (entry) => !idValue || entry.requirementSuiteRunId === idValue
      );
    const runIds = [...new Set(
      entries.flatMap((entry) =>
        entry.requirementSuiteRunId ? [entry.requirementSuiteRunId] : []
      )
    )];
    const summaries = runIds.map((runId) => context.runLedger.summary(runId));
    const pagedEntries = paginateReviewItems(entries, input);
    const pagedSummaries = paginateReviewItems(summaries, input);
    return {
      project,
      summaries: pagedSummaries.items,
      entries: pagedEntries.items,
      ...(pagedEntries.totalItems === undefined
        ? {}
        : {
            summaryPage: pagedSummaries,
            entryPage: pagedEntries
          })
    };
  }
  if (target === "execution-diagnosis") {
    const diagnosisEval = context.executionDiagnosis.legacyReviewEvalForSystems(
      project.systemIds,
      minSampleSize
    );
    const items = context.executionDiagnosis
      .list({ knowledgeProjectId: projectId })
      .filter((item) => !idValue || item.id === idValue);
    const diagnosisSummary = context.executionDiagnosis.summary({
      knowledgeProjectId: projectId
    });
    return {
      project,
      summary: diagnosisSummary,
      items,
      legacyAudit: aggregateLegacyDiagnosisAudit(
        context,
        project.systemIds,
        limit
      ),
      legacyReviews: project.systemIds.flatMap((systemId) =>
        context.executionDiagnosis.listLegacyReviews(systemId)
      ),
      humanAdjudicationEval: diagnosisEval,
      reviewSummary: executionDiagnosisReviewSummary({
        summary: diagnosisSummary,
        items,
        nextAction:
          diagnosisSummary.routing.bugEligible > 0
            ? "review_product_bugs"
            : diagnosisSummary.routing.gapRouted > 0
              ? "review_evidence_gaps"
              : "no_diagnosis_action"
      }),
      evalMarkdown: legacyDiagnosisEvalMarkdown(diagnosisEval)
    };
  }
  if (target === "coverage") {
    const requestedSystemId = optionalStringArg(input, "systemId");
    const intents = context.knowledgeService.listTestIntents(projectId);
    const sets = context.repository.requirementSets.filter(
      (item) => item.knowledgeProjectId === projectId && item.status !== "superseded"
    );
    const executionLedger = context.knowledgeService.testIntentCoverage(projectId, requestedSystemId);
    const requirementSetIds = new Set(sets.map((item) => item.id));
    const processCoverageProfiles = context.repository.requirementCoverageProfiles.filter(
      (item) => requirementSetIds.has(item.requirementSetId)
    );
    const requestedLimit = optionalNumberArg(input, "limit");
    const requestedOffset = optionalNumberArg(input, "offset") ?? 0;
    const nextOffset = requestedLimit !== undefined &&
      requestedOffset + requestedLimit < executionLedger.items.length
      ? requestedOffset + requestedLimit
      : undefined;
    const pagedLedger = requestedLimit === undefined
      ? executionLedger
      : {
          ...executionLedger,
          items: executionLedger.items.slice(requestedOffset, requestedOffset + requestedLimit),
          totalItems: executionLedger.items.length,
          returnedItems: Math.min(
            Math.max(executionLedger.items.length - requestedOffset, 0),
            requestedLimit
          ),
          offset: requestedOffset,
          nextOffset
        };
    return {
      project,
      ...(requestedSystemId ? { systemId: requestedSystemId } : {}),
      requirements: sets.length,
      coveredRequirements: new Set(intents.map((item) => item.requirementSetId)).size,
      traceableIntents: intents.filter(
        (item) => item.requirementRefs.length > 0 && item.knowledgeNodeRefs.length > 0
      ).length,
      totalIntents: intents.length,
      executionLedger: pagedLedger,
      dimensionSummary: summarizeCoverageDimensions(
        executionLedger.items
      ),
      requirementCoverageProfiles: processCoverageProfiles,
      processModels: {
        workflows: context.repository.workflowModels.filter(
          (item) => requirementSetIds.has(item.requirementSetId)
        ),
        stateMachines: context.repository.stateMachineModels.filter(
          (item) => requirementSetIds.has(item.requirementSetId)
        )
      },
      sourceLedger: context.knowledgeService.requirementSourceLedger(projectId),
      ...(requestedLimit === undefined
        ? {}
        : {
            itemPage: {
              limit: requestedLimit,
              offset: requestedOffset,
              total: executionLedger.items.length,
              nextOffset
            }
          })
    };
  }
  if (target === "requirement-eval-accuracy") {
    return {
      project,
      accuracy: context.knowledgeService.requirementEvalAccuracy(projectId, idValue)
    };
  }
  if (target === "testdata") {
    const requestedSystemId = optionalStringArg(input, "systemId");
    if (requestedSystemId && !project.systemIds.includes(requestedSystemId)) {
      throw new Error("Requested test data system is not bound to the knowledge project");
    }
    const systemIds = requestedSystemId ? [requestedSystemId] : project.systemIds;
    const systems = systemIds.map((systemId) => {
      const graph = context.testDataBrain.graph(systemId);
      return {
        systemId,
        entities: graph.entities,
        dependencies: graph.dependencies
      };
    });
    return {
      project,
      systems,
      totals: {
        entities: systems.reduce((total, item) => total + item.entities.length, 0),
        dependencies: systems.reduce((total, item) => total + item.dependencies.length, 0)
      }
    };
  }
  if (target === "system-brain") {
    if (!idValue) throw new Error("systemId is required to review System Brain");
    const view = optionalStringArg(input, "view") ?? "current";
    const snapshots = context.systemBrainSnapshots.history(idValue);
    if (view === "history") {
      return {
        project,
        systemId: idValue,
        snapshots
      };
    }
    if (view === "diff") {
      const fromSnapshotId = stringArg(input, "fromSnapshotId");
      const toSnapshotId = stringArg(input, "toSnapshotId");
      return {
        project,
        systemId: idValue,
        diff: context.systemBrainSnapshots.diff(idValue, fromSnapshotId, toSnapshotId)
      };
    }
    return {
      project,
      brain: context.knowledgeService.getSystemBrain(projectId, idValue),
      snapshot:
        context.systemBrainSnapshots.latest(idValue) ??
        context.systemBrainSnapshots.latest(idValue, "candidate"),
      latestChangeSet: context.repository.systemBrainChangeSets
        .filter((changeSet) => changeSet.systemId === idValue)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    };
  }
  if (target === "system-exploration") {
    const items = context.systemExploration
      .list(projectId)
      .filter((item) => !idValue || item.id === idValue);
    return {
      project,
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "onboarding-plan") {
    const items = context.onboardingPlans
      .list({
        systemId: optionalStringArg(input, "systemId"),
        requirementSetId: optionalStringArg(input, "requirementSetId")
      })
      .filter(
        (item) =>
          item.knowledgeProjectId === projectId &&
          (!idValue || item.id === idValue)
      );
    return {
      project,
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "exploration-plan") {
    const items = context.statefulExplorationPlans
      .list({ requirementSetId: optionalStringArg(input, "requirementSetId") })
      .filter(
        (item) =>
          item.knowledgeProjectId === projectId &&
          (!idValue || item.id === idValue)
      );
    return {
      project,
      ...paginateReviewItems(items, input)
    };
  }
  if (target === "evidence") {
    const executionEvidence = context.knowledgeService.listExecutionEvidence(projectId);
    const artifacts = project.systemIds.flatMap((systemId) => [
      ...context.service.listTestSpecs(systemId),
      ...context.service.listTestFiles(systemId),
      ...context.service.listChainRuns(systemId)
    ]);
    const pagedEvidence = paginateReviewItems(executionEvidence, input);
    const pagedArtifacts = paginateReviewItems(artifacts, input);
    return {
      project,
      systems: project.systemIds,
      executionEvidence: pagedEvidence.items,
      artifacts: pagedArtifacts.items,
      ...(pagedEvidence.totalItems === undefined
        ? {}
        : {
            executionEvidencePage: pagedEvidence,
            artifactPage: pagedArtifacts
          })
    };
  }
  return { ...status.knowledge };
}

function paginateReviewItems<T>(items: T[], input: Record<string, unknown>) {
  const limit = optionalNumberArg(input, "limit");
  if (limit === undefined) return { items };
  const offset = optionalNumberArg(input, "offset") ?? 0;
  const page = items.slice(offset, offset + limit);
  return {
    items: page,
    totalItems: items.length,
    returnedItems: page.length,
    offset,
    nextOffset: offset + page.length < items.length ? offset + page.length : undefined
  };
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

function compileRunSummary(run: CompileRun) {
  return {
    compileRunId: run.id,
    status: run.status,
    total: run.total,
    ready: run.ready,
    needsExploration: run.needsExploration,
    needsData: run.needsData,
    blocked: run.blocked,
    ambiguous: run.ambiguous,
    skipped: run.skipped,
    reused: run.reused,
    nextAction:
      run.blocked + run.ambiguous + run.needsExploration + run.needsData + run.skipped > 0
        ? "review-compile-run"
        : "preview-requirement-suite"
  };
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

function configuredFeishuReader(environment: Record<string, string | undefined> = process.env): RequirementSourceReader | undefined {
  const appId = environment.BRAIN_CREATOR_FEISHU_APP_ID;
  const appSecret = environment.BRAIN_CREATOR_FEISHU_APP_SECRET;
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
  const planLayout = resolveArtifactRunLayout({
    workDir: context.workDir,
    systemKey: system.name,
    requirementKey: "draft-plan",
    suiteRunId: `plan-${system.id}`
  });
  const specPath = optionalStringArg(input, "specPath") ?? join(
    planLayout.specsDir,
    artifactFileName({ title: requirement, extension: ".md", contentHash: systemId })
  );
  if (context.agentBridge?.provider === "host-agent") {
    const prompt = await buildAgentPrompt({
      outputDir: planLayout.analysisDir,
      system,
      requirement,
      glossaryTerms: context.service.listGlossaryTerms({ projectId: systemId, query: "" }),
      businessRules: context.service.listBusinessRules(systemId),
      authProfiles: [authProfile]
    });
    const seed = await generateSeedFile({
      workDir: context.workDir,
      outputDir: planLayout.testsDir,
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
  const harnessResult = await runInHarness({
    runtime: context.harness,
    approved: true,
    agent: "planner",
    enforceEvaluation: true,
    task: {
      brain: "requirement",
      operation: "generate-plan",
      inputSummary: requirement,
      systemId,
      policy: {
        allowWrites: true,
        allowedFiles: [specPath],
        requireApproval: false
      }
    },
    execute: () => generatePlanDraft({
      workDir: context.workDir,
      system,
      authProfile,
      requirement,
      glossaryTerms: context.service.listGlossaryTerms({ projectId: systemId, query: "" }),
      businessRules: context.service.listBusinessRules(systemId),
      specPath,
      agentBridge: context.agentBridge
    }),
    structuredOutput: (result) => plannerOutputFromResult({
      status: result.agentRun.status === "succeeded" ? "succeeded" : "failed",
      scenarios: result.scenarios,
      sourceRefs: [`agent-run:${result.agentRun.id}`, `system:${systemId}`],
      gaps: result.agentRun.error ? [result.agentRun.error] : []
    }),
    evaluate: (result) => ({
      verdict: result.agentRun.status === "succeeded" ? "pass" : "blocked",
      score: result.agentRun.status === "succeeded" ? 1 : 0,
      reasons: result.agentRun.error ? [result.agentRun.error] : [],
      affectedAssetIds: [result.agentRun.id],
      evidenceRefs: result.agentRun.outputPaths.map((path) => `artifact:${path}`),
      nextActions: result.agentRun.status === "succeeded" ? [] : ["review-agent-run"]
    })
  });
  const result = harnessResult.result;
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
  const structuredReporter = resolveStructuredReporterMode(context, input);
  const browserMode = browserModeArg(input) ?? "headless";
  const browserCapability = browserObservationCapability(browserMode);
  if (!browserCapability.available) {
    throw new Error(browserCapability.reason);
  }
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
  await verifyAuthForExecution(context, system, authProfile, {
    requirementSuiteRunId: optionalStringArg(input, "requirementSuiteRunId"),
    executableCaseId: optionalStringArg(input, "executableCaseId"),
    role: "primary"
  });
  const actorJourneyProfiles = executionPlan?.actorJourney?.map((actor) => ({
    role: actor.role,
    authProfile: findAuthProfileById(context, testCase.systemId, actor.authProfileId)
  }));
  for (const actor of actorJourneyProfiles ?? []) {
    await verifyAuthForExecution(context, system, actor.authProfile, {
      requirementSuiteRunId: optionalStringArg(input, "requirementSuiteRunId"),
      executableCaseId: optionalStringArg(input, "executableCaseId"),
      role: actor.role
    });
  }
  const artifactScope = resolveChainArtifactScope(context, input, system, testCase);
  if (context.agentBridge?.provider === "host-agent") {
    const specPath = join(artifactScope.layout.specsDir, artifactFileName({
      caseNo: artifactScope.caseNo,
      title: testCase.requirement,
      extension: ".md",
      contentHash: testCase.id
    }));
    const testPath = join(artifactScope.layout.testsDir, artifactFileName({
      caseNo: artifactScope.caseNo,
      title: testCase.requirement,
      extension: ".spec.ts",
      contentHash: testCase.id
    }));
    await mkdir(artifactScope.layout.specsDir, { recursive: true });
    await mkdir(artifactScope.layout.testsDir, { recursive: true });
    await writeFile(
      specPath,
      [formatScenariosAsMarkdown(testCase.scenarios), optionalStringArg(input, "knowledgeContext")]
        .filter(Boolean)
        .join("\n\n"),
      "utf8"
    );
    const seed = await generateSeedFile({
      workDir: context.workDir,
      outputDir: artifactScope.layout.testsDir,
      system,
      authProfile,
      actorJourney: actorJourneyProfiles
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
        contextPackPath: optionalStringArg(input, "contextPackPath"),
        requiredStepIds: executionPlan?.steps
          .filter((step) => step.action !== "api")
          .map((step) => step.id),
        actorJourneyRoles: actorJourneyProfiles?.map((actor) => actor.role),
        browserMode
      },
      suiteContext: suiteContextArg(input),
      regressionContext: regressionContextArg(input)
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
  const harnessResult = await runInHarness({
    runtime: context.harness,
    approved: true,
    task: {
      brain: "testexecution",
      operation: "run-approved-chain",
      inputSummary: testCase.requirement,
      systemId: testCase.systemId,
      requirementSetId: optionalStringArg(input, "requirementSetId"),
      policy: {
        allowWrites: true,
        requireApproval: false,
        allowedUrls: [system.baseUrl]
      },
      budget: {
        maxHealAttempts: optionalNumberArg(input, "maxHealAttempts") ?? 1
      }
    },
    execute: () => runChain({
      workDir: context.workDir,
      system,
      authProfile,
      testCase,
      agentBridge: context.agentBridge,
      runner: context.runner,
      structuredReporter,
      maxHealAttempts: optionalNumberArg(input, "maxHealAttempts"),
      knowledgeContext: optionalStringArg(input, "knowledgeContext"),
      actorJourney: actorJourneyProfiles,
      requiredStepIds: executionPlan?.steps
        .filter((step) => step.action !== "api")
        .map((step) => step.id),
      browserMode,
      artifactLayout: artifactScope.layout,
      caseNo: artifactScope.caseNo
    }),
    structuredOutputs: (result) => [
      {
        agent: "generator" as const,
        output: {
          version: 1,
          agent: "generator" as const,
          status: result.generateRun.status === "succeeded" ? "generated" as const : "blocked" as const,
          testPath: result.testPath,
          steps: testCase.scenarios.flatMap((scenario) => scenario.steps.map((step, index) => ({
            id: `${scenario.id}-step-${index + 1}`,
            sourceRefs: [`test-case:${testCase.id}`]
          }))),
          assertions: testCase.scenarios.flatMap((scenario) => scenario.steps
            .filter((step) => step.action === "assert")
            .map((step, index) => ({
              id: `${scenario.id}-assertion-${index + 1}`,
              sourceRefs: [`test-case:${testCase.id}`]
            }))),
          sourceRefs: [`test-case:${testCase.id}`, `agent-run:${result.generateRun.id}`]
        }
      },
      ...result.healerRuns.map((healerRun) => ({
        agent: "healer" as const,
        output: {
          version: 1,
          agent: "healer" as const,
          status: healerRun.status === "succeeded" ? "healed" as const : "unresolved" as const,
          targetTestPath: result.testPath,
          changedFiles: [result.testPath],
          removedAssertionIds: [],
          failureRefs: [`agent-run:${healerRun.id}`],
          sourceRefs: [`agent-run:${healerRun.id}`, `chain-run:${result.chainRun.id}`],
          notes: healerRun.error
        }
      }))
    ],
    evaluate: (result) => ({
      verdict: result.chainRun.status === "succeeded" ? "pass" : result.chainRun.gaps.length > 0 ? "blocked" : "needs-review",
      score: result.chainRun.status === "succeeded" ? 1 : 0,
      reasons: result.chainRun.gaps.map((gap) => gap.reason),
      affectedAssetIds: [result.chainRun.id],
      evidenceRefs: [
        `chain-run:${result.chainRun.id}`,
        ...result.chainRun.gaps.map((gap) => `gap:${gap.id}`)
      ],
      nextActions: result.chainRun.status === "succeeded" ? [] : ["review-chain-run"]
    })
  });
  const result = harnessResult.result;
  context.service.recordAgentRun(result.generateRun);
  for (const healerRun of result.healerRuns) {
    context.service.recordAgentRun(healerRun);
  }
  context.service.recordChainRun(result.chainRun);
  return result;
}

function requirementArtifactLayout(
  context: BrainCreatorMcpContext,
  run: RequirementSuiteRun,
  executableCase: ExecutableCase
) {
  const system = context.repository.systemProfiles.find((item) => item.id === run.systemId);
  const requirement = context.repository.requirementSets.find(
    (item) => item.id === executableCase.requirementSetId
  );
  return resolveArtifactRunLayout({
    workDir: context.workDir,
    systemKey: system?.name ?? run.systemId,
    requirementKey: requirement?.title ?? executableCase.requirementSetId,
    requirementVersion: requirement?.version,
    suiteRunId: run.id
  });
}

function resolveChainArtifactScope(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>,
  system: SystemProfile,
  testCase: TestCase
): { layout: ArtifactRunLayout; caseNo?: string } {
  const supplied = input.artifactLayout;
  const requirementSuiteRunId = optionalStringArg(input, "requirementSuiteRunId");
  const executableCaseId = optionalStringArg(input, "executableCaseId");
  const requirementSuiteRun = requirementSuiteRunId
    ? context.repository.requirementSuiteRuns.find((item) => item.id === requirementSuiteRunId)
    : undefined;
  const executableCase = executableCaseId
    ? context.repository.executableCases.find((item) => item.id === executableCaseId)
    : undefined;
  const caseRun = requirementSuiteRun?.caseRuns.find(
    (item) => item.executableCaseId === executableCaseId || item.testCaseId === testCase.id
  );
  if (isArtifactRunLayout(supplied)) {
    return {
      layout: supplied,
      ...(caseRun ? { caseNo: `TC-${String(caseRun.order).padStart(3, "0")}` } : {})
    };
  }
  if (requirementSuiteRun && executableCase) {
    return {
      layout: requirementArtifactLayout(context, requirementSuiteRun, executableCase),
      ...(caseRun ? { caseNo: `TC-${String(caseRun.order).padStart(3, "0")}` } : {})
    };
  }
  return {
    layout: resolveArtifactRunLayout({
      workDir: context.workDir,
      systemKey: system.name,
      requirementKey: "unscoped",
      suiteRunId: `chain-${testCase.id}`
    })
  };
}

function isArtifactRunLayout(value: unknown): value is ArtifactRunLayout {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ArtifactRunLayout>;
  return [candidate.root, candidate.specsDir, candidate.testsDir, candidate.evidenceDir]
    .every((path) => typeof path === "string");
}

function resolveStructuredReporterMode(
  context: BrainCreatorMcpContext,
  input: Record<string, unknown>
) {
  const requested = optionalStringArg(input, "evidenceMode");
  if (requested && requested !== "strict" && requested !== "compatibility") {
    throw new Error("evidenceMode must be strict or compatibility");
  }
  if (requested === "compatibility" && !context.runner) {
    throw new Error(
      "evidenceMode=compatibility requires an injected runner; real Playwright execution stays strict"
    );
  }
  if (requested === "strict") return true;
  if (requested === "compatibility") return false;
  return context.structuredReporter;
}

async function verifyAuthForExecution(
  context: BrainCreatorMcpContext,
  system: SystemProfile,
  authProfile: AuthProfile,
  ledgerContext: {
    requirementSuiteRunId?: string;
    executableCaseId?: string;
    role?: string;
  } = {}
) {
  const capture = context.service.getCaptureAuth(authProfile.id);
  if (!capture) return;
  let storageStatePath: string | undefined;
  try {
    storageStatePath = await materializeAuthStorageState(context, system, authProfile);
  } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const pending = context.service.listAuthCheckpoints(system.id, "awaiting-user")
        .find((checkpoint) => checkpoint.authProfileId === authProfile.id);
      if (!pending) {
        context.service.createAuthCheckpoint({
          systemId: system.id,
          authProfileId: authProfile.id,
          reason,
          resumeInstruction: "Refresh or capture a browser login state, then complete this checkpoint before resuming execution."
        });
      }
      recordAuthPreflight(context, authProfile, ledgerContext, {
        status: "blocked",
        message: reason
      });
      throw new BrainCreatorError({
        code: "BC_AUTH_MATERIALIZATION_FAILED",
        message: reason,
        userMessage: {
          enUS: "Authentication state could not be prepared for execution.",
          zhCN: "执行前无法准备鉴权状态。"
        },
        nextAction: "complete-auth-checkpoint",
        retryable: true
      });
  }
  if (!storageStatePath) return;
  const cacheTtlMs = Math.max(
    5_000,
    Math.min(300_000, Number(process.env.BRAIN_CREATOR_AUTH_CACHE_TTL_MS ?? 60_000))
  );
  const cachedUntil = context.authVerificationCache.get(authProfile.id) ?? 0;
  if (cachedUntil > Date.now()) {
    recordAuthPreflight(context, authProfile, ledgerContext, {
      status: "valid",
      message: "Authentication state reused from the bounded verification cache."
    });
    return;
  }
  let verification = await context.authStateVerifier({
    storageStatePath: await resolveProtectedStorageStatePath(context.workDir, storageStatePath),
    targetUrl: system.baseUrl,
    allowedUrls: system.urlAllowlist
  });
  if (verification.status === "valid") {
    context.authVerificationCache.set(authProfile.id, Date.now() + cacheTtlMs);
    recordAuthPreflight(context, authProfile, ledgerContext, {
      status: "valid",
      message: "Authentication state verified in a fresh browser context."
    });
    return;
  }
  const refreshed = await refreshAndVerifyAuthState(context, system, authProfile, verification.reason);
  if (refreshed?.status === "valid") {
    context.authVerificationCache.set(authProfile.id, Date.now() + cacheTtlMs);
    recordAuthPreflight(context, authProfile, ledgerContext, {
      status: "valid",
      message: `Authentication state refreshed and reverified${refreshed.authRefresh?.provider ? ` by ${refreshed.authRefresh.provider}` : ""}.`
    });
    return;
  }
  if (refreshed) verification = refreshed;
  context.authVerificationCache.delete(authProfile.id);
  const pending = context.service.listAuthCheckpoints(system.id, "awaiting-user")
    .find((checkpoint) => checkpoint.authProfileId === authProfile.id);
  if (!pending) {
    context.service.createAuthCheckpoint({
      systemId: system.id,
      authProfileId: authProfile.id,
      reason: verification.reason ?? "Stored browser authentication is no longer valid.",
      resumeInstruction: "Refresh the browser login state, then complete this checkpoint before resuming execution."
    });
  }
  recordAuthPreflight(context, authProfile, ledgerContext, {
    status: "blocked",
    message: verification.reason ?? "Stored browser authentication requires user intervention."
  });
  throw new BrainCreatorError({
    code: verification.status === "expired"
      ? "BC_AUTH_STATE_EXPIRED"
      : "BC_AUTH_STATE_UNAVAILABLE",
    message: verification.reason ?? "Stored browser authentication requires user intervention before execution.",
    userMessage: {
      enUS: "Stored browser authentication requires user intervention before execution.",
      zhCN: "保存的浏览器鉴权状态需要人工处理后才能执行。"
    },
    nextAction: "complete-auth-checkpoint",
    retryable: verification.status === "unavailable"
  });
}

function recordAuthPreflight(
  context: BrainCreatorMcpContext,
  authProfile: AuthProfile,
  ledgerContext: {
    requirementSuiteRunId?: string;
    executableCaseId?: string;
    role?: string;
  },
  input: { status: "valid" | "blocked"; message: string }
) {
  if (!ledgerContext.requirementSuiteRunId) return;
  context.runLedger.append({
    runType: "requirement-suite",
    systemId: authProfile.projectId,
    requirementSuiteRunId: ledgerContext.requirementSuiteRunId,
    executableCaseId: ledgerContext.executableCaseId,
    event: "auth-preflight",
    scope: ledgerContext.executableCaseId ? "case" : "suite",
    stage: "preflight",
    toStatus: input.status,
    outcome: input.status === "valid" ? "passed" : "blocked",
    message: ledgerContext.role
      ? `${ledgerContext.role}: ${input.message}`
      : input.message,
    references: { authProfileId: authProfile.id }
  });
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
  const agent = agentArg(input, "agent");
  const inputSummary = stringArg(input, "inputSummary");
  const outputPaths = stringArrayArg(input, "outputPaths");
  const harnessResult = await runInHarness({
    runtime: context.harness,
    approved: true,
    task: {
      brain: agent === "planner" ? "requirement" : agent === "generator" ? "testcase" : "testexecution",
      operation: `run-${agent}`,
      inputSummary,
      systemId,
      provider: context.agentBridge?.provider,
      policy: {
        allowWrites: outputPaths.length > 0,
        allowedFiles: outputPaths,
        requireApproval: false
      }
    },
    execute: () => runAgent({
      systemId,
      agent,
      inputSummary,
      args: stringArrayArg(input, "args"),
      outputPaths,
      cwd: context.workDir,
      timeoutMs: optionalNumberArg(input, "timeoutMs"),
      agentBridge: context.agentBridge
    }),
    evaluate: (result) => ({
      verdict: result.status === "succeeded" ? "pass" : "blocked",
      score: result.status === "succeeded" ? 1 : 0,
      reasons: result.error ? [result.error] : [],
      affectedAssetIds: result.outputPaths,
      evidenceRefs: result.outputPaths.map((path) => `artifact:${path}`),
      nextActions: result.status === "succeeded" ? [] : ["review-agent-run"]
    })
  });
  context.service.recordAgentRun(harnessResult.result);
  return harnessResult.result;
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
  const regressionContext = regressionContextArg(input);
  const provider = context.agentBridge?.provider ?? "host-agent";
  const harnessSession = findOrCreateHostHarnessSession(context, systemId, provider);
  const harnessTask = context.harness.startDeferredTask({
    brain: agent === "planner" ? "requirement" : "testexecution",
    operation: `host-agent-${agent}`,
    inputSummary,
    inputRefs: [
      `system:${systemId}`,
      ...outputPaths.map((path) => `artifact:${path}`),
      ...(planContext ? [`requirement:${planContext.requirement}`] : []),
      ...(chainContext?.testCaseId ? [`test-case:${chainContext.testCaseId}`] : [])
    ],
    systemId,
    sessionId: harnessSession.id,
    provider,
    policy: {
      allowedFiles: outputPaths,
      allowWrites: true,
      requireApproval: false
    },
    budget: chainContext?.maxHealAttempts === undefined
      ? undefined
      : { maxHealAttempts: Math.max(chainContext.maxHealAttempts, 0) },
    approved: true
  });
  const contextContent = JSON.stringify({
    systemId,
    agent,
    inputSummary,
    outputPaths,
    planContext,
    chainContext,
    suiteContext,
    regressionContext
  });
  context.harness.setContextPack(harnessTask.id, {
    taskId: harnessTask.id,
    purpose: agent === "planner" ? "requirement" : "testexecution",
    summary: inputSummary,
    references: [
      { ref: `system:${systemId}`, kind: "system" },
      ...outputPaths.map((path) => ({ ref: `artifact:${path}`, kind: "artifact" as const }))
    ],
    content: contextContent,
    estimatedChars: contextContent.length,
    truncated: false
  });
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
    suiteContext,
    regressionContext,
    harnessTaskId: harnessTask.id,
    harnessSessionId: harnessSession.id
  });
  await mkdir(taskDir, { recursive: true });
  await writeFile(
    promptPath,
    hostAgentPrompt({
      systemId,
      agent,
      inputSummary,
      args,
      outputPaths,
      requiredStepIds: chainContext?.requiredStepIds,
      actorJourneyRoles: chainContext?.actorJourneyRoles
    }),
    "utf8"
  );
  await writeFile(
    contextPath,
    `${JSON.stringify(
      {
        taskId,
        harnessTaskId: harnessTask.id,
        harnessSessionId: harnessSession.id,
        systemId,
        system,
        agent,
        inputSummary,
        args,
        outputPaths,
        planContext,
        chainContext,
        suiteContext,
        regressionContext,
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

function findOrCreateHostHarnessSession(
  context: BrainCreatorMcpContext,
  systemId: string,
  provider: string
) {
  const existing = context.repository.brainSessions.find(
    (session) =>
      session.currentSystemId === systemId &&
      session.provider === provider &&
      !session.activeTaskId
  );
  return existing ?? context.harness.createSession({
    currentSystemId: systemId,
    provider
  });
}

async function evaluateHostAgentOutput(
  context: BrainCreatorMcpContext,
  task: AgentTask,
  status: "succeeded" | "failed",
  providerText: string
): Promise<BrainEvalResult | undefined> {
  const harnessTask = task.harnessTaskId ? context.harness.getTask(task.harnessTaskId) : undefined;
  if (!harnessTask) return undefined;
  const output = await hostAgentStructuredOutput(context, task, status);
  if (!output) return undefined;
  return evaluateStructuredAgentOutput(task.agent, output, {
    allowedFiles: harnessTask.policy.allowedFiles,
    text: providerText
  });
}

async function hostAgentStructuredOutput(
  _context: BrainCreatorMcpContext,
  task: AgentTask,
  status: "succeeded" | "failed"
) {
  const sourceRefs = [
    `agent-task:${task.id}`,
    ...task.outputPaths.map((path) => `artifact:${path}`)
  ];
  if (task.agent === "planner") {
    if (status !== "succeeded" || !task.planContext) return undefined;
    const specContent = await readFile(task.planContext.specPath, "utf8").catch(() => undefined);
    if (!specContent) return undefined;
    const scenarios = parseSpecMarkdown(specContent);
    if (scenarios.length === 0) return undefined;
    return plannerOutputFromResult({
      status: "succeeded",
      scenarios,
      sourceRefs,
      gaps: []
    });
  }
  if (task.agent === "generator") {
    const testPath = task.chainContext?.testPath ?? task.outputPaths[0] ?? "";
    const requiredStepIds = task.chainContext?.requiredStepIds ?? ["generated-test"];
    return {
      version: 1 as const,
      agent: "generator" as const,
      status: status === "succeeded" ? "generated" as const : "blocked" as const,
      testPath,
      steps: requiredStepIds.map((id) => ({ id, sourceRefs })),
      assertions: [{ id: "generated-assertions", sourceRefs }],
      sourceRefs
    };
  }
  return {
    version: 1 as const,
    agent: "healer" as const,
    status: status === "succeeded" ? "healed" as const : "unresolved" as const,
    targetTestPath: task.chainContext?.testPath ?? task.outputPaths[0] ?? "",
    changedFiles: task.outputPaths,
    removedAssertionIds: [],
    failureRefs: [`agent-task:${task.id}`],
    sourceRefs
  };
}

function completeHostHarnessTask(
  context: BrainCreatorMcpContext,
  task: AgentTask,
  evaluation: BrainEvalResult,
  agentRunId: string,
  outputPaths: string[]
) {
  if (!task.harnessTaskId) return;
  const harnessTask = context.harness.getTask(task.harnessTaskId);
  if (!harnessTask || ["completed", "blocked", "failed", "cancelled"].includes(harnessTask.state)) return;
  context.harness.completeDeferredTask(
    harnessTask.id,
    evaluation,
    [
      `agent-run:${agentRunId}`,
      ...outputPaths.map((path) => `artifact:${path}`)
    ]
  );
}

function hostAgentEvaluation(status: "succeeded" | "failed", reason?: string): BrainEvalResult {
  return status === "succeeded"
    ? {
        verdict: "pass",
        score: 1,
        reasons: [],
        affectedAssetIds: [],
        evidenceRefs: [],
        nextActions: []
      }
    : {
        verdict: "blocked",
        score: 0,
        reasons: [reason ?? "Host agent task failed"],
        affectedAssetIds: [],
        evidenceRefs: [],
        nextActions: ["review-agent-run"]
      };
}

function mergeHarnessEvaluations(
  base: BrainEvalResult,
  structured: BrainEvalResult | undefined
): BrainEvalResult {
  if (!structured || structured.verdict === "pass") return base;
  if (base.verdict === "blocked") return base;
  return {
    verdict: structured.verdict,
    score: Math.min(base.score, structured.score),
    reasons: [...new Set([...base.reasons, ...structured.reasons])],
    affectedAssetIds: [...new Set([...base.affectedAssetIds, ...structured.affectedAssetIds])],
    evidenceRefs: [...new Set([...base.evidenceRefs, ...structured.evidenceRefs])],
    nextActions: [...new Set([...base.nextActions, ...structured.nextActions])]
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
  if (
    agentOutputStatusArg(input, "status") === "succeeded" &&
    (pendingTask.agent === "generator" || pendingTask.agent === "healer") &&
    pendingTask.chainContext
  ) {
    const source = await readFile(pendingTask.chainContext.testPath, "utf8").catch((error) => {
      throw new Error(
        `Generated test cannot be validated before submission: ${error instanceof Error ? error.message : String(error)}`
      );
    });
    const { requiredStepIds = [], actorJourneyRoles = [] } = pendingTask.chainContext;
    const journeyCheck = validateActorJourneyUsage(
      source,
      actorJourneyRoles.map((role) => ({ role }))
    );
    if (!journeyCheck.valid) throw new Error(journeyCheck.reason);
    const instrumentationCheck = validateStepInstrumentation(source, requiredStepIds);
    if (!instrumentationCheck.valid) throw new Error(instrumentationCheck.reason);
    const secretFindings = scanGeneratedTestSecrets(context, pendingTask.systemId, source);
    if (secretFindings.length > 0) {
      throw new Error(
        `Generated test contains sensitive material: ${secretFindings.join(", ")}`
      );
    }
  }
  const stdout = redactHostAgentText(
    context,
    pendingTask.systemId,
    optionalStringArg(input, "stdout") ?? ""
  );
  const stderr = redactHostAgentText(
    context,
    pendingTask.systemId,
    optionalStringArg(input, "stderr") ?? ""
  );
  const submittedOutputPaths = optionalStringArrayArg(input, "outputPaths");
  assertWorkspaceOutputPaths(context.workDir, submittedOutputPaths);
  const submittedStatus = agentOutputStatusArg(input, "status");
  const harnessTask = pendingTask.harnessTaskId
    ? context.harness.getTask(pendingTask.harnessTaskId)
    : undefined;
  const redactedProviderText = [stdout, stderr].filter(Boolean).join("\n");
  const structuredEvaluation = harnessTask
    ? await evaluateHostAgentOutput(context, pendingTask, submittedStatus, redactedProviderText)
    : undefined;
  if (harnessTask && submittedStatus === "succeeded" && structuredEvaluation?.verdict === "blocked") {
    context.harness.completeDeferredTask(
      harnessTask.id,
      structuredEvaluation,
      (submittedOutputPaths ?? pendingTask.outputPaths).map((path) => `artifact:${path}`)
    );
    throw new Error(
      `Host agent output failed Harness Eval: ${structuredEvaluation.reasons.join("; ") || "review required"}`
    );
  }
  const result = context.service.submitAgentTask({
    taskId,
    status: agentOutputStatusArg(input, "status"),
    stdout,
    stderr,
    outputPaths: submittedOutputPaths
  });
  if (result.task.planContext) {
    completeHostHarnessTask(context, result.task, mergeHarnessEvaluations(
      hostAgentEvaluation(
        result.agentRun.status === "succeeded" ? "succeeded" : "failed",
        result.agentRun.error
      ),
      structuredEvaluation
    ), result.agentRun.id, submittedOutputPaths ?? result.task.outputPaths);
    return finalizeHostAgentPlan(context, result);
  }
  const { chainContext } = result.task;
  if (!chainContext) {
    completeHostHarnessTask(
      context,
      result.task,
      mergeHarnessEvaluations(
        hostAgentEvaluation(
          result.agentRun.status === "succeeded" ? "succeeded" : "failed",
          result.agentRun.error
        ),
        structuredEvaluation
      ),
      result.agentRun.id,
      submittedOutputPaths ?? result.task.outputPaths
    );
    return result;
  }
  if (chainContext.requirementSuiteRunId && chainContext.executableCaseId) {
    context.runLedger.appendProgress({
      knowledgeProjectId: chainContext.knowledgeProjectId,
      systemId: result.task.systemId,
      requirementSuiteRunId: chainContext.requirementSuiteRunId,
      executableCaseId: chainContext.executableCaseId,
      stage: "execution",
      status: "running",
      stepTitle: "Run generated Playwright test",
      assertionSummary: "Waiting for structured Playwright evidence"
    });
  }
  const testResult =
    result.agentRun.status === "succeeded" &&
    (result.task.agent === "generator" || result.task.agent === "healer")
      ? await runSubmittedTest(
          context,
          chainContext.testPath,
          result.task.systemId,
          result.task.id,
          chainContext.browserMode
        )
      : undefined;
  const healAttempts = chainContext.healAttempts ?? 0;
  const maxHealAttempts = chainContext.maxHealAttempts ?? 1;
  if (
    (result.task.agent === "generator" || result.task.agent === "healer") &&
    testResult &&
    testResult.exitCode !== 0 &&
    healAttempts < maxHealAttempts
  ) {
    completeHostHarnessTask(
      context,
      result.task,
      mergeHarnessEvaluations(
        {
          verdict: "retry",
          score: 0,
          reasons: ["Generated test requires a controlled healer retry"],
          affectedAssetIds: [],
          evidenceRefs: [],
          nextActions: ["review-playwright-failure"]
        },
        structuredEvaluation
      ),
      result.agentRun.id,
      submittedOutputPaths ?? result.task.outputPaths
    );
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
      suiteContext: result.task.suiteContext,
      regressionContext: result.task.regressionContext
    });
    if (result.task.suiteContext) {
      const suite = context.service.getCaseSuite(result.task.suiteContext.suiteId);
      recordDocumentSuiteLedger(context, suite, {
        event: "agent-task-requested",
        scope: "case",
        stage: "generator",
        fromStatus: "waiting-for-agent",
        toStatus: "waiting-for-agent",
        caseNo: result.task.suiteContext.caseNo,
        message: "Controlled healer retry requested",
        references: {
          testCaseId: chainContext.testCaseId,
          agentTaskId: healerTaskPackage.task.id,
          chainRunId: chainRun.id
        }
      });
    }
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
  completeHostHarnessTask(
    context,
    result.task,
    mergeHarnessEvaluations(
      hostAgentEvaluation(
        status,
        failureReason
      ),
      structuredEvaluation
    ),
    result.agentRun.id,
    submittedOutputPaths ?? result.task.outputPaths
  );
  const failureClassification = status === "failed"
    ? classifyEvidenceFailure({
        stderr: testResult?.stderr,
        stdout: testResult?.stdout,
        reporter: testResult?.structuredReporter
      })
    : undefined;
  const chainRunId = id("chain");
  const artifactPaths = [
    chainContext.specPath,
    chainContext.testPath,
    testResult?.reporterPath,
    testResult?.actorRoleEvidencePath,
    ...(testResult?.structuredReporter?.attachments ?? [])
  ].filter((path): path is string => typeof path === "string");
  const terminalDiagnosis =
    status === "failed" &&
    failureReason &&
    (chainContext.executableCaseId ||
      result.task.suiteContext ||
      result.task.regressionContext)
      ? context.executionDiagnosis.create({
          knowledgeProjectId: chainContext.knowledgeProjectId,
          systemId: result.task.systemId,
          requirementSuiteRunId: chainContext.requirementSuiteRunId,
          executableCaseId: chainContext.executableCaseId,
          caseSourceId:
            result.task.suiteContext?.sourceId ??
            result.task.regressionContext?.sourceId,
          caseSuiteId: result.task.suiteContext?.suiteId,
          caseNo:
            result.task.suiteContext?.caseNo ??
            result.task.regressionContext?.caseNo,
          executionEvidenceId: chainContext.executionEvidenceId,
          chainRunId,
          testCaseId: chainContext.testCaseId,
          status: "failed",
          failureReason,
          failureType: failureClassification?.type,
          consoleErrors: testResult?.structuredReporter?.consoleErrors,
          networkFailures: testResult?.structuredReporter?.networkFailures,
          sourceType:
            result.task.agent === "healer"
              ? "host-agent-healer"
              : "host-agent-generator",
          healAttempts,
          maxHealAttempts,
          evidenceAssurance: testResult?.structuredReporter
            ? "strong"
            : chainContext.executionEvidenceId
              ? context.repository.executionEvidence.find(
                  (item) => item.id === chainContext.executionEvidenceId
                )?.assuranceLevel
              : "none",
          evidenceRefs: [
            chainRunId,
            chainContext.executionEvidenceId,
            chainContext.executionPlanId
          ].filter((value): value is string => Boolean(value))
        })
      : undefined;
  const bugReport =
    status === "failed" && failureReason
      ? await maybeCreateHostAgentBugReport(context, {
          task: result.task,
          chainRunId,
          failureReason,
          artifactPaths,
          diagnosisId: terminalDiagnosis?.id,
          diagnosisVerdict: terminalDiagnosis?.verdict
        })
      : undefined;
  if (bugReport && terminalDiagnosis) {
    context.executionDiagnosis.linkBugReport(
      terminalDiagnosis.id,
      bugReport.id
    );
  }
  if (result.task.regressionContext && terminalDiagnosis) {
    context.executionDiagnosis.linkBugReport(
      terminalDiagnosis.id,
      result.task.regressionContext.bugReportId
    );
  }
  const productRegressionFailure =
    Boolean(result.task.regressionContext) &&
    terminalDiagnosis?.verdict === "product_bug";
  const gaps =
    status === "failed" &&
    !bugReport &&
    !productRegressionFailure &&
    failureReason
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
  if (terminalDiagnosis && gaps.length > 0) {
    context.executionDiagnosis.linkGaps(
      terminalDiagnosis.id,
      gaps.map((gap) => gap.id)
    );
  }
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
      ),
      chainContext.browserMode === "observe" ? "observe" : "headless",
      terminalDiagnosis
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
      executionDiagnosis: terminalDiagnosis,
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
        diagnosisId: terminalDiagnosis?.id,
        bugReportId: bugReport?.id,
        gapIds: gaps.map((gap) => gap.id),
        failureType: terminalDiagnosis?.failureType,
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
            diagnosisId: terminalDiagnosis?.id,
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
    const suiteContext = result.task.suiteContext!;
    if (terminalDiagnosis) {
      recordDocumentSuiteLedger(context, suite, {
        event: "failure-diagnosed",
        scope: "case",
        stage: "execution",
        fromStatus: "waiting-for-agent",
        toStatus: terminalDiagnosis.verdict,
        failureType: terminalDiagnosis.failureType,
        caseNo: suiteContext.caseNo,
        references: {
          testCaseId: chainContext.testCaseId,
          agentTaskId: result.task.id,
          chainRunId: chainRun.id,
          diagnosisId: terminalDiagnosis.id,
          bugReportId: bugReport?.id,
          gapIds: gaps.map((gap) => gap.id)
        }
      });
    }
    recordDocumentSuiteLedger(context, suite, {
      event: "case-completed",
      scope: "case",
      stage: "execution",
      fromStatus: "waiting-for-agent",
      toStatus:
        status === "succeeded" ? "passed" : bugReport ? "failed" : "blocked",
      outcome:
        status === "succeeded" ? "passed" : bugReport ? "failed" : "blocked",
      failureType: terminalDiagnosis?.failureType,
      caseNo: suiteContext.caseNo,
      message: failureReason,
      references: {
        testCaseId: chainContext.testCaseId,
        agentTaskId: result.task.id,
        chainRunId: chainRun.id,
        diagnosisId: terminalDiagnosis?.id,
        bugReportId: bugReport?.id,
        gapIds: gaps.map((gap) => gap.id)
      }
    });
    const passed = passedCaseNosForSuite(context, suiteRun.systemId, suiteRun.suiteId);
    if (suite.selectedCaseNos.every((caseNo) => passed.has(caseNo))) {
      const completedSuite = context.service.updateCaseSuiteStatus(suiteRun.suiteId, "completed");
      completeDocumentSuiteLedger(context, completedSuite, "completed");
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
      completeDocumentSuiteLedger(context, blockedSuite, "blocked");
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
    completeDocumentSuiteLedger(context, failedSuite, finalStatus);
    return {
      ...result,
      status: finalStatus,
      chainRun,
      suiteRun,
      suite: failedSuite,
      testResult
    };
  }
  if (result.task.regressionContext) {
    const regression = result.task.regressionContext;
    const bug = context.repository.bugReports.find(
      (item) =>
        item.id === regression.bugReportId &&
        item.systemId === result.task.systemId
    );
    if (!bug) throw new Error("Regression BugReport not found");
    const caseStatus =
      status === "succeeded"
        ? "passed"
        : productRegressionFailure
          ? "failed"
          : "blocked";
    context.service.updateBugReportStatus(
      bug.id,
      caseStatus === "passed"
        ? "retest-passed"
        : caseStatus === "failed"
          ? "retest-failed"
          : regression.previousStatus
    );
    const completedRegression = {
      ...result,
      mode: "bug-regression",
      status:
        caseStatus === "passed"
          ? "completed"
          : caseStatus === "failed"
            ? "failed"
            : "blocked",
      chainRun,
      testResult,
      executionDiagnosis: terminalDiagnosis,
      result: {
        caseNo: regression.caseNo,
        title: regression.title,
        status: caseStatus,
        testCaseId: chainContext.testCaseId,
        chainRunId: chainRun.id,
        diagnosisId: terminalDiagnosis?.id,
        bugReportId: bug.id,
        gapIds: gaps.map((gap) => gap.id),
        error: failureReason
      },
      bug
    };
    if (regression.remainingBugIds.length === 0) {
      return completedRegression;
    }
    const next = await runBugRegression(context, {
      systemId: result.task.systemId,
      bugIds: regression.remainingBugIds,
      maxHealAttempts: regression.maxHealAttempts,
      browserMode: chainContext.browserMode
    });
    return {
      ...next,
      completedRegression
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
    diagnosisId?: string;
    diagnosisVerdict?: ExecutionDiagnosisVerdict;
  }
) {
  if (
    input.task.chainContext?.executableCaseId &&
    input.diagnosisVerdict === "product_bug"
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
        artifactPaths: input.artifactPaths,
        diagnosisId: input.diagnosisId
      });
    }
  }
  if (
    !input.task.suiteContext ||
    input.diagnosisVerdict !== "product_bug"
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
    diagnosisId: input.diagnosisId,
    gapIds: []
  });
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

async function runSubmittedTest(
  context: BrainCreatorMcpContext,
  testPath: string,
  systemId: string,
  runId = "host-agent",
  browserMode: BrowserExecutionMode = "headless"
) {
  const runner = context.runner ?? spawnCommand;
  const artifactLayout = artifactLayoutFromTestPath(context.workDir, testPath);
  const testRunPath = relative(
    artifactLayout?.testsDir ?? context.workDir,
    testPath
  ).replace(/\\/g, "/");
  const playwrightConfigPath = artifactLayout
    ? await writeArtifactPlaywrightConfig({ workDir: context.workDir, layout: artifactLayout })
    : undefined;
  try {
    const rawResult = await runner(
      "npx",
      playwrightTestArgs(testRunPath, {
        browserMode,
        structuredReporter: true,
        ...(playwrightConfigPath
          ? { configPath: relative(context.workDir, playwrightConfigPath).replace(/\\/g, "/") }
          : {})
      }),
      {
      cwd: context.workDir
      }
    );
    const protectedSecrets = protectedSecretsForSystem(context, systemId);
    const result: CommandResult = {
      ...rawResult,
      stdout: redactSensitiveText(rawResult.stdout, protectedSecrets),
      stderr: redactSensitiveText(rawResult.stderr, protectedSecrets),
      ...(rawResult.structuredReporter
        ? {
            structuredReporter: JSON.parse(
              redactSensitiveText(JSON.stringify(rawResult.structuredReporter), protectedSecrets)
            )
          }
        : {})
    };
    const reporter = result.structuredReporter ?? parseHostReporter(result.stdout);
    if (!reporter) {
      return {
        ...result,
        exitCode: result.exitCode === 0 ? 1 : result.exitCode,
        stderr: [
          result.stderr,
          "Structured Playwright Reporter output was missing; execution is not auditable."
        ].filter(Boolean).join("\n")
      };
    }
    const reporterPath = result.reporterPath ?? hostReporterPath(
      context.workDir,
      testPath,
      runId
    );
    await mkdir(dirname(reporterPath), { recursive: true });
    if (!result.reporterPath) {
      await writeFile(reporterPath, `${JSON.stringify(reporter, null, 2)}\n`, "utf8");
    }
    return {
      ...result,
      exitCode: normalizeReporterExitCode(result.exitCode, reporter),
      structuredReporter: reporter,
      reporterPath
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error)
    };
  }
}

function artifactLayoutFromTestPath(workDir: string, testPath: string): ArtifactRunLayout | undefined {
  const normalized = relative(workDir, testPath).replace(/\\/g, "/");
  if (!normalized.startsWith(".brain-creator/artifacts/")) return undefined;
  const root = dirname(dirname(resolve(workDir, testPath)));
  return {
    root,
    sourceDir: join(root, "source"),
    analysisDir: join(root, "analysis"),
    casesDir: join(root, "cases"),
    specsDir: join(root, "specs"),
    testsDir: join(root, "tests"),
    evidenceDir: join(root, "evidence"),
    reportDir: join(root, "report"),
    manifestPath: join(root, "manifest.json"),
    indexPath: join(root, "index.md"),
    latestPath: join(root, "..", "latest.json")
  };
}

function hostReporterPath(workDir: string, testPath: string, runId: string) {
  const normalized = relative(workDir, testPath).replace(/\\/g, "/");
  if (normalized.startsWith(".brain-creator/artifacts/")) {
    return join(dirname(dirname(resolve(workDir, testPath))), "evidence", `${runId}-playwright-report.json`);
  }
  return join(workDir, ".brain-creator", "runs", runId, "playwright-report.json");
}

function redactHostAgentText(
  context: BrainCreatorMcpContext,
  systemId: string,
  text: string
) {
  return redactSensitiveText(text, protectedSecretsForSystem(context, systemId));
}

function assertWorkspaceOutputPaths(workDir: string, paths: string[] | undefined) {
  for (const path of paths ?? []) {
    const absolute = resolve(workDir, path);
    const offset = relative(resolve(workDir), absolute);
    if (offset.startsWith("..") || isAbsolute(offset)) {
      throw new Error("Agent output path must stay inside the Brain Creator workspace");
    }
  }
}

function protectedSecretsForSystem(
  context: BrainCreatorMcpContext,
  systemId: string
) {
  return Object.fromEntries(
    context.repository.authProfiles
      .filter((profile) => profile.projectId === systemId)
      .flatMap((profile) => {
        try {
          return Object.entries(decryptSecrets(profile.encryptedSecrets));
        } catch {
          return [];
        }
      })
  );
}

function parseHostReporter(output: string) {
  try {
    return parsePlaywrightJsonReport(JSON.parse(output));
  } catch {
    return undefined;
  }
}

function scanGeneratedTestSecrets(
  context: BrainCreatorMcpContext,
  systemId: string,
  source: string
) {
  const protectedValues = Object.entries(protectedSecretsForSystem(context, systemId));
  return [
    ...scanSensitiveValues(source, Object.fromEntries(protectedValues)).map(
      (finding) => `credential:${finding.secretKey}`
    ),
    ...scanSensitivePatterns(source).map((finding) => `pattern:${finding.rule}`)
  ];
}

function hostAgentPrompt(input: {
  systemId: string;
  agent: AgentRun["agent"];
  inputSummary: string;
  args: string[];
  outputPaths: string[];
  requiredStepIds?: string[];
  actorJourneyRoles?: string[];
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
    ...(input.requiredStepIds?.length
      ? [
          `- Instrument every declared execution step with bc.step(): ${input.requiredStepIds.join(", ")}.`
        ]
      : []),
    ...(input.actorJourneyRoles && input.actorJourneyRoles.length > 1
      ? [
          `- This is a multi-role journey. Use bc.runAsRole() and reference every role: ${input.actorJourneyRoles.join(", ")}.`
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
  const suiteIds = new Set(runs.map((run) => run.suiteId));
  const ledgerEntries = context.runLedger
    .list({ runType: "document-suite", systemId })
    .filter((entry) => suiteIds.has(entry.caseSuiteId ?? ""));
  return {
    summary,
    runs,
    failedCases,
    bugReports,
    gaps,
    runLedger: {
      summaries: [...suiteIds]
        .filter((suiteId) =>
          ledgerEntries.some((entry) => entry.caseSuiteId === suiteId)
        )
        .map((suiteId) => context.runLedger.summary(suiteId)),
      entries: ledgerEntries
    },
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
  const evidencePaths = uniqueStrings(review.runs.flatMap((run) => run.artifactPaths));
  return {
    title: "Suite Run Review",
    status: review.summary.latestStatus ?? "empty",
    metrics: review.summary,
    evidencePaths: evidencePaths.slice(0, 20),
    evidencePathCount: evidencePaths.length,
    evidenceTruncated: evidencePaths.length > 20,
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
  const evidencePaths = uniqueStrings(bugs.flatMap((bug) => bug.evidencePaths));
  return {
    title: "Bug Review",
    status: summary.open > 0 || summary.retestFailed > 0 ? "action_required" : "completed",
    metrics: summary,
    evidencePaths: evidencePaths.slice(0, 20),
    evidencePathCount: evidencePaths.length,
    evidenceTruncated: evidencePaths.length > 20,
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
    browserMode: suite.browserMode ?? "headless",
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

function ensureDocumentSuiteLedger(
  context: BrainCreatorMcpContext,
  suite: CaseSuite
) {
  const existing = context.runLedger.list({
    runType: "document-suite",
    systemId: suite.systemId,
    caseSuiteId: suite.id
  });
  if (existing.length > 0) return;
  recordDocumentSuiteLedger(context, suite, {
    event: "suite-created",
    scope: "suite",
    stage: "suite",
    toStatus: suite.status
  });
}

function recordDocumentSuiteLedger(
  context: BrainCreatorMcpContext,
  suite: CaseSuite,
  input: Omit<
    Parameters<RunLedgerService["append"]>[0],
    "runType" | "knowledgeProjectId" | "systemId" | "requirementSuiteRunId" | "caseSuiteId" | "caseSourceId"
  >
) {
  return context.runLedger.append({
    runType: "document-suite",
    systemId: suite.systemId,
    caseSuiteId: suite.id,
    caseSourceId: suite.sourceId,
    ...input
  });
}

function completeDocumentSuiteLedger(
  context: BrainCreatorMcpContext,
  suite: CaseSuite,
  status: "completed" | "failed" | "blocked" | "cancelled"
) {
  const entries = context.runLedger.list({
    runType: "document-suite",
    systemId: suite.systemId,
    caseSuiteId: suite.id
  });
  const latest = entries.at(-1);
  if (latest?.event === "suite-completed" && latest.toStatus === status) return;
  recordDocumentSuiteLedger(context, suite, {
    event: "suite-completed",
    scope: "suite",
    stage: "suite",
    fromStatus: suite.status,
    toStatus: status,
    outcome:
      status === "completed"
        ? "passed"
        : status === "cancelled"
          ? "cancelled"
          : status
  });
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
    browserMode: suite.browserMode ?? "headless",
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

function blockedCaseNosForSuite(context: BrainCreatorMcpContext, systemId: string, suiteId: string) {
  const blocked = new Set<string>();
  for (const run of context.service.listCaseSuiteRuns(systemId).filter((item) => item.suiteId === suiteId)) {
    for (const result of run.caseResults) {
      if (result.status === "blocked") {
        blocked.add(result.caseNo);
      }
    }
  }
  return blocked;
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
  activeSuite?: {
    suiteId: string;
    status: string;
    browserMode?: BrowserExecutionMode;
    totalCases: number;
    attempted: number;
    passed: number;
    failed: number;
    blocked: number;
    waiting: number;
    pending: number;
    nextCaseNo?: string;
    currentStage?: string;
    currentStep?: string;
    currentCaseTitle?: string;
    currentPageUrl?: string;
    elapsedMs?: number;
    lastUpdatedAt?: string;
    waitReason?: string;
    possiblyStalled?: boolean;
    latestEvent?: string;
    traceId?: string;
    activeTask?: { taskId: string; caseNo: string; title: string };
  };
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
    ...(state.activeSuite ? { activeSuite: state.activeSuite } : {}),
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
    ...(summary.activeSuite
      ? [
          `- Active suite: ${summary.activeSuite.suiteId} (${summary.activeSuite.status})`,
          `- Active suite progress: ${summary.activeSuite.passed}/${summary.activeSuite.totalCases} passed; next ${summary.activeSuite.nextCaseNo ?? "none"}`,
          ...(summary.activeSuite.currentStage
            ? [`- Active suite stage: ${summary.activeSuite.currentStage}`]
            : []),
          ...(summary.activeSuite.currentStep
            ? [`- Active suite step: ${summary.activeSuite.currentStep}`]
            : []),
          ...(summary.activeSuite.currentCaseTitle
            ? [`- Active suite case: ${summary.activeSuite.currentCaseTitle}`]
            : []),
          ...(summary.activeSuite.currentPageUrl
            ? [`- Active suite page: ${summary.activeSuite.currentPageUrl}`]
            : []),
          ...(summary.activeSuite.elapsedMs !== undefined
            ? [`- Active suite elapsed: ${summary.activeSuite.elapsedMs} ms`]
            : []),
          ...(summary.activeSuite.waitReason
            ? [`- Active suite waiting: ${summary.activeSuite.waitReason}`]
            : []),
          ...(summary.activeSuite.possiblyStalled
            ? ["- Active suite warning: possibly stalled"]
            : []),
          ...(summary.activeSuite.latestEvent
            ? [`- Active suite event: ${summary.activeSuite.latestEvent}`]
            : []),
          ...(summary.activeSuite.traceId
            ? [`- Active suite trace: ${summary.activeSuite.traceId}`]
            : [])
        ]
      : []),
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

function requirementSuiteRunCollectionSummary(runs: RequirementSuiteRun[]) {
  const statusCounts = countBy(runs, (run) => run.status);
  const metrics = {
    totalRuns: runs.length,
    byStatus: statusCounts,
    totalCases: runs.reduce((total, run) => total + run.total, 0),
    passed: runs.reduce((total, run) => total + run.passed, 0),
    failed: runs.reduce((total, run) => total + run.failed, 0),
    blocked: runs.reduce((total, run) => total + run.blocked, 0),
    skipped: runs.reduce((total, run) => total + run.skipped, 0),
    cancelled: runs.reduce((total, run) => total + run.cancelled, 0)
  };
  const active = runs.some((run) =>
    ["running", "waiting-for-test-data", "waiting-for-agent", "blocked"].includes(run.status)
  );
  return {
    title: "Requirement Suite Run Review",
    status: active ? "action_required" : runs.length > 0 ? "completed" : "empty",
    metrics,
    nextAction: active ? "resume_or_resolve_blockers" : runs.length > 0 ? "review_suite_results" : "prepare_requirement_suite",
    userMessage: runs.length === 0
      ? "No requirement suite runs are available."
      : `${runs.length} requirement suite run(s), ${metrics.totalCases} case(s): ${metrics.passed} passed, ${metrics.failed} failed, ${metrics.blocked} blocked.`
  };
}

function executionDiagnosisReviewSummary(input: {
  summary: ReturnType<ExecutionDiagnosisService["summary"]>;
  items: Array<{ evidenceRefs: string[] }>;
  nextAction: string;
}) {
  const evidencePaths = uniqueStrings(input.items.flatMap((item) => item.evidenceRefs));
  return {
    title: "Execution Diagnosis Review",
    status:
      input.summary.routing.bugEligible > 0 || input.summary.routing.gapRouted > 0
        ? "action_required"
        : "completed",
    metrics: input.summary,
    evidencePaths: evidencePaths.slice(0, 20),
    evidencePathCount: evidencePaths.length,
    evidenceTruncated: evidencePaths.length > 20,
    nextAction: input.nextAction,
    userMessage:
      `Diagnosis review: ${input.summary.total} records, ` +
      `${input.summary.routing.bugEligible} product-bug candidates, ` +
      `${input.summary.routing.gapRouted} evidence-gap candidates.`
  };
}

export function summarizeStabilityRuns(
  runs: RequirementSuiteRun[],
  executionEvidence: ExecutionEvidence[]
) {
  const grouped = new Map<string, RequirementSuiteRun[]>();
  for (const run of runs) {
    if (!run.stabilityGroupId) continue;
    const group = grouped.get(run.stabilityGroupId) ?? [];
    group.push(run);
    grouped.set(run.stabilityGroupId, group);
  }
  return [...grouped.entries()]
    .sort(([, left], [, right]) => (right.at(-1)?.updatedAt ?? "").localeCompare(left.at(-1)?.updatedAt ?? ""))
    .slice(0, 20)
    .map(([groupId, group]) => {
      const target = Math.max(...group.map((run) => run.stabilityTarget ?? 1));
      const strongVerifiedRunIds = group.filter((run) =>
        run.status === "completed" &&
        run.failed === 0 &&
        run.blocked === 0 &&
        run.caseRuns.length === run.total &&
        run.caseRuns.every((caseRun) => {
          const evidence = caseRun.executionEvidenceId
            ? executionEvidence.find((item) => item.id === caseRun.executionEvidenceId)
            : undefined;
          return Boolean(
            evidence &&
              evidence.status === "passed" &&
              evidence.assuranceLevel === "strong" &&
              (evidence.coverage?.missing.length ?? 0) === 0 &&
              actorJourneyEvidenceMatches(run, evidence)
          );
        })
      ).map((run) => run.id);
      const policy = group.find((run) => run.stabilityPolicy)?.stabilityPolicy ?? {
        targetIterations: target,
        minIterations: 2,
        maxFailureRate: 0,
        requireStrongEvidence: true,
        stopOnBlocked: true
      };
      const evaluation = evaluateStabilityPolicy(group, policy, { strongVerifiedRunIds });
      return {
        stabilityGroupId: groupId,
        ...evaluation,
        latestRunId: group.at(-1)?.id,
        nextRunId: group.find((run) => run.stabilityNextRunId)?.stabilityNextRunId,
        nextRunAt: group.at(-1)?.stabilitySchedule?.nextRunAt,
        schedule: group.at(-1)?.stabilitySchedule
          ? {
              due: isStabilityScheduleDue(group.at(-1)!.stabilitySchedule!, new Date()),
              leaseOwner: group.at(-1)!.stabilitySchedule!.leaseOwner,
              leaseExpiresAt: group.at(-1)!.stabilitySchedule!.leaseExpiresAt
            }
          : undefined
      };
    });
}

function requirementSuiteReconciliation(
  context: BrainCreatorMcpContext,
  run: RequirementSuiteRun
) {
  const project = context.repository.knowledgeProjects.find(
    (item) => item.id === run.knowledgeProjectId
  );
  if (!project) return run.reconciliation;
  return reconcileRequirementCoverage({
    knowledgeProject: project,
    systemId: run.systemId,
    requirementSets: context.repository.requirementSets,
    testIntents: context.repository.testIntents,
    cases: context.repository.executableCases,
    expectedRequirementSetIds: run.requirementSetIds
  });
}

function actorJourneyEvidenceMatches(
  run: RequirementSuiteRun,
  evidence: ExecutionEvidence
) {
  const declaredRoles = (run.actorJourney ?? []).map((item) => item.role ?? "");
  if (declaredRoles.length === 0) return true;
  const observedRoles = (evidence.actorJourney ?? []).map((item) => item.role);
  return (
    observedRoles.length === declaredRoles.length &&
    observedRoles.every((role, index) => role === declaredRoles[index])
  );
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

function aggregateLegacyDiagnosisAudit(
  context: BrainCreatorMcpContext,
  systemIds: string[],
  limit: number
) {
  const audits = systemIds.map((systemId) => ({
    systemId,
    audit: context.executionDiagnosis.auditLegacy({ systemId, limit: 100 })
  }));
  const candidates = audits
    .flatMap((item) => item.audit.candidates)
    .slice(0, Math.min(100, Math.max(1, limit)));
  const sum = (
    select: (summary: (typeof audits)[number]["audit"]["summary"]) => number
  ) => audits.reduce((total, item) => total + select(item.audit.summary), 0);
  const totalCandidates = sum((summary) => summary.totalCandidates);
  return {
    summary: {
      totalCandidates,
      bugs: sum((summary) => summary.bugs),
      gaps: sum((summary) => summary.gaps),
      reviewBugAsGap: sum((summary) => summary.reviewBugAsGap),
      confirmBug: sum((summary) => summary.confirmBug),
      confirmGap: sum((summary) => summary.confirmGap),
      needsEvidence: sum((summary) => summary.needsEvidence),
      truncated: candidates.length < totalCandidates
    },
    bySystem: audits.map((item) => ({
      systemId: item.systemId,
      ...item.audit.summary
    })),
    candidates
  };
}

function aggregateLegacyDiagnosisReviewSummary(
  context: BrainCreatorMcpContext,
  systemIds: string[]
) {
  const reviews = systemIds.flatMap((systemId) =>
    context.executionDiagnosis.listLegacyReviews(systemId)
  );
  const activeReviews = reviews.filter(
    (review) => review.status !== "rolled-back"
  );
  const adjudicated = activeReviews.filter(
    (review) => review.confirmedVerdict !== undefined
  );
  const matched = adjudicated.filter(
    (review) => review.matchesSuggestion === true
  );
  return {
    total: reviews.length,
    byDecision: countBy(activeReviews, (review) => review.decision),
    migrated: activeReviews.filter((review) => review.status === "migrated").length,
    rolledBack: reviews.filter((review) => review.status === "rolled-back").length,
    needsEvidence: activeReviews.filter(
      (review) => review.decision === "needs_evidence"
    ).length,
    quality: {
      adjudicated: adjudicated.length,
      matched: matched.length,
      corrected: adjudicated.length - matched.length,
      accuracy:
        adjudicated.length > 0 ? matched.length / adjudicated.length : null,
      byProposedFailureType: adjudicated.reduce<
        Record<string, { total: number; matched: number; corrected: number }>
      >((summary, review) => {
        const current = summary[review.proposedFailureType] ?? {
          total: 0,
          matched: 0,
          corrected: 0
        };
        current.total += 1;
        if (review.matchesSuggestion) current.matched += 1;
        else current.corrected += 1;
        summary[review.proposedFailureType] = current;
        return summary;
      }, {})
    }
  };
}

function legacyDiagnosisEvalMarkdown(evaluation: {
  metric: string;
  adjudicated: number;
  minSampleSize: number;
  readiness: "ready" | "insufficient-sample";
  observedAccuracy: number | null;
  reportableAccuracy: number | null;
  matched: number;
  corrected: number;
  inconclusive: number;
  rolledBack: number;
}) {
  const percent = (value: number | null) =>
    value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  return [
    "# Historical Execution Diagnosis Eval",
    "",
    `- Metric: ${evaluation.metric}`,
    `- Readiness: ${evaluation.readiness}`,
    `- Adjudicated sample: ${evaluation.adjudicated}/${evaluation.minSampleSize}`,
    `- Observed accuracy: ${percent(evaluation.observedAccuracy)}`,
    `- Reportable accuracy: ${percent(evaluation.reportableAccuracy)}`,
    `- Matched: ${evaluation.matched}`,
    `- Corrected: ${evaluation.corrected}`,
    `- Inconclusive: ${evaluation.inconclusive}`,
    `- Rolled back: ${evaluation.rolledBack}`
  ].join("\n");
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
  systemId: string,
  profile = findAuthProfile(context, systemId)
): Promise<(AuthStateVerification & {
  authRefresh?: { attempted: boolean; provider?: string; status?: string; reason?: string };
}) | undefined> {
  const system = context.repository.systemProfiles.find((item) => item.id === systemId);
  if (!system) {
    throw new Error("Business system not found");
  }
  const storageStatePath = await materializeAuthStorageState(context, system, profile);
  if (!storageStatePath) {
    return undefined;
  }
  const verification = await context.authStateVerifier({
    storageStatePath: await resolveProtectedStorageStatePath(context.workDir, storageStatePath),
    targetUrl: system.baseUrl,
    allowedUrls: system.urlAllowlist
  });
  if (verification.status === "valid") {
    return { ...verification, authRefresh: { attempted: false } };
  }
  const refreshed = await refreshAndVerifyAuthState(context, system, profile, verification.reason);
  if (!refreshed) return verification;
  return refreshed.status === "valid"
    ? {
        ...refreshed,
        authRefresh: refreshed.authRefresh
          ? {
              attempted: true,
              provider: refreshed.authRefresh.provider
            }
          : undefined
      }
    : { ...verification, authRefresh: refreshed.authRefresh };
}

async function refreshAndVerifyAuthState(
  context: BrainCreatorMcpContext,
  system: SystemProfile,
  authProfile: AuthProfile,
  reason = "Stored browser authentication is no longer valid."
) {
  try {
    const refreshed = await context.authRefreshRegistry.refresh({
      workDir: context.workDir,
      system,
      authProfile,
      reason,
      timeoutMs: Number(process.env.BRAIN_CREATOR_AUTH_REFRESH_TIMEOUT_MS ?? 30_000)
    });
    if (refreshed.status !== "succeeded" || !refreshed.storageStatePath) {
      return {
        status: "unavailable" as const,
        reason: refreshed.reason ?? "Authentication refresh requires user intervention.",
        authRefresh: {
          attempted: true,
          provider: refreshed.provider,
          status: refreshed.status,
          reason: refreshed.reason
        }
      };
    }
    const safePath = await resolveProtectedStorageStatePath(
      context.workDir,
      refreshed.storageStatePath
    );
    context.service.setAuthStorageStatePath(authProfile.id, refreshed.storageStatePath);
    const verification = await context.authStateVerifier({
      storageStatePath: safePath,
      targetUrl: system.baseUrl,
      allowedUrls: system.urlAllowlist
    });
    return {
      ...verification,
      authRefresh: {
        attempted: true,
        provider: refreshed.provider,
        status: refreshed.status
      }
    };
  } catch (error) {
    return {
      status: "unavailable" as const,
      reason: error instanceof Error ? error.message : String(error),
      authRefresh: {
        attempted: true,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error)
      }
    };
  }
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

function facadeTextResult(data: unknown, input: Record<string, unknown>): CallToolResult {
  if (responseModeArg(input) === "full") return textResult(data);
  return textResult(compactFacadePayload(data));
}

function compactFacadePayload(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { responseMode: "summary", status: "succeeded", summary: data };
  }
  const record = data as Record<string, unknown>;
  if (typeof record.compileRunId === "string" && !record.items) {
    return { ...record, responseMode: "summary" };
  }
  const preferredSummary =
    record.reviewSummary ?? record.userSummary ?? record.summary ?? summarizeFacadeRecord(record);
  return {
    responseMode: "summary",
    status: typeof record.status === "string" ? record.status : "succeeded",
    ...(typeof record.mode === "string" ? { mode: record.mode } : {}),
    ...(typeof record.stage === "string" ? { stage: record.stage } : {}),
    summary: preferredSummary,
    ...(typeof record.nextAction === "string" ? { nextAction: record.nextAction } : {}),
    ...(typeof record.requiresConfirmation === "boolean"
      ? { requiresConfirmation: record.requiresConfirmation }
      : {}),
    references: facadeReferences(record)
  };
}

function summarizeFacadeRecord(record: Record<string, unknown>) {
  const summary = Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      )
      .slice(0, 20)
  );
  for (const key of ["verificationEvidence", "counts", "completeness"]) {
    if (record[key] && typeof record[key] === "object") summary[key] = record[key];
  }
  return summary;
}

function facadeReferences(value: unknown, depth = 0): Record<string, string>[] {
  if (!value || typeof value !== "object" || depth > 3) return [];
  const references: Record<string, string>[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string" && (/(?:Id|Path)$/i.test(key) || key === "id")) {
      references.push({ [key]: child });
    } else if (Array.isArray(child)) {
      for (const item of child.slice(0, 10)) {
        references.push(...facadeReferences(item, depth + 1));
      }
    } else if (child && typeof child === "object") {
      references.push(...facadeReferences(child, depth + 1));
    }
    if (references.length >= 30) break;
  }
  return references.slice(0, 30);
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

function mutationResultsArg(input: Record<string, unknown>): MutationOutcome[] {
  const value = input.mutationResults;
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("mutationResults must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`mutationResults[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const status = record.status;
    if (typeof record.id !== "string" || typeof record.scenarioId !== "string") {
      throw new Error(`mutationResults[${index}] requires id and scenarioId`);
    }
    if (status !== "caught" && status !== "survived" && status !== "blocked") {
      throw new Error(`mutationResults[${index}].status is invalid`);
    }
    const evidenceRefs = record.evidenceRefs;
    return {
      id: record.id,
      scenarioId: record.scenarioId,
      status: status as MutationOutcome["status"],
      evidenceRefs: Array.isArray(evidenceRefs)
        ? evidenceRefs.filter((item): item is string => typeof item === "string")
        : [],
      reason: typeof record.reason === "string" ? record.reason : undefined
    };
  });
}

async function materializeAuthStorageState(
  context: BrainCreatorMcpContext,
  system: SystemProfile,
  authProfile: AuthProfile,
  force: boolean = false
) {
  const capture = context.service.getCaptureAuth(authProfile.id);
  const existing = capture?.secrets.storageStatePath;
  if (existing) return existing;
  if (!force && (!authProfile.verificationEvidence || authProfile.status !== "succeeded")) return undefined;
  if (!force && authProfile.loginMethod !== "token" && authProfile.loginMethod !== "cookie") {
    return undefined;
  }
  if (authProfile.loginMethod !== "token" && authProfile.loginMethod !== "cookie") {
    return undefined;
  }
  const hasSecret = authProfile.loginMethod === "token"
    ? Boolean(capture?.secrets.token)
    : Boolean(capture?.secrets.cookie);
  if (!hasSecret) return undefined;
  const materialized = await context.authStateMaterializer({
    workDir: context.workDir,
    system,
    authProfile
  });
  context.service.setAuthStorageStatePath(authProfile.id, materialized.storageStatePath);
  context.authVerificationCache.delete(authProfile.id);
  return materialized.storageStatePath;
}

function actorJourneyArg(input: Record<string, unknown>) {
  const value = input.actorJourney;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("actorJourney must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`actorJourney[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    return {
      role: optionalStringArg(record, "role"),
      authProfileId: stringArg(record, "authProfileId"),
      afterStepId: optionalStringArg(record, "afterStepId"),
      sourceRefs: optionalStringArrayArg(record, "sourceRefs") ?? []
    };
  });
}

function explorationScenarioArg(input: Record<string, unknown>) {
  const value = input.explorationScenario;
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("explorationScenario must be an object");
  }
  const record = value as Record<string, unknown>;
  const name = stringArg(record, "name");
  const dataRefs = optionalStringArrayArg(record, "dataRefs") ?? [];
  return {
    id: optionalStringArg(record, "id"),
    name,
    role: optionalStringArg(record, "role"),
    prerequisiteState: optionalStringArg(record, "prerequisiteState"),
    dataRefs,
    testDataLeaseIds: optionalStringArrayArg(record, "testDataLeaseIds") ?? [],
    selectorValues: recordArg(record, "selectorValues")
  };
}

function summarizeCoverageDimensions(
  items: Array<{
    coverage?: {
      required: readonly string[];
      verified: readonly string[];
      missing: readonly string[];
    };
  }>
) {
  const dimensions = [...new Set(items.flatMap((item) => item.coverage?.required ?? []))];
  return dimensions.map((dimension) => ({
    dimension,
    required: items.filter((item) => item.coverage?.required.includes(dimension)).length,
    verified: items.filter((item) => item.coverage?.verified.includes(dimension)).length,
    missing: items.filter((item) => item.coverage?.missing.includes(dimension)).length
  }));
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
  const requiredStepIds = candidate.requiredStepIds;
  const actorJourneyRoles = candidate.actorJourneyRoles;
  const browserMode = candidate.browserMode;
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
  for (const [name, value] of Object.entries({ requiredStepIds, actorJourneyRoles })) {
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    ) {
      throw new Error(`chainContext ${name} must be an array of strings when provided`);
    }
  }
  if (browserMode !== undefined && browserMode !== "headless" && browserMode !== "observe") {
    throw new Error("chainContext browserMode must be headless or observe");
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
    contextPackPath: contextPackPath as string | undefined,
    requiredStepIds: requiredStepIds as string[] | undefined,
    actorJourneyRoles: actorJourneyRoles as string[] | undefined,
    browserMode: browserMode as "headless" | "observe" | undefined
  };
}

async function archiveRequirementSuiteRun(
  context: BrainCreatorMcpContext,
  run: RequirementSuiteRun
) {
  const executableCaseIds = new Set(run.caseRuns.map((item) => item.executableCaseId));
  const executableCases = run.caseRuns
    .map((item) => context.repository.executableCases.find((candidate) => candidate.id === item.executableCaseId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const requirementSetIds = [...new Set(executableCases.map((item) => item.requirementSetId))];
  const requirementSetIdSet = new Set(requirementSetIds);
  const requirementSetId = requirementSetIds.length === 1
    ? requirementSetIds[0]
    : requirementSetIds.length > 1
      ? "multi-requirement"
      : "unscoped";
  const coverage = context.knowledgeService
    .testIntentCoverage(run.knowledgeProjectId, run.systemId)
    .items
    .filter((item) => requirementSetIdSet.has(item.requirementSetId))
    .map((item) => ({
      testIntentId: item.testIntentId,
      title: item.title,
      module: item.module,
      classification: item.classification,
      classificationReason: item.classificationReason,
      requirementRefs: item.requirementRefs
    }));
  const evidence = run.caseRuns.flatMap((caseRun) => {
    const item = caseRun.executionEvidenceId
      ? context.repository.executionEvidence.find((candidate) => candidate.id === caseRun.executionEvidenceId)
      : undefined;
    return item ? [item] : [];
  });
  const system = context.repository.systemProfiles.find((item) => item.id === run.systemId);
  const singleRequirement = requirementSetIds.length === 1
    ? context.repository.requirementSets.find((item) => item.id === requirementSetIds[0])
    : undefined;
  const artifactLayout = resolveArtifactRunLayout({
    workDir: context.workDir,
    systemKey: system?.name ?? run.systemId,
    requirementKey: singleRequirement?.title ?? requirementSetId,
    requirementVersion: singleRequirement?.version,
    suiteRunId: run.id
  });
  const snapshotPaths = await writeRequirementSuiteSnapshots(
    context,
    run,
    requirementSetIds,
    executableCases,
    coverage,
    artifactLayout
  );
  const reportPath = join(artifactLayout.reportDir, "suite-report.html");
  await writeStaticSuiteExecutionReport({
    outputPath: reportPath,
    title: `Brain Creator requirement suite ${run.id}`,
    run,
    requirementSetIds,
    locale: system?.defaultLocale,
    evidence,
    coverage,
    bugs: context.repository.bugReports
      .filter((bug) => bug.systemId === run.systemId && executableCaseIds.has(bug.sourceId))
      .map((bug) => ({ id: bug.id, status: bug.status, caseNo: bug.caseNo, actualResult: bug.actualResult })),
    gaps: context.repository.gaps
      .filter((gap) => gap.projectId === run.systemId && (gap.sourceId === run.id || executableCaseIds.has(gap.sourceId)))
      .map((gap) => ({ id: gap.id, status: gap.status, caseNo: gap.sourceId, reason: gap.reason })),
    progress: context.runLedger.progress(run.id)
  });
  run.reportPath = reportPath;
  const artifactManifest = await writeArtifactManifest({
    workDir: context.workDir,
    systemId: run.systemId,
    requirementSetId,
    suiteRunId: run.id,
    requirementSetIds,
    artifactPaths: [
      ...snapshotPaths,
      reportPath,
      ...evidence.flatMap((item) => item.artifactPaths)
    ],
    sourceRefs: requirementSetIds,
    ownershipDirectory: artifactLayout.root,
    protectedSecrets: protectedSecretsForSystem(context, run.systemId)
  });
  context.repository.persist();
  return { reportPath, artifactManifest };
}

async function writeRequirementSuiteSnapshots(
  context: BrainCreatorMcpContext,
  run: RequirementSuiteRun,
  requirementSetIds: string[],
  executableCases: ExecutableCase[],
  coverage: Array<Record<string, unknown>>,
  layout: ArtifactRunLayout
) {
  const requirementIdSet = new Set(requirementSetIds);
  const requirementSets = context.repository.requirementSets.filter(
    (item) => requirementIdSet.has(item.id)
  );
  const sourceIds = new Set(requirementSets.map((item) => item.sourceId));
  const sourcePath = join(layout.sourceDir, "requirements.json");
  const analysisPath = join(layout.analysisDir, "knowledge-and-coverage.json");
  const casesPath = join(layout.casesDir, "executable-cases.json");
  await Promise.all([
    mkdir(layout.sourceDir, { recursive: true }),
    mkdir(layout.analysisDir, { recursive: true }),
    mkdir(layout.casesDir, { recursive: true })
  ]);
  await Promise.all([
    writeFile(sourcePath, `${JSON.stringify({
      knowledgeProject: context.repository.knowledgeProjects.find(
        (item) => item.id === run.knowledgeProjectId
      ),
      requirementSets,
      requirementSources: context.repository.requirementSources.filter(
        (item) => sourceIds.has(item.id)
      )
    }, null, 2)}\n`, "utf8"),
    writeFile(analysisPath, `${JSON.stringify({
      coverage,
      workflowModels: context.repository.workflowModels.filter(
        (item) => requirementIdSet.has(item.requirementSetId)
      ),
      stateMachineModels: context.repository.stateMachineModels.filter(
        (item) => requirementIdSet.has(item.requirementSetId)
      ),
      attachmentAnalyses: context.repository.attachmentAnalyses.filter(
        (item) => requirementIdSet.has(item.requirementSetId)
      )
    }, null, 2)}\n`, "utf8"),
    writeFile(casesPath, `${JSON.stringify({
      executableCases,
      executionPlans: context.repository.executionPlans.filter(
        (item) => executableCases.some((candidate) => candidate.id === item.executableCaseId)
      )
    }, null, 2)}\n`, "utf8")
  ]);
  return [sourcePath, analysisPath, casesPath];
}

function createRequirementBugReport(
  context: BrainCreatorMcpContext,
  input: {
    executableCase: ExecutableCase;
    chainRun: ChainRun;
    failureReason: string;
    artifactPaths: string[];
    diagnosisId?: string;
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
    diagnosisId: input.diagnosisId,
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

function regressionContextArg(
  input: Record<string, unknown>
): AgentTask["regressionContext"] | undefined {
  const value = input.regressionContext;
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new Error("regressionContext must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const bugReportId = candidate.bugReportId;
  const sourceId = candidate.sourceId;
  const caseNo = candidate.caseNo;
  const title = candidate.title;
  const previousStatus = candidate.previousStatus;
  const remainingBugIds = candidate.remainingBugIds;
  const maxHealAttempts = candidate.maxHealAttempts;
  if (
    typeof bugReportId !== "string" ||
    typeof sourceId !== "string" ||
    typeof caseNo !== "string" ||
    typeof title !== "string" ||
    (previousStatus !== "open" && previousStatus !== "retest-failed") ||
    !Array.isArray(remainingBugIds) ||
    remainingBugIds.some((item) => typeof item !== "string") ||
    (maxHealAttempts !== undefined &&
      (typeof maxHealAttempts !== "number" || maxHealAttempts < 0))
  ) {
    throw new Error(
      "regressionContext requires bugReportId, sourceId, caseNo, title, previousStatus, and remainingBugIds"
    );
  }
  return {
    bugReportId,
    sourceId,
    caseNo,
    title,
    previousStatus,
    remainingBugIds: remainingBugIds as string[],
    maxHealAttempts: maxHealAttempts as number | undefined
  };
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

function browserModeArg(input: Record<string, unknown>): BrowserExecutionMode | undefined {
  const value = optionalStringArg(input, "browserMode");
  if (value === undefined) return undefined;
  if (value !== "headless" && value !== "observe") {
    throw new Error("browserMode must be headless or observe");
  }
  return value;
}

function suiteActionArg(input: Record<string, unknown>) {
  const value = optionalStringArg(input, "suiteAction") ?? "continue";
  if (!["continue", "cancel", "retry", "skip", "claim-next-scheduled", "process-next-scheduled", "claim-scheduled", "renew-scheduled", "release-scheduled"].includes(value)) {
    throw new Error("suiteAction is invalid");
  }
  return value as
    | "continue"
    | "cancel"
    | "retry"
    | "skip"
    | "claim-next-scheduled"
    | "process-next-scheduled"
    | "claim-scheduled"
    | "renew-scheduled"
    | "release-scheduled";
}

function explorationPlanActionsArg(input: Record<string, unknown>) {
  const value = input.explorationPlanActions;
  if (!Array.isArray(value)) throw new Error("explorationPlanActions must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`explorationPlanActions[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    return {
      name: stringArg(record, "name"),
      route: stringArg(record, "route"),
      role: optionalStringArg(record, "role"),
      write: optionalBooleanArg(record, "write"),
      sourceRefs: stringArrayArg(record, "sourceRefs")
    };
  });
}

function explorationCleanupPolicyArg(
  input: Record<string, unknown>,
  key: string
) {
  const value = stringArg(input, key);
  if (value !== "delete" && value !== "close" && value !== "retain-with-label") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

function explorationResultArg(input: Record<string, unknown>) {
  const value = input.explorationResult;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("explorationResult must be an object");
  }
  const record = value as Record<string, unknown>;
  const status = stringArg(record, "status");
  if (status !== "succeeded" && status !== "failed") {
    throw new Error("explorationResult.status is invalid");
  }
  const cleanupStatus = stringArg(record, "cleanupStatus");
  if (cleanupStatus !== "completed" && cleanupStatus !== "not-required" && cleanupStatus !== "failed") {
    throw new Error("explorationResult.cleanupStatus is invalid");
  }
  const rawActions = record.actionEvidence;
  if (!Array.isArray(rawActions)) {
    throw new Error("explorationResult.actionEvidence must be an array");
  }
  return {
    planId: stringArg(input, "explorationPlanId"),
    status: status as "succeeded" | "failed",
    durationMs: numberArg(record, "durationMs"),
    actionEvidence: rawActions.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`explorationResult.actionEvidence[${index}] must be an object`);
      }
      const action = item as Record<string, unknown>;
      return {
        actionId: stringArg(action, "actionId"),
        action: stringArg(action, "action"),
        route: stringArg(action, "route"),
        role: optionalStringArg(action, "role"),
        sourceRefs: stringArrayArg(action, "sourceRefs")
      };
    }),
    evidenceRefs: stringArrayArg(record, "evidenceRefs"),
    pageModelIds: stringArrayArg(record, "pageModelIds"),
    systemExplorationIds: stringArrayArg(record, "systemExplorationIds"),
    trainingSessionIds: stringArrayArg(record, "trainingSessionIds"),
    taskEvidence: optionalObjectArrayArg(record, "taskEvidence").map((item) => ({
      taskId: stringArg(item, "taskId"),
      observedEvidence: stringArrayArg(item, "observedEvidence"),
      evidenceRefs: stringArrayArg(item, "evidenceRefs")
    })),
    cleanupStatus: cleanupStatus as "completed" | "not-required" | "failed",
    error: optionalStringArg(record, "error")
  };
}

type KnowledgeReviewTarget =
  | "requirement"
  | "knowledge"
  | "coverage"
  | "requirement-eval-accuracy"
  | "system-brain"
  | "system-exploration"
  | "onboarding-plan"
  | "exploration-plan"
  | "test-intent"
  | "executable-case"
  | "execution-plan"
  | "requirement-suite-run"
  | "run-ledger"
  | "execution-diagnosis"
  | "evidence"
  | "compile-run"
  | "semantic-binding"
  | "case-dependency"
  | "testdata"
  | "business-scenario"
  | "scenario-assurance"
  | "scenario-trust";

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
      "onboarding-plan",
      "exploration-plan",
      "test-intent",
      "executable-case",
      "execution-plan",
      "requirement-suite-run",
      "run-ledger",
      "execution-diagnosis",
      "evidence",
      "compile-run",
      "semantic-binding",
      "case-dependency",
      "testdata",
      "business-scenario",
      "scenario-assurance",
      "scenario-trust"
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

function stabilityPolicyArg(input: Record<string, unknown>): StabilityPolicy | undefined {
  const value = input.stabilityPolicy;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const numberValue = (key: string) =>
    typeof candidate[key] === "number" && Number.isFinite(candidate[key])
      ? candidate[key] as number
      : undefined;
  const targetIterations = numberValue("targetIterations");
  if (!targetIterations || targetIterations < 1) {
    throw new Error("stabilityPolicy.targetIterations must be a positive number");
  }
  const minIterations = numberValue("minIterations");
  const maxFailureRate = numberValue("maxFailureRate");
  const maxConsecutiveFailures = numberValue("maxConsecutiveFailures");
  const minIntervalMs = numberValue("minIntervalMs");
  const maxIntervalMs = numberValue("maxIntervalMs");
  if (minIterations !== undefined && (minIterations < 1 || minIterations > targetIterations)) {
    throw new Error("stabilityPolicy.minIterations must be between 1 and targetIterations");
  }
  if (maxFailureRate !== undefined && (maxFailureRate < 0 || maxFailureRate > 1)) {
    throw new Error("stabilityPolicy.maxFailureRate must be between 0 and 1");
  }
  if (maxConsecutiveFailures !== undefined && maxConsecutiveFailures < 0) {
    throw new Error("stabilityPolicy.maxConsecutiveFailures must not be negative");
  }
  if (minIntervalMs !== undefined && minIntervalMs < 0) {
    throw new Error("stabilityPolicy.minIntervalMs must not be negative");
  }
  if (maxIntervalMs !== undefined && maxIntervalMs < 0) {
    throw new Error("stabilityPolicy.maxIntervalMs must not be negative");
  }
  if (minIntervalMs !== undefined && maxIntervalMs !== undefined && maxIntervalMs < minIntervalMs) {
    throw new Error("stabilityPolicy.maxIntervalMs must be greater than or equal to minIntervalMs");
  }
  return {
    targetIterations,
    minIterations,
    maxDurationMs: numberValue("maxDurationMs"),
    maxFailureRate,
    maxConsecutiveFailures,
    minIntervalMs,
    maxIntervalMs,
    requireStrongEvidence: typeof candidate.requireStrongEvidence === "boolean"
      ? candidate.requireStrongEvidence
      : undefined,
    stopOnBlocked: typeof candidate.stopOnBlocked === "boolean"
      ? candidate.stopOnBlocked
      : undefined
  };
}

function isKnowledgeReviewTarget(value: ReturnType<typeof reviewTargetArg>): value is KnowledgeReviewTarget {
  return [
    "requirement",
    "knowledge",
    "coverage",
    "requirement-eval-accuracy",
    "system-brain",
    "system-exploration",
    "onboarding-plan",
    "exploration-plan",
    "test-intent",
    "executable-case",
    "execution-plan",
    "requirement-suite-run",
    "run-ledger",
    "execution-diagnosis",
    "evidence",
    "compile-run",
    "semantic-binding",
    "case-dependency",
    "testdata",
    "business-scenario",
    "scenario-assurance",
    "scenario-trust"
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
      "connector",
      "runtime"
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
    | "connector"
    | "runtime";
}

function prepareActionArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (
    ![
      "ingest-requirement",
      "refresh-requirement",
      "analyze-attachments",
      "submit-attachment-analysis",
      "confirm-attachment-analysis",
      "generate-analysis",
      "generate-test-design",
      "assess-scenarios",
      "record-scenario-run",
      "evaluate-mutations",
      "confirm-eval-actions",
      "review-legacy-diagnosis",
      "rollback-legacy-diagnosis",
      "approve-baseline",
      "compile-cases",
      "confirm-page-binding",
      "create-onboarding-plan",
      "approve-onboarding-plan",
      "start-onboarding-plan",
      "create-exploration-plan",
      "approve-exploration-plan",
      "cancel-exploration-plan",
      "start-exploration-plan",
      "submit-exploration-result",
      "resolve-exploration-task",
      "resolve-gap",
      "dismiss-gap",
      "reopen-gap",
      "resolve-test-data",
      "prepare-test-data",
      "submit-test-data",
      "prepare-execution",
      "record-observation",
      "record-page-evidence",
      "record-interaction-evidence",
      "record-training-evidence",
      "explore-system",
      "refresh-system-brain",
      "confirm-system-snapshot",
      "reconcile-system-brain",
      "confirm-semantic-binding",
      "recompile-stale-cases"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as
    | "ingest-requirement"
    | "refresh-requirement"
    | "analyze-attachments"
    | "submit-attachment-analysis"
    | "confirm-attachment-analysis"
    | "generate-analysis"
    | "generate-test-design"
    | "assess-scenarios"
    | "record-scenario-run"
    | "evaluate-mutations"
    | "confirm-eval-actions"
    | "review-legacy-diagnosis"
    | "rollback-legacy-diagnosis"
    | "approve-baseline"
    | "compile-cases"
    | "confirm-page-binding"
    | "create-onboarding-plan"
    | "approve-onboarding-plan"
    | "start-onboarding-plan"
    | "create-exploration-plan"
    | "approve-exploration-plan"
    | "cancel-exploration-plan"
    | "start-exploration-plan"
    | "submit-exploration-result"
    | "resolve-exploration-task"
    | "resolve-gap"
    | "dismiss-gap"
    | "reopen-gap"
    | "resolve-test-data"
    | "prepare-test-data"
    | "submit-test-data"
    | "prepare-execution"
    | "record-observation"
    | "record-page-evidence"
    | "record-interaction-evidence"
    | "record-training-evidence"
    | "explore-system"
    | "refresh-system-brain"
    | "confirm-system-snapshot"
    | "reconcile-system-brain"
    | "confirm-semantic-binding"
    | "recompile-stale-cases";
}

function diagnosisAssetTypeArg(
  input: Record<string, unknown>,
  key: string
): "bug" | "gap" {
  const value = stringArg(input, key);
  if (value !== "bug" && value !== "gap") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

function legacyDiagnosisDecisionArg(
  input: Record<string, unknown>,
  key: string
): LegacyDiagnosisDecision {
  const value = stringArg(input, key);
  if (
    ![
      "confirm_bug",
      "review_bug_as_gap",
      "confirm_gap",
      "needs_evidence",
      "override_classification"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as LegacyDiagnosisDecision;
}

function optionalExecutionFailureTypeArg(
  input: Record<string, unknown>,
  key: string
): ExecutionFailureType | undefined {
  const value = optionalStringArg(input, key);
  if (!value) return undefined;
  if (
    ![
      "assertion_failure",
      "auth_failure",
      "locator_failure",
      "network_failure",
      "automation_failure",
      "test_data_failure",
      "environment_failure",
      "execution_failure",
      "unknown_failure"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as ExecutionFailureType;
}

function optionalExecutionDiagnosisVerdictArg(
  input: Record<string, unknown>,
  key: string
): ExecutionDiagnosisVerdict | undefined {
  const value = optionalStringArg(input, key);
  if (!value) return undefined;
  if (
    ![
      "product_bug",
      "automation_gap",
      "test_data_gap",
      "auth_gap",
      "environment_gap",
      "network_gap",
      "execution_gap",
      "unknown_gap"
    ].includes(value)
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value as ExecutionDiagnosisVerdict;
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
  if (value !== "builtin" && value !== "host-skill" && value !== "host-agent") throw new Error(`${key} is invalid`);
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

function explorationTaskOutcomeArg(
  input: Record<string, unknown>,
  key: string
): "resolved" | "failed" | "cancelled" {
  const value = stringArg(input, key);
  if (value !== "resolved" && value !== "failed" && value !== "cancelled") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

function attachmentAnalysisArg(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const kinds = new Set(["table", "flowchart", "state-machine", "wireframe", "text-image", "other"]);
  if (
    typeof record.kind !== "string" ||
    !kinds.has(record.kind) ||
    typeof record.markdown !== "string" ||
    !record.markdown.trim() ||
    !Array.isArray(record.nodes) ||
    !Array.isArray(record.edges) ||
    typeof record.confidence !== "number" ||
    record.confidence < 0 ||
    record.confidence > 1
  ) {
    throw new Error(`${key} is invalid`);
  }
  return {
    kind: record.kind as "table" | "flowchart" | "state-machine" | "wireframe" | "text-image" | "other",
    markdown: record.markdown,
    nodes: record.nodes.map((node, index) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        throw new Error(`${key}.nodes[${index}] is invalid`);
      }
      const item = node as Record<string, unknown>;
      return { id: stringArg(item, "id"), type: stringArg(item, "type"), label: stringArg(item, "label") };
    }),
    edges: record.edges.map((edge, index) => {
      if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
        throw new Error(`${key}.edges[${index}] is invalid`);
      }
      const item = edge as Record<string, unknown>;
      return {
        from: stringArg(item, "from"),
        to: stringArg(item, "to"),
        condition: optionalStringArg(item, "condition"),
        actor: optionalStringArg(item, "actor")
      };
    }),
    confidence: record.confidence
  };
}

function interactionEvidenceArg(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const state = (stateValue: unknown, stateKey: string) => {
    if (!stateValue || typeof stateValue !== "object" || Array.isArray(stateValue)) {
      throw new Error(`${key}.${stateKey} must be an object`);
    }
    const stateRecord = stateValue as Record<string, unknown>;
    const controlValues = stateRecord.controlValues;
    return {
      id: stringArg(stateRecord, "id"),
      url: stringArg(stateRecord, "url"),
      visibleElements: stringArrayArg(stateRecord, "visibleElements"),
      dialogs: stringArrayArg(stateRecord, "dialogs"),
      ...(controlValues === undefined
        ? {}
        : {
            controlValues: (controlValues as unknown[]).map((item, index) => {
              if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new Error(`${key}.${stateKey}.controlValues[${index}] must be an object`);
              }
              const control = item as Record<string, unknown>;
              return {
                name: stringArg(control, "name"),
                value: stringArg(control, "value")
              };
            })
          })
    };
  };
  const blockedRequests = record.blockedRequests;
  if (!Array.isArray(blockedRequests)) throw new Error(`${key}.blockedRequests must be an array`);
  return {
    pageUrl: stringArg(record, "pageUrl"),
    targetName: stringArg(record, "targetName"),
    targetRole: stringArg(record, "targetRole"),
    targetSelector: stringArg(record, "targetSelector"),
    targetKind: stringArg(record, "targetKind") as "tab" | "disclosure" | "select",
    action: stringArg(record, "action") as "click" | "select",
    inputValue: optionalStringArg(record, "inputValue"),
    before: state(record.before, "before"),
    after: state(record.after, "after"),
    visibleAdded: stringArrayArg(record, "visibleAdded"),
    visibleRemoved: stringArrayArg(record, "visibleRemoved"),
    dialogAdded: stringArrayArg(record, "dialogAdded"),
    dialogRemoved: stringArrayArg(record, "dialogRemoved"),
    changedControls:
      record.changedControls === undefined
        ? undefined
        : (record.changedControls as unknown[]).map((item, index) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              throw new Error(`${key}.changedControls[${index}] must be an object`);
            }
            const control = item as Record<string, unknown>;
            return {
              name: stringArg(control, "name"),
              before: stringArg(control, "before"),
              after: stringArg(control, "after")
            };
          }),
    urlChanged: Boolean(record.urlChanged),
    transitionKind: optionalStringArg(record, "transitionKind") as "navigation" | "state" | undefined,
    blockedRequests: blockedRequests.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`${key}.blockedRequests[${index}] must be an object`);
      }
      const request = item as Record<string, unknown>;
      return { method: stringArg(request, "method"), url: stringArg(request, "url") };
    }),
    status: stringArg(record, "status") as "observed" | "no-change" | "blocked" | "failed",
    screenshotPath: optionalStringArg(record, "screenshotPath"),
    evidenceRefs: stringArrayArg(record, "evidenceRefs"),
    scenarioId: optionalStringArg(record, "scenarioId")
  };
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

function optionalObjectArrayArg(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${key}[${index}] must be an object`);
    }
    return item as Record<string, unknown>;
  });
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
  if (value !== "open" && value !== "resolved" && value !== "dismissed") {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

function responseModeArg(input: Record<string, unknown>) {
  const value = optionalStringArg(input, "responseMode") ?? "full";
  if (value !== "summary" && value !== "full") {
    throw new Error("responseMode is invalid");
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
