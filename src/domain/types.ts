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
  status: "draft" | "approved" | "running" | "completed" | "failed" | "cancelled";
  totalCases: number;
  selectedCaseNos: string[];
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
  status: "passed" | "failed" | "blocked";
  testCaseId?: string;
  chainRunId?: string;
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
