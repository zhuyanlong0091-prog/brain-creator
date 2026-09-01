import type { ExecutionDiagnosis, ExecutionEvidence } from "../domain/types.js";
import type { ScenarioTrustRecord } from "../brain/types.js";

export type ExecutionNarrative = {
  understood: string;
  observed: string;
  data: string;
  result: string;
  trust: string;
  waiting?: string;
};

export function buildExecutionNarrative(input: {
  evidence: Pick<
    ExecutionEvidence,
    | "status"
    | "assuranceLevel"
    | "assertionContracts"
    | "steps"
    | "coverage"
    | "actualResult"
    | "evidenceWarnings"
    | "consoleErrors"
    | "networkFailures"
    | "scenarioTrust"
  >;
  locale?: string;
  diagnosis?: Pick<ExecutionDiagnosis, "verdict" | "failureType">;
  trust?: Pick<ScenarioTrustRecord, "status" | "strongRunCount">;
}): ExecutionNarrative {
  const zh = input.locale?.toLowerCase().startsWith("zh") ?? false;
  const evidence = input.evidence;
  const stepCount = evidence.steps.length;
  const assertionCount = evidence.assertionContracts?.length ?? 0;
  const sourceCount = new Set(evidence.steps.flatMap((step) => step.sourceRefs)).size;
  const dataRefs = [...new Set(evidence.steps.map((step) => step.dataReference).filter(Boolean))];
  const missing = evidence.coverage?.missing ?? [];
  const consoleErrors = evidence.consoleErrors.length;
  const networkFailures = evidence.networkFailures.length;
  const diagnosis = input.diagnosis
    ? zh
      ? `失败分类为 ${input.diagnosis.verdict}${input.diagnosis.failureType ? `（${input.diagnosis.failureType}）` : ""}。`
      : `The failure was classified as ${input.diagnosis.verdict}${input.diagnosis.failureType ? ` (${input.diagnosis.failureType})` : ""}.`
    : "";
  const status = zh ? statusZh(evidence.status) : evidence.status;
  const assurance = evidence.assuranceLevel ?? "none";
  const trustStatus = input.trust?.status ?? input.evidence.scenarioTrust?.status;
  const trustRunCount = input.trust?.strongRunCount ?? input.evidence.scenarioTrust?.strongRunCount;

  return {
    understood: zh
      ? `本次理解为一个包含 ${stepCount} 个步骤和 ${assertionCount} 个业务断言的测试场景，引用了 ${sourceCount} 个来源。`
      : `This run represents a scenario with ${stepCount} execution step(s) and ${assertionCount} business assertion(s), backed by ${sourceCount} source reference(s).`,
    observed: zh
      ? `真实执行状态为“${status}”，已记录 ${evidence.steps.filter((step) => step.assertionStatus !== "pending").length} 个步骤结果；控制台错误 ${consoleErrors} 个，网络失败 ${networkFailures} 个。`
      : `The observed execution status is “${status}”; results were recorded for ${evidence.steps.filter((step) => step.assertionStatus !== "pending").length} step(s), with ${consoleErrors} console error(s) and ${networkFailures} network failure(s).`,
    data: dataRefs.length > 0
      ? zh ? `使用的业务数据引用：${dataRefs.join("、")}。` : `Business data references used: ${dataRefs.join(", ")}.`
      : zh ? "本次没有记录可复用的业务数据引用。" : "No reusable business data reference was recorded for this run.",
    result: zh
      ? `执行结果为“${status}”，验证强度为“${assurance}”。${missing.length ? `尚缺少：${missing.join("、")}。` : ""}${evidence.actualResult ? ` 实际结果：${evidence.actualResult}` : ""}${diagnosis}`
      : `The execution result is “${status}” with “${assurance}” assurance.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${evidence.actualResult ? ` Actual result: ${evidence.actualResult}` : ""}${diagnosis}`,
    trust: trustStatus === "trusted"
      ? zh ? `场景已达到可信，可用于无人值守回归（连续强证据通过 ${trustRunCount ?? 0} 次）。` : `The scenario is trusted for unattended regression after ${trustRunCount ?? 0} strong passing run(s).`
      : trustStatus === "verified"
        ? zh ? "场景已完成首次强证据观察，但仍需继续稳定运行后才能可信。" : "The scenario has completed its first strong observed run but needs more stable runs before it is trusted."
        : assurance === "strong"
          ? zh ? "本次证据达到强验证，但尚未形成场景级可信记录。" : "This run has strong evidence, but it has not established scenario-level trust."
          : zh ? "当前证据不足以证明需求符合，不能据此晋升场景可信。" : "The evidence is not sufficient to claim requirement conformance or promote scenario trust.",
    ...(evidence.status === "blocked" || evidence.evidenceWarnings?.length
      ? { waiting: zh ? `当前需要处理：${evidence.evidenceWarnings?.[0] ?? "执行被阻塞"}。` : `Action is required: ${evidence.evidenceWarnings?.[0] ?? "execution is blocked"}.` }
      : {})
  };
}

function statusZh(status: ExecutionEvidence["status"]) {
  return status === "passed" ? "通过" : status === "failed" ? "失败" : status === "blocked" ? "阻塞" : "运行中";
}
