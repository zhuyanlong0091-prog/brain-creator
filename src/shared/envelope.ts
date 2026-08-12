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
