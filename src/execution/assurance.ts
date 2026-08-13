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
  const completeEvidence = contracts.every((contract) => {
    const assertion = mapped.find((item) => item?.id === contract.id) ?? mapped[contracts.indexOf(contract)];
    if (!assertion) return false;
    const refs = assertion.evidenceRefs ?? [];
    const hasActual = typeof assertion.actual === "string" && assertion.actual.length > 0;
    const hasScreenshot = refs.some((ref) => /\.(?:png|jpe?g|webp)$/i.test(ref));
    const hasTrace = refs.some((ref) => /trace[^/\\]*\.zip$/i.test(ref)) ||
      reporter.attachments.some((ref) => /trace[^/\\]*\.zip$/i.test(ref));
    return contract.evidenceRequirements.every((requirement) => {
      if (requirement === "actual-value") return hasActual;
      if (requirement === "screenshot") return hasScreenshot;
      if (requirement === "trace") return hasTrace;
      if (requirement === "network") return reporter.networkFailures.length === 0;
      if (requirement === "console") return reporter.consoleErrors.length === 0;
      return false;
    });
  });
  return completeEvidence ? "strong" : "limited";
}

export function missingAssuranceEvidence(
  contracts: AssertionContract[],
  reporter: StructuredReporterResult | undefined
) {
  if (!reporter) return ["structured-reporter"];
  const results = new Map(reporter.assertions.map((assertion) => [assertion.id, assertion]));
  const mapped = contracts.map((contract, index) => results.get(contract.id) ?? reporter.assertions[index]);
  const missing = new Set<string>();
  if (mapped.length !== contracts.length) missing.add("assertion-mapping");
  for (const [index, contract] of contracts.entries()) {
    const assertion = mapped[index];
    if (!assertion) continue;
    const refs = assertion.evidenceRefs ?? [];
    if (contract.evidenceRequirements.includes("actual-value") && !assertion.actual) missing.add("actual-value");
    if (contract.evidenceRequirements.includes("screenshot") && !refs.some((ref) => /\.(?:png|jpe?g|webp)$/i.test(ref))) missing.add("screenshot");
    if (contract.evidenceRequirements.includes("trace") && !refs.some((ref) => /trace[^/\\]*\.zip$/i.test(ref)) && !reporter.attachments.some((ref) => /trace[^/\\]*\.zip$/i.test(ref))) missing.add("trace");
    if (contract.evidenceRequirements.includes("network") && reporter.networkFailures.length > 0) missing.add("network");
    if (contract.evidenceRequirements.includes("console") && reporter.consoleErrors.length > 0) missing.add("console");
  }
  return [...missing];
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
