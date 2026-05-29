import type { BusinessRule, RuleCheckResult } from "../domain/types.js";

type CheckBusinessRulesInput = {
  specContent: string;
  rules: BusinessRule[];
};

export function checkBusinessRules(input: CheckBusinessRulesInput): RuleCheckResult {
  const checks = input.rules.map((rule) => {
    const missingKeywords = keywordsFrom(rule.condition).filter(
      (keyword) => !input.specContent.includes(keyword)
    );
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      covered: missingKeywords.length === 0,
      detail:
        missingKeywords.length === 0
          ? "Rule keywords are covered by the spec."
          : `Missing keywords: ${missingKeywords.join(", ")}`
    };
  });

  return {
    passed: checks.every((check) => {
      const rule = input.rules.find((item) => item.id === check.ruleId);
      return rule?.severity === "warn" || check.covered;
    }),
    checks
  };
}

function keywordsFrom(condition: string) {
  const chineseTerms = (condition.match(/[\u4e00-\u9fff]{2,}/g) ?? []).flatMap((term) =>
    term
      .split(/必须|需要|应该|应当|验证|校验|提示|用户|然后|并且|并|和|与|时|后|前/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2)
  );
  const asciiTerms = condition.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? [];
  return [...chineseTerms, ...asciiTerms];
}
