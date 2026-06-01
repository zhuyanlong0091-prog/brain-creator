import { InMemoryBrainCreatorRepository } from "./repository.js";
import { decryptSecrets, encryptSecrets, redactSecrets } from "../shared/crypto.js";
import { id } from "../shared/id.js";
import type {
  ActionStep,
  AgentRun,
  ApiFlow,
  ApiRequest,
  AssetSearchResult,
  AuthProfile,
  BusinessRule,
  ChainRun,
  Gap,
  GeneratedCase,
  GlossaryTerm,
  LocatorPoint,
  PageModel,
  ProbeResult,
  RuleCheckResult,
  SystemProfile,
  TestCase,
  TestCaseScenario,
  TrainingSession
} from "./types.js";

type PageCaptureAuth = {
  loginMethod: AuthProfile["loginMethod"];
  secrets: Record<string, string>;
};

type PageCaptureResult = {
  title: string;
  finalUrl: string;
  domText: string;
  screenshotPath: string;
  interactiveElements: Array<{
    name: string;
    role: string;
    text: string;
    selector: string;
  }>;
  consoleErrors: string[];
  networkFailures: string[];
  issues: string[];
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

type DiscoverPageInput = {
  projectId: string;
  route: string;
  name: string;
  authProfileId: string;
  domText: string;
  captureMode?: "manual" | "browser";
  targetUrl?: string;
  browserCapture?: PageCaptureResult;
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

type CreateTestCaseInput = {
  systemId: string;
  requirement: string;
  scenarios: TestCaseScenario[];
  newTerms: TestCase["newTerms"];
  ruleCheckResult: RuleCheckResult;
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

  verifyAuthProfile(idValue: string): AuthProfile {
    const profile = this.repository.authProfiles.find((item) => item.id === idValue);
    if (!profile) {
      throw new Error("Auth profile not found");
    }

    profile.status = "succeeded";
    profile.lastVerifiedAt = timestamp();
    profile.updatedAt = profile.lastVerifiedAt;
    this.repository.persist();
    return publicAuthProfile(profile);
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
    const pageModel: PageModel = {
      id: id("page"),
      projectId: input.projectId,
      route: capture?.finalUrl ?? input.targetUrl ?? input.route,
      name: capture?.title || input.name,
      version: 1,
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

  deleteBusinessRule(ruleId: string): void {
    const originalLength = this.repository.businessRules.length;
    this.repository.businessRules = this.repository.businessRules.filter(
      (rule) => rule.id !== ruleId
    );
    if (this.repository.businessRules.length === originalLength) {
      throw new Error("Business rule not found");
    }
    this.repository.persist();
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
    testCase.status = "approved";
    testCase.updatedAt = timestamp();
    this.repository.persist();
    return testCase;
  }

  updateTestCaseScenarios(caseId: string, scenarios: TestCaseScenario[]): TestCase {
    const testCase = this.getTestCase(caseId);
    testCase.scenarios = scenarios;
    testCase.updatedAt = timestamp();
    this.repository.persist();
    return testCase;
  }

  recordAgentRun(run: AgentRun): void {
    this.repository.agentRuns.push(run);
    this.repository.persist();
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

    return [
      ...systems,
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
      ...chainRuns
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

  resolveGap(gapId: string): Gap {
    const gap = this.repository.gaps.find((item) => item.id === gapId);
    if (!gap) {
      throw new Error("Gap not found");
    }

    gap.status = "resolved";
    gap.updatedAt = timestamp();
    this.repository.persist();
    return gap;
  }

  private createGap(projectId: string, sourceType: string, sourceId: string, reason: string): Gap {
    const now = timestamp();
    return {
      id: id("gap"),
      projectId,
      sourceType,
      sourceId,
      reason,
      severity: "high",
      owner: "qa",
      status: "open",
      createdAt: now,
      updatedAt: now
    };
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
      "chain-run": this.repository.chainRuns.filter((item) => item.systemId === input.projectId)
    };
    const asset = candidates[input.type]?.find(
      (item) => (item as { id?: string }).id === input.id
    );
    if (!asset) {
      throw new Error("Asset not found");
    }
    return asset;
  }
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
  capture: PageCaptureResult
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
