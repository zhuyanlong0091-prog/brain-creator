import { InMemoryBrainCreatorRepository } from "./repository.js";
import { decryptSecrets, encryptSecrets, redactSecrets } from "../shared/crypto.js";
import { id } from "../shared/id.js";
import type {
  ActionStep,
  AgentRun,
  AgentTask,
  ApiFlow,
  ApiRequest,
  AssetSearchResult,
  AuthCheckpoint,
  AuthProfile,
  BugReport,
  BusinessRule,
  CaseSource,
  CaseSuite,
  CaseSuiteRun,
  ChainRun,
  DocumentCase,
  Gap,
  GeneratedCase,
  GlossaryTerm,
  LocatorPoint,
  PageCaptureEvidence,
  PageModel,
  ProbeResult,
  RuleCheckResult,
  SystemProfile,
  TestArtifact,
  TestCase,
  TestCaseScenario,
  TestCaseStep,
  TrainingSession
} from "./types.js";

type PageCaptureAuth = {
  loginMethod: AuthProfile["loginMethod"];
  secrets: Record<string, string>;
};

type CreateSystemProfileInput = {
  name: string;
  environment: string;
  baseUrl: string;
  defaultLocale: string;
  urlAllowlist: string[];
};

type CreateAuthProfileInput = {
  projectId: string;
  env: string;
  role: string;
  loginMethod: AuthProfile["loginMethod"];
  secrets: Record<string, string>;
};

type CreateAuthCheckpointInput = {
  systemId: string;
  authProfileId: string;
  testCaseId?: string;
  reason: string;
  resumeInstruction: string;
};

type ReportGapInput = {
  projectId: string;
  sourceType: string;
  sourceId: string;
  reason: string;
  severity: Gap["severity"];
  owner: string;
};

type DiscoverPageInput = {
  projectId: string;
  route: string;
  name: string;
  authProfileId: string;
  domText: string;
  captureMode?: "manual" | "browser";
  targetUrl?: string;
  browserCapture?: PageCaptureEvidence;
};

type CompleteTrainingInput = {
  sessionId: string;
  actions: Array<Omit<ActionStep, "id" | "sessionId" | "order">>;
  apiRequests: ApiRequest[];
  artifacts?: {
    traceUrl: string;
    harUrl: string;
    screenshotUrl: string;
  };
};

type GenerateCaseInput = {
  projectId: string;
  sourceRequirement: string;
  pageModelId: string;
};

type SearchInput = {
  projectId: string;
  query: string;
};

type ListGapsInput = {
  projectId: string;
  status?: Gap["status"];
};

type ResolveGapInput = {
  projectId: string;
  gapId: string;
};

type TransitionGapInput = ResolveGapInput & {
  operation: "resolve" | "dismiss" | "reopen";
  note: string;
  evidenceRefs: string[];
};

type AssetDetailInput = {
  projectId: string;
  type: AssetSearchResult["type"];
  id: string;
};

type CreateGlossaryTermInput = {
  projectId: string;
  key: string;
  zhCN: string;
  enUS: string;
  aliases: string[];
  pageScope: string;
};

type UpdateGlossaryTermInput = CreateGlossaryTermInput & {
  termId: string;
};

type DeleteGlossaryTermInput = {
  projectId: string;
  termId: string;
};

type ConfirmCandidateTermsInput = {
  caseId: string;
  confirmTermIds: string[];
  ignoreTermIds: string[];
};

type CreateBusinessRuleInput = {
  systemId: string;
  name: string;
  condition: string;
  severity: BusinessRule["severity"];
};

type DeleteBusinessRuleInput = {
  systemId: string;
  ruleId: string;
};

type CreateTestCaseInput = {
  systemId: string;
  requirement: string;
  scenarios: TestCaseScenario[];
  newTerms: TestCase["newTerms"];
  ruleCheckResult: RuleCheckResult;
};

type UpsertCaseSourceInput = {
  systemId: string;
  source: string;
  sourceType: CaseSource["sourceType"];
  contentHash: string;
  caseCount: number;
  moduleStats: Record<string, number>;
  priorityStats: Record<string, number>;
};

type CreateCaseSuiteInput = {
  systemId: string;
  sourceId: string;
  totalCases: number;
  selectedCaseNos: string[];
  continueOnBlocked?: boolean;
  status?: CaseSuite["status"];
};

type RecordCaseSuiteRunInput = Omit<CaseSuiteRun, "id" | "createdAt">;

type CreateBugReportInput = {
  systemId: string;
  sourceId: string;
  suiteRunId?: string;
  caseNo: string;
  caseTitle: string;
  module: string;
  priority: string;
  expectedResult: string;
  actualResult: string;
  reproductionSteps: string[];
  evidencePaths: string[];
  chainRunId?: string;
  diagnosisId?: string;
  gapIds: string[];
};

type CreateAgentTaskInput = {
  id: string;
  systemId: string;
  agent: AgentTask["agent"];
  inputSummary: string;
  args: string[];
  outputPaths: string[];
  promptPath: string;
  contextPath: string;
  planContext?: AgentTask["planContext"];
  chainContext?: AgentTask["chainContext"];
  suiteContext?: AgentTask["suiteContext"];
  regressionContext?: AgentTask["regressionContext"];
};

type SubmitAgentTaskInput = {
  taskId: string;
  status: "succeeded" | "failed";
  stdout: string;
  stderr: string;
  outputPaths?: string[];
};

const actionTerms = ["Create Order", "Submit", "Search", "Create", "Save", "Delete"];

export class BrainCreatorService {
  constructor(private readonly repository: InMemoryBrainCreatorRepository) {}

  createSystemProfile(input: CreateSystemProfileInput): SystemProfile {
    assertHttpUrl(input.baseUrl, "baseUrl");
    for (const allowedUrl of input.urlAllowlist) {
      assertHttpUrl(allowedUrl, "urlAllowlist");
    }
    const now = timestamp();
    const profile: SystemProfile = {
      id: id("system"),
      name: input.name.trim(),
      environment: input.environment.trim(),
      baseUrl: input.baseUrl.trim(),
      defaultLocale: input.defaultLocale.trim() || "zh-CN",
      urlAllowlist: input.urlAllowlist.map((url) => url.trim()).filter(Boolean),
      status: "succeeded",
      createdAt: now,
      updatedAt: now
    };

    this.repository.systemProfiles.push(profile);
    this.repository.persist();
    return profile;
  }

  listSystemProfiles(): SystemProfile[] {
    return [...this.repository.systemProfiles];
  }

  upsertCaseSource(input: UpsertCaseSourceInput): CaseSource {
    const now = timestamp();
    const existing = this.repository.caseSources.find(
      (item) => item.systemId === input.systemId && item.source === input.source
    );
    if (existing) {
      existing.sourceType = input.sourceType;
      existing.contentHash = input.contentHash;
      existing.caseCount = input.caseCount;
      existing.moduleStats = input.moduleStats;
      existing.priorityStats = input.priorityStats;
      existing.status = "active";
      existing.parsedAt = now;
      existing.updatedAt = now;
      this.repository.persist();
      return existing;
    }
    const source: CaseSource = {
      id: id("source"),
      systemId: input.systemId,
      source: input.source,
      sourceType: input.sourceType,
      contentHash: input.contentHash,
      caseCount: input.caseCount,
      moduleStats: input.moduleStats,
      priorityStats: input.priorityStats,
      status: "active",
      parsedAt: now,
      createdAt: now,
      updatedAt: now
    };
    this.repository.caseSources.push(source);
    this.repository.persist();
    return source;
  }

  listCaseSources(systemId: string): CaseSource[] {
    return this.repository.caseSources.filter((item) => item.systemId === systemId);
  }

  createCaseSuite(input: CreateCaseSuiteInput): CaseSuite {
    const now = timestamp();
    const suite: CaseSuite = {
      id: id("suite"),
      systemId: input.systemId,
      sourceId: input.sourceId,
      status: input.status ?? "draft",
      totalCases: input.totalCases,
      selectedCaseNos: input.selectedCaseNos,
      continueOnBlocked: input.continueOnBlocked ?? false,
      createdAt: now,
      updatedAt: now
    };
    this.repository.caseSuites.push(suite);
    this.repository.persist();
    return suite;
  }

  updateCaseSuiteStatus(suiteId: string, status: CaseSuite["status"]): CaseSuite {
    const suite = this.getCaseSuite(suiteId);
    suite.status = status;
    suite.updatedAt = timestamp();
    this.repository.persist();
    return suite;
  }

  enableCaseSuiteContinueOnBlocked(suiteId: string): CaseSuite {
    const suite = this.getCaseSuite(suiteId);
    suite.continueOnBlocked = true;
    suite.updatedAt = timestamp();
    this.repository.persist();
    return suite;
  }

  getCaseSuite(suiteId: string): CaseSuite {
    const suite = this.repository.caseSuites.find((item) => item.id === suiteId);
    if (!suite) {
      throw new Error("Case suite not found");
    }
    return suite;
  }

  listCaseSuites(systemId: string): CaseSuite[] {
    return this.repository.caseSuites.filter((item) => item.systemId === systemId);
  }

  recordCaseSuiteRun(input: RecordCaseSuiteRunInput): CaseSuiteRun {
    const run: CaseSuiteRun = {
      ...input,
      id: id("suiteRun"),
      createdAt: timestamp()
    };
    this.repository.caseSuiteRuns.push(run);
    this.repository.persist();
    return run;
  }

  listCaseSuiteRuns(systemId: string): CaseSuiteRun[] {
    return this.repository.caseSuiteRuns.filter((item) => item.systemId === systemId);
  }

  createBugReport(input: CreateBugReportInput): BugReport {
    const now = timestamp();
    const bug: BugReport = {
      id: id("bug"),
      systemId: input.systemId,
      sourceId: input.sourceId,
      suiteRunId: input.suiteRunId,
      caseNo: input.caseNo,
      caseTitle: input.caseTitle,
      module: input.module,
      priority: input.priority,
      expectedResult: input.expectedResult,
      actualResult: input.actualResult,
      reproductionSteps: input.reproductionSteps,
      evidencePaths: input.evidencePaths,
      chainRunId: input.chainRunId,
      diagnosisId: input.diagnosisId,
      gapIds: input.gapIds,
      status: "open",
      createdAt: now,
      updatedAt: now
    };
    this.repository.bugReports.push(bug);
    this.repository.persist();
    return bug;
  }

  listBugReports(input: { systemId: string; status?: BugReport["status"] }): BugReport[] {
    return this.repository.bugReports.filter(
      (item) => item.systemId === input.systemId && (input.status === undefined || item.status === input.status)
    );
  }

  updateBugReportStatus(id: string, status: BugReport["status"]): BugReport {
    const bug = this.repository.bugReports.find((item) => item.id === id);
    if (!bug) {
      throw new Error("Bug report not found");
    }
    bug.status = status;
    bug.updatedAt = timestamp();
    this.repository.persist();
    return bug;
  }

  createTestCaseFromDocumentCase(input: { systemId: string; documentCase: DocumentCase }): TestCase {
    return this.createTestCase({
      systemId: input.systemId,
      requirement: `${input.documentCase.caseNo} ${input.documentCase.title}`,
      scenarios: [documentCaseToScenario(input.documentCase)],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
  }

  archiveSystemProfile(systemId: string): SystemProfile {
    const system = this.repository.systemProfiles.find((item) => item.id === systemId);
    if (!system) {
      throw new Error("Business system not found");
    }
    system.status = "cancelled";
    system.updatedAt = timestamp();
    this.repository.persist();
    return system;
  }

  getSystemOverview(systemId: string) {
    const system = this.repository.systemProfiles.find((item) => item.id === systemId);
    if (!system) {
      throw new Error("Business system not found");
    }
    const pageModelIds = this.repository.pageModels
      .filter((item) => item.projectId === systemId)
      .map((item) => item.id);
    const trainingSessionIds = this.repository.trainingSessions
      .filter((item) => item.projectId === systemId)
      .map((item) => item.id);
    const authProfiles = this.repository.authProfiles.filter((item) => item.projectId === systemId);
    const generatedCases = this.repository.generatedCases.filter(
      (item) => item.projectId === systemId
    );
    const gaps = this.repository.gaps.filter((item) => item.projectId === systemId);
    const apiFlows = this.repository.apiFlows.filter((item) =>
      trainingSessionIds.includes(item.sessionId)
    );

    return {
      system,
      completeness: {
        authConfigured: authProfiles.length > 0,
        pageModeled: pageModelIds.length > 0,
        trainingEvidence: trainingSessionIds.length > 0 && apiFlows.length > 0,
        caseGenerated: generatedCases.length > 0,
        openGaps: gaps.filter((gap) => gap.status === "open").length
      },
      assetCounts: {
        authProfiles: authProfiles.length,
        systemExplorations: this.repository.systemExplorations.filter(
          (item) => item.systemId === systemId
        ).length,
        authCheckpoints: this.repository.authCheckpoints.filter((item) => item.systemId === systemId)
          .length,
        pageModels: pageModelIds.length,
        locatorPoints: this.repository.locatorPoints.filter((item) =>
          pageModelIds.includes(item.pageModelId)
        ).length,
        probeResults: this.repository.probeResults.filter((item) =>
          pageModelIds.includes(item.pageModelId)
        ).length,
        trainingSessions: trainingSessionIds.length,
        actionSteps: this.repository.actionSteps.filter((item) =>
          trainingSessionIds.includes(item.sessionId)
        ).length,
        apiFlows: apiFlows.length,
        generatedCases: generatedCases.length,
        gaps: gaps.length,
        glossaryTerms: this.repository.glossaryTerms.filter((item) => item.projectId === systemId)
          .length,
        businessRules: this.repository.businessRules.filter((item) => item.systemId === systemId)
          .length,
        testCases: this.repository.testCases.filter((item) => item.systemId === systemId).length,
        agentRuns: this.repository.agentRuns.filter((item) => item.systemId === systemId).length,
        chainRuns: this.repository.chainRuns.filter((item) => item.systemId === systemId).length
      }
    };
  }

  createAuthProfile(input: CreateAuthProfileInput): AuthProfile {
    const now = timestamp();
    const profile: AuthProfile = {
      id: id("auth"),
      projectId: input.projectId,
      env: input.env,
      role: input.role,
      loginMethod: input.loginMethod,
      encryptedSecrets: encryptSecrets(input.secrets),
      status: "pending",
      createdAt: now,
      updatedAt: now
    };

    this.repository.authProfiles.push(profile);
    this.repository.persist();
    return publicAuthProfile(profile);
  }

  verifyAuthProfile(
    idValue: string,
    verificationEvidence?: { targetUrl: string; finalUrl: string; title?: string }
  ): AuthProfile {
    const profile = this.repository.authProfiles.find((item) => item.id === idValue);
    if (!profile) {
      throw new Error("Auth profile not found");
    }

    profile.status = "succeeded";
    profile.lastVerifiedAt = timestamp();
    profile.failureReason = undefined;
    profile.verificationEvidence = verificationEvidence
      ? {
          status: "valid",
          targetUrl: verificationEvidence.targetUrl,
          finalUrl: verificationEvidence.finalUrl,
          title: verificationEvidence.title,
          verifiedAt: profile.lastVerifiedAt
        }
      : undefined;
    profile.updatedAt = profile.lastVerifiedAt;
    this.repository.persist();
    return publicAuthProfile(profile);
  }

  failAuthProfileVerification(idValue: string, reason: string): AuthProfile {
    const profile = this.repository.authProfiles.find((item) => item.id === idValue);
    if (!profile) {
      throw new Error("Auth profile not found");
    }
    profile.status = "failed";
    profile.failureReason = reason;
    profile.verificationEvidence = undefined;
    profile.updatedAt = timestamp();
    this.repository.persist();
    return publicAuthProfile(profile);
  }

  archiveAuthProfile(idValue: string): AuthProfile {
    const profile = this.repository.authProfiles.find((item) => item.id === idValue);
    if (!profile) {
      throw new Error("Auth profile not found");
    }
    profile.status = "cancelled";
    profile.failureReason = "Archived by user";
    profile.updatedAt = timestamp();
    this.repository.persist();
    return publicAuthProfile(profile);
  }

  listAuthProfiles(systemId: string): AuthProfile[] {
    return this.repository.authProfiles
      .filter((profile) => profile.projectId === systemId)
      .map((profile) => publicAuthProfile(profile));
  }

  createAuthCheckpoint(input: CreateAuthCheckpointInput): AuthCheckpoint {
    const system = this.repository.systemProfiles.find((item) => item.id === input.systemId);
    if (!system) {
      throw new Error("Business system not found");
    }
    const authProfile = this.repository.authProfiles.find((item) => item.id === input.authProfileId);
    if (!authProfile) {
      throw new Error("Auth profile not found");
    }
    if (authProfile.projectId !== input.systemId) {
      throw new Error("Auth profile belongs to another business system");
    }
    if (input.testCaseId) {
      const testCase = this.getTestCase(input.testCaseId);
      if (testCase.systemId !== input.systemId) {
        throw new Error("Test case belongs to another business system");
      }
    }
    const now = timestamp();
    const checkpoint: AuthCheckpoint = {
      id: id("checkpoint"),
      systemId: input.systemId,
      authProfileId: input.authProfileId,
      testCaseId: input.testCaseId,
      reason: input.reason.trim(),
      resumeInstruction: input.resumeInstruction.trim(),
      status: "awaiting-user",
      createdAt: now,
      updatedAt: now
    };
    this.repository.authCheckpoints.push(checkpoint);
    this.repository.persist();
    return checkpoint;
  }

  listAuthCheckpoints(systemId: string, status?: AuthCheckpoint["status"]): AuthCheckpoint[] {
    return this.repository.authCheckpoints.filter(
      (item) => item.systemId === systemId && (status === undefined || item.status === status)
    );
  }

  completeAuthCheckpoint(checkpointId: string): AuthCheckpoint {
    return this.setAuthCheckpointStatus(checkpointId, "completed");
  }

  cancelAuthCheckpoint(checkpointId: string): AuthCheckpoint {
    return this.setAuthCheckpointStatus(checkpointId, "cancelled");
  }

  getCaptureAuth(idValue?: string): PageCaptureAuth | undefined {
    if (!idValue) {
      return undefined;
    }
    const profile = this.repository.authProfiles.find((item) => item.id === idValue);
    if (!profile) {
      throw new Error("Auth profile not found");
    }
    return {
      loginMethod: profile.loginMethod,
      secrets: decryptSecrets(profile.encryptedSecrets)
    };
  }

  discoverPageModel(input: DiscoverPageInput): {
    pageModel: PageModel;
    locatorPoints: LocatorPoint[];
    probeResult: ProbeResult;
  } {
    this.assertAuthProfileMatchesProject(input.authProfileId, input.projectId);
    const now = timestamp();
    const capture = input.captureMode === "browser" ? input.browserCapture : undefined;
    const route = capture?.finalUrl ?? input.targetUrl ?? input.route;
    const previousVersion = this.repository.pageModels
      .filter((page) => page.projectId === input.projectId && page.route === route)
      .reduce((highest, page) => Math.max(highest, page.version), 0);
    const pageModel: PageModel = {
      id: id("page"),
      projectId: input.projectId,
      route,
      name: capture?.title || input.name,
      version: previousVersion + 1,
      domSnapshotId: id("dom"),
      screenshotId: capture?.screenshotPath ?? id("shot"),
      status: "succeeded",
      createdAt: now,
      updatedAt: now
    };

    const locatorPoints = capture
      ? locatorPointsFromCapture(pageModel.id, capture)
      : extractLocatorPoints(pageModel.id, input.domText);
    const issues = capture
      ? [
          ...capture.issues,
          ...capture.consoleErrors.map((error) => `Console error: ${error}`),
          ...capture.networkFailures.map((failure) => `Network failure: ${failure}`)
        ]
      : locatorPoints.length > 0
        ? []
        : ["No stable locator candidates found"];
    const probeResult: ProbeResult = {
      id: id("probe"),
      pageModelId: pageModel.id,
      type: capture ? "browser-capture" : "dom-scan",
      result: `${locatorPoints.length} locator points found`,
      issues,
      createdAt: now
    };

    this.repository.pageModels.push(pageModel);
    this.repository.locatorPoints.push(...locatorPoints);
    this.repository.probeResults.push(probeResult);

    if (locatorPoints.length === 0) {
      this.repository.gaps.push(
        this.createGap(input.projectId, "page-model", pageModel.id, "No locator evidence found")
      );
    }

    this.repository.persist();
    return { pageModel, locatorPoints, probeResult };
  }

  getPageModel(pageModelId: string) {
    const pageModel = this.repository.pageModels.find((item) => item.id === pageModelId);
    if (!pageModel) {
      throw new Error("Page model not found");
    }
    return {
      pageModel,
      locatorPoints: this.repository.locatorPoints.filter(
        (point) => point.pageModelId === pageModelId
      ),
      probeResults: this.repository.probeResults.filter(
        (probe) => probe.pageModelId === pageModelId
      )
    };
  }

  createTrainingSession(input: {
    projectId: string;
    pageModelId: string;
  }): TrainingSession {
    this.assertPageModelMatchesProject(input.pageModelId, input.projectId);
    const now = timestamp();
    const session: TrainingSession = {
      id: id("session"),
      projectId: input.projectId,
      pageModelId: input.pageModelId,
      videoUrl: `/artifacts/${input.projectId}/video-placeholder.webm`,
      traceUrl: `/artifacts/${input.projectId}/trace-placeholder.zip`,
      status: "running",
      createdAt: now,
      updatedAt: now
    };
    this.repository.trainingSessions.push(session);
    this.repository.persist();
    return session;
  }

  completeTrainingSession(input: CompleteTrainingInput): {
    session: TrainingSession;
    actionSteps: ActionStep[];
    apiFlow: ApiFlow;
    gaps: Gap[];
  } {
    const session = this.repository.trainingSessions.find(
      (item) => item.id === input.sessionId
    );
    if (!session) {
      throw new Error("Training session not found");
    }

    const actionSteps = input.actions.map<ActionStep>((action, index) => ({
      ...action,
      id: id("step"),
      sessionId: session.id,
      order: index + 1
    }));
    const apiFlow: ApiFlow = {
      id: id("flow"),
      sessionId: session.id,
      name: `API Flow for ${session.pageModelId}`,
      requests: input.apiRequests,
      dependencies: [],
      assertions: input.apiRequests.map((request) => `${request.method} ${request.url} ${request.status}`)
    };

    const gaps =
      input.artifacts && input.apiRequests.length === 0
        ? [
            this.createGap(
              session.projectId,
              "training-session",
              session.id,
              "No API requests captured during training"
            )
          ]
        : [];

    session.status = gaps.length > 0 ? "failed" : "succeeded";
    session.updatedAt = timestamp();
    if (input.artifacts) {
      session.traceUrl = input.artifacts.traceUrl;
      session.harUrl = input.artifacts.harUrl;
      session.screenshotUrl = input.artifacts.screenshotUrl;
    }
    this.repository.actionSteps.push(...actionSteps);
    this.repository.apiFlows.push(apiFlow);
    this.repository.gaps.push(...gaps);
    this.repository.persist();
    return { session, actionSteps, apiFlow, gaps };
  }

  failTrainingSession(sessionId: string, reason: string): {
    session: TrainingSession;
    gap: Gap;
  } {
    const session = this.repository.trainingSessions.find((item) => item.id === sessionId);
    if (!session) {
      throw new Error("Training session not found");
    }
    const gap = this.createGap(session.projectId, "training-session", session.id, reason);
    session.status = "failed";
    session.updatedAt = timestamp();
    this.repository.gaps.push(gap);
    this.repository.persist();
    return { session, gap };
  }

  generateCase(input: GenerateCaseInput): GeneratedCase {
    this.assertPageModelMatchesProject(input.pageModelId, input.projectId);
    const locators = this.repository.locatorPoints.filter(
      (point) => point.pageModelId === input.pageModelId
    );
    const matched = locators.filter((point) =>
      input.sourceRequirement.toLowerCase().includes(point.text.toLowerCase())
    );

    if (locators.length === 0 || matched.length === 0) {
      const gap = this.createGap(
        input.projectId,
        "generated-case",
        input.pageModelId,
        `No locator evidence can satisfy requirement: ${input.sourceRequirement}`
      );
      this.repository.gaps.push(gap);
      const blocked: GeneratedCase = {
        id: id("case"),
        projectId: input.projectId,
        sourceRequirement: input.sourceRequirement,
        pageModelId: input.pageModelId,
        steps: [],
        status: "blocked",
        gaps: [gap],
        createdAt: timestamp()
      };
      this.repository.generatedCases.push(blocked);
      this.repository.persist();
      return blocked;
    }

    const ready: GeneratedCase = {
      id: id("case"),
      projectId: input.projectId,
      sourceRequirement: input.sourceRequirement,
      pageModelId: input.pageModelId,
      steps: matched.map((point, index) => ({
        order: index + 1,
        instruction: `Use ${point.name}`,
        locatorPointId: point.id
      })),
      status: "ready",
      gaps: [],
      createdAt: timestamp()
    };
    this.repository.generatedCases.push(ready);
    this.repository.persist();
    return ready;
  }

  createGlossaryTerm(input: CreateGlossaryTermInput): GlossaryTerm {
    const now = timestamp();
    const term: GlossaryTerm = {
      id: id("term"),
      projectId: input.projectId,
      key: input.key.trim(),
      zhCN: input.zhCN.trim(),
      enUS: input.enUS.trim(),
      aliases: input.aliases.map((alias) => alias.trim()).filter(Boolean),
      pageScope: input.pageScope.trim(),
      createdAt: now,
      updatedAt: now
    };

    this.repository.glossaryTerms.push(term);
    this.repository.persist();
    return term;
  }

  listGlossaryTerms(input: SearchInput): GlossaryTerm[] {
    const query = input.query.toLowerCase();
    const includes = (value: string) => value.toLowerCase().includes(query);
    return this.repository.glossaryTerms.filter(
      (item) =>
        item.projectId === input.projectId &&
        includes(`${item.key} ${item.zhCN} ${item.enUS} ${item.aliases.join(" ")} ${item.pageScope}`)
    );
  }

  updateGlossaryTerm(input: UpdateGlossaryTermInput): GlossaryTerm {
    const term = this.repository.glossaryTerms.find((item) => item.id === input.termId);
    if (!term) {
      throw new Error("Glossary term not found");
    }
    if (term.projectId !== input.projectId) {
      throw new Error("Glossary term belongs to another business system");
    }

    term.key = input.key.trim();
    term.zhCN = input.zhCN.trim();
    term.enUS = input.enUS.trim();
    term.aliases = input.aliases.map((alias) => alias.trim()).filter(Boolean);
    term.pageScope = input.pageScope.trim();
    term.updatedAt = timestamp();
    this.repository.persist();
    return term;
  }

  deleteGlossaryTerm(input: DeleteGlossaryTermInput): GlossaryTerm {
    const index = this.repository.glossaryTerms.findIndex((item) => item.id === input.termId);
    if (index < 0) {
      throw new Error("Glossary term not found");
    }
    const [term] = this.repository.glossaryTerms.splice(index, 1);
    if (term.projectId !== input.projectId) {
      this.repository.glossaryTerms.splice(index, 0, term);
      throw new Error("Glossary term belongs to another business system");
    }
    this.repository.persist();
    return term;
  }

  confirmCandidateTerms(input: ConfirmCandidateTermsInput): {
    confirmedTerms: GlossaryTerm[];
    ignoredTerms: GlossaryTerm[];
    testCase: TestCase;
    glossaryTerms: GlossaryTerm[];
  } {
    const testCase = this.getTestCase(input.caseId);
    const confirmIds = new Set(input.confirmTermIds);
    const ignoreIds = new Set(input.ignoreTermIds);
    const confirmedTerms = testCase.newTerms.filter((term) => confirmIds.has(term.id));
    const ignoredTerms = testCase.newTerms.filter((term) => ignoreIds.has(term.id));
    const handledIds = new Set([...input.confirmTermIds, ...input.ignoreTermIds]);
    const now = timestamp();

    for (const term of confirmedTerms) {
      const exists = this.repository.glossaryTerms.some(
        (item) =>
          item.projectId === testCase.systemId &&
          (item.id === term.id || item.key === term.key || item.zhCN === term.zhCN)
      );
      if (!exists) {
        this.repository.glossaryTerms.push({
          ...term,
          projectId: testCase.systemId,
          updatedAt: now
        });
      }
    }

    testCase.newTerms = testCase.newTerms.filter((term) => !handledIds.has(term.id));
    testCase.updatedAt = now;
    this.repository.persist();
    return {
      confirmedTerms,
      ignoredTerms,
      testCase,
      glossaryTerms: this.listGlossaryTerms({ projectId: testCase.systemId, query: "" })
    };
  }

  createBusinessRule(input: CreateBusinessRuleInput): BusinessRule {
    const rule: BusinessRule = {
      id: id("rule"),
      systemId: input.systemId,
      name: input.name.trim(),
      condition: input.condition.trim(),
      severity: input.severity,
      createdAt: timestamp()
    };
    this.repository.businessRules.push(rule);
    this.repository.persist();
    return rule;
  }

  listBusinessRules(systemId: string): BusinessRule[] {
    return this.repository.businessRules.filter((rule) => rule.systemId === systemId);
  }

  deleteBusinessRule(input: DeleteBusinessRuleInput): BusinessRule {
    const index = this.repository.businessRules.findIndex((rule) => rule.id === input.ruleId);
    if (index < 0) {
      throw new Error("Business rule not found");
    }
    const [rule] = this.repository.businessRules.splice(index, 1);
    if (rule.systemId !== input.systemId) {
      this.repository.businessRules.splice(index, 0, rule);
      throw new Error("Business rule belongs to another business system");
    }
    this.repository.persist();
    return rule;
  }

  createTestCase(input: CreateTestCaseInput): TestCase {
    const now = timestamp();
    const testCase: TestCase = {
      id: id("case"),
      systemId: input.systemId,
      requirement: input.requirement.trim(),
      status: "draft",
      scenarios: input.scenarios,
      newTerms: input.newTerms,
      ruleCheckResult: input.ruleCheckResult,
      createdAt: now,
      updatedAt: now
    };
    this.repository.testCases.push(testCase);
    this.repository.persist();
    return testCase;
  }

  getTestCase(caseId: string): TestCase {
    const testCase = this.repository.testCases.find((item) => item.id === caseId);
    if (!testCase) {
      throw new Error("Test case not found");
    }
    return testCase;
  }

  listTestCases(systemId: string): TestCase[] {
    return this.repository.testCases.filter((testCase) => testCase.systemId === systemId);
  }

  approveTestCase(caseId: string): TestCase {
    const testCase = this.getTestCase(caseId);
    if (testCase.status !== "draft") {
      throw new Error("Only draft test cases can be approved");
    }
    testCase.status = "approved";
    testCase.updatedAt = timestamp();
    this.repository.persist();
    return testCase;
  }

  cancelTestCase(caseId: string, reason: string): { testCase: TestCase; gap: Gap } {
    const testCase = this.getTestCase(caseId);
    if (!["draft", "approved"].includes(testCase.status)) {
      throw new Error("Only draft or approved test cases can be cancelled");
    }
    const now = timestamp();
    testCase.status = "cancelled";
    testCase.cancellationReason = reason.trim();
    testCase.cancelledAt = now;
    testCase.updatedAt = now;
    const gap = this.reportGap({
      projectId: testCase.systemId,
      sourceType: "user-interruption",
      sourceId: testCase.id,
      reason: testCase.cancellationReason,
      severity: "medium",
      owner: "user"
    });
    this.repository.persist();
    return { testCase, gap };
  }

  resumeTestCase(caseId: string): { testCase: TestCase; resolvedGaps: Gap[] } {
    const testCase = this.getTestCase(caseId);
    if (testCase.status !== "cancelled") {
      throw new Error("Only cancelled test cases can be resumed");
    }
    const awaitingCheckpoints = this.repository.authCheckpoints.filter(
      (item) => item.testCaseId === caseId && item.status === "awaiting-user"
    );
    if (awaitingCheckpoints.length > 0) {
      throw new Error("Manual auth checkpoints must be completed or cancelled before resuming");
    }
    testCase.status = "draft";
    testCase.cancellationReason = undefined;
    testCase.cancelledAt = undefined;
    testCase.updatedAt = timestamp();
    const resolvedGaps = this.repository.gaps.filter(
      (gap) =>
        gap.projectId === testCase.systemId &&
        gap.sourceType === "user-interruption" &&
        gap.sourceId === caseId &&
        gap.status === "open"
    );
    for (const gap of resolvedGaps) {
      gap.status = "resolved";
      gap.updatedAt = testCase.updatedAt;
    }
    this.repository.persist();
    return { testCase, resolvedGaps };
  }

  updateTestCaseScenarios(caseId: string, scenarios: TestCaseScenario[]): TestCase {
    const testCase = this.getTestCase(caseId);
    if (testCase.status !== "draft") {
      throw new Error("Only draft test cases can be updated");
    }
    testCase.scenarios = scenarios;
    testCase.updatedAt = timestamp();
    this.repository.persist();
    return testCase;
  }

  recordAgentRun(run: AgentRun): void {
    this.repository.agentRuns.push(run);
    this.repository.persist();
  }

  createAgentTask(input: CreateAgentTaskInput): AgentTask {
    const now = timestamp();
    const task: AgentTask = {
      id: input.id,
      systemId: input.systemId,
      agent: input.agent,
      status: "pending",
      inputSummary: input.inputSummary,
      args: input.args,
      outputPaths: input.outputPaths,
      promptPath: input.promptPath,
      contextPath: input.contextPath,
      planContext: input.planContext,
      chainContext: input.chainContext,
      suiteContext: input.suiteContext,
      regressionContext: input.regressionContext,
      submitTool: "bc_submit_agent_output",
      createdAt: now,
      updatedAt: now
    };
    this.repository.agentTasks.push(task);
    this.repository.persist();
    return task;
  }

  submitAgentTask(input: SubmitAgentTaskInput): { task: AgentTask; agentRun: AgentRun } {
    const task = this.repository.agentTasks.find((item) => item.id === input.taskId);
    if (!task) {
      throw new Error("Agent task not found");
    }
    if (task.status !== "pending") {
      throw new Error("Agent task already submitted");
    }
    const now = timestamp();
    const logs = [input.stdout.trim(), input.stderr.trim()].filter(Boolean);
    const agentRun: AgentRun = {
      id: id("agent"),
      systemId: task.systemId,
      agent: task.agent,
      status: input.status === "succeeded" ? "succeeded" : "failed",
      inputSummary: task.inputSummary,
      outputPaths: input.outputPaths ?? task.outputPaths,
      duration: 0,
      logs,
      error: input.status === "failed" ? input.stderr || input.stdout || "Host agent task failed" : undefined,
      createdAt: now
    };
    task.status = input.status === "succeeded" ? "submitted" : "failed";
    task.submittedAt = now;
    task.updatedAt = now;
    task.agentRunId = agentRun.id;
    task.stdout = input.stdout;
    task.stderr = input.stderr;
    this.repository.agentRuns.push(agentRun);
    this.repository.persist();
    return { task, agentRun };
  }

  listAgentTasks(systemId: string): AgentTask[] {
    return this.repository.agentTasks.filter((task) => task.systemId === systemId);
  }

  getAgentRun(runId: string): AgentRun {
    const run = this.repository.agentRuns.find((item) => item.id === runId);
    if (!run) {
      throw new Error("Agent run not found");
    }
    return run;
  }

  listAgentRuns(systemId: string): AgentRun[] {
    return this.repository.agentRuns.filter((run) => run.systemId === systemId);
  }

  recordChainRun(run: ChainRun): void {
    this.repository.chainRuns.push(run);
    const testCase = this.repository.testCases.find((item) => item.id === run.testCaseId);
    if (testCase) {
      testCase.chainRunId = run.id;
      if (run.status === "succeeded") {
        testCase.status = "passed";
      }
      if (run.status === "failed") {
        testCase.status = "failed";
      }
      testCase.updatedAt = run.completedAt ?? timestamp();
    }
    this.repository.persist();
  }

  getChainRun(chainId: string): ChainRun {
    const run = this.repository.chainRuns.find((item) => item.id === chainId);
    if (!run) {
      throw new Error("Chain run not found");
    }
    return run;
  }

  listChainRuns(systemId: string): ChainRun[] {
    return this.repository.chainRuns.filter((run) => run.systemId === systemId);
  }

  listTestSpecs(systemId: string): TestArtifact[] {
    return this.listTestArtifacts(systemId, "test-spec");
  }

  listTestFiles(systemId: string): TestArtifact[] {
    return this.listTestArtifacts(systemId, "test-file");
  }

  searchAssets(input: SearchInput): AssetSearchResult[] {
    const query = input.query.toLowerCase();
    const includes = (value: string) => value.toLowerCase().includes(query);
    const inProject = (projectId: string) => projectId === input.projectId;

    const systems = this.repository.systemProfiles
      .filter((item) => item.id === input.projectId || includes(`${item.name} ${item.environment} ${item.baseUrl}`))
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "system-profile",
        label: item.name,
        projectId: item.id,
        status: item.status
      }))
      .filter((item) => item.projectId === input.projectId || input.projectId === "all");

    const authCheckpoints = this.repository.authCheckpoints
      .filter(
        (item) =>
          inProject(item.systemId) &&
          includes(`${item.reason} ${item.resumeInstruction} ${item.status}`)
      )
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "auth-checkpoint",
        label: item.reason,
        projectId: item.systemId,
        status: item.status
      }));

    const pageModels = this.repository.pageModels
      .filter((item) => inProject(item.projectId) && includes(`${item.name} ${item.route}`))
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "page-model",
        label: item.name,
        projectId: item.projectId,
        status: item.status
      }));

    const locators = this.repository.locatorPoints
      .filter((item) => {
        const page = this.repository.pageModels.find((model) => model.id === item.pageModelId);
        return page ? inProject(page.projectId) && includes(`${item.name} ${item.text}`) : false;
      })
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "locator-point",
        label: item.name,
        projectId: input.projectId
      }));

    const sessions = this.repository.trainingSessions
      .filter((item) => inProject(item.projectId))
      .filter((item) => {
        const page = this.repository.pageModels.find((model) => model.id === item.pageModelId);
        return page ? includes(page.name) || includes(page.route) : true;
      })
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "training-session",
        label: `Training ${item.id}`,
        projectId: item.projectId,
        status: item.status
      }));

    const apiFlows = this.repository.apiFlows
      .filter((item) => includes(`${item.name} ${item.requests.map((request) => request.url).join(" ")}`))
      .map<AssetSearchResult>((item) => {
        const session = this.repository.trainingSessions.find(
          (training) => training.id === item.sessionId
        );
        return {
          id: item.id,
          type: "api-flow",
          label: item.name,
          projectId: session?.projectId ?? input.projectId
        };
      })
      .filter((item) => inProject(item.projectId));

    const cases = this.repository.generatedCases
      .filter((item) => inProject(item.projectId) && includes(item.sourceRequirement))
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "generated-case",
        label: item.sourceRequirement,
        projectId: item.projectId,
        status: item.status
      }));

    const gaps = this.repository.gaps
      .filter((item) => inProject(item.projectId) && includes(item.reason))
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "gap",
        label: item.reason,
        projectId: item.projectId,
        status: item.status
      }));

    const glossaryTerms = this.repository.glossaryTerms
      .filter(
        (item) =>
          inProject(item.projectId) &&
          includes(`${item.key} ${item.zhCN} ${item.enUS} ${item.aliases.join(" ")} ${item.pageScope}`)
      )
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "glossary-term",
        label: item.key,
        projectId: item.projectId
      }));

    const businessRules = this.repository.businessRules
      .filter(
        (item) =>
          inProject(item.systemId) && includes(`${item.name} ${item.condition} ${item.severity}`)
      )
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "business-rule",
        label: item.name,
        projectId: item.systemId,
        status: item.severity
      }));

    const testCases = this.repository.testCases
      .filter(
        (item) =>
          inProject(item.systemId) &&
          includes(
            `${item.requirement} ${item.scenarios.map((scenario) => scenario.title).join(" ")}`
          )
      )
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "test-case",
        label: item.requirement,
        projectId: item.systemId,
        status: item.status
      }));

    const agentRuns = this.repository.agentRuns
      .filter(
        (item) =>
          inProject(item.systemId) &&
          includes(`${item.agent} ${item.inputSummary} ${item.outputPaths.join(" ")}`)
      )
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "agent-run",
        label: `${item.agent} ${item.inputSummary}`,
        projectId: item.systemId,
        status: item.status
      }));

    const chainRuns = this.repository.chainRuns
      .filter((item) => {
        const testCase = this.repository.testCases.find(
          (candidate) => candidate.id === item.testCaseId
        );
        return (
          inProject(item.systemId) &&
          includes(
            `${item.testCaseId} ${testCase?.requirement ?? ""} ${item.specPath ?? ""} ${
              item.testPath ?? ""
            }`
          )
        );
      })
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "chain-run",
        label: `Chain run for ${item.testCaseId}`,
        projectId: item.systemId,
        status: item.status
      }));

    const caseSources = this.repository.caseSources
      .filter(
        (item) =>
          inProject(item.systemId) &&
          includes(
            `${item.source} ${item.sourceType} ${JSON.stringify(item.moduleStats)} ${JSON.stringify(
              item.priorityStats
            )}`
          )
      )
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "case-source",
        label: item.source,
        projectId: item.systemId,
        status: item.status
      }));

    const caseSuites = this.repository.caseSuites
      .filter((item) => inProject(item.systemId) && includes(`${item.id} ${item.status}`))
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "case-suite",
        label: `Case suite ${item.id}`,
        projectId: item.systemId,
        status: item.status
      }));

    const caseSuiteRuns = this.repository.caseSuiteRuns
      .filter((item) => inProject(item.systemId) && includes(`${item.id} ${item.status}`))
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "case-suite-run",
        label: `Case suite run ${item.id}`,
        projectId: item.systemId,
        status: item.status
      }));

    const bugReports = this.repository.bugReports
      .filter(
        (item) =>
          inProject(item.systemId) &&
          includes(
            `${item.caseNo} ${item.caseTitle} ${item.module} ${item.expectedResult} ${item.actualResult}`
          )
      )
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "bug-report",
        label: `${item.caseNo} ${item.caseTitle}`,
        projectId: item.systemId,
        status: item.status
      }));
    const systemExplorations = this.repository.systemExplorations
      .filter(
        (item) =>
          inProject(item.systemId) &&
          includes(
            `${item.startUrl} ${item.status} ${item.warnings.join(" ")} ${item.navigationEdges
              .map((edge) => `${edge.text} ${edge.fromUrl} ${edge.toUrl}`)
              .join(" ")}`
          )
      )
      .map<AssetSearchResult>((item) => ({
        id: item.id,
        type: "system-exploration",
        label: `System exploration ${item.startUrl}`,
        projectId: item.systemId,
        status: item.status
      }));

    return [
      ...systems,
      ...authCheckpoints,
      ...pageModels,
      ...locators,
      ...sessions,
      ...apiFlows,
      ...cases,
      ...gaps,
      ...glossaryTerms,
      ...businessRules,
      ...testCases,
      ...agentRuns,
      ...chainRuns,
      ...caseSources,
      ...caseSuites,
      ...caseSuiteRuns,
      ...bugReports,
      ...systemExplorations
    ];
  }

  getAssetDetail(input: AssetDetailInput) {
    if (input.type === "page-model") {
      const pageModel = this.repository.pageModels.find((item) => item.id === input.id);
      if (!pageModel) {
        throw new Error("Asset not found");
      }
      if (pageModel.projectId !== input.projectId) {
        throw new Error("Asset belongs to another business system");
      }
      const trainingSessions = this.repository.trainingSessions.filter(
        (item) => item.pageModelId === pageModel.id && item.projectId === input.projectId
      );
      const sessionIds = trainingSessions.map((session) => session.id);
      return {
        type: input.type,
        asset: pageModel,
        related: {
          locatorPoints: this.repository.locatorPoints.filter(
            (item) => item.pageModelId === pageModel.id
          ),
          probeResults: this.repository.probeResults.filter(
            (item) => item.pageModelId === pageModel.id
          ),
          trainingSessions,
          actionSteps: this.repository.actionSteps.filter((item) =>
            sessionIds.includes(item.sessionId)
          ),
          apiFlows: this.repository.apiFlows.filter((item) =>
            sessionIds.includes(item.sessionId)
          ),
          generatedCases: this.repository.generatedCases.filter(
            (item) => item.pageModelId === pageModel.id && item.projectId === input.projectId
          ),
          gaps: this.repository.gaps.filter(
            (item) => item.projectId === input.projectId && item.sourceId === pageModel.id
          )
        }
      };
    }

    const asset = this.findAsset(input);
    return {
      type: input.type,
      asset,
      related: {}
    };
  }

  listGaps(input: ListGapsInput): Gap[] {
    return this.repository.gaps.filter(
      (gap) =>
        gap.projectId === input.projectId &&
        (input.status === undefined || gap.status === input.status)
    );
  }

  reportGap(input: ReportGapInput): Gap {
    const system = this.repository.systemProfiles.find((item) => item.id === input.projectId);
    if (!system) {
      throw new Error("Business system not found");
    }
    const gap = this.createGap(
      input.projectId,
      input.sourceType,
      input.sourceId,
      input.reason,
      input.severity,
      input.owner
    );
    this.repository.gaps.push(gap);
    this.repository.persist();
    return gap;
  }

  resolveGap(input: ResolveGapInput): Gap {
    return this.transitionGap({
      ...input,
      operation: "resolve",
      note: "Resolved through the legacy gap control.",
      evidenceRefs: []
    });
  }

  transitionGap(input: TransitionGapInput): Gap {
    const gap = this.repository.gaps.find((item) => item.id === input.gapId);
    if (!gap) {
      throw new Error("Gap not found");
    }
    if (gap.projectId !== input.projectId) {
      throw new Error("Gap belongs to another business system");
    }

    const note = input.note.trim();
    if (!note) {
      throw new Error("Gap transition note is required");
    }
    if (input.operation === "reopen" && gap.status === "open") {
      throw new Error("Gap is already open");
    }
    if (input.operation !== "reopen" && gap.status !== "open") {
      throw new Error("Only open gaps can be resolved or dismissed");
    }

    const now = timestamp();
    gap.status =
      input.operation === "resolve"
        ? "resolved"
        : input.operation === "dismiss"
          ? "dismissed"
          : "open";
    gap.lifecycle = [
      ...(gap.lifecycle ?? []),
      {
        operation: input.operation,
        note,
        evidenceRefs: [...new Set(input.evidenceRefs)],
        createdAt: now
      }
    ];
    gap.updatedAt = now;
    this.repository.persist();
    return { ...gap, lifecycle: gap.lifecycle.map((entry) => ({ ...entry })) };
  }

  private createGap(
    projectId: string,
    sourceType: string,
    sourceId: string,
    reason: string,
    severity: Gap["severity"] = "high",
    owner = "qa"
  ): Gap {
    const now = timestamp();
    return {
      id: id("gap"),
      projectId,
      sourceType,
      sourceId,
      reason,
      severity,
      owner,
      status: "open",
      createdAt: now,
      updatedAt: now
    };
  }

  private setAuthCheckpointStatus(
    checkpointId: string,
    status: Extract<AuthCheckpoint["status"], "completed" | "cancelled">
  ): AuthCheckpoint {
    const checkpoint = this.repository.authCheckpoints.find((item) => item.id === checkpointId);
    if (!checkpoint) {
      throw new Error("Auth checkpoint not found");
    }
    if (checkpoint.status !== "awaiting-user") {
      throw new Error("Only awaiting-user auth checkpoints can be updated");
    }
    const now = timestamp();
    checkpoint.status = status;
    checkpoint.updatedAt = now;
    checkpoint.completedAt = now;
    this.repository.persist();
    return checkpoint;
  }

  private assertAuthProfileMatchesProject(authProfileId: string | undefined, projectId: string) {
    if (!authProfileId) {
      return;
    }
    const profile = this.repository.authProfiles.find((item) => item.id === authProfileId);
    if (profile && profile.projectId !== projectId) {
      throw new Error("Auth profile belongs to another business system");
    }
  }

  private assertPageModelMatchesProject(pageModelId: string, projectId: string) {
    const pageModel = this.repository.pageModels.find((item) => item.id === pageModelId);
    if (pageModel && pageModel.projectId !== projectId) {
      throw new Error("Page model belongs to another business system");
    }
  }

  private findAsset(input: AssetDetailInput) {
    const pageIds = this.repository.pageModels
      .filter((item) => item.projectId === input.projectId)
      .map((item) => item.id);
    const sessionIds = this.repository.trainingSessions
      .filter((item) => item.projectId === input.projectId)
      .map((item) => item.id);
    const candidates: Record<string, unknown[]> = {
      "system-profile": this.repository.systemProfiles.filter((item) => item.id === input.projectId),
      "auth-profile": this.repository.authProfiles.filter((item) => item.projectId === input.projectId),
      "auth-checkpoint": this.repository.authCheckpoints.filter(
        (item) => item.systemId === input.projectId
      ),
      "system-exploration": this.repository.systemExplorations.filter(
        (item) => item.systemId === input.projectId
      ),
      "locator-point": this.repository.locatorPoints.filter((item) =>
        pageIds.includes(item.pageModelId)
      ),
      "training-session": this.repository.trainingSessions.filter(
        (item) => item.projectId === input.projectId
      ),
      "api-flow": this.repository.apiFlows.filter((item) => sessionIds.includes(item.sessionId)),
      "generated-case": this.repository.generatedCases.filter(
        (item) => item.projectId === input.projectId
      ),
      gap: this.repository.gaps.filter((item) => item.projectId === input.projectId),
      "glossary-term": this.repository.glossaryTerms.filter(
        (item) => item.projectId === input.projectId
      ),
      "business-rule": this.repository.businessRules.filter(
        (item) => item.systemId === input.projectId
      ),
      "test-case": this.repository.testCases.filter((item) => item.systemId === input.projectId),
      "agent-run": this.repository.agentRuns.filter((item) => item.systemId === input.projectId),
      "chain-run": this.repository.chainRuns.filter((item) => item.systemId === input.projectId),
      "case-source": this.repository.caseSources.filter((item) => item.systemId === input.projectId),
      "case-suite": this.repository.caseSuites.filter((item) => item.systemId === input.projectId),
      "case-suite-run": this.repository.caseSuiteRuns.filter(
        (item) => item.systemId === input.projectId
      ),
      "bug-report": this.repository.bugReports.filter((item) => item.systemId === input.projectId)
    };
    const asset = candidates[input.type]?.find(
      (item) => (item as { id?: string }).id === input.id
    );
    if (!asset) {
      throw new Error("Asset not found");
    }
    return asset;
  }

  private listTestArtifacts(
    systemId: string,
    type: TestArtifact["type"]
  ): TestArtifact[] {
    const byPath = new Map<string, TestArtifact>();
    const add = (artifact: TestArtifact) => {
      const existing = byPath.get(artifact.path);
      if (!existing || (!existing.testCaseId && artifact.testCaseId)) {
        byPath.set(artifact.path, artifact);
      }
    };

    for (const run of this.repository.agentRuns.filter((item) => item.systemId === systemId)) {
      run.outputPaths
        .filter((path) => matchesArtifactType(path, type))
        .forEach((path, index) =>
          add({
            id: `${type}_${run.id}_${index + 1}`,
            systemId,
            type,
            path,
            sourceType: "agent-run",
            sourceId: run.id,
            status: run.status,
            createdAt: run.createdAt
          })
        );
    }

    for (const run of this.repository.chainRuns.filter((item) => item.systemId === systemId)) {
      const path = type === "test-spec" ? run.specPath : run.testPath;
      if (path) {
        add({
          id: `${type}_${run.id}`,
          systemId,
          type,
          path,
          sourceType: "chain-run",
          sourceId: run.id,
          status: run.status,
          createdAt: run.completedAt ?? run.createdAt,
          testCaseId: run.testCaseId
        });
      }
    }

    return [...byPath.values()];
  }
}

function matchesArtifactType(path: string, type: TestArtifact["type"]) {
  const lowerPath = path.toLowerCase();
  if (type === "test-spec") {
    return lowerPath.endsWith(".md") || lowerPath.endsWith(".markdown");
  }
  return lowerPath.endsWith(".spec.ts");
}

function documentCaseToScenario(documentCase: DocumentCase): TestCaseScenario {
  const steps: TestCaseStep[] = [];
  if (documentCase.precondition.trim()) {
    steps.push({ action: "wait", target: documentCase.precondition.trim() });
  }
  for (const step of documentCase.steps) {
    steps.push({ action: "click", target: step });
  }
  if (documentCase.expectedResult.trim()) {
    steps.push({
      action: "assert",
      target: documentCase.title,
      expected: documentCase.expectedResult.trim()
    });
  }
  return {
    id: id("scenario"),
    title: `${documentCase.caseNo} ${documentCase.title}`.trim(),
    priority: documentPriority(documentCase.priority),
    steps
  };
}

function documentPriority(priority: string): TestCaseScenario["priority"] {
  const normalized = priority.trim().toUpperCase();
  if (normalized === "P0") {
    return "critical";
  }
  if (normalized === "P1") {
    return "high";
  }
  if (normalized === "P3") {
    return "low";
  }
  return "medium";
}

function assertHttpUrl(value: string, fieldName: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${fieldName} must use http or https`);
  }
}

function publicAuthProfile(profile: AuthProfile): AuthProfile {
  return {
    ...profile,
    encryptedSecrets: redactSecrets(profile.encryptedSecrets)
  };
}

function extractLocatorPoints(pageModelId: string, domText: string): LocatorPoint[] {
  return actionTerms
    .sort((left, right) => right.length - left.length)
    .filter((term) => domText.toLowerCase().includes(term.toLowerCase()))
    .filter((term, index, terms) => {
      const lower = term.toLowerCase();
      return !terms.slice(0, index).some((previous) => previous.toLowerCase().includes(lower));
    })
    .map((term) => ({
      id: id("locator"),
      pageModelId,
      name: term,
      selector: `[data-brain-label="${slug(term)}"]`,
      role: term === "Search" ? "searchbox" : "button",
      text: term,
      fallbackSelectors: [`text=${term}`, `role=${term === "Search" ? "searchbox" : "button"}`],
      confidence: 0.92
    }));
}

function locatorPointsFromCapture(
  pageModelId: string,
  capture: PageCaptureEvidence
): LocatorPoint[] {
  return capture.interactiveElements.map((element) => ({
    id: id("locator"),
    pageModelId,
    name: element.name,
    selector: element.selector,
    role: element.role,
    text: element.text || element.name,
    fallbackSelectors: [element.selector, `text=${element.text || element.name}`],
    confidence: 0.96
  }));
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function timestamp() {
  return new Date().toISOString();
}
