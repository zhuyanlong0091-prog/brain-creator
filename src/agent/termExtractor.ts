import type { GlossaryTerm } from "../domain/types.js";
import { id } from "../shared/id.js";

type ExtractCandidateTermsInput = {
  systemId: string;
  specContent: string;
  existingTerms: GlossaryTerm[];
  pageScope: string;
};

const candidatePhrases = ["商品列表", "订单金额", "提交订单", "支付页面", "购买流程"];

export function extractCandidateTerms(input: ExtractCandidateTermsInput): GlossaryTerm[] {
  const existing = new Set(input.existingTerms.flatMap((term) => [term.zhCN, ...term.aliases]));
  const now = new Date().toISOString();
  return candidatePhrases
    .filter((phrase) => input.specContent.includes(phrase))
    .filter((phrase) => !existing.has(phrase))
    .map((phrase) => ({
      id: id("term"),
      projectId: input.systemId,
      key: keyFromChinese(phrase),
      zhCN: phrase,
      enUS: "",
      aliases: [],
      pageScope: input.pageScope,
      createdAt: now,
      updatedAt: now
    }));
}

function keyFromChinese(value: string) {
  return `candidate.${Buffer.from(value).toString("hex").slice(0, 12)}`;
}
