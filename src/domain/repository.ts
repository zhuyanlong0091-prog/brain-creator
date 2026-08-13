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
export const SHARDED_REPOSITORY_SCHEMA_VERSION = 17;

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

  constructor(
    private readonly storeDir: string,
    legacyFilePath = join(dirname(storeDir), "local-assets.json")
  ) {
    super();
    this.manifestPath = join(storeDir, "manifest.json");
    this.collectionsDir = join(storeDir, "collections");
    this.legacyFilePath = legacyFilePath;
    this.lockDir = join(storeDir, ".write.lock");
    this.restoreShardedOrMigrate();
  }

  override persist() {
    this.withLock(() => {
      const snapshot = snapshotRepository(this, SHARDED_REPOSITORY_SCHEMA_VERSION);
      mkdirSync(this.collectionsDir, { recursive: true });
      for (const key of collectionKeys()) {
        writeAtomicJson(join(this.collectionsDir, `${key}.json`), snapshot[key]);
      }
      this.writeOwnershipShards(snapshot);
      writeAtomicJson(join(this.storeDir, "indexes", "asset-index.json"), buildAssetIndex(this));
      writeAtomicJson(this.manifestPath, {
        format: "sharded",
        schemaVersion: SHARDED_REPOSITORY_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        collections: collectionKeys(),
        counts: repositoryCounts(this)
      });
    });
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
      if (manifest.format !== "sharded" || manifest.schemaVersion !== SHARDED_REPOSITORY_SCHEMA_VERSION) {
        throw new Error("Brain Creator sharded store manifest is invalid");
      }
      const collections = manifest.collections as unknown[];
      const expectedCollections = collectionKeys();
      if (
        collections.length !== expectedCollections.length ||
        expectedCollections.some((key) => !collections.includes(key))
      ) {
        throw new Error("Brain Creator sharded store manifest collections are invalid");
      }
      const snapshot = readShardedSnapshot(this.collectionsDir);
      applyRepositorySnapshot(this, snapshot);
      this.schemaVersion = SHARDED_REPOSITORY_SCHEMA_VERSION;
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

  private writeOwnershipShards(snapshot: RepositorySnapshot) {
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
    void snapshot;
  }

  private withLock(action: () => void) {
    mkdirSync(this.storeDir, { recursive: true });
    try {
      mkdirSync(this.lockDir);
    } catch {
      throw new Error("Brain Creator sharded store is locked by another writer");
    }
    try {
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
    requirementSets: repository.requirementSets,
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
    pageBindingDecisions: repository.pageBindingDecisions
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
    repository.requirementSets = snapshot.requirementSets ?? [];
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
    repository.compileRuns = snapshot.compileRuns ?? [];
    repository.pageBindingDecisions = snapshot.pageBindingDecisions ?? [];
}

function collectionKeys(): Array<Exclude<keyof RepositorySnapshot, "schemaVersion">> {
  return [
    "systemProfiles", "systemExplorations", "authProfiles", "authCheckpoints", "pageModels",
    "locatorPoints", "probeResults", "trainingSessions", "actionSteps", "apiFlows",
    "generatedCases", "gaps", "glossaryTerms", "businessRules", "testCases", "agentRuns",
    "agentTasks", "chainRuns", "caseSources", "caseSuites", "caseSuiteRuns", "bugReports",
    "knowledgeProjects", "requirementSources", "requirementSets", "knowledgeNodes",
    "knowledgeEdges", "testIntents", "testDataProfiles", "testDataTasks", "testDataLeases",
    "executableCases", "executionPlans", "requirementSuiteRuns", "executionEvidence",
    "executionDiagnoses", "executionDiagnosisReviews", "runLedgerEntries", "compileRuns",
    "pageBindingDecisions"
  ];
}

function readRepositorySnapshot(filePath: string): Partial<RepositorySnapshot> {
  const snapshot = JSON.parse(readFileSync(filePath, "utf8")) as Partial<RepositorySnapshot>;
  assertRepositorySnapshot(snapshot);
  return snapshot;
}

function readShardedSnapshot(collectionsDir: string): Partial<RepositorySnapshot> {
  const snapshot: Record<string, unknown> = { schemaVersion: SHARDED_REPOSITORY_SCHEMA_VERSION };
  for (const key of collectionKeys()) {
    const filePath = join(collectionsDir, `${key}.json`);
    if (!existsSync(filePath)) {
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
  writeFileSync(temporaryPath, value, "utf8");
  renameSync(temporaryPath, filePath);
}

function backupStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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
    requirementSets: repository.requirementSets.filter((item) => requirementSetIds.has(item.id)),
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
    pageBindingDecisions: repository.pageBindingDecisions.filter((item) => item.systemId === systemId)
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
    ...repository.testIntents.map((item) => ({ id: item.id, type: "test-intent", projectId: item.knowledgeProjectId, requirementSetId: item.requirementSetId, label: item.title })),
    ...repository.executableCases.map((item) => ({ id: item.id, type: "executable-case", systemId: item.systemId, requirementSetId: item.requirementSetId, testIntentId: item.testIntentId, label: item.title })),
    ...repository.executionEvidence.map((item) => ({ id: item.id, type: "execution-evidence", systemId: item.systemId, executableCaseId: item.executableCaseId, requirementSetId: executableCaseById.get(item.executableCaseId)?.requirementSetId, label: item.id })),
    ...repository.gaps.map((item) => ({ id: item.id, type: "gap", systemId: item.projectId, label: item.reason }))
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
