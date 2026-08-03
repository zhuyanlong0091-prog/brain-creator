export type TaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type GapStatus = "open" | "resolved";

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
  encryptedSecrets: Record<string, string>;
  status: TaskStatus;
  lastVerifiedAt?: string;
  failureReason?: string;
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
  }>;
  consoleErrors: string[];
  networkFailures: string[];
  issues: string[];
};

export type SystemExplorationBudget = {
  maxPages: number;
  maxDepth: number;
  maxDurationMs: number;
  maxInteractionsPerPage: number;
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
};

export type SystemExplorationInteractionTransition = {
  id: string;
  pageModelId: string;
  pageUrl: string;
  targetName: string;
  targetRole: string;
  targetSelector: string;
  targetKind: "tab" | "disclosure" | "select";
  action: "click" | "select";
  inputValue?: string;
  before: SystemInteractionState;
  after: SystemInteractionState;
  visibleAdded: string[];
  visibleRemoved: string[];
  dialogAdded: string[];
  dialogRemoved: string[];
  urlChanged: boolean;
  blockedRequests: Array<{ method: string; url: string }>;
  status: "observed" | "no-change" | "blocked" | "failed";
  screenshotPath?: string;
};

export type SystemExploration = {
  id: string;
  knowledgeProjectId: string;
  systemId: string;
  authProfileId?: string;
  startUrl: string;
  status: "running" | "completed" | "partial" | "blocked" | "cancelled";
  interactionMode: "off" | "safe";
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
export type RequirementAttachment = { name: string; url?: string; type?: string };

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

export type TestDesignTechnique =
  | "equivalence-partitioning"
  | "boundary-value"
  | "decision-table"
  | "state-transition"
  | "scenario"
  | "error-guessing";

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
  status: "draft" | "approved" | "compiled" | "blocked";
  createdAt: string;
  updatedAt: string;
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
    | "auth";
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
  steps: ExecutableCaseStep[];
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
  maxHealAttempts?: number;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  cancelled: number;
  currentExecutableCaseId?: string;
  caseRuns: RequirementSuiteCaseRun[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type ExecutableCase = {
  id: string;
  knowledgeProjectId: string;
  requirementSetId: string;
  testIntentId: string;
  systemId?: string;
  title: string;
  status: "ready" | "blocked" | "executed";
  preconditions: string[];
  steps: ExecutableCaseStep[];
  pathPlan?: ExecutableCasePathPlan;
  statePlan?: ExecutableCaseStatePlan;
  dataPlan?: ExecutableCaseDataPlan;
  dataProfileIds: string[];
  gapIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ExecutionStepEvidence = {
  stepId: string;
  order: number;
  action: ExecutableCaseStep["action"];
  instruction: string;
  expected?: string;
  actual?: string;
  assertionStatus: "pending" | "passed" | "failed" | "blocked";
  screenshotPath?: string;
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
  steps: ExecutionStepEvidence[];
  tracePaths: string[];
  artifactPaths: string[];
  consoleErrors: string[];
  networkFailures: string[];
  actualResult?: string;
  createdAt: string;
  completedAt?: string;
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
    | "case-skipped"
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
  message?: string;
  references?: {
    testCaseId?: string;
    executionPlanId?: string;
    testDataTaskId?: string;
    agentTaskId?: string;
    executionEvidenceId?: string;
    chainRunId?: string;
    diagnosisId?: string;
    bugReportId?: string;
    gapIds?: string[];
  };
  createdAt: string;
};
