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
  Gap,
  GeneratedCase,
  GlossaryTerm,
  ExecutableCase,
  ExecutionEvidence,
  KnowledgeEdge,
  KnowledgeNode,
  KnowledgeProject,
  LocatorPoint,
  PageModel,
  ProbeResult,
  RequirementSet,
  RequirementSource,
  SystemProfile,
  TestDataProfile,
  TestIntent,
  TestCase,
  TrainingSession
} from "./types.js";

export const CURRENT_REPOSITORY_SCHEMA_VERSION = 2;

export class InMemoryBrainCreatorRepository {
  schemaVersion = CURRENT_REPOSITORY_SCHEMA_VERSION;
  systemProfiles: SystemProfile[] = [];
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
  executableCases: ExecutableCase[] = [];
  executionEvidence: ExecutionEvidence[] = [];

  persist() {
    return;
  }

  reset() {
    this.systemProfiles = [];
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
    this.executableCases = [];
    this.executionEvidence = [];
    this.persist();
  }
}

type RepositorySnapshot = Pick<
  InMemoryBrainCreatorRepository,
  | "systemProfiles"
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
  | "executableCases"
  | "executionEvidence"
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

  private restore() {
    if (!existsSync(this.filePath)) {
      return;
    }
    const snapshot = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<RepositorySnapshot>;
    this.schemaVersion = CURRENT_REPOSITORY_SCHEMA_VERSION;
    this.systemProfiles = snapshot.systemProfiles ?? [];
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
    this.executableCases = snapshot.executableCases ?? [];
    this.executionEvidence = snapshot.executionEvidence ?? [];
  }

  private snapshot(): RepositorySnapshot {
    return {
      systemProfiles: this.systemProfiles,
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
      executableCases: this.executableCases,
      executionEvidence: this.executionEvidence
    };
  }
}
