import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import type {
  ActionStep,
  AttachmentAnalysis,
  AgentRun,
  AgentTask,
  ApiFlow,
  AuthCheckpoint,
  AuthProfile,
  BugReport,
  BusinessObjectModel,
  BusinessRule,
  CaseSource,
  CaseSuite,
  CaseSuiteRun,
  ChainRun,
  CompileRun,
  DecisionTableModel,
  Gap,
  GeneratedCase,
  GlossaryTerm,
  ExecutableCase,
  ExecutionDiagnosis,
  ExecutionDiagnosisReview,
  ExecutionPlan,
  ExecutionEvidence,
  ExplorationPlan,
  ExplorationTask,
  KnowledgeEdge,
  KnowledgeNode,
  KnowledgeProject,
  LocatorPoint,
  PageModel,
  PageBindingDecision,
  ProbeResult,
  RequirementSet,
  RequirementCoverageProfile,
  RequirementSuiteRun,
  RunLedgerEntry,
  RequirementSource,
  SystemProfile,
  SystemExploration,
  TestDataLease,
  TestDataProfile,
  TestDataTask,
  TestIntent,
  WorkflowModel,
  StateMachineModel,
  TestCase,
  TrainingSession
} from "./types.js";
import type {
  BrainEvent,
  BrainSession,
  BrainTask,
  BusinessEntityInstance,
  BusinessScenario,
  ApprovalReceipt,
  ConformanceResult,
  EvaluationTrial,
  InterventionRecord,
  OnboardingPlan,
  ProjectionManifest,
  ScenarioAssuranceContract,
  ScenarioTrustRecord,
  SemanticAlias,
  SemanticBinding,
  SemanticConcept,
  SemanticRelation,
  SystemBrainChangeSet,
  SystemBrainSnapshot,
  SystemPageIdentity,
  SourceSnapshot,
  StageEvalRecord,
  TestDataDependency
} from "../brain/types.js";

export const CURRENT_REPOSITORY_SCHEMA_VERSION = 21;
export const SHARDED_REPOSITORY_SCHEMA_VERSION = 21;
const LEGACY_SHARDED_REPOSITORY_SCHEMA_VERSIONS = new Set([17, 18, 19, 20]);
const OPTIONAL_LEGACY_COLLECTIONS = new Set([
  "attachmentAnalyses",
  "workflowModels",
  "stateMachineModels",
  "requirementCoverageProfiles",
  "explorationTasks",
  "explorationPlans",
  "brainTasks",
  "brainSessions",
  "brainEvents",
  "semanticConcepts",
  "semanticAliases",
  "semanticRelations",
  "businessEntityInstances",
  "testDataDependencies",
  "systemBrainSnapshots",
  "systemBrainChangeSets",
  "businessObjectModels",
  "decisionTableModels",
  "semanticBindings",
  "businessScenarios",
  "scenarioAssuranceContracts",
  "scenarioTrustRecords",
  "onboardingPlans",
  "evaluationTrials",
  "sourceSnapshots",
  "projectionManifests",
  "interventionRecords",
  "stageEvalRecords",
  "approvalReceipts",
  "conformanceResults",
  "systemPageIdentities"
]);

export function shardedRepositoryCollectionKeys() {
  return collectionKeys();
}

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
  attachmentAnalyses: AttachmentAnalysis[] = [];
  requirementSets: RequirementSet[] = [];
  workflowModels: WorkflowModel[] = [];
  stateMachineModels: StateMachineModel[] = [];
  businessObjectModels: BusinessObjectModel[] = [];
  decisionTableModels: DecisionTableModel[] = [];
  requirementCoverageProfiles: RequirementCoverageProfile[] = [];
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
  explorationTasks: ExplorationTask[] = [];
  explorationPlans: ExplorationPlan[] = [];
  pageBindingDecisions: PageBindingDecision[] = [];
  brainTasks: BrainTask[] = [];
  brainSessions: BrainSession[] = [];
  brainEvents: BrainEvent[] = [];
  semanticConcepts: SemanticConcept[] = [];
  semanticAliases: SemanticAlias[] = [];
  semanticRelations: SemanticRelation[] = [];
  semanticBindings: SemanticBinding[] = [];
  businessScenarios: BusinessScenario[] = [];
  scenarioAssuranceContracts: ScenarioAssuranceContract[] = [];
  scenarioTrustRecords: ScenarioTrustRecord[] = [];
  onboardingPlans: OnboardingPlan[] = [];
  businessEntityInstances: BusinessEntityInstance[] = [];
  testDataDependencies: TestDataDependency[] = [];
  systemBrainSnapshots: SystemBrainSnapshot[] = [];
  systemBrainChangeSets: SystemBrainChangeSet[] = [];
  evaluationTrials: EvaluationTrial[] = [];
  sourceSnapshots: SourceSnapshot[] = [];
  projectionManifests: ProjectionManifest[] = [];
  interventionRecords: InterventionRecord[] = [];
  stageEvalRecords: StageEvalRecord[] = [];
  approvalReceipts: ApprovalReceipt[] = [];
  conformanceResults: ConformanceResult[] = [];
  systemPageIdentities: SystemPageIdentity[] = [];

  persist() {
    return;
  }

  transaction<T>(action: () => T): T {
    const before = structuredClone(snapshotRepository(this, this.schemaVersion));
    try {
      const result = action();
      this.persist();
      return result;
    } catch (error) {
      applyRepositorySnapshot(this, before);
      throw error;
    }
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
    this.attachmentAnalyses = [];
    this.requirementSets = [];
    this.workflowModels = [];
    this.stateMachineModels = [];
    this.businessObjectModels = [];
    this.decisionTableModels = [];
    this.requirementCoverageProfiles = [];
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
    this.explorationTasks = [];
    this.explorationPlans = [];
    this.pageBindingDecisions = [];
    this.brainTasks = [];
    this.brainSessions = [];
    this.brainEvents = [];
    this.semanticConcepts = [];
    this.semanticAliases = [];
    this.semanticRelations = [];
    this.semanticBindings = [];
    this.businessScenarios = [];
    this.scenarioAssuranceContracts = [];
    this.scenarioTrustRecords = [];
    this.onboardingPlans = [];
    this.businessEntityInstances = [];
    this.testDataDependencies = [];
    this.systemBrainSnapshots = [];
    this.systemBrainChangeSets = [];
    this.evaluationTrials = [];
    this.sourceSnapshots = [];
    this.projectionManifests = [];
    this.interventionRecords = [];
    this.stageEvalRecords = [];
    this.approvalReceipts = [];
    this.conformanceResults = [];
    this.systemPageIdentities = [];
    this.persist();
  }
}

export type RepositorySnapshot = Pick<
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
  | "attachmentAnalyses"
  | "requirementSets"
  | "workflowModels"
  | "stateMachineModels"
  | "businessObjectModels"
  | "decisionTableModels"
  | "requirementCoverageProfiles"
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
  | "explorationTasks"
  | "explorationPlans"
  | "pageBindingDecisions"
  | "brainTasks"
  | "brainSessions"
  | "brainEvents"
  | "semanticConcepts"
  | "semanticAliases"
  | "semanticRelations"
  | "semanticBindings"
  | "businessScenarios"
  | "scenarioAssuranceContracts"
  | "scenarioTrustRecords"
  | "onboardingPlans"
  | "businessEntityInstances"
  | "testDataDependencies"
  | "systemBrainSnapshots"
  | "systemBrainChangeSets"
  | "evaluationTrials"
  | "sourceSnapshots"
  | "projectionManifests"
  | "interventionRecords"
  | "stageEvalRecords"
  | "approvalReceipts"
  | "conformanceResults"
  | "systemPageIdentities"
>;

export class JsonFileBrainCreatorRepository extends InMemoryBrainCreatorRepository {
  constructor(private readonly filePath: string) {
    super();
    this.restore();
  }

  override persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeAtomicJson(this.filePath, this.snapshot());
  }

  override reload() {
    if (!existsSync(this.filePath)) {
      throw new Error("Brain Creator store file not found");
    }
    this.restore();
    return repositoryCounts(this);
  }

  protected restore() {
    if (!existsSync(this.filePath)) {
      return;
    }
    const snapshot = readRepositorySnapshot(this.filePath);
    applyRepositorySnapshot(this, snapshot);
    this.schemaVersion = CURRENT_REPOSITORY_SCHEMA_VERSION;
  }

  protected snapshot(): RepositorySnapshot {
    return snapshotRepository(this, CURRENT_REPOSITORY_SCHEMA_VERSION);
  }
}

export class ShardedFileBrainCreatorRepository extends InMemoryBrainCreatorRepository {
  private readonly manifestPath: string;
  private readonly collectionsDir: string;
  private readonly legacyFilePath: string;
  private readonly lockDir: string;
  private readonly transactionJournalPath: string;

  constructor(
    private readonly storeDir: string,
    legacyFilePath = join(dirname(storeDir), "local-assets.json")
  ) {
    super();
    this.manifestPath = join(storeDir, "manifest.json");
    this.collectionsDir = join(storeDir, "collections");
    this.legacyFilePath = legacyFilePath;
    this.lockDir = join(storeDir, ".write.lock");
    this.transactionJournalPath = join(storeDir, ".transaction.json");
    this.recoverInterruptedTransaction();
    this.restoreShardedOrMigrate();
  }

  override persist() {
    this.withLock(() => {
      const snapshot = snapshotRepository(this, SHARDED_REPOSITORY_SCHEMA_VERSION);
      this.writeSnapshot(snapshot);
    });
  }

  override transaction<T>(action: () => T): T {
    const before = structuredClone(snapshotRepository(this, this.schemaVersion));
    try {
      const result = action();
      this.withLock(() => {
        writeAtomicJson(this.transactionJournalPath, {
          schemaVersion: SHARDED_REPOSITORY_SCHEMA_VERSION,
          snapshot: before
        });
        try {
          this.writeSnapshot(snapshotRepository(this, SHARDED_REPOSITORY_SCHEMA_VERSION));
          rmSync(this.transactionJournalPath, { force: true });
        } catch (error) {
          applyRepositorySnapshot(this, before);
          try {
            this.writeSnapshot(before);
            rmSync(this.transactionJournalPath, { force: true });
          } catch {
            // Keep the journal so the next process can finish the rollback.
          }
          throw error;
        }
      });
      return result;
    } catch (error) {
      applyRepositorySnapshot(this, before);
      throw error;
    }
  }

  override reload() {
    this.restoreShardedOrMigrate();
    return repositoryCounts(this);
  }

  rebuildIndexes() {
    if (!existsSync(this.manifestPath)) {
      throw new Error("Brain Creator sharded manifest not found");
    }
    writeAtomicJson(join(this.storeDir, "indexes", "asset-index.json"), buildAssetIndex(this));
    return { index: "asset-index.json", rebuiltAt: new Date().toISOString() };
  }

  private restoreShardedOrMigrate() {
    if (existsSync(this.manifestPath)) {
      const manifest = JSON.parse(readFileSync(this.manifestPath, "utf8")) as Record<string, unknown>;
      if (
        manifest.format !== "sharded" ||
        ![
          ...LEGACY_SHARDED_REPOSITORY_SCHEMA_VERSIONS,
          SHARDED_REPOSITORY_SCHEMA_VERSION
        ].includes(manifest.schemaVersion as number)
      ) {
        throw new Error("Brain Creator sharded store manifest is invalid");
      }
      const rawCollections = manifest.collections;
      const collections = Array.isArray(rawCollections) ? rawCollections : [];
      const expectedCollections = collectionKeys();
      const manifestSchemaVersion = manifest.schemaVersion as number;
      const requiredCollections = manifestSchemaVersion === SHARDED_REPOSITORY_SCHEMA_VERSION
        ? expectedCollections
        : expectedCollections.filter((key) => !OPTIONAL_LEGACY_COLLECTIONS.has(key));
      if (
        !Array.isArray(rawCollections) ||
        requiredCollections.some((key) => !collections.includes(key)) ||
        collections.some(
          (key) =>
            typeof key !== "string" ||
            !expectedCollections.includes(key as (typeof expectedCollections)[number])
        )
      ) {
        throw new Error("Brain Creator sharded store manifest collections are invalid");
      }
      const snapshot = readShardedSnapshot(this.collectionsDir, manifestSchemaVersion);
      applyRepositorySnapshot(this, snapshot);
      this.schemaVersion = SHARDED_REPOSITORY_SCHEMA_VERSION;
      if (manifestSchemaVersion !== SHARDED_REPOSITORY_SCHEMA_VERSION) {
        writeAtomicJson(
          join(this.storeDir, "backups", `schema-${manifestSchemaVersion}-${backupStamp()}.json`),
          snapshot
        );
        try {
          this.persist();
        } catch {
          applyRepositorySnapshot(this, snapshot);
          this.schemaVersion = manifestSchemaVersion;
        }
      }
      return;
    }
    if (existsSync(this.legacyFilePath)) {
      const snapshot = readRepositorySnapshot(this.legacyFilePath);
      applyRepositorySnapshot(this, snapshot);
      this.schemaVersion = SHARDED_REPOSITORY_SCHEMA_VERSION;
      const backupPath = `${this.legacyFilePath}.backup-${backupStamp()}`;
      writeAtomicJson(backupPath, snapshot);
      this.persist();
      return;
    }
    this.schemaVersion = SHARDED_REPOSITORY_SCHEMA_VERSION;
    this.persist();
  }

  private writeSnapshot(snapshot: RepositorySnapshot) {
    mkdirSync(this.collectionsDir, { recursive: true });
    for (const key of collectionKeys()) {
      writeAtomicJson(join(this.collectionsDir, `${key}.json`), snapshot[key]);
    }
    this.writeOwnershipShards();
    writeAtomicJson(join(this.storeDir, "indexes", "asset-index.json"), buildAssetIndex(this));
    writeAtomicJson(this.manifestPath, {
      format: "sharded",
      schemaVersion: SHARDED_REPOSITORY_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      collections: collectionKeys(),
      counts: repositoryCounts(this)
    });
  }

  private recoverInterruptedTransaction() {
    if (!existsSync(this.transactionJournalPath)) return;
    if (existsSync(this.lockDir)) {
      const ownerPath = join(this.lockDir, "owner.json");
      const owner = existsSync(ownerPath)
        ? JSON.parse(readFileSync(ownerPath, "utf8")) as { pid?: number }
        : undefined;
      if (!owner?.pid || isProcessRunning(owner.pid)) {
        throw new Error("Brain Creator sharded store transaction is still active");
      }
      rmSync(this.lockDir, { recursive: true, force: true });
    }
    const journal = JSON.parse(readFileSync(this.transactionJournalPath, "utf8")) as {
      snapshot?: Partial<RepositorySnapshot>;
    };
    if (!journal.snapshot) {
      throw new Error("Brain Creator sharded store transaction journal is invalid");
    }
    applyRepositorySnapshot(this, journal.snapshot);
    this.schemaVersion = SHARDED_REPOSITORY_SCHEMA_VERSION;
    this.withLock(() => {
      this.writeSnapshot(snapshotRepository(this, SHARDED_REPOSITORY_SCHEMA_VERSION));
      rmSync(this.transactionJournalPath, { force: true });
    });
  }

  private writeOwnershipShards() {
    for (const system of this.systemProfiles) {
      const systemDir = join(this.storeDir, "systems", system.id);
      mkdirSync(systemDir, { recursive: true });
      writeAtomicJson(join(systemDir, "system.json"), system);
      writeAtomicJson(join(systemDir, "assets.json"), systemAssets(this, system.id));
    }
    for (const requirement of this.requirementSets) {
      const requirementDir = join(
        this.storeDir,
        "knowledge",
        requirement.knowledgeProjectId,
        "requirements"
      );
      mkdirSync(requirementDir, { recursive: true });
      writeAtomicJson(join(requirementDir, `${requirement.id}.json`), requirement);
    }
    const ledgersByRun = new Map<string, string[]>();
    for (const entry of this.runLedgerEntries) {
      const runId = entry.requirementSuiteRunId ?? entry.caseSuiteId ?? entry.id;
      const lines = ledgersByRun.get(runId) ?? [];
      lines.push(JSON.stringify(entry));
      ledgersByRun.set(runId, lines);
    }
    for (const [runId, lines] of ledgersByRun) {
      const runDir = join(this.storeDir, "runs", runId);
      mkdirSync(runDir, { recursive: true });
      writeAtomicText(join(runDir, "ledger.jsonl"), `${lines.join("\n")}\n`);
    }
  }

  private withLock(action: () => void) {
    mkdirSync(this.storeDir, { recursive: true });
    try {
      mkdirSync(this.lockDir);
    } catch {
      throw new Error("Brain Creator sharded store is locked by another writer");
    }
    try {
      writeAtomicJson(join(this.lockDir, "owner.json"), {
        pid: process.pid,
        createdAt: new Date().toISOString()
      });
      action();
    } finally {
      rmSync(this.lockDir, { recursive: true, force: true });
    }
  }
}

function snapshotRepository(
  repository: InMemoryBrainCreatorRepository,
  schemaVersion: number
): RepositorySnapshot {
  return {
    systemProfiles: repository.systemProfiles,
    systemExplorations: repository.systemExplorations,
    authProfiles: repository.authProfiles,
    authCheckpoints: repository.authCheckpoints,
    pageModels: repository.pageModels,
    locatorPoints: repository.locatorPoints,
    probeResults: repository.probeResults,
    trainingSessions: repository.trainingSessions,
    actionSteps: repository.actionSteps,
    apiFlows: repository.apiFlows,
    generatedCases: repository.generatedCases,
    gaps: repository.gaps,
    glossaryTerms: repository.glossaryTerms,
    businessRules: repository.businessRules,
    testCases: repository.testCases,
    agentRuns: repository.agentRuns,
    agentTasks: repository.agentTasks,
    chainRuns: repository.chainRuns,
    caseSources: repository.caseSources,
    caseSuites: repository.caseSuites,
    caseSuiteRuns: repository.caseSuiteRuns,
    bugReports: repository.bugReports,
    schemaVersion,
    knowledgeProjects: repository.knowledgeProjects,
    requirementSources: repository.requirementSources,
    attachmentAnalyses: repository.attachmentAnalyses,
    requirementSets: repository.requirementSets,
    workflowModels: repository.workflowModels,
    stateMachineModels: repository.stateMachineModels,
    businessObjectModels: repository.businessObjectModels,
    decisionTableModels: repository.decisionTableModels,
    requirementCoverageProfiles: repository.requirementCoverageProfiles,
    knowledgeNodes: repository.knowledgeNodes,
    knowledgeEdges: repository.knowledgeEdges,
    testIntents: repository.testIntents,
    testDataProfiles: repository.testDataProfiles,
    testDataTasks: repository.testDataTasks,
    testDataLeases: repository.testDataLeases,
    executableCases: repository.executableCases,
    executionPlans: repository.executionPlans,
    requirementSuiteRuns: repository.requirementSuiteRuns,
    executionEvidence: repository.executionEvidence,
    executionDiagnoses: repository.executionDiagnoses,
    executionDiagnosisReviews: repository.executionDiagnosisReviews,
    runLedgerEntries: repository.runLedgerEntries,
    compileRuns: repository.compileRuns,
    explorationTasks: repository.explorationTasks,
    explorationPlans: repository.explorationPlans,
    pageBindingDecisions: repository.pageBindingDecisions,
    brainTasks: repository.brainTasks,
    brainSessions: repository.brainSessions,
    brainEvents: repository.brainEvents,
    semanticConcepts: repository.semanticConcepts,
    semanticAliases: repository.semanticAliases,
    semanticRelations: repository.semanticRelations,
    semanticBindings: repository.semanticBindings,
    businessScenarios: repository.businessScenarios,
    scenarioAssuranceContracts: repository.scenarioAssuranceContracts,
    scenarioTrustRecords: repository.scenarioTrustRecords,
    onboardingPlans: repository.onboardingPlans,
    businessEntityInstances: repository.businessEntityInstances,
    testDataDependencies: repository.testDataDependencies,
    systemBrainSnapshots: repository.systemBrainSnapshots,
    systemBrainChangeSets: repository.systemBrainChangeSets,
    evaluationTrials: repository.evaluationTrials,
    sourceSnapshots: repository.sourceSnapshots,
    projectionManifests: repository.projectionManifests,
    interventionRecords: repository.interventionRecords,
    stageEvalRecords: repository.stageEvalRecords,
    approvalReceipts: repository.approvalReceipts,
    conformanceResults: repository.conformanceResults,
    systemPageIdentities: repository.systemPageIdentities
  };
}

function applyRepositorySnapshot(
  repository: InMemoryBrainCreatorRepository,
  snapshot: Partial<RepositorySnapshot>
) {
    repository.schemaVersion = snapshot.schemaVersion ?? CURRENT_REPOSITORY_SCHEMA_VERSION;
    repository.systemProfiles = snapshot.systemProfiles ?? [];
    repository.systemExplorations = (snapshot.systemExplorations ?? []).map((exploration) => ({
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
    repository.authProfiles = snapshot.authProfiles ?? [];
    repository.authCheckpoints = snapshot.authCheckpoints ?? [];
    repository.pageModels = snapshot.pageModels ?? [];
    repository.locatorPoints = snapshot.locatorPoints ?? [];
    repository.probeResults = snapshot.probeResults ?? [];
    repository.trainingSessions = snapshot.trainingSessions ?? [];
    repository.actionSteps = snapshot.actionSteps ?? [];
    repository.apiFlows = snapshot.apiFlows ?? [];
    repository.generatedCases = snapshot.generatedCases ?? [];
    repository.gaps = snapshot.gaps ?? [];
    repository.glossaryTerms = snapshot.glossaryTerms ?? [];
    repository.businessRules = snapshot.businessRules ?? [];
    repository.testCases = snapshot.testCases ?? [];
    repository.agentRuns = snapshot.agentRuns ?? [];
    repository.agentTasks = snapshot.agentTasks ?? [];
    repository.chainRuns = snapshot.chainRuns ?? [];
    repository.caseSources = snapshot.caseSources ?? [];
    repository.caseSuites = snapshot.caseSuites ?? [];
    repository.caseSuiteRuns = snapshot.caseSuiteRuns ?? [];
    repository.bugReports = snapshot.bugReports ?? [];
    repository.knowledgeProjects = snapshot.knowledgeProjects ?? [];
    repository.requirementSources = snapshot.requirementSources ?? [];
    repository.attachmentAnalyses = snapshot.attachmentAnalyses ?? [];
    repository.requirementSets = snapshot.requirementSets ?? [];
    repository.workflowModels = snapshot.workflowModels ?? [];
    repository.stateMachineModels = snapshot.stateMachineModels ?? [];
    repository.businessObjectModels = snapshot.businessObjectModels ?? [];
    repository.decisionTableModels = snapshot.decisionTableModels ?? [];
    repository.requirementCoverageProfiles = snapshot.requirementCoverageProfiles ?? [];
    repository.knowledgeNodes = snapshot.knowledgeNodes ?? [];
    repository.knowledgeEdges = snapshot.knowledgeEdges ?? [];
    repository.testIntents = snapshot.testIntents ?? [];
    repository.testDataProfiles = snapshot.testDataProfiles ?? [];
    repository.testDataTasks = snapshot.testDataTasks ?? [];
    repository.testDataLeases = snapshot.testDataLeases ?? [];
    repository.executableCases = snapshot.executableCases ?? [];
    repository.executionPlans = snapshot.executionPlans ?? [];
    repository.requirementSuiteRuns = (snapshot.requirementSuiteRuns ?? []).map(
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
    repository.executionEvidence = snapshot.executionEvidence ?? [];
    repository.executionDiagnoses = (snapshot.executionDiagnoses ?? []).map(
      (diagnosis) => ({
        ...diagnosis,
        gapIds: diagnosis.gapIds ?? []
      })
    );
    repository.executionDiagnosisReviews = (snapshot.executionDiagnosisReviews ?? []).map(
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
    repository.runLedgerEntries = (snapshot.runLedgerEntries ?? []).map((entry) => ({
      ...entry,
      runType:
        entry.runType ??
        (entry.caseSuiteId ? "document-suite" : "requirement-suite")
    }));
    repository.compileRuns = (snapshot.compileRuns ?? []).map((run) => ({
      ...run,
      needsExploration: run.needsExploration ?? 0,
      needsData: run.needsData ?? 0
    }));
    repository.explorationTasks = snapshot.explorationTasks ?? [];
    repository.explorationPlans = snapshot.explorationPlans ?? [];
    repository.pageBindingDecisions = snapshot.pageBindingDecisions ?? [];
    repository.brainTasks = snapshot.brainTasks ?? [];
    repository.brainSessions = snapshot.brainSessions ?? [];
    repository.brainEvents = snapshot.brainEvents ?? [];
    repository.semanticConcepts = snapshot.semanticConcepts ?? [];
    repository.semanticAliases = snapshot.semanticAliases ?? [];
    repository.semanticRelations = snapshot.semanticRelations ?? [];
    repository.semanticBindings = snapshot.semanticBindings ?? [];
    repository.businessScenarios = snapshot.businessScenarios ?? [];
    repository.scenarioAssuranceContracts = snapshot.scenarioAssuranceContracts ?? [];
    repository.scenarioTrustRecords = snapshot.scenarioTrustRecords ?? [];
    repository.onboardingPlans = snapshot.onboardingPlans ?? [];
    repository.businessEntityInstances = snapshot.businessEntityInstances ?? [];
    repository.testDataDependencies = snapshot.testDataDependencies ?? [];
    repository.systemBrainSnapshots = snapshot.systemBrainSnapshots ?? [];
    repository.systemBrainChangeSets = snapshot.systemBrainChangeSets ?? [];
    repository.evaluationTrials = snapshot.evaluationTrials ?? [];
    repository.sourceSnapshots = snapshot.sourceSnapshots ?? [];
    repository.projectionManifests = snapshot.projectionManifests ?? [];
    repository.interventionRecords = snapshot.interventionRecords ?? [];
    repository.stageEvalRecords = snapshot.stageEvalRecords ?? [];
    repository.approvalReceipts = snapshot.approvalReceipts ?? [];
    repository.conformanceResults = snapshot.conformanceResults ?? [];
    repository.systemPageIdentities = snapshot.systemPageIdentities ?? [];
}

function collectionKeys(): Array<Exclude<keyof RepositorySnapshot, "schemaVersion">> {
  return [
    "systemProfiles", "systemExplorations", "authProfiles", "authCheckpoints", "pageModels",
    "locatorPoints", "probeResults", "trainingSessions", "actionSteps", "apiFlows",
    "generatedCases", "gaps", "glossaryTerms", "businessRules", "testCases", "agentRuns",
    "agentTasks", "chainRuns", "caseSources", "caseSuites", "caseSuiteRuns", "bugReports",
    "knowledgeProjects", "requirementSources", "attachmentAnalyses", "requirementSets", "workflowModels",
    "stateMachineModels", "businessObjectModels", "decisionTableModels", "requirementCoverageProfiles", "knowledgeNodes",
    "knowledgeEdges", "testIntents", "testDataProfiles", "testDataTasks", "testDataLeases",
    "executableCases", "executionPlans", "requirementSuiteRuns", "executionEvidence",
    "executionDiagnoses", "executionDiagnosisReviews", "runLedgerEntries", "compileRuns",
    "explorationTasks", "explorationPlans", "pageBindingDecisions", "brainTasks", "brainSessions",
    "brainEvents", "semanticConcepts", "semanticAliases", "semanticRelations", "semanticBindings",
    "businessScenarios", "scenarioAssuranceContracts", "scenarioTrustRecords", "onboardingPlans", "businessEntityInstances",
    "testDataDependencies",
    "systemBrainSnapshots", "systemBrainChangeSets", "evaluationTrials", "sourceSnapshots",
    "projectionManifests", "interventionRecords", "stageEvalRecords", "approvalReceipts",
    "conformanceResults", "systemPageIdentities"
  ];
}

function readRepositorySnapshot(filePath: string): Partial<RepositorySnapshot> {
  const snapshot = JSON.parse(readFileSync(filePath, "utf8")) as Partial<RepositorySnapshot>;
  assertRepositorySnapshot(snapshot);
  return snapshot;
}

function readShardedSnapshot(
  collectionsDir: string,
  schemaVersion = SHARDED_REPOSITORY_SCHEMA_VERSION
): Partial<RepositorySnapshot> {
  const snapshot: Record<string, unknown> = { schemaVersion };
  for (const key of collectionKeys()) {
    const filePath = join(collectionsDir, `${key}.json`);
    if (!existsSync(filePath)) {
      if (schemaVersion !== SHARDED_REPOSITORY_SCHEMA_VERSION && OPTIONAL_LEGACY_COLLECTIONS.has(key)) {
        snapshot[key] = [];
        continue;
      }
      throw new Error(`Brain Creator shard ${key} is missing`);
    }
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(value)) throw new Error(`Brain Creator shard ${key} must be an array`);
    snapshot[key] = value;
  }
  return snapshot as Partial<RepositorySnapshot>;
}

function writeAtomicJson(filePath: string, value: unknown) {
  writeAtomicText(filePath, JSON.stringify(value, null, 2));
}

function writeAtomicText(filePath: string, value: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, value, "utf8");
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function backupStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function systemAssets(repository: InMemoryBrainCreatorRepository, systemId: string) {
  const pageModelIds = new Set(
    repository.pageModels
      .filter((item) => item.projectId === systemId)
      .map((item) => item.id)
  );
  const sessionIds = new Set(
    repository.trainingSessions
      .filter((item) => item.projectId === systemId)
      .map((item) => item.id)
  );
  const knowledgeProjectIds = new Set(
    repository.knowledgeProjects
      .filter((item) => item.systemIds.includes(systemId))
      .map((item) => item.id)
  );
  const requirementSetIds = new Set(
    repository.requirementSets
      .filter((item) => knowledgeProjectIds.has(item.knowledgeProjectId))
      .map((item) => item.id)
  );
  const visibleKnowledgeNodeIds = new Set(
    repository.knowledgeNodes
      .filter(
        (item) =>
          knowledgeProjectIds.has(item.knowledgeProjectId) &&
          (!item.systemId || item.systemId === systemId)
      )
      .map((item) => item.id)
  );
  return {
    authProfiles: repository.authProfiles.filter((item) => item.projectId === systemId),
    authCheckpoints: repository.authCheckpoints.filter((item) => item.systemId === systemId),
    systemExplorations: repository.systemExplorations.filter((item) => item.systemId === systemId),
    pageModels: repository.pageModels.filter((item) => item.projectId === systemId),
    locatorPoints: repository.locatorPoints.filter((item) => pageModelIds.has(item.pageModelId)),
    probeResults: repository.probeResults.filter((item) => pageModelIds.has(item.pageModelId)),
    trainingSessions: repository.trainingSessions.filter((item) => item.projectId === systemId),
    actionSteps: repository.actionSteps.filter((item) => sessionIds.has(item.sessionId)),
    apiFlows: repository.apiFlows.filter((item) => sessionIds.has(item.sessionId)),
    gaps: repository.gaps.filter((item) => item.projectId === systemId),
    generatedCases: repository.generatedCases.filter((item) => item.projectId === systemId),
    glossaryTerms: repository.glossaryTerms.filter((item) => item.projectId === systemId),
    businessRules: repository.businessRules.filter((item) => item.systemId === systemId),
    testCases: repository.testCases.filter((item) => item.systemId === systemId),
    agentRuns: repository.agentRuns.filter((item) => item.systemId === systemId),
    agentTasks: repository.agentTasks.filter((item) => item.systemId === systemId),
    chainRuns: repository.chainRuns.filter((item) => item.systemId === systemId),
    caseSources: repository.caseSources.filter((item) => item.systemId === systemId),
    caseSuites: repository.caseSuites.filter((item) => item.systemId === systemId),
    caseSuiteRuns: repository.caseSuiteRuns.filter((item) => item.systemId === systemId),
    bugReports: repository.bugReports.filter((item) => item.systemId === systemId),
    knowledgeProjects: repository.knowledgeProjects.filter((item) => knowledgeProjectIds.has(item.id)),
    requirementSources: repository.requirementSources.filter((item) => knowledgeProjectIds.has(item.knowledgeProjectId)),
    attachmentAnalyses: repository.attachmentAnalyses.filter((item) => knowledgeProjectIds.has(item.knowledgeProjectId)),
    requirementSets: repository.requirementSets.filter((item) => requirementSetIds.has(item.id)),
    workflowModels: repository.workflowModels.filter((item) => requirementSetIds.has(item.requirementSetId)),
    stateMachineModels: repository.stateMachineModels.filter((item) => requirementSetIds.has(item.requirementSetId)),
    businessObjectModels: repository.businessObjectModels.filter((item) => requirementSetIds.has(item.requirementSetId)),
    decisionTableModels: repository.decisionTableModels.filter((item) => requirementSetIds.has(item.requirementSetId)),
    requirementCoverageProfiles: repository.requirementCoverageProfiles.filter((item) => requirementSetIds.has(item.requirementSetId)),
    knowledgeNodes: repository.knowledgeNodes.filter((item) => visibleKnowledgeNodeIds.has(item.id)),
    knowledgeEdges: repository.knowledgeEdges.filter(
      (item) => visibleKnowledgeNodeIds.has(item.fromNodeId) && visibleKnowledgeNodeIds.has(item.toNodeId)
    ),
    testIntents: repository.testIntents.filter((item) => knowledgeProjectIds.has(item.knowledgeProjectId)),
    testDataProfiles: repository.testDataProfiles.filter((item) => knowledgeProjectIds.has(item.knowledgeProjectId)),
    testDataTasks: repository.testDataTasks.filter((item) => item.systemId === systemId),
    testDataLeases: repository.testDataLeases.filter((item) => item.systemId === systemId),
    executableCases: repository.executableCases.filter((item) => item.systemId === systemId),
    executionPlans: repository.executionPlans.filter((item) => item.systemId === systemId),
    requirementSuiteRuns: repository.requirementSuiteRuns.filter((item) => item.systemId === systemId),
    executionEvidence: repository.executionEvidence.filter((item) => item.systemId === systemId),
    executionDiagnoses: repository.executionDiagnoses.filter((item) => item.systemId === systemId),
    executionDiagnosisReviews: repository.executionDiagnosisReviews.filter((item) => item.systemId === systemId),
    runLedgerEntries: repository.runLedgerEntries.filter((item) => item.systemId === systemId),
    compileRuns: repository.compileRuns.filter((item) => item.systemId === systemId),
    explorationTasks: repository.explorationTasks.filter((item) => item.systemId === systemId),
    explorationPlans: repository.explorationPlans.filter((item) => item.systemId === systemId),
    pageBindingDecisions: repository.pageBindingDecisions.filter((item) => item.systemId === systemId),
    brainTasks: repository.brainTasks.filter((item) => item.systemId === systemId),
    brainSessions: repository.brainSessions.filter((item) => item.currentSystemId === systemId),
    brainEvents: repository.brainEvents.filter((item) => {
      const task = repository.brainTasks.find((candidate) => candidate.id === item.taskId);
      return task?.systemId === systemId;
    }),
    semanticConcepts: repository.semanticConcepts.filter((item) => item.systemId === systemId),
    semanticAliases: repository.semanticAliases.filter((item) =>
      repository.semanticConcepts.some(
        (concept) => concept.id === item.conceptId && concept.systemId === systemId
      )
    ),
    semanticRelations: repository.semanticRelations.filter((item) => {
      const conceptIds = new Set(
        repository.semanticConcepts
          .filter((concept) => concept.systemId === systemId)
          .map((concept) => concept.id)
      );
      return conceptIds.has(item.fromConceptId) && conceptIds.has(item.toConceptId);
    }),
    semanticBindings: repository.semanticBindings.filter((item) => item.systemId === systemId),
    businessScenarios: repository.businessScenarios.filter((item) =>
      knowledgeProjectIds.has(item.knowledgeProjectId)
    ),
    scenarioAssuranceContracts: repository.scenarioAssuranceContracts.filter((item) =>
      repository.businessScenarios.some(
        (scenario) => scenario.id === item.scenarioId && knowledgeProjectIds.has(scenario.knowledgeProjectId)
      )
    ),
    scenarioTrustRecords: repository.scenarioTrustRecords.filter((item) =>
      repository.businessScenarios.some(
        (scenario) => scenario.id === item.scenarioId && knowledgeProjectIds.has(scenario.knowledgeProjectId)
      )
    ),
    onboardingPlans: repository.onboardingPlans.filter((item) => item.systemId === systemId),
    businessEntityInstances: repository.businessEntityInstances.filter(
      (item) => item.systemId === systemId
    ),
    testDataDependencies: repository.testDataDependencies.filter(
      (item) => item.systemId === systemId
    ),
    systemBrainSnapshots: repository.systemBrainSnapshots.filter(
      (item) => item.systemId === systemId
    ),
    systemBrainChangeSets: repository.systemBrainChangeSets.filter(
      (item) => item.systemId === systemId
    ),
    evaluationTrials: repository.evaluationTrials.filter(
      (item) =>
        knowledgeProjectIds.has(item.knowledgeProjectId) &&
        (!item.systemId || item.systemId === systemId)
    ),
    sourceSnapshots: repository.sourceSnapshots.filter((item) =>
      repository.evaluationTrials.some(
        (trial) =>
          trial.id === item.trialId &&
          knowledgeProjectIds.has(trial.knowledgeProjectId) &&
          (!trial.systemId || trial.systemId === systemId)
      )
    ),
    projectionManifests: repository.projectionManifests.filter((item) =>
      repository.evaluationTrials.some(
        (trial) =>
          trial.id === item.trialId &&
          knowledgeProjectIds.has(trial.knowledgeProjectId) &&
          (!trial.systemId || trial.systemId === systemId)
      )
    ),
    interventionRecords: repository.interventionRecords.filter((item) =>
      repository.evaluationTrials.some(
        (trial) =>
          trial.id === item.trialId &&
          knowledgeProjectIds.has(trial.knowledgeProjectId) &&
          (!trial.systemId || trial.systemId === systemId)
      )
    )
  };
}

function buildAssetIndex(repository: InMemoryBrainCreatorRepository) {
  const executableCaseById = new Map(repository.executableCases.map((item) => [item.id, item]));
  return [
    ...repository.systemProfiles.map((item) => ({ id: item.id, type: "system-profile", systemId: item.id, label: item.name })),
    ...repository.authProfiles.map((item) => ({ id: item.id, type: "auth-profile", systemId: item.projectId, label: `${item.env}:${item.role}` })),
    ...repository.pageModels.map((item) => ({ id: item.id, type: "page-model", systemId: item.projectId, label: item.name })),
    ...repository.locatorPoints.map((item) => ({ id: item.id, type: "locator-point", pageModelId: item.pageModelId, label: item.name })),
    ...repository.probeResults.map((item) => ({ id: item.id, type: "probe-result", pageModelId: item.pageModelId, label: item.type })),
    ...repository.trainingSessions.map((item) => ({ id: item.id, type: "training-session", systemId: item.projectId, label: item.id })),
    ...repository.apiFlows.map((item) => ({ id: item.id, type: "api-flow", sessionId: item.sessionId, label: item.name })),
    ...repository.generatedCases.map((item) => ({ id: item.id, type: "generated-case", systemId: item.projectId, pageModelId: item.pageModelId, label: item.sourceRequirement })),
    ...repository.glossaryTerms.map((item) => ({ id: item.id, type: "glossary-term", systemId: item.projectId, label: item.key })),
    ...repository.businessRules.map((item) => ({ id: item.id, type: "business-rule", systemId: item.systemId, label: item.name })),
    ...repository.testCases.map((item) => ({ id: item.id, type: "test-case", systemId: item.systemId, label: item.requirement })),
    ...repository.agentRuns.map((item) => ({ id: item.id, type: "agent-run", systemId: item.systemId, label: item.agent })),
    ...repository.agentTasks.map((item) => ({ id: item.id, type: "agent-task", systemId: item.systemId, label: item.agent })),
    ...repository.chainRuns.map((item) => ({ id: item.id, type: "chain-run", systemId: item.systemId, label: item.testCaseId })),
    ...repository.caseSources.map((item) => ({ id: item.id, type: "case-source", systemId: item.systemId, label: item.source })),
    ...repository.caseSuites.map((item) => ({ id: item.id, type: "case-suite", systemId: item.systemId, label: item.id })),
    ...repository.caseSuiteRuns.map((item) => ({ id: item.id, type: "case-suite-run", systemId: item.systemId, label: item.id })),
    ...repository.bugReports.map((item) => ({ id: item.id, type: "bug-report", systemId: item.systemId, label: item.caseNo })),
    ...repository.requirementSets.map((item) => ({ id: item.id, type: "requirement-set", projectId: item.knowledgeProjectId, label: item.title })),
    ...repository.attachmentAnalyses.map((item) => ({ id: item.id, type: "attachment-analysis", projectId: item.knowledgeProjectId, requirementSetId: item.requirementSetId, label: item.kind })),
    ...repository.workflowModels.map((item) => ({ id: item.id, type: "workflow-model", projectId: item.knowledgeProjectId, requirementSetId: item.requirementSetId, label: item.title })),
    ...repository.stateMachineModels.map((item) => ({ id: item.id, type: "state-machine-model", projectId: item.knowledgeProjectId, requirementSetId: item.requirementSetId, label: item.title })),
    ...repository.businessObjectModels.map((item) => ({ id: item.id, type: "business-object-model", requirementSetId: item.requirementSetId, label: item.name })),
    ...repository.decisionTableModels.map((item) => ({ id: item.id, type: "decision-table-model", requirementSetId: item.requirementSetId, label: item.title })),
    ...repository.explorationTasks.map((item) => ({ id: item.id, type: "exploration-task", systemId: item.systemId, requirementSetId: item.requirementSetId, label: item.reason })),
    ...repository.explorationPlans.map((item) => ({ id: item.id, type: "exploration-plan", systemId: item.systemId, requirementSetId: item.requirementSetId, label: item.status })),
    ...repository.testIntents.map((item) => ({ id: item.id, type: "test-intent", projectId: item.knowledgeProjectId, requirementSetId: item.requirementSetId, label: item.title })),
    ...repository.executableCases.map((item) => ({ id: item.id, type: "executable-case", systemId: item.systemId, requirementSetId: item.requirementSetId, testIntentId: item.testIntentId, label: item.title })),
    ...repository.executionEvidence.map((item) => ({ id: item.id, type: "execution-evidence", systemId: item.systemId, executableCaseId: item.executableCaseId, requirementSetId: executableCaseById.get(item.executableCaseId)?.requirementSetId, label: item.id })),
    ...repository.gaps.map((item) => ({ id: item.id, type: "gap", systemId: item.projectId, label: item.reason })),
    ...repository.brainTasks.map((item) => ({ id: item.id, type: "brain-task", systemId: item.systemId, label: item.operation })),
    ...repository.semanticConcepts.map((item) => ({ id: item.id, type: "semantic-concept", systemId: item.systemId, label: item.canonicalName })),
    ...repository.semanticBindings.map((item) => ({ id: item.id, type: "semantic-binding", systemId: item.systemId, requirementSetId: item.requirementSetId, label: item.type })),
    ...repository.businessScenarios.map((item) => ({ id: item.id, type: "business-scenario", projectId: item.knowledgeProjectId, requirementSetId: item.requirementSetId, label: item.title })),
    ...repository.scenarioAssuranceContracts.map((item) => ({ id: item.scenarioId, type: "scenario-assurance", label: item.verdict })),
    ...repository.scenarioTrustRecords.map((item) => ({ id: item.scenarioId, type: "scenario-trust", label: item.status })),
    ...repository.onboardingPlans.map((item) => ({ id: item.id, type: "onboarding-plan", systemId: item.systemId, requirementSetId: item.requirementSetId, label: item.status })),
    ...repository.businessEntityInstances.map((item) => ({ id: item.id, type: "business-entity", systemId: item.systemId, label: item.entityKey })),
    ...repository.testDataDependencies.map((item) => ({ id: item.id, type: "test-data-dependency", systemId: item.systemId, label: `${item.fromReference} -> ${item.toReference}` })),
    ...repository.systemBrainSnapshots.map((item) => ({ id: item.id, type: "system-brain-snapshot", systemId: item.systemId, label: `revision ${item.revision}` })),
    ...repository.systemBrainChangeSets.map((item) => ({ id: item.id, type: "system-brain-change-set", systemId: item.systemId, label: item.status })),
    ...repository.evaluationTrials.map((item) => ({ id: item.id, type: "evaluation-trial", systemId: item.systemId, projectId: item.knowledgeProjectId, label: `${item.provider}:${item.status}` })),
    ...repository.sourceSnapshots.map((item) => ({ id: item.id, type: "source-snapshot", projectId: item.knowledgeProjectId, requirementSetId: item.requirementSetId, label: item.contentHash })),
    ...repository.projectionManifests.map((item) => ({ id: item.id, type: "projection-manifest", label: item.operation })),
    ...repository.interventionRecords.map((item) => ({ id: item.id, type: "evaluation-intervention", label: item.category }))
  ];
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
