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
import type {
  AgentRun,
  AuthCheckpoint,
  AuthProfile,
  BugReport,
  CaseSuite,
  CaseSuiteCaseResult,
  ChainRun,
  DocumentCase,
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

async function statusFacade(context: BrainCreatorMcpContext, input: Record<string, unknown>) {
  const systemId = stringArg(input, "systemId");
  const snapshot = await sessionResume(context, { systemId });
  const caseSources = context.service.listCaseSources(systemId);
  const suites = context.service.listCaseSuites(systemId);
  const suiteRuns = context.service.listCaseSuiteRuns(systemId);
  const bugs = context.service.listBugReports({ systemId });
  const openBugs = bugs.filter((bug) => bug.status === "open" || bug.status === "retest-failed");
  const unfinishedSuites = unfinishedCaseSuites(context, systemId);
  return {
    ...snapshot,
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
    facadeNextAction: facadeNextAction({
      bridgeOk: snapshot.bridge.ok,
      openBugs: openBugs.length,
      openGaps: snapshot.openGaps.length,
      approvedCases: snapshot.cases.byStatus.approved,
      caseSources: caseSources.length,
      unfinishedSuites: unfinishedSuites.length
    })
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
  if (mode === "case-source-suite") {
    return runCaseSourceSuite(context, input);
  }
  return runBugRegression(context, input);
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

  return {
    mode: "case-source-suite",
    status: suiteRun.status,
    source: caseSource,
    suite,
    suiteRun,
    progress: caseSuiteProgress(suite.selectedCaseNos, alreadyPassed, caseResults),
    bugs: context.service.listBugReports({ systemId }).filter((bug) =>
      bugReportIds.includes(bug.id)
    )
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
  const candidates = context.service
    .listBugReports({ systemId })
    .filter((bug) =>
      requestedBugIds.length > 0
        ? requestedBugIds.includes(bug.id)
        : bug.status === "open" || bug.status === "retest-failed"
    );
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
  const systemId = stringArg(input, "systemId");
  const target = reviewTargetArg(input, "target");
  if (target === "bug") {
    const bugs = context.service.listBugReports({
      systemId,
      status: bugStatusArg(input, "status")
    });
    const regressionCandidates = bugRegressionCandidates(bugs);
    return {
      summary: bugReviewSummary(bugs),
      bugs,
      regressionCandidates: regressionCandidateSummary(regressionCandidates),
      reportMarkdown: bugReviewMarkdown(bugs),
      nextAction: bugs.some((bug) => bug.status === "open" || bug.status === "retest-failed")
        ? "run_bug_regression"
        : "no_open_bug"
    };
  }
  if (target === "suite-run") {
    return context.service.listCaseSuiteRuns(systemId);
  }
  if (target === "case") {
    return context.service.listTestCases(systemId);
  }
  if (target === "gap") {
    return context.service.listGaps({
      projectId: systemId,
      status: gapStatusArg(input, "status")
    });
  }
  return artifactOverview(context, { systemId });
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
