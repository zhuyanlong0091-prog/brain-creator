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
import { parseCaseSource, summarizeDocumentCases, type ParsedCaseSource } from "../caseSource/parser.js";
import { writeXlsxCaseSourceResults } from "../caseSource/writeBack.js";
import type {
  AgentRun,
  AuthCheckpoint,
  AuthProfile,
  BugReport,
  CaseSuiteRun,
  CaseSuite,
  CaseSuiteCaseResult,
  ChainRun,
  DocumentCase,
  Gap,
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
        return textResult(configureFacade(context, input));
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

async function statusFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const resolution = resolveSystemReference(context, input);
  const systemId = resolution.systemId;
  const snapshot = await sessionResume(context, { systemId });
  const caseSources = context.service.listCaseSources(systemId);
  const suites = context.service.listCaseSuites(systemId);
  const suiteRuns = context.service.listCaseSuiteRuns(systemId);
  const bugs = context.service.listBugReports({ systemId });
  const openBugs = bugs.filter((bug) => bug.status === "open" || bug.status === "retest-failed");
  const unfinishedSuites = unfinishedCaseSuites(context, systemId);
  const nextAction = facadeNextAction({
    bridgeOk: snapshot.bridge.ok,
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

async function runFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const mode = runModeArg(input, "mode");
  if (mode === "approved-case") {
    return runApprovedChain(context, { ...input, caseId: stringArg(input, "caseId") });
  }
  if (mode === "full-workflow") {
    return fullWorkflow(context, { ...input, caseId: stringArg(input, "caseId") });
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

  const requestedSuiteId = optionalStringArg(input, "suiteId") ?? resumeTarget?.suiteId;
  const suite = requestedSuiteId
    ? existingCaseSuite(context, requestedSuiteId, systemId, caseSource.id)
    : context.service.createCaseSuite({
        systemId,
        sourceId: caseSource.id,
        totalCases: selectedCases.length,
        selectedCaseNos: selectedCases.map((documentCase) => documentCase.caseNo),
        status: "approved"
      });
  const alreadyPassed = passedCaseNosForSuite(context, systemId, suite.id);
  const casesToRun = parsed.cases.filter(
    (documentCase) =>
      suite.selectedCaseNos.includes(documentCase.caseNo) && !alreadyPassed.has(documentCase.caseNo)
  );
  context.service.updateCaseSuiteStatus(suite.id, "running");
  const caseResults: CaseSuiteCaseResult[] = [];
  const artifactPaths: string[] = [];
  const bugReportIds: string[] = [];
  const gapIds: string[] = [];

  for (const documentCase of casesToRun) {
    const result = await executeDocumentCase(context, {
      systemId,
      sourceId: caseSource.id,
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
    progress: caseSuiteProgress(suite.selectedCaseNos, alreadyPassed, caseResults),
    bugs,
    writeBack
  };
}

async function executeDocumentCase(
  context: BrainCreatorMcpContext,
  input: {
    systemId: string;
    sourceId: string;
    documentCase: DocumentCase;
    maxHealAttempts?: number;
    createBugOnFailure?: boolean;
  }
): Promise<{
  caseResult: CaseSuiteCaseResult;
  artifactPaths?: string[];
  bugReportId?: string;
}> {
  const testCase = context.service.createTestCaseFromDocumentCase({
    systemId: input.systemId,
    documentCase: input.documentCase
  });
  context.service.approveTestCase(testCase.id);
  try {
    const result = await runApprovedChain(context, {
      caseId: testCase.id,
      maxHealAttempts: input.maxHealAttempts
    });
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
  const resolution = resolveSystemReference(context, input);
  const systemId = resolution.systemId;
  const target = reviewTargetArg(input, "target");
  if (target === "bug") {
    const bugs = context.service.listBugReports({
      systemId,
      status: bugStatusArg(input, "status")
    });
    const regressionCandidates = bugRegressionCandidates(bugs);
    const summary = bugReviewSummary(bugs);
    const nextAction = bugs.some((bug) => bug.status === "open" || bug.status === "retest-failed")
      ? "run_bug_regression"
      : "no_open_bug";
    return {
      summary,
      bugs,
      regressionCandidates: regressionCandidateSummary(regressionCandidates),
      reportMarkdown: bugReviewMarkdown(bugs),
      reviewSummary: bugReviewResultSummary(summary, bugs, nextAction),
      nextAction,
      systemResolution: resolution
    };
  }
  if (target === "suite-run") {
    const review = suiteRunReview(context, systemId, optionalStringArg(input, "id"));
    return {
      ...review,
      reviewSummary: suiteRunReviewSummary(review),
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
    const gaps = context.service.listGaps({
      projectId: systemId,
      status: gapStatusArg(input, "status")
    });
    return {
      items: gaps,
      reviewSummary: gapReviewSummary(gaps),
      systemResolution: resolution
    };
  }
  const overview = await artifactOverview(context, { systemId });
  return {
    ...overview,
    reviewSummary: artifactReviewSummary(overview),
    systemResolution: resolution
  };
}

function configureFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const target = configureTargetArg(input, "target");
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

function suiteRunReview(context: BrainCreatorMcpContext, systemId: string, id?: string) {
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
    .filter((bug) => bugIds.has(bug.id));
  const gaps = context.service
    .listGaps({ projectId: systemId })
    .filter((gap) => gapIds.has(gap.id));
  const failedCases = runs.flatMap((run) =>
    run.caseResults
      .filter((caseResult) => caseResult.status !== "passed")
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
  return {
    totalRuns: runs.length,
    totalCases: sumBy(runs, (run) => run.total),
    passed: sumBy(runs, (run) => run.passed),
    failed: sumBy(runs, (run) => run.failed),
    blocked: sumBy(runs, (run) => run.blocked),
    bugReports: bugReports.length,
    gaps: gaps.length,
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
      `${review.summary.blocked} blocked.`
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
    bySeverity: countBy(gaps, (gap) => gap.severity)
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

function caseSuiteProgress(
  selectedCaseNos: string[],
  alreadyPassed: Set<string>,
  caseResults: CaseSuiteCaseResult[]
) {
  const passedNow = caseResults.filter((result) => result.status === "passed").map((result) => result.caseNo);
  const passed = new Set([...alreadyPassed, ...passedNow]);
  const failed = caseResults.filter((result) => result.status === "failed").length;
  const blocked = caseResults.filter((result) => result.status === "blocked").length;
  const remainingCaseNos = selectedCaseNos.filter((caseNo) => !passed.has(caseNo));
  return {
    selected: selectedCaseNos.length,
    alreadyPassed: alreadyPassed.size,
    attempted: caseResults.length,
    passed: passed.size,
    failed,
    blocked,
    remaining: remainingCaseNos.length,
    remainingCaseNos
  };
}

function unfinishedCaseSuites(context: BrainCreatorMcpContext, systemId: string) {
  const sourcesById = new Map(context.service.listCaseSources(systemId).map((source) => [source.id, source]));
  return context.service
    .listCaseSuites(systemId)
    .filter((suite) => suite.status !== "completed" && suite.status !== "cancelled")
    .map((suite) => {
      const passed = passedCaseNosForSuite(context, systemId, suite.id);
      const remainingCaseNos = suite.selectedCaseNos.filter((caseNo) => !passed.has(caseNo));
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
        passedCaseNos: [...passed],
        remainingCaseNos,
        nextCaseNo: remainingCaseNos[0],
        lastRunId: lastRun?.id
      };
    })
    .filter((suite) => suite.remainingCaseNos.length > 0 && suite.source)
    .sort((left, right) => (left.lastRunId ?? "").localeCompare(right.lastRunId ?? ""));
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

function facadeNextAction(state: {
  bridgeOk: boolean;
  openBugs: number;
  openGaps: number;
  approvedCases: number;
  caseSources: number;
  unfinishedSuites: number;
}) {
  if (!state.bridgeOk) {
    return "configure_bridge";
  }
  if (state.unfinishedSuites > 0) {
    return "continue_case_source_suite";
  }
  if (state.openGaps > 0) {
    return "review_gaps";
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
  openBugs: number;
  openGaps: number;
  unfinishedSuites: number;
  nextAction: string;
}) {
  return {
    systemName: state.systemName,
    readiness: state.bridgeOk ? "ready" : "blocked",
    nextAction: state.nextAction,
    nextCommand: nextCommandForAction(state.nextAction),
    nextStep: nextStepForAction(state.nextAction),
    counts: {
      authProfiles: state.authProfiles,
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

function nextStepForAction(action: string) {
  if (action === "configure_bridge") {
    return "Configure the Brain Creator agent bridge before running generation or suites.";
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

function bugReviewSummary(bugs: Array<{ status: string }>) {
  const counts = countBy(bugs, (bug) => bug.status);
  return {
    total: bugs.length,
    open: counts.open ?? 0,
    retestRunning: counts["retest-running"] ?? 0,
    retestPassed: counts["retest-passed"] ?? 0,
    retestFailed: counts["retest-failed"] ?? 0,
    closed: counts.closed ?? 0
  };
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

function optionalBooleanArg(input: Record<string, unknown>, key: string): boolean {
  return input[key] === true;
}

function runModeArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (!["approved-case", "full-workflow", "case-source-suite", "bug-regression"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as "approved-case" | "full-workflow" | "case-source-suite" | "bug-regression";
}

function reviewTargetArg(input: Record<string, unknown>, key: string) {
  const value = stringArg(input, key);
  if (!["suite-run", "case", "bug", "gap", "artifact"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as "suite-run" | "case" | "bug" | "gap" | "artifact";
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
    return { tool: "bc_review", toolInput: { target: "bug", systemId } };
  }
  if (action === "gaps") {
    return { tool: "bc_review", toolInput: { target: "gap", systemId } };
  }
  if (action === "review" && tokens[2]) {
    const target = commandReviewTarget(tokens[2]);
    return {
      tool: "bc_review",
      toolInput: {
        target,
        systemId
      }
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
  if (!["system", "auth", "term", "rule", "checkpoint"].includes(value)) {
    throw new Error(`${key} is invalid`);
  }
  return value as "system" | "auth" | "term" | "rule" | "checkpoint";
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
