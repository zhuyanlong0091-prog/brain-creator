import type { ExecutionFailureType } from "../domain/types.js";

export function classifyExecutionFailure(
  reason: string,
  sourceType = ""
): ExecutionFailureType {
  const text = `${sourceType} ${reason}`.toLowerCase();
  if (
    /\b(auth|login|token|cookie|password|captcha|2fa|unauthorized|forbidden|403|401)\b/.test(
      text
    )
  ) {
    return "auth_failure";
  }
  if (
    /\btest-data\b|\btest data\b|\bprecondition data\b/.test(text)
  ) {
    return "test_data_failure";
  }
  if (isEnvironmentConfigurationFailure(text)) {
    return "environment_failure";
  }
  if (/\b(selector|locator|element|dom|stable selector)\b/.test(text)) {
    return "locator_failure";
  }
  if (isGeneratedTestImplementationFailure(text)) {
    return "automation_failure";
  }
  if (
    /\b(network|net::|econn|timeout|timed out|dns|socket|connection|http 5\d\d)\b/.test(
      text
    )
  ) {
    return "network_failure";
  }
  if (
    /\b(expected|actual|assert|assertion|tobe|toequal|tocontain|not visible)\b/.test(
      text
    )
  ) {
    return "assertion_failure";
  }
  if (
    /\b(playwright|process|command|exit code|failed after|host-agent|generator|healer|suite failure)\b/.test(
      text
    )
  ) {
    return "execution_failure";
  }
  return "unknown_failure";
}

export function isGeneratedTestImplementationFailure(reason: string) {
  return /\b(?:syntaxerror|typeerror|referenceerror|cannot find module|module not found|no tests found|strict mode violation|target page, context or browser has been closed|sharedstrings|decodexml|index out of bounds)\b|expect\(locator\)[\s\S]*element\(s\) not found/i.test(
    reason
  );
}

export function isEnvironmentConfigurationFailure(reason: string) {
  return /\b(?:process definition key(?: is)? not configured|missing (?:environment )?configuration|configuration missing|required test data is unavailable|missing required test data|test data (?:is )?(?:missing|unavailable)|precondition(?: data)? (?:is )?(?:missing|unavailable))\b|未配置流程定义|环境配置缺失|测试数据(?:缺失|不存在|不可用)|前置数据(?:缺失|不存在|不可用)/i.test(
    reason
  );
}
