import { describe, expect, it } from "vitest";
import { extractCandidateTerms } from "./termExtractor.js";
import type { GlossaryTerm } from "../domain/types.js";

describe("extractCandidateTerms", () => {
  it("extracts Chinese term candidates while excluding existing glossary terms", () => {
    const existing: GlossaryTerm[] = [
      {
        id: "term_1",
        projectId: "system_1",
        key: "product.robot",
        zhCN: "机器人",
        enUS: "Robot",
        aliases: [],
        pageScope: "/products",
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:00:00.000Z"
      }
    ];

    const terms = extractCandidateTerms({
      systemId: "system_1",
      specContent: "用户进入商品列表，选择机器人，校验订单金额，然后提交订单。",
      existingTerms: existing,
      pageScope: "/orders"
    });

    expect(terms.map((term) => term.zhCN)).toEqual(["商品列表", "订单金额", "提交订单"]);
    expect(terms[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^term_/),
        projectId: "system_1",
        pageScope: "/orders"
      })
    );
  });
});
