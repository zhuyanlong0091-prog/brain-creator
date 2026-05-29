import { describe, expect, it } from "vitest";
import { checkBusinessRules } from "./qualityGate.js";
import type { BusinessRule } from "../domain/types.js";

describe("checkBusinessRules", () => {
  it("marks block rules as failed when spec does not cover their keywords", () => {
    const rules: BusinessRule[] = [
      {
        id: "rule_1",
        systemId: "system_1",
        name: "Payment amount rule",
        condition: "支付页面必须验证订单金额",
        severity: "block",
        createdAt: "2026-05-29T00:00:00.000Z"
      },
      {
        id: "rule_2",
        systemId: "system_1",
        name: "Inventory warning",
        condition: "库存不足时提示用户",
        severity: "warn",
        createdAt: "2026-05-29T00:00:00.000Z"
      }
    ];

    const result = checkBusinessRules({
      specContent: "测试购买机器人，并在支付页面验证订单金额。",
      rules
    });

    expect(result.passed).toBe(true);
    expect(result.checks).toEqual([
      expect.objectContaining({ ruleId: "rule_1", covered: true }),
      expect.objectContaining({ ruleId: "rule_2", covered: false })
    ]);
  });
});
