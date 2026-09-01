export type BrainName =
  | "requirement"
  | "system"
  | "testcase"
  | "testdata"
  | "testexecution";

export type BrainTaskState =
  | "created"
  | "context-ready"
  | "waiting-approval"
  | "waiting-provider"
  | "executing"
  | "evaluating"
  | "healing"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type BrainTaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type HarnessBudget = {
  maxAgentCalls: number;
  maxHealAttempts: number;
  maxWrites: number;
  maxDurationMs: number;
  maxContextChars: number;
};

export type HarnessPolicy = {
  allowedFiles: string[];
  allowedUrls: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  allowWrites: boolean;
  requireApproval: boolean;
};

export type BrainTask = {
  id: string;
  brain: BrainName;
  operation: string;
  knowledgeProjectId?: string;
  systemId?: string;
  requirementSetId?: string;
  sessionId?: string;
  state: BrainTaskState;
  status: BrainTaskStatus;
  inputSummary: string;
  inputRefs: string[];
  contextPack?: BrainContextPack;
  outputRefs: string[];
  provider?: string;
  policy: HarnessPolicy;
  budget: HarnessBudget;
  agentCalls: number;
  healAttempts: number;
  writeCount: number;
  eval?: BrainEvalResult;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type BrainSession = {
  id: string;
  knowledgeProjectId?: string;
  currentSystemId?: string;
  currentRequirementSetId?: string;
  activeTaskId?: string;
  lastRunId?: string;
  state: BrainTaskState;
  lastAction?: string;
  openBlockers: string[];
  provider?: string;
  createdAt: string;
  updatedAt: string;
};

export type BrainEventStatus =
  | "started"
  | "running"
  | "waiting"
  | "passed"
  | "failed"
  | "blocked";

export type BrainEvent = {
  id: string;
  sequence: number;
  sessionId?: string;
  taskId?: string;
  brain: BrainName;
  type: string;
  status: BrainEventStatus;
  message: string;
  traceId: string;
  refs: string[];
  createdAt: string;
};

export type SemanticConceptKind =
  | "module"
  | "object"
  | "field"
  | "action"
  | "workflow"
  | "state"
  | "role"
  | "term"
  | "data-entity"
  | "data-field"
  | "assertion"
  | "integration";

export type SemanticAssetStatus = "draft" | "confirmed" | "conflicted" | "deprecated";

export type SemanticConcept = {
  id: string;
  identityKey: string;
  knowledgeProjectId?: string;
  systemId?: string;
  requirementSetId?: string;
  kind: SemanticConceptKind;
  canonicalName: string;
  aliases: string[];
  scope?: string;
  sourceRefs: string[];
  confidence: number;
  status: SemanticAssetStatus;
  createdAt: string;
  updatedAt: string;
};

export type SemanticAlias = {
  id: string;
  conceptId: string;
  alias: string;
  normalizedAlias: string;
  sourceRefs: string[];
  confidence: number;
  status: SemanticAssetStatus;
  createdAt: string;
  updatedAt: string;
};

export type SemanticRelation = {
  id: string;
  fromConceptId: string;
  toConceptId: string;
  relation: string;
  sourceRefs: string[];
  confidence: number;
  status: SemanticAssetStatus;
  createdAt: string;
  updatedAt: string;
};

export type SemanticBinding = {
  id: string;
  requirementSetId: string;
  systemId: string;
  expectedSemanticId: string;
  observedSemanticId?: string;
  type: "exact" | "alias" | "step-expansion" | "conditional" | "missing" | "conflict";
  conditions: {
    role?: string;
    state?: string;
    dataRefs?: string[];
  };
  confidence: number;
  status: "candidate" | "confirmed" | "conflicted" | "stale";
  evidenceRefs: string[];
  confirmedBy?: string;
};

export type BusinessScenarioFamily =
  | "main-flow"
  | "branch"
  | "state-transition"
  | "invalid-transition"
  | "cross-role"
  | "exception"
  | "compensation"
  | "data"
  | "integration";

export type BusinessScenario = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  title: string;
  objective: string;
  family: BusinessScenarioFamily;
  actors: string[];
  preconditions: string[];
  workflowRefs: string[];
  stateTransitionRefs: string[];
  decisionRuleRefs: string[];
  testDataNeeds: string[];
  expectedBusinessOutcomes: string[];
  sourceRefs: string[];
  risk: "low" | "medium" | "high" | "critical";
  status: "draft" | "approved" | "stale" | "blocked";
};

export type ScenarioTrustStatus =
  | "generated"
  | "grounded"
  | "bound"
  | "verified"
  | "trusted"
  | "quarantined";

export type ScenarioAssuranceContract = {
  scenarioId: string;
  requirementRefs: string[];
  workflowRefs: string[];
  stateTransitionRefs: string[];
  decisionRuleRefs: string[];
  systemBinding: "unique" | "ambiguous" | "missing";
  testDataReadiness: "ready" | "creatable" | "blocked";
  oracleStrength: "strong" | "limited" | "none";
  unsupportedInferences: string[];
  risk: BusinessScenario["risk"];
  independence: "deterministic" | "isolated-single-provider" | "cross-provider" | "human-confirmed";
  verdict: "pass" | "needs-review" | "blocked";
  evidenceRefs: string[];
};

export type ScenarioTrustRecord = {
  scenarioId: string;
  status: ScenarioTrustStatus;
  strongRunCount: number;
  lastRequirementHash: string;
  lastSystemSnapshotHash?: string;
  lastDataPlanHash?: string;
  downgradeReason?: string;
  updatedAt: string;
};

export type OnboardingPlan = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  systemId: string;
  requirementSummary: string;
  baselineAssetIds: string[];
  baselineFingerprint?: string;
  explorationPlanId: string;
  unresolvedQuestions: string[];
  allowedRoutes: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  maxWrites: number;
  maxDurationMs: number;
  cleanupPolicy: "delete" | "close" | "retain-with-label";
  status: "draft" | "approved" | "completed" | "blocked";
  approvedBy?: string;
  approvedAt?: string;
};

export type EvaluationProviderDescriptor = {
  provider: "host-agent" | "claude" | "codex";
  modelFamily: "claude" | "openai" | "unknown";
  available: boolean;
  enabled: boolean;
  role: "primary" | "evaluator";
};

export type BusinessEntityInstance = {
  id: string;
  entityKey: string;
  semanticConceptId: string;
  knowledgeProjectId?: string;
  systemId?: string;
  values: Record<string, string | number | boolean | null>;
  status: "active" | "released" | "invalid";
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
  releasedAt?: string;
};

export type TestDataDependency = {
  id: string;
  systemId: string;
  fromReference: string;
  toReference: string;
  relation: "requires" | "created-by" | "transitions-to" | "verified-by";
  sourceRefs: string[];
  createdAt: string;
};

export type EvidenceReference = {
  ref: string;
  kind: "requirement" | "system" | "page" | "locator" | "workflow" | "state" | "data" | "execution" | "artifact";
  label?: string;
};

export type BrainContextPack = {
  taskId: string;
  purpose: "requirement" | "system" | "testcase" | "testdata" | "testexecution";
  summary: string;
  references: EvidenceReference[];
  content: string;
  estimatedChars: number;
  truncated: boolean;
};

export type BrainEvalResult = {
  verdict: "pass" | "needs-review" | "retry" | "blocked";
  score: number;
  reasons: string[];
  affectedAssetIds: string[];
  evidenceRefs: string[];
  nextActions: string[];
};

export type SystemBrainSnapshotAssetKind =
  | "page"
  | "locator"
  | "navigation"
  | "state"
  | "transition"
  | "workflow"
  | "api-flow";

export type SystemBrainSnapshotStatus = "candidate" | "confirmed" | "superseded";

export type SystemBrainSnapshotAsset = {
  semanticId: string;
  kind: SystemBrainSnapshotAssetKind;
  label: string;
  content: string;
  contentHash: string;
  sourceRefs: string[];
  metadata: Record<string, string | number | boolean | string[] | undefined>;
};

export type SystemBrainSnapshot = {
  id: string;
  knowledgeProjectId: string;
  systemId: string;
  revision: number;
  basedOnSnapshotId?: string;
  explorationIds: string[];
  status: SystemBrainSnapshotStatus;
  assets: SystemBrainSnapshotAsset[];
  contentHash: string;
  createdAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
};

export type SystemBrainChangeType =
  | "added"
  | "removed"
  | "renamed"
  | "locator-changed"
  | "behavior-changed"
  | "evidence-refreshed";

export type SystemBrainChangeImpact = "none" | "recompile" | "blocked";
export type SystemBrainChangeStatus = "auto-accepted" | "needs-review" | "conflicted";

export type SystemBrainChange = {
  semanticId: string;
  kind: SystemBrainSnapshotAssetKind;
  changeType: SystemBrainChangeType;
  before?: SystemBrainSnapshotAsset;
  after?: SystemBrainSnapshotAsset;
  confidence: number;
  impact: SystemBrainChangeImpact;
  status: SystemBrainChangeStatus;
  reasons: string[];
  sourceRefs: string[];
};

export type SystemBrainChangeSet = {
  id: string;
  knowledgeProjectId: string;
  systemId: string;
  fromSnapshotId?: string;
  toSnapshotId: string;
  status: "clean" | "needs-review" | "conflicted";
  changes: SystemBrainChange[];
  summary: {
    added: number;
    removed: number;
    renamed: number;
    locatorChanged: number;
    behaviorChanged: number;
    evidenceRefreshed: number;
  };
  affectedTestIntentIds?: string[];
  affectedExecutableCaseIds?: string[];
  createdAt: string;
};
