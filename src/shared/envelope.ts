import { randomUUID } from "node:crypto";

export type BrainCreatorUserMessage = {
  enUS: string;
  zhCN: string;
};

export type BrainCreatorErrorDetail = {
  code: string;
  userMessage: BrainCreatorUserMessage;
  technicalMessage: string;
  nextAction?: string;
  retryable: boolean;
};

export type Envelope<T> = {
  success: boolean;
  data: T | null;
  errors: string[];
  traceId: string;
  error?: BrainCreatorErrorDetail;
};

export class BrainCreatorError extends Error {
  readonly code: string;
  readonly userMessage: BrainCreatorUserMessage;
  readonly nextAction?: string;
  readonly retryable: boolean;

  constructor(input: {
    code: string;
    message: string;
    userMessage: BrainCreatorUserMessage;
    nextAction?: string;
    retryable: boolean;
  }) {
    super(input.message);
    this.name = "BrainCreatorError";
    this.code = input.code;
    this.userMessage = input.userMessage;
    this.nextAction = input.nextAction;
    this.retryable = input.retryable;
  }
}

export function successEnvelope<T>(data: T): Envelope<T> {
  return {
    success: true,
    data,
    errors: [],
    traceId: randomUUID()
  };
}

export function errorEnvelope(error: unknown): Envelope<never> {
  const message = error instanceof Error ? error.message : String(error);
  const detail = errorDetail(error, message);
  return {
    success: false,
    data: null,
    errors: [message],
    traceId: randomUUID(),
    error: detail
  };
}

function errorDetail(error: unknown, message: string): BrainCreatorErrorDetail {
  if (error instanceof BrainCreatorError) {
    return {
      code: error.code,
      userMessage: error.userMessage,
      technicalMessage: message,
      nextAction: error.nextAction,
      retryable: error.retryable
    };
  }
  if (/not found/i.test(message)) {
    return knownError(
      "BC_ASSET_NOT_FOUND",
      message,
      "The requested Brain Creator asset was not found.",
      "未找到请求的 Brain Creator 资产。",
      "review-status"
    );
  }
  if (/belongs to another|does not belong|must be bound/i.test(message)) {
    return knownError(
      "BC_SCOPE_MISMATCH",
      message,
      "The selected asset belongs to a different business system.",
      "所选资产属于其他业务系统。",
      "select-correct-system"
    );
  }
  if (/baseline must be approved/i.test(message)) {
    return knownError(
      "BC_BASELINE_NOT_APPROVED",
      message,
      "Approve the requirement baseline before compiling cases.",
      "编译用例前需要先批准需求基线。",
      "approve-baseline"
    );
  }
  if (/test data plan must be confirmed/i.test(message)) {
    return knownError(
      "BC_TEST_DATA_NOT_CONFIRMED",
      message,
      "Confirm the executable case test-data plan before automatic resolution.",
      "请先确认可执行用例的测试数据计划，再进行自动解析。",
      "confirm-test-data-plan"
    );
  }
  if (/reporter.*missing|not auditable/i.test(message)) {
    return knownError(
      "BC_REPORTER_MISSING",
      message,
      "Structured Playwright evidence was not produced, so the result cannot be treated as auditable.",
      "未生成结构化 Playwright 证据，当前结果不能作为可审计结果。",
      "inspect-reporter-output"
    );
  }
  if (/bridge.*timed out|bridge.*timeout|agent.*command timed out|BRAIN_CREATOR_AGENT_COMMAND/i.test(message)) {
    return knownError(
      "BC_AGENT_BRIDGE_TIMEOUT",
      message,
      "The Agent bridge did not respond before the configured timeout.",
      "Agent Bridge 未在配置的超时时间内响应。",
      "configure-agent-bridge",
      true
    );
  }
  if (/agent bridge unavailable|bridge.*not configured|bridge.*unavailable/i.test(message)) {
    return knownError(
      "BC_AGENT_BRIDGE_UNAVAILABLE",
      message,
      "The Agent bridge is unavailable for this execution.",
      "当前执行所需的 Agent Bridge 不可用。",
      "configure-agent-bridge"
    );
  }
  if (/store.*locked|locked by another writer/i.test(message)) {
    return knownError(
      "BC_STORE_LOCKED",
      message,
      "The Brain Creator store is busy. Retry after the active writer finishes.",
      "Brain Creator 存储正在被其他写入者占用，请稍后重试。",
      "retry-store-operation",
      true
    );
  }
  if (/outside.*workspace|must stay inside.*workspace/i.test(message)) {
    return knownError(
      "BC_PATH_OUTSIDE_WORKSPACE",
      message,
      "The requested path is outside the Brain Creator workspace.",
      "请求路径位于 Brain Creator 工作区之外。",
      "choose-workspace-path"
    );
  }
  if (/budget|maximum.*attempt|heal.*exhausted|too many retries/i.test(message)) {
    return knownError(
      "BC_EXECUTION_BUDGET_EXCEEDED",
      message,
      "The execution safety budget was reached before the task completed.",
      "任务在完成前已达到执行安全预算。",
      "review-run-and-gap"
    );
  }
  if (/evidenceMode|compatibility evidence|structured reporter mode/i.test(message)) {
    return knownError(
      "BC_EVIDENCE_MODE_POLICY",
      message,
      "The requested evidence mode is not allowed for this execution path.",
      "当前执行路径不允许使用请求的证据模式。",
      "use-strict-evidence-mode"
    );
  }
  if (/ is required| is invalid|unsupported/i.test(message)) {
    return knownError(
      "BC_INVALID_ARGUMENT",
      message,
      "The request contains an invalid or missing field.",
      "请求中存在无效或缺失字段。",
      "correct-request"
    );
  }
  return knownError(
    "BC_UNEXPECTED",
    message,
    "Brain Creator could not complete the request.",
    "Brain Creator 无法完成该请求。",
    "inspect-trace",
    true
  );
}

function knownError(
  code: string,
  technicalMessage: string,
  enUS: string,
  zhCN: string,
  nextAction: string,
  retryable = false
): BrainCreatorErrorDetail {
  return {
    code,
    userMessage: { enUS, zhCN },
    technicalMessage,
    nextAction,
    retryable
  };
}
