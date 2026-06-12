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
  | "agent-run"
  | "chain-run"
  | "agent-session"
  | "run-ledger-entry"
  | "rag-document";

export type AgentIntent =
  | "connect_system"
  | "configure_auth"
  | "generate_plan"
  | "approve_plan"
  | "run_chain"
  | "show_assets"
  | "show_gaps"
  | "unknown";

export type AgentLoopState =
  | "idle"
  | "intent_detected"
  | "context_building"
  | "planning"
  | "waiting_for_approval"
  | "waiting_for_auth"
  | "approved"
  | "generating"
  | "testing"
  | "healing"
  | "blocked"
  | "completed"
  | "cancelled";

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

export type AgentSession = {
  id: string;
  state: AgentLoopState;
  currentSystemId?: string;
  currentCaseId?: string;
  pendingCheckpointId?: string;
  lastChainRunId?: string;
  lastIntent?: AgentIntent;
  lastUserRequest?: string;
  createdAt: string;
  updatedAt: string;
};

export type EvalVerdict = "pass" | "needs_user" | "retry" | "blocked";

export type GapDraft = {
  reason: string;
  severity: Gap["severity"];
  sourceType: string;
  sourceId: string;
  owner: string;
};

export type EvalResult = {
  verdict: EvalVerdict;
  score: number;
  reasons: string[];
  requiredActions: string[];
  gaps: GapDraft[];
};

export type ContextReference = {
  assetType: string;
  assetId: string;
  title: string;
  summary: string;
  relevance: number;
  reason: string;
};

export type RunLedgerEntry = {
  id: string;
  sessionId: string;
  systemId?: string;
  intent: AgentIntent;
  action: string;
  fromState: AgentLoopState;
  toState: AgentLoopState;
  inputSummary: string;
  contextReferences: ContextReference[];
  outputSummary: string;
  evalResult?: EvalResult;
  error?: string;
  createdAt: string;
};

export type RagAssetType =
  | "system"
  | "glossary"
  | "rule"
  | "test-case"
  | "scenario"
  | "gap"
  | "evidence"
  | "spec-summary"
  | "test-summary"
  | "run-summary";

export type RagDocument = {
  id: string;
  systemId: string;
  assetType: RagAssetType;
  assetId: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  visibility: "active" | "archived";
  contentHash: string;
  updatedAt: string;
};

export type EmbeddingProvider = {
  embed(text: string): Promise<number[]>;
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

export type AssetSearchResult = {
  id: string;
  type: AssetType;
  label: string;
  projectId: string;
  status?: string;
};
