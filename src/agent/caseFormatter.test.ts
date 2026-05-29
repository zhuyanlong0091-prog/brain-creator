import { describe, expect, it } from "vitest";
import { formatScenariosAsMarkdown, parseSpecMarkdown } from "./caseFormatter.js";
import type { TestCaseScenario } from "../domain/types.js";

describe("caseFormatter", () => {
  it("parses planner markdown into structured scenarios", () => {
    const scenarios = parseSpecMarkdown(`
## Scenario: 购买机器人
Priority: critical
Rule: rule_1
- navigate: 商品列表
- click: 机器人商品
- fill: 搜索框 = robot
- assert: 订单金额 => 金额正确
`);

    expect(scenarios).toEqual([
      {
        id: expect.stringMatching(/^scenario_/),
        title: "购买机器人",
        priority: "critical",
        businessRuleRef: "rule_1",
        steps: [
          { action: "navigate", target: "商品列表" },
          { action: "click", target: "机器人商品" },
          { action: "fill", target: "搜索框", value: "robot" },
          { action: "assert", target: "订单金额", expected: "金额正确" }
        ]
      }
    ]);
  });

  it("formats structured scenarios back to markdown", () => {
    const scenarios: TestCaseScenario[] = [
      {
        id: "scenario_1",
        title: "购买机器人",
        priority: "critical",
        businessRuleRef: "rule_1",
        steps: [
          { action: "navigate", target: "商品列表" },
          { action: "fill", target: "搜索框", value: "robot" },
          { action: "assert", target: "订单金额", expected: "金额正确" }
        ]
      }
    ];

    expect(formatScenariosAsMarkdown(scenarios)).toContain("## Scenario: 购买机器人");
    expect(formatScenariosAsMarkdown(scenarios)).toContain("Priority: critical");
    expect(formatScenariosAsMarkdown(scenarios)).toContain("Rule: rule_1");
    expect(formatScenariosAsMarkdown(scenarios)).toContain("- fill: 搜索框 = robot");
    expect(formatScenariosAsMarkdown(scenarios)).toContain("- assert: 订单金额 => 金额正确");
  });
});
