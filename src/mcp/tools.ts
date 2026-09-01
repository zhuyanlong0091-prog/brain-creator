import { z } from "zod";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
  ToolAnnotations
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";

export type BrainCreatorToolName =
  | "bc_command"
  | "bc_intent_preview"
  | "bc_status"
  | "bc_prepare"
  | "bc_run"
  | "bc_review"
  | "bc_configure"
  | "bc_create_system"
  | "bc_list_systems"
  | "bc_session_resume"
  | "bc_system_overview"
  | "bc_archive_system"
  | "bc_create_auth"
  | "bc_list_auth"
  | "bc_verify_auth"
  | "bc_archive_auth"
  | "bc_generate_seed"
  | "bc_create_auth_checkpoint"
  | "bc_list_auth_checkpoints"
  | "bc_complete_auth_checkpoint"
  | "bc_cancel_auth_checkpoint"
  | "bc_add_term"
  | "bc_list_terms"
  | "bc_update_term"
  | "bc_delete_term"
  | "bc_batch_confirm_terms"
  | "bc_add_rule"
  | "bc_list_rules"
  | "bc_delete_rule"
  | "bc_generate_plan"
  | "bc_update_plan"
  | "bc_approve_plan"
  | "bc_cancel_plan"
  | "bc_resume_plan"
  | "bc_run_agent"
  | "bc_prepare_agent_task"
  | "bc_submit_agent_output"
  | "bc_list_agent_runs"
  | "bc_run_chain"
  | "bc_full_workflow"
  | "bc_list_chain_runs"
  | "bc_list_specs"
  | "bc_list_tests"
  | "bc_read_spec"
  | "bc_read_test"
  | "bc_artifact_overview"
  | "bc_list_cases"
  | "bc_list_gaps"
  | "bc_report_gap"
  | "bc_resolve_gap"
  | "bc_search_assets";

type ToolDefinition = {
  name: BrainCreatorToolName;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
};

type RegisterableMcpServer = {
  registerTool: (
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: z.ZodObject<z.ZodRawShape>;
      annotations?: ToolAnnotations;
    },
    handler: (
      input: Record<string, unknown>,
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>
    ) => Promise<CallToolResult>
  ) => unknown;
};

export type BrainCreatorToolRequest = {
  progressToken?: string | number;
  sendNotification?: (notification: ServerNotification) => Promise<void>;
};

export type BrainCreatorToolProfile = "facade" | "full";

export const FACADE_TOOL_NAMES = new Set<BrainCreatorToolName>([
  "bc_command",
  "bc_intent_preview",
  "bc_prepare",
  "bc_status",
  "bc_run",
  "bc_review",
  "bc_configure",
  "bc_submit_agent_output"
]);

const READ_ONLY_TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true
};

const READ_ONLY_TOOL_NAMES = new Set<BrainCreatorToolName>([
  "bc_intent_preview",
  "bc_status",
  "bc_review",
  "bc_list_systems",
  "bc_session_resume",
  "bc_system_overview",
  "bc_list_auth",
  "bc_list_auth_checkpoints",
  "bc_list_terms",
  "bc_list_rules",
  "bc_list_agent_runs",
  "bc_list_chain_runs",
  "bc_list_specs",
  "bc_list_tests",
  "bc_read_spec",
  "bc_read_test",
  "bc_artifact_overview",
  "bc_list_cases",
  "bc_list_gaps",
  "bc_search_assets"
]);

export const BRAIN_CREATOR_TOOLS: ToolDefinition[] = [
  {
    name: "bc_prepare",
    title: "Brain Creator prepare requirement",
    description:
      "Requirement-first facade for ingesting sources, confirming Requirement Eval, atomically approving a baseline with bounded first-system onboarding, reviewing or rolling back historical execution diagnoses, exploring System Brain, compiling evidence-bound cases, resolving compilation exploration tasks, preparing test data, and confirming immutable execution preflight snapshots.",
    inputSchema: z.object({
      action: z.enum([
        "ingest-requirement",
        "refresh-requirement",
        "analyze-attachments",
        "submit-attachment-analysis",
        "confirm-attachment-analysis",
        "generate-analysis",
        "generate-test-design",
        "confirm-eval-actions",
        "review-legacy-diagnosis",
        "rollback-legacy-diagnosis",
        "approve-baseline",
        "compile-cases",
        "confirm-page-binding",
        "create-onboarding-plan",
        "approve-onboarding-plan",
        "start-onboarding-plan",
        "create-exploration-plan",
        "approve-exploration-plan",
        "cancel-exploration-plan",
        "start-exploration-plan",
        "submit-exploration-result",
        "resolve-exploration-task",
        "resolve-gap",
        "dismiss-gap",
        "reopen-gap",
        "resolve-test-data",
        "prepare-test-data",
        "submit-test-data",
        "prepare-execution",
        "record-observation",
        "record-page-evidence",
        "record-interaction-evidence",
        "record-training-evidence",
        "explore-system",
        "refresh-system-brain",
        "confirm-system-snapshot"
      ]),
      knowledgeProjectId: z.string().optional(),
      systemBrainSnapshotId: z.string().optional(),
      requirementSetId: z.string().optional(),
      requirementSourceId: z.string().optional(),
      attachmentId: z.string().optional(),
      attachmentIds: z.array(z.string()).default([]),
      attachmentAnalysisId: z.string().optional(),
      testIntentId: z.string().optional(),
      testIntentIds: z.array(z.string()).default([]),
      modules: z.array(z.string()).default([]),
      pageModelId: z.string().optional(),
      explorationTaskId: z.string().optional(),
      explorationTaskIds: z.array(z.string()).default([]),
      explorationPlanId: z.string().optional(),
      onboardingPlanId: z.string().optional(),
      allowedRoutes: z.array(z.string().url()).default([]),
      explorationPlanActions: z.array(z.object({
        name: z.string().min(1),
        route: z.string().url(),
        role: z.string().optional(),
        write: z.boolean().default(false),
        sourceRefs: z.array(z.string()).min(1)
      })).default([]),
      forbiddenActions: z.array(z.string()).default([]),
      cleanupPolicy: z.enum(["delete", "close", "retain-with-label"]).optional(),
      maxWrites: z.number().int().min(0).max(20).optional(),
      explorationOutcome: z.enum(["resolved", "failed", "cancelled"]).optional(),
      failureReason: z.string().optional(),
      role: z.string().optional(),
      gapId: z.string().optional(),
      evidenceRefs: z.array(z.string()).default([]),
      responseMode: z.enum(["summary", "full"]).default("summary"),
      authProfileId: z.string().optional(),
      actorJourney: z
        .array(
          z.object({
            role: z.string().optional(),
            authProfileId: z.string(),
            afterStepId: z.string().optional(),
            sourceRefs: z.array(z.string()).default([])
          })
        )
        .optional(),
      explorationScenario: z
        .object({
          id: z.string().optional(),
          name: z.string().min(1),
          role: z.string().optional(),
          prerequisiteState: z.string().optional(),
          dataRefs: z.array(z.string()).default([]),
          testDataLeaseIds: z.array(z.string()).default([]),
          selectorValues: z.record(z.string(), z.string()).default({})
        })
        .optional(),
      startUrl: z.string().url().optional(),
      maxPages: z.number().int().min(1).max(25).optional(),
      maxDepth: z.number().int().min(0).max(4).optional(),
      maxDurationMs: z.number().int().min(5_000).max(300_000).optional(),
      interactionMode: z.enum(["off", "safe"]).default("off"),
      maxInteractionsPerPage: z.number().int().min(0).max(10).optional(),
      actionIds: z.array(z.string()).default([]),
      confirmedBy: z.string().optional(),
      executableCaseId: z.string().optional(),
      taskId: z.string().optional(),
      taskStatus: z.enum(["succeeded", "failed"]).optional(),
      dataDecision: z.enum(["reuse", "create"]).optional(),
      dataReference: z.string().optional(),
      dataValue: z.string().optional(),
      error: z.string().optional(),
      allowCreate: z.boolean().default(false),
      automatic: z.boolean().default(false),
      testDataResolutions: z
        .array(
          z.object({
            profileId: z.string(),
            decision: z.enum([
              "use-value",
              "reuse",
              "create",
              "capture",
              "secret-reference"
            ]),
            value: z.string().optional(),
            reference: z.string().optional()
          })
        )
        .default([]),
      confirmationNote: z.string().min(1).max(500).optional(),
      diagnosisAssetType: z.enum(["bug", "gap"]).optional(),
      diagnosisAssetId: z.string().optional(),
      diagnosisReviewId: z.string().optional(),
      diagnosisDecision: z
        .enum([
          "confirm_bug",
          "review_bug_as_gap",
          "confirm_gap",
          "needs_evidence",
          "override_classification"
        ])
        .optional(),
      correctedFailureType: z
        .enum([
          "assertion_failure",
          "auth_failure",
          "locator_failure",
          "network_failure",
          "automation_failure",
          "test_data_failure",
          "environment_failure",
          "execution_failure",
          "unknown_failure"
        ])
        .optional(),
      correctedVerdict: z
        .enum([
          "product_bug",
          "automation_gap",
          "test_data_gap",
          "auth_gap",
          "environment_gap",
          "network_gap",
          "execution_gap",
          "unknown_gap"
        ])
        .optional(),
      systemId: z.string().optional(),
      observationType: z.enum([
        "module", "actor", "object", "field", "rule", "workflow", "state", "permission",
        "integration", "data-constraint", "term", "requirement"
      ]).optional(),
      title: z.string().optional(),
      content: z.string().optional(),
      module: z.string().optional(),
      sourceRefs: z.array(z.string()).default([]),
      explorationResult: z.object({
        status: z.enum(["succeeded", "failed"]),
        durationMs: z.number().int().min(0),
        actionEvidence: z.array(z.object({
          actionId: z.string(),
          action: z.string(),
          route: z.string().url(),
          role: z.string().optional(),
          sourceRefs: z.array(z.string()).min(1)
        })).min(1),
        evidenceRefs: z.array(z.string()).min(1),
        pageModelIds: z.array(z.string()).default([]),
        systemExplorationIds: z.array(z.string()).default([]),
        trainingSessionIds: z.array(z.string()).default([]),
        taskEvidence: z.array(z.object({
          taskId: z.string().min(1),
          observedEvidence: z.array(z.string().min(1)).min(1),
          evidenceRefs: z.array(z.string().min(1)).min(1)
        })).optional(),
        cleanupStatus: z.enum(["completed", "not-required", "failed"]),
        error: z.string().optional()
      }).optional(),
      confidence: z.number().min(0).max(1).optional(),
      pageEvidence: z
        .object({
          title: z.string(),
          finalUrl: z.string().url(),
          domText: z.string(),
          screenshotPath: z.string(),
          interactiveElements: z.array(
            z.object({
              name: z.string(),
              role: z.string(),
              text: z.string(),
              selector: z.string()
            })
          ),
          consoleErrors: z.array(z.string()).default([]),
          networkFailures: z.array(z.string()).default([]),
          issues: z.array(z.string()).default([])
        })
        .optional(),
      interactionEvidence: z
        .object({
          pageUrl: z.string().url(),
          targetName: z.string(),
          targetRole: z.string(),
          targetSelector: z.string(),
          targetKind: z.enum(["tab", "disclosure", "select"]),
          action: z.enum(["click", "select"]),
          inputValue: z.string().optional(),
          before: z.object({
            id: z.string(),
            url: z.string().url(),
            visibleElements: z.array(z.string()),
            dialogs: z.array(z.string()),
            controlValues: z.array(z.object({ name: z.string(), value: z.string() })).optional()
          }),
          after: z.object({
            id: z.string(),
            url: z.string().url(),
            visibleElements: z.array(z.string()),
            dialogs: z.array(z.string()),
            controlValues: z.array(z.object({ name: z.string(), value: z.string() })).optional()
          }),
          visibleAdded: z.array(z.string()),
          visibleRemoved: z.array(z.string()),
          dialogAdded: z.array(z.string()),
          dialogRemoved: z.array(z.string()),
          changedControls: z.array(z.object({ name: z.string(), before: z.string(), after: z.string() })).optional(),
          urlChanged: z.boolean(),
          transitionKind: z.enum(["navigation", "state"]).optional(),
          blockedRequests: z.array(z.object({ method: z.string(), url: z.string().url() })),
          status: z.enum(["observed", "no-change", "blocked", "failed"]),
          screenshotPath: z.string().optional(),
          evidenceRefs: z.array(z.string()).min(1),
          scenarioId: z.string().optional()
        })
        .optional(),
      trainingEvidence: z
        .object({
          actions: z.array(
            z.object({
              type: z.string(),
              targetLocatorId: z.string(),
              inputValue: z.string().default(""),
              assertion: z.string().default("")
            })
          ),
          apiRequests: z.array(
            z.object({
              method: z.string(),
              url: z.string(),
              status: z.number().int()
            })
          ),
          artifacts: z
            .object({
              traceUrl: z.string(),
              harUrl: z.string(),
              screenshotUrl: z.string()
            })
            .optional()
        })
        .optional(),
      source: z.string().optional(),
      provider: z.enum(["builtin", "host-skill", "host-agent"]).default("builtin"),
      confirm: z.boolean().default(false),
      allowPrivateNetwork: z.boolean().default(false),
      contentPackage: z
        .object({
          title: z.string(),
          content: z.string(),
          blocks: z.array(z.object({ type: z.string(), text: z.string(), level: z.number().optional() })),
          attachments: z.array(z.object({
            blockId: z.string().optional(),
            fileToken: z.string().optional(),
            name: z.string(),
            mimeType: z.string().optional(),
            url: z.string().optional(),
            type: z.string().optional(),
            containerPath: z.string().optional(),
            containerEntry: z.string().optional(),
            pageNumber: z.number().int().positive().optional(),
            contentHash: z.string().optional(),
          })),
          source: z.string(),
          sourceType: z.enum(["local-file", "http", "feishu", "obsidian", "host-connector"]),
          contentHash: z.string(),
          updatedAt: z.string().optional(),
          warnings: z.array(z.string())
        })
        .optional(),
      analysisPackage: z.record(z.string(), z.unknown()).optional(),
      attachmentAnalysis: z
        .object({
          kind: z.enum(["table", "flowchart", "state-machine", "wireframe", "text-image", "other"]),
          markdown: z.string().min(1),
          nodes: z.array(z.object({ id: z.string(), type: z.string(), label: z.string() })),
          edges: z.array(z.object({
            from: z.string(),
            to: z.string(),
            condition: z.string().optional(),
            actor: z.string().optional()
          })),
          confidence: z.number().min(0).max(1)
        })
        .optional()
    })
  },
  {
    name: "bc_command",
    title: "Brain Creator command",
    description:
      "Minimal slash-command facade. Parses /bc help, /bc status, /bc run <path> with optional --system/--env and --case/--module/--priority filters, /bc continue, /bc bugs, /bc gaps, and /bc regress bugs into existing facade tools.",
    inputSchema: z.object({
      systemId: z.string().optional(),
      knowledgeProjectId: z.string().optional(),
      systemName: z.string().optional(),
      environment: z.string().optional(),
      command: z.string()
    })
  },
  {
    name: "bc_intent_preview",
    title: "Brain Creator intent preview",
    description:
      "Preview how a natural-language Brain Creator request maps to a facade tool call. Does not execute the suggested tool.",
    inputSchema: z.object({
      request: z.string(),
      systemId: z.string().optional(),
      systemName: z.string().optional(),
      environment: z.string().optional(),
      source: z.string().optional(),
      bugIds: z.array(z.string()).default([]),
      caseNos: z.array(z.string()).default([]),
      modules: z.array(z.string()).default([]),
      priorities: z.array(z.string()).default([])
    })
  },
  {
    name: "bc_status",
    title: "Brain Creator status",
    description:
      "Facade status entry for agents. Resolves by systemId or systemName and returns system, auth, bridge, cases, suites, bugs, gaps, artifacts, user summary, quick commands, and next action.",
    inputSchema: z.object({
      systemId: z.string().optional(),
      knowledgeProjectId: z.string().optional(),
      systemName: z.string().optional(),
      environment: z.string().optional(),
      include: z.array(z.string()).default([]),
      responseMode: z.enum(["summary", "full"]).default("summary")
    })
  },
  {
    name: "bc_run",
    title: "Brain Creator run",
    description:
      "Facade execution entry for approved cases, resumable requirement suites with per-case test-data preparation and cleanup, document case suites, and bug regression.",
    inputSchema: z.object({
      mode: z.enum(["approved-case", "full-workflow", "case-source-suite", "bug-regression", "requirement-suite"]),
      systemId: z.string().optional(),
      systemName: z.string().optional(),
      environment: z.string().optional(),
      caseId: z.string().optional(),
      source: z.string().optional(),
      suiteId: z.string().optional(),
        suiteAction: z
          .enum([
            "continue",
            "cancel",
            "retry",
            "skip",
            "claim-next-scheduled",
            "process-next-scheduled",
            "claim-scheduled",
            "renew-scheduled",
            "release-scheduled"
          ])
          .default("continue"),
        scheduleOwner: z.string().optional(),
        scheduleLeaseMs: z.number().int().positive().optional(),
        nextRunAt: z.string().optional(),
        scheduleError: z.string().optional(),
      resume: z.boolean().default(false),
      continueOnBlocked: z.boolean().default(false),
      allowCreateTestData: z.boolean().default(false),
      automaticTestData: z.boolean().default(false),
      caseNos: z.array(z.string()).default([]),
      modules: z.array(z.string()).default([]),
      priorities: z.array(z.string()).default([]),
      requirementSetIds: z.array(z.string()).default([]),
      writeBack: z.boolean().default(false),
      confirmWriteBack: z.boolean().default(false),
      confirm: z.boolean().default(false),
      maxHealAttempts: z.number().int().min(0).max(10).optional(),
      repeatCount: z.number().int().min(1).max(5).optional(),
      stabilityPolicy: z
        .object({
          targetIterations: z.number().int().min(1).max(1000),
          minIterations: z.number().int().min(1).optional(),
          maxDurationMs: z.number().int().min(1).optional(),
          maxFailureRate: z.number().min(0).max(1).optional(),
          maxConsecutiveFailures: z.number().int().min(0).optional(),
          minIntervalMs: z.number().int().min(0).optional(),
          maxIntervalMs: z.number().int().min(0).optional(),
          requireStrongEvidence: z.boolean().optional(),
          stopOnBlocked: z.boolean().optional()
        })
        .optional(),
      bugIds: z.array(z.string()).default([]),
      knowledgeProjectId: z.string().optional(),
      executableCaseId: z.string().optional(),
      authProfileId: z.string().optional(),
      operator: z.string().optional(),
      provider: z.string().optional(),
      sessionId: z.string().optional(),
      evidenceMode: z.enum(["strict", "compatibility"]).optional(),
      browserMode: z.enum(["headless", "observe"]).optional(),
      observationMode: z.enum(["summary", "step-by-step"]).default("summary"),
      responseMode: z.enum(["summary", "full"]).default("summary")
    })
  },
  {
    name: "bc_review",
    title: "Brain Creator review",
    description:
      "Facade review entry for onboarding plans, document and requirement suite runs, run-ledger timelines, execution diagnoses, cases, execution plans, bugs, gaps, artifacts, requirement quality, historical Requirement Eval accuracy, System Brain, and system exploration runs.",
    inputSchema: z.object({
      target: z.enum([
        "suite-run",
        "case",
        "bug",
        "gap",
        "artifact",
        "requirement",
        "knowledge",
        "coverage",
        "requirement-eval-accuracy",
        "system-brain",
        "system-exploration",
        "onboarding-plan",
        "exploration-plan",
        "test-intent",
        "executable-case",
        "execution-plan",
        "requirement-suite-run",
        "run-ledger",
        "execution-diagnosis",
        "evidence",
        "compile-run",
        "testdata"
      ]),
      knowledgeProjectId: z.string().optional(),
      requirementSetId: z.string().optional(),
      systemId: z.string().optional(),
      systemName: z.string().optional(),
      environment: z.string().optional(),
      view: z.enum(["current", "history", "diff"]).default("current"),
      fromSnapshotId: z.string().optional(),
      toSnapshotId: z.string().optional(),
      status: z.string().optional(),
      id: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
      minSampleSize: z.number().int().min(1).max(10_000).optional(),
      failureTypes: z
        .array(
          z.enum([
            "assertion_failure",
            "auth_failure",
            "locator_failure",
            "network_failure",
            "automation_failure",
            "test_data_failure",
            "environment_failure",
            "execution_failure",
            "unknown_failure"
          ])
        )
        .default([]),
      responseMode: z.enum(["summary", "full"]).default("summary")
    })
  },
  {
    name: "bc_configure",
    title: "Brain Creator configure",
    description: "Facade configuration entry for system, auth, term, rule, runtime, and auth checkpoint setup.",
    inputSchema: z.object({
      target: z.enum(["system", "auth", "term", "rule", "checkpoint", "knowledge-project", "system-binding", "connector", "runtime"]),
      operation: z.enum(["create", "verify", "preflight", "refresh", "archive", "update", "reload-config", "reload-store", "rebuild-index"]).default("create"),
      knowledgeProjectId: z.string().optional(),
      connector: z.enum(["feishu"]).optional(),
      systemId: z.string().optional(),
      name: z.string().optional(),
      environment: z.string().optional(),
      baseUrl: z.string().optional(),
      defaultLocale: z.string().default("zh-CN"),
      urlAllowlist: z.array(z.string()).default([]),
      env: z.string().optional(),
      role: z.string().optional(),
      loginMethod: z.enum(["password", "cookie", "token", "script"]).optional(),
      refreshProvider: z.enum(["token", "cookie", "oauth", "cas", "saml", "host-agent"]).optional(),
      secrets: z.record(z.string(), z.string()).default({}),
      key: z.string().optional(),
      zhCN: z.string().optional(),
      enUS: z.string().optional(),
      aliases: z.array(z.string()).default([]),
      pageScope: z.string().default("/"),
      condition: z.string().optional(),
      severity: z.enum(["block", "warn"]).optional(),
      authProfileId: z.string().optional(),
      testCaseId: z.string().optional(),
      reason: z.string().optional(),
      resumeInstruction: z.string().optional(),
      bridgeProvider: z.enum(["auto", "claude", "codex", "host-agent", "disabled"]).optional(),
      bridgeCommand: z.string().optional(),
      bridgeArgs: z.array(z.string()).optional(),
      bridgeTimeoutMs: z.number().int().min(1000).max(600000).optional(),
      providerConfigs: z.record(z.string(), z.string()).optional(),
      connectorConfigs: z.record(z.string(), z.string()).optional(),
      responseMode: z.enum(["summary", "full"]).default("summary")
    })
  },
  {
    name: "bc_create_system",
    title: "Create business system",
    description: "Create a reusable business system context.",
    inputSchema: z.object({
      name: z.string(),
      environment: z.string(),
      baseUrl: z.string(),
      defaultLocale: z.string().default("zh-CN"),
      urlAllowlist: z.array(z.string()).default([])
    })
  },
  {
    name: "bc_list_systems",
    title: "List business systems",
    description: "List all connected business systems.",
    inputSchema: z.object({})
  },
  {
    name: "bc_session_resume",
    title: "Resume session",
    description:
      "只读返回系统完整快照：系统配置、鉴权、规则、术语、用例状态、最近执行记录、Open Gap、Agent Bridge 状态和推荐下一步。替代新会话时的多次独立查询。",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_system_overview",
    title: "Business system overview",
    description: "Show asset counts and onboarding state for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_archive_system",
    title: "Archive business system",
    description: "Non-destructively archive a business system by marking it cancelled.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_create_auth",
    title: "Create auth profile",
    description: "Create an encrypted auth profile for a business system.",
    inputSchema: z.object({
      projectId: z.string(),
      env: z.string(),
      role: z.string(),
      loginMethod: z.enum(["password", "cookie", "token", "script"]),
      secrets: z.record(z.string(), z.string())
    })
  },
  {
    name: "bc_list_auth",
    title: "List auth profiles",
    description: "List redacted auth profiles for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_verify_auth",
    title: "Verify auth profile",
    description: "Mark an auth profile verified for local MVP use.",
    inputSchema: z.object({ id: z.string() })
  },
  {
    name: "bc_archive_auth",
    title: "Archive auth profile",
    description: "Non-destructively archive an auth profile by marking it cancelled.",
    inputSchema: z.object({ id: z.string() })
  },
  {
    name: "bc_generate_seed",
    title: "Generate seed file",
    description: "Generate a local Playwright seed fixture from a business system auth profile.",
    inputSchema: z.object({
      systemId: z.string(),
      authProfileId: z.string().optional(),
      outputDir: z.string().optional()
    })
  },
  {
    name: "bc_create_auth_checkpoint",
    title: "Create manual auth checkpoint",
    description: "Record that a user must complete protected authentication outside Brain Creator.",
    inputSchema: z.object({
      systemId: z.string(),
      authProfileId: z.string(),
      testCaseId: z.string().optional(),
      reason: z.string(),
      resumeInstruction: z.string()
    })
  },
  {
    name: "bc_list_auth_checkpoints",
    title: "List manual auth checkpoints",
    description: "List manual authentication checkpoints for a business system.",
    inputSchema: z.object({
      systemId: z.string(),
      status: z.enum(["awaiting-user", "completed", "cancelled"]).optional()
    })
  },
  {
    name: "bc_complete_auth_checkpoint",
    title: "Complete manual auth checkpoint",
    description: "Mark a manual authentication checkpoint completed without storing credentials.",
    inputSchema: z.object({ checkpointId: z.string() })
  },
  {
    name: "bc_cancel_auth_checkpoint",
    title: "Cancel manual auth checkpoint",
    description: "Mark a manual authentication checkpoint cancelled.",
    inputSchema: z.object({ checkpointId: z.string() })
  },
  {
    name: "bc_add_term",
    title: "Add glossary term",
    description: "Add a business glossary term for a system.",
    inputSchema: z.object({
      projectId: z.string(),
      key: z.string(),
      zhCN: z.string(),
      enUS: z.string(),
      aliases: z.array(z.string()).default([]),
      pageScope: z.string().default("/")
    })
  },
  {
    name: "bc_list_terms",
    title: "List glossary terms",
    description: "List glossary terms for a system.",
    inputSchema: z.object({
      projectId: z.string(),
      query: z.string().default("")
    })
  },
  {
    name: "bc_update_term",
    title: "Update glossary term",
    description: "Update a glossary term inside a business system.",
    inputSchema: z.object({
      projectId: z.string(),
      termId: z.string(),
      key: z.string(),
      zhCN: z.string(),
      enUS: z.string(),
      aliases: z.array(z.string()).default([]),
      pageScope: z.string().default("/")
    })
  },
  {
    name: "bc_delete_term",
    title: "Delete glossary term",
    description: "Delete a glossary term from a business system.",
    inputSchema: z.object({
      projectId: z.string(),
      termId: z.string()
    })
  },
  {
    name: "bc_batch_confirm_terms",
    title: "Confirm candidate terms",
    description: "Confirm or ignore Planner-discovered glossary term candidates from a draft test case.",
    inputSchema: z.object({
      caseId: z.string(),
      confirmTermIds: z.array(z.string()).default([]),
      ignoreTermIds: z.array(z.string()).default([])
    })
  },
  {
    name: "bc_add_rule",
    title: "Add business rule",
    description: "Add a quality gate business rule for a system.",
    inputSchema: z.object({
      systemId: z.string(),
      name: z.string(),
      condition: z.string(),
      severity: z.enum(["block", "warn"])
    })
  },
  {
    name: "bc_list_rules",
    title: "List business rules",
    description: "List business rules for a system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_delete_rule",
    title: "Delete business rule",
    description: "Delete a business rule from a business system.",
    inputSchema: z.object({
      systemId: z.string(),
      ruleId: z.string()
    })
  },
  {
    name: "bc_generate_plan",
    title: "Generate test plan",
    description: "Run planner flow and store a draft structured test case.",
    inputSchema: z.object({
      systemId: z.string(),
      requirement: z.string(),
      specPath: z.string().optional()
    })
  },
  {
    name: "bc_update_plan",
    title: "Update test plan",
    description: "Replace scenarios on a draft structured test case before approval.",
    inputSchema: z.object({
      caseId: z.string(),
      scenarios: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          priority: z.enum(["critical", "high", "medium", "low"]),
          businessRuleRef: z.string().optional(),
          steps: z.array(
            z.object({
              action: z.enum(["navigate", "fill", "click", "assert", "wait", "select"]),
              target: z.string(),
              value: z.string().optional(),
              expected: z.string().optional()
            })
          )
        })
      )
    })
  },
  {
    name: "bc_approve_plan",
    title: "Approve test plan",
    description: "Approve a draft test case before code generation.",
    inputSchema: z.object({ caseId: z.string() })
  },
  {
    name: "bc_cancel_plan",
    title: "Cancel test plan",
    description: "Record a user-interrupted draft or approved plan and create a gap.",
    inputSchema: z.object({
      caseId: z.string(),
      reason: z.string()
    })
  },
  {
    name: "bc_resume_plan",
    title: "Resume cancelled test plan",
    description: "Resume a cancelled plan after manual auth checkpoints are handled.",
    inputSchema: z.object({ caseId: z.string() })
  },
  {
    name: "bc_run_agent",
    title: "Run agent",
    description: "Run a single Planner, Generator, or Healer agent and record the AgentRun.",
    inputSchema: z.object({
      systemId: z.string(),
      agent: z.enum(["planner", "generator", "healer"]),
      inputSummary: z.string(),
      args: z.array(z.string()).default([]),
      outputPaths: z.array(z.string()).default([]),
      timeoutMs: z.number().int().positive().optional()
    })
  },
  {
    name: "bc_prepare_agent_task",
    title: "Prepare host-agent task",
    description:
      "Prepare a Planner, Generator, or Healer task for the current host agent to execute without starting a subprocess.",
    inputSchema: z.object({
      systemId: z.string(),
      agent: z.enum(["planner", "generator", "healer"]),
      inputSummary: z.string(),
      args: z.array(z.string()).default([]),
      outputPaths: z.array(z.string()).default([])
    })
  },
  {
    name: "bc_submit_agent_output",
    title: "Submit host-agent output",
    description:
      "Submit a prepared host-agent result. Requirement tasks revalidate the frozen ExecutionPlan before recording any AgentRun or executing generated output.",
    inputSchema: z.object({
      taskId: z.string(),
      status: z.enum(["succeeded", "failed"]),
      stdout: z.string().default(""),
      stderr: z.string().default(""),
      outputPaths: z.array(z.string()).optional()
    })
  },
  {
    name: "bc_list_agent_runs",
    title: "List agent runs",
    description: "List Planner, Generator, and Healer agent runs for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_run_chain",
    title: "Run test chain",
    description: "Run generator/test/healer chain for an approved test case.",
    inputSchema: z.object({
      caseId: z.string(),
      maxHealAttempts: z.number().int().min(0).max(10).optional(),
      evidenceMode: z.enum(["strict", "compatibility"]).optional()
    })
  },
  {
    name: "bc_full_workflow",
    title: "Full workflow: approve + run",
    description:
      "一键审批并执行：对草稿用例先调用 bc_approve_plan，审批通过后自动执行 bc_run_chain。用于用户已审核计划、确认可执行的场景，减少两次独立工具调用。",
    inputSchema: z.object({
      caseId: z.string(),
      maxHealAttempts: z.number().int().min(0).max(10).optional(),
      evidenceMode: z.enum(["strict", "compatibility"]).optional()
    })
  },
  {
    name: "bc_list_chain_runs",
    title: "List chain runs",
    description: "List generator/test/healer chain runs for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_list_specs",
    title: "List test specs",
    description: "List generated Markdown test specs for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_list_tests",
    title: "List test files",
    description: "List generated Playwright test files for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_read_spec",
    title: "Read test spec",
    description: "Read a generated Markdown test spec that belongs to a business system.",
    inputSchema: z.object({
      systemId: z.string(),
      path: z.string()
    })
  },
  {
    name: "bc_read_test",
    title: "Read test file",
    description: "Read a generated Playwright test file that belongs to a business system.",
    inputSchema: z.object({
      systemId: z.string(),
      path: z.string()
    })
  },
  {
    name: "bc_artifact_overview",
    title: "Artifact overview",
    description: "Summarize generated spec and test artifacts for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_list_cases",
    title: "List test cases",
    description: "List structured test cases for a business system.",
    inputSchema: z.object({ systemId: z.string() })
  },
  {
    name: "bc_list_gaps",
    title: "List gaps",
    description: "List open, resolved, or dismissed gaps for a business system.",
    inputSchema: z.object({
      projectId: z.string(),
      status: z.enum(["open", "resolved", "dismissed"]).optional()
    })
  },
  {
    name: "bc_report_gap",
    title: "Report gap",
    description: "Record an external preflight, manual workflow, or evidence gap.",
    inputSchema: z.object({
      projectId: z.string(),
      sourceType: z.string(),
      sourceId: z.string(),
      reason: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      owner: z.string()
    })
  },
  {
    name: "bc_resolve_gap",
    title: "Resolve gap",
    description: "Mark a gap resolved inside a business system.",
    inputSchema: z.object({
      projectId: z.string(),
      gapId: z.string()
    })
  },
  {
    name: "bc_search_assets",
    title: "Search assets",
    description: "Search Brain Creator assets inside a business system.",
    inputSchema: z.object({
      projectId: z.string(),
      query: z.string()
    })
  }
];

export function registerBrainCreatorTools(
  server: RegisterableMcpServer,
  handler: (
    name: BrainCreatorToolName,
    input: Record<string, unknown>,
    request?: BrainCreatorToolRequest
  ) => Promise<CallToolResult>,
  profile: BrainCreatorToolProfile = "full"
) {
  for (const tool of BRAIN_CREATOR_TOOLS.filter(
    (candidate) => profile === "full" || FACADE_TOOL_NAMES.has(candidate.name)
  )) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: READ_ONLY_TOOL_NAMES.has(tool.name)
          ? READ_ONLY_TOOL_ANNOTATIONS
          : undefined
      },
      (input, extra) => handler(tool.name, input, {
        progressToken: extra._meta?.progressToken,
        sendNotification: extra.sendNotification
      })
    );
  }
}

export function parseBrainCreatorToolProfile(value?: string): BrainCreatorToolProfile {
  const profile = value ?? "full";
  if (profile === "facade" || profile === "full") return profile;
  throw new Error(`Unsupported Brain Creator tool profile: ${profile}`);
}
