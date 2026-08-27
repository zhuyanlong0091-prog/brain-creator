export type TaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type GapStatus = "open" | "resolved" | "dismissed";

export type AssetType =
  | "system-profile"
  | "auth-profile"
  | "auth-checkpoint"
  | "case-source"
  | "case-suite"
  | "case-suite-run"
  | "bug-report"
  | "page-model"
  | "locator-point"
  | "training-session"
  | "api-flow"
  | "generated-case"
  | "gap"
  | "glossary-term"
  | "business-rule"
  | "test-case"
  | "test-spec"
  | "test-file"
  | "system-exploration"
  | "agent-task"
  | "agent-run"
  | "chain-run";

export type SystemProfile = {
  id: string;
  name: string;
  environment: string;
  baseUrl: string;
  defaultLocale: string;
  urlAllowlist: string[];
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type AuthProfile = {
  id: string;
  projectId: string;
  env: string;
  role: string;
  loginMethod: "password" | "cookie" | "token" | "script";
  refreshProvider?: "token" | "cookie" | "oauth" | "cas" | "saml" | "host-agent";
  encryptedSecrets: Record<string, string>;
  status: TaskStatus;
  lastVerifiedAt?: string;
  failureReason?: string;
  verificationEvidence?: {
    status: "valid";
    targetUrl: string;
    finalUrl: string;
    title?: string;
    verifiedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type AuthCheckpointStatus = "awaiting-user" | "completed" | "cancelled";

export type AuthCheckpoint = {
  id: string;
  systemId: string;
  authProfileId: string;
  testCaseId?: string;
  reason: string;
  resumeInstruction: string;
  status: AuthCheckpointStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type PageModel = {
  id: string;
  projectId: string;
  route: string;
  name: string;
  version: number;
  domSnapshotId: string;
  screenshotId: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type LocatorPoint = {
  id: string;
  pageModelId: string;
  name: string;
  selector: string;
  role: string;
  text: string;
  fallbackSelectors: string[];
  confidence: number;
};

export type ProbeResult = {
  id: string;
  pageModelId: string;
  type: string;
  result: string;
  issues: string[];
  surfaceEvidence?: BrowserSurfaceEvidence[];
  createdAt: string;
};

export type PageCaptureEvidence = {
  title: string;
  finalUrl: string;
  domText: string;
  screenshotPath: string;
  interactiveElements: Array<{
    name: string;
    role: string;
    text: string;
    selector: string;
    surface?: InteractionSurfaceRef;
  }>;
  consoleErrors: string[];
  networkFailures: string[];
  issues: string[];
  surfaces?: BrowserSurfaceEvidence[];
};

export type BrowserSurfaceEvidence = {
  kind: "document" | "iframe" | "shadow-root" | "wujie" | "popup";
  url: string;
  parentUrl?: string;
  /** Stable ordinal among child frames on the captured page. */
  frameIndex?: number;
  accessible: boolean;
  interactiveCount: number;
  title?: string;
  domText?: string;
  screenshotPath?: string;
  evidence?: string;
};

export type SystemExplorationBudget = {
  maxPages: number;
  maxDepth: number;
  maxDurationMs: number;
  maxInteractionsPerPage: number;
};

/**
 * A user-approved exploration context. Selector values are non-secret values
 * used to reveal conditional UI states; reusable test data stays referenced by
 * id instead of being copied into browser or report output.
 */
export type ExplorationScenario = {
  id: string;
  name: string;
  role?: string;
  prerequisiteState?: string;
  dataRefs: string[];
  testDataLeaseIds: string[];
  selectorValues: Record<string, string>;
};

export type SystemExplorationNavigationEdge = {
  fromUrl: string;
  toUrl: string;
  text: string;
  fromPageModelId: string;
  toPageModelId?: string;
};

export type SystemInteractionState = {
  id: string;
  url: string;
  visibleElements: string[];
  dialogs: string[];
  surfaceUrls?: Array<{
    kind: "iframe";
    url: string;
    frameIndex: number;
  }>;
  /** Non-secret control state used to detect SPA changes without a DOM text change. */
  controlValues?: Array<{ name: string; value: string }>;
};

export type InteractionSurfaceRef = {
  kind: "document" | "iframe" | "shadow-root" | "wujie" | "popup";
  url: string;
  parentUrl?: string;
  /** Stable ordinal among child frames on the captured page. */
  frameIndex?: number;
  /** Stable host selector chain for an open shadow/Wujie surface. */
  hostSelectors?: string[];
};

export type SystemExplorationInteractionTransition = {
  id: string;
  pageModelId: string;
  pageUrl: string;
  targetName: string;
  targetRole: string;
  targetSelector: string;
  targetKind: "tab" | "disclosure" | "select";
  surface?: InteractionSurfaceRef;
  action: "click" | "select";
  inputValue?: string;
  before: SystemInteractionState;
  after: SystemInteractionState;
  visibleAdded: string[];
  visibleRemoved: string[];
  dialogAdded: string[];
  dialogRemoved: string[];
  changedControls?: Array<{ name: string; before: string; after: string }>;
  urlChanged: boolean;
  transitionKind?: "navigation" | "state";
  blockedRequests: Array<{ method: string; url: string }>;
  status: "observed" | "no-change" | "blocked" | "failed";
  reacquiredPage?: boolean;
  recovery?: InteractionRecoveryEvidence;
  screenshotPath?: string;
  evidenceRefs?: string[];
  scenarioId?: string;
};

export type InteractionRecoveryEvidence = {
  trigger: "page-closed" | "interaction-failure" | "page-closed-after-action";
  method: "new-page-and-reload";
  fromUrl: string;
  toUrl: string;
  attempts: number;
  status: "recovered" | "failed";
};

export type SystemExploration = {
  id: string;
  knowledgeProjectId: string;
  systemId: string;
  authProfileId?: string;
  startUrl: string;
  status: "running" | "completed" | "partial" | "blocked" | "cancelled";
  interactionMode: "off" | "safe";
  scenario?: ExplorationScenario;
  budget: SystemExplorationBudget;
  pageModelIds: string[];
  navigationEdges: SystemExplorationNavigationEdge[];
  interactionTransitions: SystemExplorationInteractionTransition[];
  warnings: string[];
  gapIds: string[];
  artifactDir: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type TrainingSession = {
  id: string;
  projectId: string;
  pageModelId: string;
  videoUrl: string;
  traceUrl: string;
  harUrl?: string;
  screenshotUrl?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type ActionStep = {
  id: string;
  sessionId: string;
  type: string;
  targetLocatorId: string;
  inputValue: string;
  assertion: string;
  order: number;
};

export type ApiRequest = {
  method: string;
  url: string;
  status: number;
};

export type ApiFlow = {
  id: string;
  sessionId: string;
  name: string;
  requests: ApiRequest[];
  dependencies: string[];
  assertions: string[];
};

export type Gap = {
  id: string;
  projectId: string;
  sourceType: string;
  sourceId: string;
  reason: string;
  severity: "low" | "medium" | "high";
  owner: string;
  status: GapStatus;
  lifecycle?: Array<{
    operation: "resolve" | "dismiss" | "reopen";
    note: string;
    evidenceRefs: string[];
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type GeneratedCase = {
  id: string;
  projectId: string;
  sourceRequirement: string;
  pageModelId: string;
  steps: GeneratedStep[];
  status: "draft" | "ready" | "blocked";
  gaps: Gap[];
  createdAt: string;
};

export type GeneratedStep = {
  order: number;
  instruction: string;
  locatorPointId: string;
};

export type GlossaryTerm = {
  id: string;
  projectId: string;
  key: string;
  zhCN: string;
  enUS: string;
  aliases: string[];
  pageScope: string;
  createdAt: string;
  updatedAt: string;
};

export type BusinessRule = {
  id: string;
  systemId: string;
  name: string;
  condition: string;
  severity: "block" | "warn";
  createdAt: string;
};

export type TestCaseStatus =
  | "draft"
  | "approved"
  | "generating"
  | "passed"
  | "failed"
  | "cancelled";

export type TestCase = {
  id: string;
  systemId: string;
  requirement: string;
  status: TestCaseStatus;
  scenarios: TestCaseScenario[];
  newTerms: GlossaryTerm[];
  ruleCheckResult: RuleCheckResult;
  specId?: string;
  testFileId?: string;
  chainRunId?: string;
  cancellationReason?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type TestCaseScenario = {
  id: string;
  title: string;
  priority: "critical" | "high" | "medium" | "low";
  steps: TestCaseStep[];
  businessRuleRef?: string;
};

export type TestCaseStep = {
  action: "navigate" | "fill" | "click" | "assert" | "wait" | "select";
  target: string;
  value?: string;
  expected?: string;
};

export type RuleCheckResult = {
  passed: boolean;
  checks: Array<{
    ruleId: string;
    ruleName: string;
    covered: boolean;
    detail: string;
  }>;
};

export type AgentRun = {
  id: string;
  systemId: string;
  agent: "planner" | "generator" | "healer";
  status: TaskStatus;
  inputSummary: string;
  outputPaths: string[];
  duration: number;
  logs: string[];
  error?: string;
  createdAt: string;
};

export type AgentTask = {
  id: string;
  systemId: string;
  agent: AgentRun["agent"];
  status: "pending" | "submitted" | "failed" | "cancelled";
  inputSummary: string;
  args: string[];
  outputPaths: string[];
  promptPath: string;
  contextPath: string;
  planContext?: {
    requirement: string;
    specPath: string;
    promptPath: string;
    seedPath: string;
  };
  chainContext?: {
    testCaseId: string;
    specPath: string;
    seedPath?: string;
    testPath: string;
    generateRunId?: string;
    maxHealAttempts?: number;
    healAttempts?: number;
    knowledgeProjectId?: string;
    executableCaseId?: string;
    executionPlanId?: string;
    executionEvidenceId?: string;
    contextPackPath?: string;
    requirementSuiteRunId?: string;
    requiredStepIds?: string[];
    actorJourneyRoles?: string[];
    browserMode?: BrowserExecutionMode;
  };
  suiteContext?: {
    suiteId: string;
    sourceId: string;
    caseNo: string;
    title: string;
  };
  regressionContext?: {
    bugReportId: string;
    sourceId: string;
    caseNo: string;
    title: string;
    previousStatus: "open" | "retest-failed";
    remainingBugIds: string[];
    maxHealAttempts?: number;
  };
  submitTool: "bc_submit_agent_output";
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  agentRunId?: string;
  stdout?: string;
  stderr?: string;
};

export type ChainRun = {
  id: string;
  systemId: string;
  testCaseId: string;
  status: "running" | "succeeded" | "partial" | "failed";
  planRunId?: string;
  generateRunId?: string;
  healRunId?: string;
  specPath?: string;
  testPath?: string;
  gaps: Gap[];
  createdAt: string;
  completedAt?: string;
};

export type TestArtifact = {
  id: string;
  systemId: string;
  type: "test-spec" | "test-file";
  path: string;
  sourceType: "agent-run" | "chain-run";
  sourceId: string;
  status: string;
  createdAt: string;
  testCaseId?: string;
};

export type CaseSource = {
  id: string;
  systemId: string;
  source: string;
  sourceType: "xlsx" | "markdown" | "obsidian" | "claudian" | "unknown";
  contentHash: string;
  caseCount: number;
  moduleStats: Record<string, number>;
  priorityStats: Record<string, number>;
  status: "active" | "stale" | "failed";
  parsedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type DocumentCase = {
  caseNo: string;
  title: string;
  module: string;
  precondition: string;
  steps: string[];
  expectedResult: string;
  actualResult?: string;
  priority: "P0" | "P1" | "P2" | "P3" | string;
  status?: string;
  bugId?: string;
  remark?: string;
  sourceRow: number;
};

export type CaseSuite = {
  id: string;
  systemId: string;
  sourceId: string;
  status:
    | "draft"
    | "approved"
    | "running"
    | "waiting-for-agent"
    | "blocked"
    | "completed"
    | "failed"
    | "cancelled";
  totalCases: number;
  selectedCaseNos: string[];
  continueOnBlocked?: boolean;
  browserMode?: BrowserExecutionMode;
  createdAt: string;
  updatedAt: string;
};

export type CaseSuiteRun = {
  id: string;
  systemId: string;
  suiteId: string;
  sourceId: string;
  status: "running" | "completed" | "failed" | "blocked";
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  caseResults: CaseSuiteCaseResult[];
  artifactPaths: string[];
  bugReportIds: string[];
  gapIds: string[];
  createdAt: string;
  completedAt?: string;
};

export type CaseSuiteCaseResult = {
  caseNo: string;
  title: string;
  status: "passed" | "failed" | "blocked" | "waiting-for-agent";
  testCaseId?: string;
  chainRunId?: string;
  diagnosisId?: string;
  bugReportId?: string;
  gapIds: string[];
  error?: string;
};

export type BugReport = {
  id: string;
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
  status: "open" | "retest-running" | "retest-passed" | "retest-failed" | "closed";
  createdAt: string;
  updatedAt: string;
};

export type AssetSearchResult = {
  id: string;
  type: AssetType;
  label: string;
  projectId: string;
  status?: string;
};

export type KnowledgeProject = {
  id: string;
  key: string;
  name: string;
  defaultLocale: string;
  status: "active" | "archived";
  systemIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type RequirementSourceType =
  | "local-file"
  | "http"
  | "feishu"
  | "obsidian"
  | "host-connector";

export type RequirementContentBlock = { type: string; text: string; level?: number };
export type RequirementAttachmentStatus =
  | "discovered"
  | "downloading"
  | "downloaded"
  | "recognizing"
  | "structured"
  | "confirmed"
  | "needs-auth"
  | "failed";

export type RequirementAttachment = {
  id?: string;
  sourceId?: string;
  blockId?: string;
  fileToken?: string;
  name: string;
  mimeType?: string;
  /** Legacy source packages used type for either MIME type or block kind. */
  type?: string;
  url?: string;
  containerPath?: string;
  containerEntry?: string;
  pageNumber?: number;
  status?: RequirementAttachmentStatus;
  localPath?: string;
  contentHash?: string;
  attempts?: number;
  recognitionAttempts?: number;
  analysisId?: string;
  failureReason?: string;
};

export type AttachmentAnalysisKind =
  | "table"
  | "flowchart"
  | "state-machine"
  | "wireframe"
  | "text-image"
  | "other";

export type AttachmentAnalysis = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  sourceId: string;
  attachmentId: string;
  kind: AttachmentAnalysisKind;
  markdown: string;
  nodes: Array<{ id: string; type: string; label: string }>;
  edges: Array<{ from: string; to: string; condition?: string; actor?: string }>;
  confidence: number;
  sourceRefs: string[];
  provider: "host-agent" | "adapter";
  status: "draft" | "confirmed" | "failed";
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
};

export type RequirementContentPackage = {
  title: string;
  content: string;
  blocks: RequirementContentBlock[];
  attachments: RequirementAttachment[];
  source: string;
  sourceType: RequirementSourceType;
  contentHash: string;
  updatedAt?: string;
  warnings: string[];
};

export type RequirementSource = {
  id: string;
  knowledgeProjectId: string;
  source: string;
  sourceType: RequirementSourceType;
  title: string;
  contentHash: string;
  content: string;
  blocks: RequirementContentBlock[];
  attachments: RequirementAttachment[];
  warnings: string[];
  accessStatus: "available" | "needs-connector" | "failed";
  revision: number;
  latestRequirementSetId?: string;
  createdAt: string;
  updatedAt: string;
};

export type RequirementEvalActionKind =
  | "clarification"
  | "contradiction"
  | "missing-branch"
  | "uncovered-coverage"
  | "unconfirmed-attachment"
  | "missing-process-coverage"
  | "unsupported-claim";

export type RequirementEvalAction = {
  id: string;
  kind: RequirementEvalActionKind;
  message: string;
  sourceRefs: string[];
  gapIds: string[];
  status: "pending" | "confirmed" | "blocked";
  createdAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  confirmationNote?: string;
  resolutionNodeId?: string;
};

export type RequirementEvaluationGate = {
  policyId: string;
  policyVersion: string;
  verdict: "pass" | "needs-user" | "blocked";
  score: number;
  coverage: {
    totalClauses: number;
    coveredClauses: number;
    coverageRate: number;
    uncoveredSourceRefs: string[];
  };
  status: "passed" | "needs-confirmation" | "confirmed" | "blocked";
  actions: RequirementEvalAction[];
  generatedAt: string;
  confirmedAt?: string;
};

export type RequirementSet = {
  id: string;
  knowledgeProjectId: string;
  sourceId: string;
  version: number;
  title: string;
  summary: string;
  contentHash: string;
  status: "draft" | "approved" | "superseded";
  affectedNodeIds: string[];
  evaluationGate?: RequirementEvaluationGate;
  previousRequirementSetId?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeNodeType =
  | "module"
  | "actor"
  | "object"
  | "field"
  | "rule"
  | "workflow"
  | "state"
  | "permission"
  | "integration"
  | "data-constraint"
  | "term"
  | "requirement";

export type KnowledgeNode = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId?: string;
  systemId?: string;
  type: KnowledgeNodeType;
  title: string;
  content: string;
  module: string;
  sourceRefs: string[];
  origin: "source" | "derived" | "observed";
  confidence: number;
  status: "draft" | "confirmed" | "conflicted" | "deprecated";
  policyId?: string;
  policyVersion?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeEdge = {
  id: string;
  knowledgeProjectId: string;
  fromNodeId: string;
  toNodeId: string;
  relation: string;
  sourceRefs: string[];
  createdAt: string;
};

export type BrowserExecutionMode = "headless" | "observe";

export type ProcessModelStatus = "draft" | "confirmed" | "conflicted";

export type WorkflowModel = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  attachmentAnalysisId: string;
  title: string;
  actors: string[];
  steps: Array<{
    id: string;
    label: string;
    actor?: string;
    sourceRefs: string[];
  }>;
  transitions: Array<{
    id: string;
    from: string;
    to: string;
    condition?: string;
    actor?: string;
    sourceRefs: string[];
  }>;
  startStepIds: string[];
  endStepIds: string[];
  sourceRefs: string[];
  confidence: number;
  status: ProcessModelStatus;
  createdAt: string;
  updatedAt: string;
};

export type StateMachineModel = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  attachmentAnalysisId: string;
  title: string;
  states: Array<{
    id: string;
    label: string;
    initial: boolean;
    terminal: boolean;
    sourceRefs: string[];
  }>;
  transitions: Array<{
    id: string;
    from: string;
    to: string;
    trigger?: string;
    actor?: string;
    sourceRefs: string[];
  }>;
  sourceRefs: string[];
  confidence: number;
  status: ProcessModelStatus;
  createdAt: string;
  updatedAt: string;
};

export type TestDesignTechnique =
  | "equivalence-partitioning"
  | "boundary-value"
  | "decision-table"
  | "state-transition"
  | "scenario"
  | "error-guessing";

export type CoverageDimension =
  | "field"
  | "workflow"
  | "state"
  | "permission"
  | "integration";

export type RequirementCoverageProfile = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  inputHash: string;
  dimensions: Record<
    CoverageDimension,
    {
      requirementRefs: string[];
      coveredRefs: string[];
      missingRefs: string[];
      intentCount: number;
    }
  >;
  workflowModelIds: string[];
  stateMachineModelIds: string[];
  status: "complete" | "needs-user" | "blocked";
  reasons: string[];
  generatedAt: string;
};

export type TestIntent = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  title: string;
  module: string;
  priority: "P0" | "P1" | "P2" | "P3";
  objective: string;
  preconditions: string[];
  expectedResults: string[];
  requirementRefs: string[];
  knowledgeNodeRefs: string[];
  techniques: TestDesignTechnique[];
  coverageDimensions?: CoverageDimension[];
  scenarioType?: "positive" | "negative";
  processModelRefs?: string[];
  actorJourney?: string[];
  status:
    | "draft"
    | "approved"
    | "compiled"
    | "stale"
    | "needs-exploration"
    | "needs-data"
    | "ambiguous"
    | "blocked";
  createdAt: string;
  updatedAt: string;
};

export type PageBindingDecision = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  testIntentId: string;
  systemId: string;
  pageModelId: string;
  role?: string;
  note: string;
  confirmedAt: string;
};

export type CompileRunItem = {
  testIntentId: string;
  result:
    | "ready"
    | "needs-exploration"
    | "needs-data"
    | "blocked"
    | "ambiguous"
    | "skipped"
    | "reused";
  executableCaseId?: string;
  explorationTaskIds?: string[];
  gapIds: string[];
  reason?: string;
};

export type CompileRun = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  systemId?: string;
  status: "completed" | "completed-with-blockers" | "failed";
  total: number;
  ready: number;
  needsExploration: number;
  needsData: number;
  blocked: number;
  ambiguous: number;
  skipped: number;
  reused: number;
  items: CompileRunItem[];
  createdAt: string;
};

export type CompilationStageName =
  | "requirement-path"
  | "system-brain"
  | "test-data"
  | "step-provenance"
  | "executable-case";

export type CompilationStageResult = {
  stage: CompilationStageName;
  verdict: "ready" | "needs-exploration" | "needs-data" | "ambiguous" | "blocked";
  reason?: string;
  sourceRefs: string[];
};

export type ExplorationTask = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  testIntentId: string;
  executableCaseId?: string;
  systemId: string;
  kind: "page-binding" | "navigation-path" | "state-action" | "locator-evidence";
  status: "pending" | "resolved" | "failed" | "cancelled";
  reason: string;
  query: string;
  candidatePageModelIds: string[];
  requestedEvidence: string[];
  sourceRefs: string[];
  resultSourceRefs: string[];
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  failureReason?: string;
};

export type ExplorationPlanAction = {
  id: string;
  name: string;
  route: string;
  role?: string;
  write: boolean;
  sourceRefs: string[];
};

export type ExplorationActionEvidence = {
  actionId: string;
  action: string;
  route: string;
  role?: string;
  sourceRefs: string[];
};

export type ExplorationPlan = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  systemId: string;
  explorationTaskIds: string[];
  executableCaseIds: string[];
  actorJourney: ActorJourneyConfig[];
  allowedRoutes: string[];
  allowedActions: ExplorationPlanAction[];
  forbiddenActions: string[];
  testDataLeaseIds: string[];
  cleanupPolicy: "delete" | "close" | "retain-with-label";
  maxWrites: number;
  maxDurationMs: number;
  status: "draft" | "approved" | "running" | "completed" | "blocked" | "cancelled";
  approvalNote?: string;
  approvedBy?: string;
  approvedAt?: string;
  actionEvidence: ExplorationActionEvidence[];
  evidenceRefs: string[];
  systemExplorationIds: string[];
  pageModelIds: string[];
  trainingSessionIds: string[];
  gapIds: string[];
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type TestDataProfile = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  name: string;
  field: string;
  strategy:
    | "fixed"
    | "generated"
    | "unique"
    | "existing-reference"
    | "runtime-captured"
    | "secret-reference";
  constraints: string[];
  seed: string;
  dependsOnFields?: string[];
  cleanup?: "none" | "delete-created" | "restore";
  sourceRefs: string[];
  createdAt: string;
};

export type ExecutableCaseStep = {
  id: string;
  order: number;
  action: "navigate" | "fill" | "click" | "assert" | "wait" | "select" | "api";
  instruction: string;
  targetSemantic: string;
  value?: string;
  expected?: string;
  assertion?: {
    type: AssertionContractType;
    strength?: AssertionStrength;
    expected?: string;
  };
  pageModelId?: string;
  locatorPointId?: string;
  dataProfileId?: string;
  origin: "source" | "derived" | "observed";
  sourceRefs: string[];
};

export type ExecutableCasePathPlan = {
  verdict: "not-required" | "unique" | "ambiguous" | "missing";
  reason?: string;
  startPageModelId?: string;
  targetPageModelId?: string;
  pageModelIds: string[];
  navigationSourceRefs: string[];
  candidatePathCount: number;
  candidatePaths: Array<{
    pageModelIds: string[];
    navigationLabels: string[];
    sourceRefs: string[];
  }>;
};

export type ExecutableCaseStatePlan = {
  verdict: "not-required" | "unique" | "ambiguous" | "missing";
  reason?: string;
  pageModelId?: string;
  candidateCount: number;
  candidates: Array<{
    transitionId: string;
    targetName: string;
    action: "click" | "select";
    inputValue?: string;
    effects: string[];
    sourceRefs: string[];
  }>;
  transitionSourceRefs: string[];
};

export type ExecutableCaseDataOperation = {
  profileId: string;
  field: string;
  strategy: TestDataProfile["strategy"];
  decision:
    | "use-fixed"
    | "generate"
    | "lookup"
    | "reuse"
    | "create"
    | "capture"
    | "resolve-secret";
  status: "proposed" | "ready" | "needs-resolution" | "blocked";
  value?: string;
  reference?: string;
  lookupQuery?: string;
  secretRef?: string;
  dependsOnProfileIds: string[];
  cleanup: "none" | "delete-created" | "restore";
  constraints: string[];
  reason?: string;
  sourceRefs: string[];
};

export type ExecutableCaseDataPlan = {
  verdict: "not-required" | "ready" | "blocked";
  reasons: string[];
  operations: ExecutableCaseDataOperation[];
  dependencyOrder: string[];
  requiresConfirmation: boolean;
  confirmedAt?: string;
  requiresCleanup: boolean;
  sourceRefs: string[];
};

export type TestDataTask = {
  id: string;
  knowledgeProjectId: string;
  systemId: string;
  executableCaseId: string;
  profileId: string;
  field: string;
  action: "lookup-or-create" | "cleanup";
  status: "pending" | "submitted" | "failed" | "cancelled";
  idempotencyKey: string;
  allowCreate: boolean;
  cleanup: "none" | "delete-created" | "restore";
  lookupQuery?: string;
  leaseId?: string;
  contextPath: string;
  promptPath: string;
  sourceRefs: string[];
  outputSourceRefs: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
};

export type TestDataLease = {
  id: string;
  knowledgeProjectId: string;
  systemId: string;
  executableCaseId: string;
  profileId: string;
  taskId: string;
  decision: "reuse" | "create";
  reference: string;
  value?: string;
  cleanup: "none" | "delete-created" | "restore";
  status: "active" | "released" | "cleanup-failed";
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
  releasedAt?: string;
};

export type ExecutionPreflightCheck = {
  id:
    | "requirement"
    | "system"
    | "executable-case"
    | "open-gaps"
    | "workflow-path"
    | "state-actions"
    | "test-data-tasks"
    | "test-data"
    | "test-data-cleanup"
    | "auth"
    | "actor-journey";
  status: "pass" | "action-required" | "blocked";
  message: string;
  sourceRefs: string[];
};

export type ExecutionDataBinding = {
  profileId: string;
  field: string;
  decision: ExecutableCaseDataOperation["decision"];
  value?: string;
  reference?: string;
  secretRef?: string;
  leaseId?: string;
  cleanup: ExecutableCaseDataOperation["cleanup"];
  sourceRefs: string[];
};

export type ExecutionContextPack = {
  knowledgeProjectId: string;
  purpose: "generator";
  query: string;
  content: string;
  references: Array<{
    nodeId: string;
    sourceRefs: string[];
    type: KnowledgeNodeType;
  }>;
  truncated: boolean;
};

export type ActorJourneyConfig = {
  role?: string;
  authProfileId: string;
  afterStepId?: string;
  sourceRefs?: string[];
};

export type ActorJourneyStep = {
  id: string;
  order: number;
  role: string;
  authProfileId: string;
  afterStepId?: string;
  sourceRefs: string[];
};

export type ExecutionPlanDraft = {
  knowledgeProjectId: string;
  requirementSetId: string;
  systemId: string;
  executableCaseId: string;
  title: string;
  preconditions: string[];
  auth?: {
    profileId: string;
    role: string;
    method: AuthProfile["loginMethod"];
    verifiedAt?: string;
  };
  actorJourney?: ActorJourneyStep[];
  steps: ExecutableCaseStep[];
  assertionContracts?: AssertionContract[];
  pathPlan?: ExecutableCasePathPlan;
  statePlan?: ExecutableCaseStatePlan;
  dataBindings: ExecutionDataBinding[];
  contextPack: ExecutionContextPack;
  checks: ExecutionPreflightCheck[];
  verdict: "ready" | "needs-confirmation" | "blocked";
  blockers: string[];
  sourceRefs: string[];
  snapshotHash: string;
  generatedAt: string;
};

export type ExecutionPlan = Omit<ExecutionPlanDraft, "verdict"> & {
  id: string;
  verdict: "ready";
  confirmedAt: string;
};

export type RequirementSuiteCaseAttempt = {
  status: "failed" | "blocked";
  executionPlanId?: string;
  testCaseId?: string;
  agentTaskId?: string;
  executionEvidenceId?: string;
  chainRunId?: string;
  diagnosisId?: string;
  bugReportId?: string;
  gapIds: string[];
  error?: string;
  startedAt?: string;
  completedAt?: string;
  archivedAt: string;
};

export type RequirementSuiteCaseRun = {
  executableCaseId: string;
  executionPlanId?: string;
  title: string;
  order: number;
  status:
    | "queued"
    | "running"
    | "waiting-for-test-data"
    | "waiting-for-agent"
    | "passed"
    | "failed"
    | "blocked"
    | "skipped"
    | "cancelled";
  testDataTaskId?: string;
  testDataPhase?: "prepare" | "cleanup";
  pendingOutcome?: RequirementSuiteCaseOutcome;
  testCaseId?: string;
  agentTaskId?: string;
  executionEvidenceId?: string;
  chainRunId?: string;
  diagnosisId?: string;
  bugReportId?: string;
  gapIds: string[];
  attempts: RequirementSuiteCaseAttempt[];
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type RequirementSuiteCaseOutcome = {
  status: "passed" | "failed" | "blocked";
  chainRunId?: string;
  diagnosisId?: string;
  bugReportId?: string;
  gapIds: string[];
  failureType?: ExecutionFailureType;
  error?: string;
};

export type RequirementSuiteRun = {
  id: string;
  knowledgeProjectId: string;
  systemId: string;
  authProfileId?: string;
  operator?: string;
  provider?: string;
  sessionId?: string;
  actorJourney?: ActorJourneyConfig[];
  browserMode?: BrowserExecutionMode;
  status:
    | "running"
    | "waiting-for-test-data"
    | "waiting-for-agent"
    | "blocked"
    | "completed"
    | "failed"
    | "cancelled";
  continueOnBlocked: boolean;
  allowCreateTestData: boolean;
  automaticTestData?: boolean;
  maxHealAttempts?: number;
  stabilityGroupId?: string;
  stabilityIteration?: number;
  stabilityTarget?: number;
  stabilityNextRunId?: string;
  stabilityPolicy?: StabilityPolicy;
  stabilitySchedule?: StabilitySchedule;
  requirementSetIds?: string[];
  reconciliation?: RequirementReconciliation;
  coverageSnapshot?: RequirementCoverageSnapshot;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  cancelled: number;
  currentExecutableCaseId?: string;
  reportPath?: string;
  caseRuns: RequirementSuiteCaseRun[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type StabilityPolicy = {
  targetIterations: number;
  minIterations?: number;
  maxDurationMs?: number;
  maxFailureRate?: number;
  maxConsecutiveFailures?: number;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  requireStrongEvidence?: boolean;
  stopOnBlocked?: boolean;
};

export type StabilitySchedule = {
  status: "active" | "paused" | "completed" | "exhausted";
  nextRunAt?: string;
  lastStartedAt?: string;
  attemptCount?: number;
  leaseId?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastError?: string;
};

export type RequirementReconciliation = {
  status: "complete" | "partial" | "conflicted";
  systemId: string;
  requirementSetIds: string[];
  observedRequirementSetIds: string[];
  caseIds: string[];
  missingCaseIds: string[];
  missingRequirementSetIds: string[];
  duplicateCompileKeys: string[];
  crossSystemCaseIds: string[];
  supersededCaseIds: string[];
  evaluatedAt: string;
};

export type RequirementCoverageSnapshot = RequirementReconciliation & {
  knowledgeProjectId: string;
  expectedTestIntentIds: string[];
  observedTestIntentIds: string[];
  missingTestIntentIds: string[];
  missingExecutableCaseIntentIds: string[];
  supersededRequirementSetIds: string[];
  unboundCaseIds: string[];
};

export type ExecutableCase = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  testIntentId: string;
  systemId?: string;
  title: string;
  status:
    | "ready"
    | "stale"
    | "needs-exploration"
    | "needs-data"
    | "ambiguous"
    | "blocked"
    | "executed"
    | "superseded";
  compileKey?: string;
  systemBrainSnapshotId?: string;
  staleReason?: string;
  staleAt?: string;
  staleByChangeSetId?: string;
  supersededById?: string;
  preconditions: string[];
  steps: ExecutableCaseStep[];
  pathPlan?: ExecutableCasePathPlan;
  statePlan?: ExecutableCaseStatePlan;
  dataPlan?: ExecutableCaseDataPlan;
  coverageDimensions?: CoverageDimension[];
  dataProfileIds: string[];
  explorationTaskIds?: string[];
  compilationStages?: CompilationStageResult[];
  gapIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ExecutionStepEvidence = {
  stepId: string;
  order: number;
  action: ExecutableCaseStep["action"];
  instruction: string;
  targetSemantic?: string;
  value?: string;
  pageModelId?: string;
  locatorPointId?: string;
  dataProfileId?: string;
  expected?: string;
  actual?: string;
  assertionStatus: "pending" | "passed" | "failed" | "blocked";
  screenshotPath?: string;
  pageUrl?: string;
  evidenceRefs?: string[];
  traceRefs?: string[];
  sourceRefs: string[];
  origin: ExecutableCaseStep["origin"];
};

export type ExecutionEvidence = {
  id: string;
  knowledgeProjectId: string;
  systemId: string;
  executableCaseId: string;
  executionPlanId?: string;
  testCaseId: string;
  chainRunId?: string;
  contextPackPath: string;
  status: "running" | "passed" | "failed" | "blocked";
  assuranceLevel?: AssuranceLevel;
  assertionContracts?: AssertionContract[];
  reporterPath?: string;
  reporterResult?: StructuredReporterResult;
  evidenceWarnings?: string[];
  coverage?: {
    required: CoverageDimension[];
    verified: CoverageDimension[];
    missing: CoverageDimension[];
  };
  actorJourney?: ActorJourneyStep[];
  steps: ExecutionStepEvidence[];
  tracePaths: string[];
  artifactPaths: string[];
  consoleErrors: string[];
  networkFailures: string[];
  actualResult?: string;
  createdAt: string;
  completedAt?: string;
};

export type AssertionContractType =
  | "visibility"
  | "value"
  | "state"
  | "workflow"
  | "network"
  | "side-effect";

export type AssertionStrength = "strong" | "limited";

export type AssuranceLevel = "strong" | "limited" | "none";

export type AssertionContract = {
  id: string;
  stepId?: string;
  type: AssertionContractType;
  strength: AssertionStrength;
  expected?: string;
  requirementRefs: string[];
  evidenceRequirements: Array<"actual-value" | "screenshot" | "trace" | "network" | "console">;
};

export type StructuredReporterAssertion = {
  id: string;
  stepId?: string;
  status: "passed" | "failed" | "skipped" | "unknown";
  actual?: string;
  expected?: string;
  evidenceRefs: string[];
};

export type StructuredReporterStep = {
  id: string;
  title: string;
  status: "passed" | "failed" | "skipped" | "unknown";
  durationMs?: number;
  pageUrl?: string;
  evidenceRefs: string[];
  traceRefs?: string[];
  consoleErrors?: string[];
  networkFailures?: string[];
  error?: string;
};

export type StructuredReporterResult = {
  status: "passed" | "failed" | "blocked";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  assertions: StructuredReporterAssertion[];
  steps?: StructuredReporterStep[];
  attachments: string[];
  consoleErrors: string[];
  networkFailures: string[];
};

export type ExecutionFailureType =
  | "assertion_failure"
  | "auth_failure"
  | "locator_failure"
  | "network_failure"
  | "automation_failure"
  | "test_data_failure"
  | "environment_failure"
  | "execution_failure"
  | "unknown_failure";

export type ExecutionDiagnosisVerdict =
  | "passed"
  | "product_bug"
  | "automation_gap"
  | "test_data_gap"
  | "auth_gap"
  | "environment_gap"
  | "network_gap"
  | "execution_gap"
  | "unknown_gap";

export type ExecutionDiagnosis = {
  id: string;
  knowledgeProjectId?: string;
  systemId: string;
  requirementSuiteRunId?: string;
  executableCaseId?: string;
  caseSourceId?: string;
  caseSuiteId?: string;
  caseNo?: string;
  executionEvidenceId?: string;
  chainRunId?: string;
  bugReportId?: string;
  gapIds: string[];
  legacyReviewId?: string;
  testCaseId: string;
  verdict: ExecutionDiagnosisVerdict;
  failureType?: ExecutionFailureType;
  confidence: "high" | "medium" | "low";
  retry: {
    attempted: number;
    max: number;
    exhausted: boolean;
    eligible: boolean;
  };
  reasons: string[];
  evidenceRefs: string[];
  createdAt: string;
};

export type LegacyDiagnosisSuggestion =
  | "confirm_bug"
  | "review_bug_as_gap"
  | "confirm_gap"
  | "needs_evidence";

export type LegacyDiagnosisDecision =
  | LegacyDiagnosisSuggestion
  | "override_classification";

export type ExecutionDiagnosisReview = {
  id: string;
  systemId: string;
  assetType: "bug" | "gap";
  assetId: string;
  proposedFailureType: ExecutionFailureType;
  proposedVerdict: ExecutionDiagnosisVerdict;
  suggestedDecision: LegacyDiagnosisSuggestion;
  decision: LegacyDiagnosisDecision;
  confirmedFailureType?: ExecutionFailureType;
  confirmedVerdict?: ExecutionDiagnosisVerdict;
  matchesSuggestion?: boolean;
  note: string;
  status: "recorded" | "migrated" | "rolled-back";
  priorAssetStatus: string;
  resultingAssetStatus: string;
  diagnosisId?: string;
  createdGapId?: string;
  rollback?: {
    note: string;
    diagnosisId?: string;
    removedGapId?: string;
    restoredAssetStatus: string;
    rolledBackAt: string;
  };
  createdAt: string;
};

export type RunLedgerEntry = {
  id: string;
  runType?: "requirement-suite" | "document-suite";
  knowledgeProjectId?: string;
  systemId: string;
  requirementSuiteRunId?: string;
  caseSuiteId?: string;
  caseSourceId?: string;
  executableCaseId?: string;
  caseNo?: string;
  event:
    | "suite-created"
    | "auth-preflight"
    | "case-started"
    | "test-data-task-requested"
    | "test-data-task-completed"
    | "test-data-task-failed"
    | "execution-plan-frozen"
    | "agent-task-requested"
    | "failure-diagnosed"
    | "case-completed"
    | "suite-resumed"
    | "case-retried"
    | "role-switched"
    | "case-skipped"
    | "schedule-claimed"
    | "progress"
    | "suite-cancelled"
    | "suite-completed";
  scope: "suite" | "case";
  stage:
    | "suite"
    | "test-data-prepare"
    | "test-data-cleanup"
    | "preflight"
    | "generator"
    | "execution";
  fromStatus?: string;
  toStatus: string;
  outcome?: "passed" | "failed" | "blocked" | "skipped" | "cancelled";
  failureType?: ExecutionFailureType;
  operator?: string;
  provider?: string;
  sessionId?: string;
  traceId?: string;
  sequence?: number;
  caseTitle?: string;
  stepId?: string;
  stepTitle?: string;
  progressStatus?: ExecutionProgressStatus;
  pageUrl?: string;
  elapsedMs?: number;
  screenshotPath?: string;
  assertionSummary?: string;
  waitReason?: string;
  currentStep?: string;
  message?: string;
  references?: {
    testCaseId?: string;
    executionPlanId?: string;
    testDataTaskId?: string;
    authProfileId?: string;
    agentTaskId?: string;
    executionEvidenceId?: string;
    chainRunId?: string;
    leaseId?: string;
    leaseExpiresAt?: string;
    diagnosisId?: string;
    bugReportId?: string;
    gapIds?: string[];
  };
  createdAt: string;
};

export type ExecutionProgressStatus =
  | "started"
  | "running"
  | "waiting"
  | "passed"
  | "failed"
  | "blocked";

export type ExecutionProgressEvent = {
  sequence: number;
  runId: string;
  caseId?: string;
  caseTitle?: string;
  stage: RunLedgerEntry["stage"];
  stepId?: string;
  stepTitle?: string;
  status: ExecutionProgressStatus;
  pageUrl?: string;
  elapsedMs: number;
  screenshotPath?: string;
  assertionSummary?: string;
  waitReason?: string;
  traceId: string;
  createdAt: string;
};
