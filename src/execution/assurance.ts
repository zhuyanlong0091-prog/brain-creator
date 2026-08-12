import { id } from "../shared/id.js";
import type {
  AssertionContract,
  AssuranceLevel,
  ExecutableCaseStep,
  StructuredReporterResult
} from "../domain/types.js";

export function buildAssertionContracts(
  steps: ExecutableCaseStep[],
  requirementRefs: string[] = []
): AssertionContract[] {
  return steps
    .filter((step) => step.action === "assert")
    .map((step) => ({
      id: id("assertionContract"),
      stepId: step.id,
      type: assertionType(step),
      strength: "strong" as const,
      expected: step.expected,
      requirementRefs: [...new Set([...requirementRefs, ...step.sourceRefs])],
      evidenceRequirements: ["actual-value", "screenshot", "trace"] as const
    }));
}

export function determineAssuranceLevel(
  contracts: AssertionContract[],
  reporter: StructuredReporterResult | undefined
): AssuranceLevel {
  if (!contracts.length || !reporter) return "none";
  const results = new Map(reporter.assertions.map((assertion) => [assertion.id, assertion]));
  const exactMatches = contracts.filter((contract) => results.has(contract.id));
  const mapped = exactMatches.length === contracts.length
    ? contracts.map((contract) => results.get(contract.id))
    : reporter.assertions.length === contracts.length
      ? reporter.assertions
      : [];
  if (mapped.length !== contracts.length || mapped.some((assertion) => assertion?.status !== "passed")) return "none";
  if (contracts.some((contract) => contract.strength === "limited")) return "limited";
  if (reporter.status !== "passed") return "none";
  return "strong";
}

function assertionType(step: ExecutableCaseStep): AssertionContract["type"] {
  const text = `${step.instruction} ${step.targetSemantic} ${step.expected ?? ""}`.toLowerCase();
  if (/network|request|response|接口|请求|响应/.test(text)) return "network";
  if (/visible|display|shown|显示|可见/.test(text)) return "visibility";
  if (/status|state|enabled|disabled|状态|启用|禁用/.test(text)) return "state";
  if (/created|saved|updated|deleted|创建|保存|更新|删除/.test(text)) return "side-effect";
  if (/workflow|approved|rejected|流程|审批|驳回/.test(text)) return "workflow";
  return "value";
}
