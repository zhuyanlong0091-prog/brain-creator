import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ActionStep,
  AgentRun,
  AgentTask,
  ApiFlow,
  AuthCheckpoint,
  AuthProfile,
  BugReport,
  BusinessRule,
  CaseSource,
  CaseSuite,
  CaseSuiteRun,
  ChainRun,
  CompileRun,
  Gap,
  GeneratedCase,
  GlossaryTerm,
  ExecutableCase,
  ExecutionDiagnosis,
  ExecutionDiagnosisReview,
  ExecutionPlan,
  ExecutionEvidence,
  KnowledgeEdge,
  KnowledgeNode,
  KnowledgeProject,
  LocatorPoint,
  PageModel,
  PageBindingDecision,
  ProbeResult,
  RequirementSet,
  RequirementSuiteRun,
  RunLedgerEntry,
  RequirementSource,
  SystemProfile,
  SystemExploration,
  TestDataLease,
  TestDataProfile,
  TestDataTask,
  TestIntent,
  TestCase,
  TrainingSession
} from "./types.js";

export const CURRENT_REPOSITORY_SCHEMA_VERSION = 16;

export class InMemoryBrainCreatorRepository {
  schemaVersion = CURRENT_REPOSITORY_SCHEMA_VERSION;
  systemProfiles: SystemProfile[] = [];
  systemExplorations: SystemExploration[] = [];
  authProfiles: AuthProfile[] = [];
  authCheckpoints: AuthCheckpoint[] = [];
  pageModels: PageModel[] = [];
  locatorPoints: LocatorPoint[] = [];
  probeResults: ProbeResult[] = [];
  trainingSessions: TrainingSession[] = [];
  actionSteps: ActionStep[] = [];
  apiFlows: ApiFlow[] = [];
  generatedCases: GeneratedCase[] = [];
  gaps: Gap[] = [];
  glossaryTerms: GlossaryTerm[] = [];
  businessRules: BusinessRule[] = [];
  testCases: TestCase[] = [];
  agentRuns: AgentRun[] = [];
  agentTasks: AgentTask[] = [];
  chainRuns: ChainRun[] = [];
  caseSources: CaseSource[] = [];
  caseSuites: CaseSuite[] = [];
  caseSuiteRuns: CaseSuiteRun[] = [];
  bugReports: BugReport[] = [];
  knowledgeProjects: KnowledgeProject[] = [];
  requirementSources: RequirementSource[] = [];
  requirementSets: RequirementSet[] = [];
  knowledgeNodes: KnowledgeNode[] = [];
  knowledgeEdges: KnowledgeEdge[] = [];
  testIntents: TestIntent[] = [];
  testDataProfiles: TestDataProfile[] = [];
  testDataTasks: TestDataTask[] = [];
  testDataLeases: TestDataLease[] = [];
  executableCases: ExecutableCase[] = [];
  executionPlans: ExecutionPlan[] = [];
  requirementSuiteRuns: RequirementSuiteRun[] = [];
  executionEvidence: ExecutionEvidence[] = [];
  executionDiagnoses: ExecutionDiagnosis[] = [];
  executionDiagnosisReviews: ExecutionDiagnosisReview[] = [];
  runLedgerEntries: RunLedgerEntry[] = [];
  compileRuns: CompileRun[] = [];
  pageBindingDecisions: PageBindingDecision[] = [];

  persist() {
    return;
  }

  reload() {
    return repositoryCounts(this);
  }

  reset() {
    this.systemProfiles = [];
    this.systemExplorations = [];
    this.authProfiles = [];
    this.authCheckpoints = [];
    this.pageModels = [];
    this.locatorPoints = [];
    this.probeResults = [];
    this.trainingSessions = [];
    this.actionSteps = [];
    this.apiFlows = [];
    this.generatedCases = [];
    this.gaps = [];
    this.glossaryTerms = [];
    this.businessRules = [];
    this.testCases = [];
    this.agentRuns = [];
    this.agentTasks = [];
    this.chainRuns = [];
    this.caseSources = [];
    this.caseSuites = [];
    this.caseSuiteRuns = [];
    this.bugReports = [];
    this.knowledgeProjects = [];
    this.requirementSources = [];
    this.requirementSets = [];
    this.knowledgeNodes = [];
    this.knowledgeEdges = [];
    this.testIntents = [];
    this.testDataProfiles = [];
    this.testDataTasks = [];
    this.testDataLeases = [];
    this.executableCases = [];
    this.executionPlans = [];
    this.requirementSuiteRuns = [];
    this.executionEvidence = [];
    this.executionDiagnoses = [];
    this.executionDiagnosisReviews = [];
    this.runLedgerEntries = [];
    this.compileRuns = [];
    this.pageBindingDecisions = [];
    this.persist();
  }
}

type RepositorySnapshot = Pick<
  InMemoryBrainCreatorRepository,
  | "systemProfiles"
  | "systemExplorations"
  | "authProfiles"
  | "authCheckpoints"
  | "pageModels"
  | "locatorPoints"
  | "probeResults"
  | "trainingSessions"
  | "actionSteps"
  | "apiFlows"
  | "generatedCases"
  | "gaps"
  | "glossaryTerms"
  | "businessRules"
  | "testCases"
  | "agentRuns"
  | "agentTasks"
  | "chainRuns"
  | "caseSources"
  | "caseSuites"
  | "caseSuiteRuns"
  | "bugReports"
  | "schemaVersion"
  | "knowledgeProjects"
  | "requirementSources"
  | "requirementSets"
  | "knowledgeNodes"
  | "knowledgeEdges"
  | "testIntents"
  | "testDataProfiles"
  | "testDataTasks"
  | "testDataLeases"
  | "executableCases"
  | "executionPlans"
  | "requirementSuiteRuns"
  | "executionEvidence"
  | "executionDiagnoses"
  | "executionDiagnosisReviews"
  | "runLedgerEntries"
  | "compileRuns"
  | "pageBindingDecisions"
>;

export class JsonFileBrainCreatorRepository extends InMemoryBrainCreatorRepository {
  constructor(private readonly filePath: string) {
    super();
    this.restore();
  }

  override persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.snapshot(), null, 2), "utf8");
  }

  override reload() {
    if (!existsSync(this.filePath)) {
      throw new Error("Brain Creator store file not found");
    }
    this.restore();
    return repositoryCounts(this);
  }

  private restore() {
    if (!existsSync(this.filePath)) {
      return;
    }
    const snapshot = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<RepositorySnapshot>;
    assertRepositorySnapshot(snapshot);
    this.schemaVersion = CURRENT_REPOSITORY_SCHEMA_VERSION;
    this.systemProfiles = snapshot.systemProfiles ?? [];
    this.systemExplorations = (snapshot.systemExplorations ?? []).map((exploration) => ({
      ...exploration,
      interactionMode: exploration.interactionMode ?? "off",
      budget: {
        ...exploration.budget,
        maxInteractionsPerPage: exploration.budget.maxInteractionsPerPage ?? 0
      },
      interactionTransitions: (exploration.interactionTransitions ?? []).map((transition) => ({
        ...transition,
        targetKind:
          transition.targetKind ??
          (transition.action === "select"
            ? "select"
            : transition.targetRole.toLowerCase() === "tab"
              ? "tab"
              : "disclosure")
      }))
    }));
    this.authProfiles = snapshot.authProfiles ?? [];
    this.authCheckpoints = snapshot.authCheckpoints ?? [];
    this.pageModels = snapshot.pageModels ?? [];
    this.locatorPoints = snapshot.locatorPoints ?? [];
    this.probeResults = snapshot.probeResults ?? [];
    this.trainingSessions = snapshot.trainingSessions ?? [];
    this.actionSteps = snapshot.actionSteps ?? [];
    this.apiFlows = snapshot.apiFlows ?? [];
    this.generatedCases = snapshot.generatedCases ?? [];
    this.gaps = snapshot.gaps ?? [];
    this.glossaryTerms = snapshot.glossaryTerms ?? [];
    this.businessRules = snapshot.businessRules ?? [];
    this.testCases = snapshot.testCases ?? [];
    this.agentRuns = snapshot.agentRuns ?? [];
    this.agentTasks = snapshot.agentTasks ?? [];
    this.chainRuns = snapshot.chainRuns ?? [];
    this.caseSources = snapshot.caseSources ?? [];
    this.caseSuites = snapshot.caseSuites ?? [];
    this.caseSuiteRuns = snapshot.caseSuiteRuns ?? [];
    this.bugReports = snapshot.bugReports ?? [];
    this.knowledgeProjects = snapshot.knowledgeProjects ?? [];
    this.requirementSources = snapshot.requirementSources ?? [];
    this.requirementSets = snapshot.requirementSets ?? [];
    this.knowledgeNodes = snapshot.knowledgeNodes ?? [];
    this.knowledgeEdges = snapshot.knowledgeEdges ?? [];
    this.testIntents = snapshot.testIntents ?? [];
    this.testDataProfiles = snapshot.testDataProfiles ?? [];
    this.testDataTasks = snapshot.testDataTasks ?? [];
    this.testDataLeases = snapshot.testDataLeases ?? [];
    this.executableCases = snapshot.executableCases ?? [];
    this.executionPlans = snapshot.executionPlans ?? [];
    this.requirementSuiteRuns = (snapshot.requirementSuiteRuns ?? []).map(
      (run) => ({
        ...run,
        allowCreateTestData: run.allowCreateTestData ?? false,
        skipped: run.skipped ?? 0,
        cancelled: run.cancelled ?? 0,
        caseRuns: run.caseRuns.map((caseRun) => ({
          ...caseRun,
          attempts: caseRun.attempts ?? []
        }))
      })
    );
    this.executionEvidence = snapshot.executionEvidence ?? [];
    this.executionDiagnoses = (snapshot.executionDiagnoses ?? []).map(
      (diagnosis) => ({
        ...diagnosis,
        gapIds: diagnosis.gapIds ?? []
      })
    );
    this.executionDiagnosisReviews = (snapshot.executionDiagnosisReviews ?? []).map(
      (review) => {
        const adjudicated = review.decision !== "needs_evidence";
        return {
          ...review,
          confirmedFailureType:
            review.confirmedFailureType ??
            (adjudicated ? review.proposedFailureType : undefined),
          confirmedVerdict:
            review.confirmedVerdict ??
            (adjudicated ? review.proposedVerdict : undefined),
          matchesSuggestion:
            review.matchesSuggestion ?? (adjudicated ? true : undefined)
        };
      }
    );
    this.runLedgerEntries = (snapshot.runLedgerEntries ?? []).map((entry) => ({
      ...entry,
      runType:
        entry.runType ??
        (entry.caseSuiteId ? "document-suite" : "requirement-suite")
    }));
    this.compileRuns = snapshot.compileRuns ?? [];
    this.pageBindingDecisions = snapshot.pageBindingDecisions ?? [];
  }

  private snapshot(): RepositorySnapshot {
    return {
      systemProfiles: this.systemProfiles,
      systemExplorations: this.systemExplorations,
      authProfiles: this.authProfiles,
      authCheckpoints: this.authCheckpoints,
      pageModels: this.pageModels,
      locatorPoints: this.locatorPoints,
      probeResults: this.probeResults,
      trainingSessions: this.trainingSessions,
      actionSteps: this.actionSteps,
      apiFlows: this.apiFlows,
      generatedCases: this.generatedCases,
      gaps: this.gaps,
      glossaryTerms: this.glossaryTerms,
      businessRules: this.businessRules,
      testCases: this.testCases,
      agentRuns: this.agentRuns,
      agentTasks: this.agentTasks,
      chainRuns: this.chainRuns,
      caseSources: this.caseSources,
      caseSuites: this.caseSuites,
      caseSuiteRuns: this.caseSuiteRuns,
      bugReports: this.bugReports,
      schemaVersion: CURRENT_REPOSITORY_SCHEMA_VERSION,
      knowledgeProjects: this.knowledgeProjects,
      requirementSources: this.requirementSources,
      requirementSets: this.requirementSets,
      knowledgeNodes: this.knowledgeNodes,
      knowledgeEdges: this.knowledgeEdges,
      testIntents: this.testIntents,
      testDataProfiles: this.testDataProfiles,
      testDataTasks: this.testDataTasks,
      testDataLeases: this.testDataLeases,
      executableCases: this.executableCases,
      executionPlans: this.executionPlans,
      requirementSuiteRuns: this.requirementSuiteRuns,
      executionEvidence: this.executionEvidence,
      executionDiagnoses: this.executionDiagnoses,
      executionDiagnosisReviews: this.executionDiagnosisReviews,
      runLedgerEntries: this.runLedgerEntries,
      compileRuns: this.compileRuns,
      pageBindingDecisions: this.pageBindingDecisions
    };
  }
}

function repositoryCounts(repository: InMemoryBrainCreatorRepository) {
  return {
    systems: repository.systemProfiles.length,
    requirements: repository.requirementSets.length,
    executableCases: repository.executableCases.length,
    compileRuns: repository.compileRuns.length,
    gaps: repository.gaps.length
  };
}

function assertRepositorySnapshot(value: unknown): asserts value is Partial<RepositorySnapshot> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Brain Creator store must contain a JSON object");
  }
  const snapshot = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(snapshot)) {
    if (key === "schemaVersion") {
      if (typeof entry !== "number") {
        throw new Error("Brain Creator store schemaVersion must be a number");
      }
      continue;
    }
    if (!Array.isArray(entry)) {
      throw new Error(`Brain Creator store field ${key} must be an array`);
    }
  }
}
