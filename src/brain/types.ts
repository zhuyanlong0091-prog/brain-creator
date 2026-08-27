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
  | "assertion";

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
  kind: "requirement" | "page" | "locator" | "workflow" | "state" | "data" | "execution" | "artifact";
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
  createdAt: string;
};
