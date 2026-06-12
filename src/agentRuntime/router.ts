import type { AgentIntent } from "../domain/types.js";

export type RoutedIntent = {
  intent: AgentIntent;
  targetUrl?: string;
  requirement?: string;
  confidence: number;
};

const urlPattern = /https?:\/\/[^\s"'，。)）]+/i;

export function routeIntent(request: string): RoutedIntent {
  const normalized = request.trim();
  const lower = normalized.toLowerCase();
  const targetUrl = normalized.match(urlPattern)?.[0];

  if (targetUrl && includesAny(lower, ["接入", "connect", "连接", "加入", "新增系统"])) {
    return { intent: "connect_system", targetUrl, confidence: 0.95 };
  }
  if (includesAny(lower, ["鉴权", "auth", "token", "cookie", "登录", "checkpoint"])) {
    return { intent: "configure_auth", requirement: normalized, confidence: 0.8 };
  }
  if (includesAny(lower, ["批准", "approve", "审批通过"])) {
    return { intent: "approve_plan", requirement: normalized, confidence: 0.85 };
  }
  if (includesAny(lower, ["运行", "执行", "run", "链路", "chain"])) {
    return { intent: "run_chain", requirement: normalized, confidence: 0.8 };
  }
  if (includesAny(lower, ["gap", "缺口", "阻塞", "未处理"])) {
    return { intent: "show_gaps", requirement: normalized, confidence: 0.85 };
  }
  if (includesAny(lower, ["资产", "artifacts", "assets", "状态", "overview"])) {
    return { intent: "show_assets", requirement: normalized, confidence: 0.75 };
  }
  if (includesAny(lower, ["计划", "plan", "用例", "case", "测试"])) {
    return { intent: "generate_plan", requirement: normalized, confidence: 0.75 };
  }
  return { intent: "unknown", requirement: normalized, confidence: 0.2 };
}

function includesAny(value: string, candidates: string[]) {
  return candidates.some((candidate) => value.includes(candidate.toLowerCase()));
}
