import { describe, expect, it } from "vitest";
import { BrainCreatorService } from "../domain/service.js";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import { buildRagDocuments, retrieveRag } from "./rag.js";

describe("Brain Creator RAG", () => {
  it("keeps retrieval scoped to the selected business system", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new BrainCreatorService(repository);
    const systemA = service.createSystemProfile({
      name: "Contract System",
      environment: "test",
      baseUrl: "https://contract.example.test",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://contract.example.test"]
    });
    const systemB = service.createSystemProfile({
      name: "Payroll System",
      environment: "test",
      baseUrl: "https://payroll.example.test",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://payroll.example.test"]
    });
    service.createBusinessRule({
      systemId: systemA.id,
      name: "合同模板必填字段",
      condition: "合同模板必须填写名称",
      severity: "block"
    });
    service.createBusinessRule({
      systemId: systemB.id,
      name: "薪资模板必填字段",
      condition: "薪资模板必须填写名称",
      severity: "block"
    });

    const hits = retrieveRag({
      documents: buildRagDocuments(repository),
      systemId: systemA.id,
      intent: "generate_plan",
      query: "模板必填字段",
      includeTypes: ["rule"],
      limit: 10
    });

    expect(hits).toEqual([
      expect.objectContaining({ systemId: systemA.id, title: "合同模板必填字段" })
    ]);
  });

  it("boosts open gaps above similarly matching successful assets", () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new BrainCreatorService(repository);
    const system = service.createSystemProfile({
      name: "Contract System",
      environment: "test",
      baseUrl: "https://contract.example.test",
      defaultLocale: "zh-CN",
      urlAllowlist: ["https://contract.example.test"]
    });
    const testCase = service.createTestCase({
      systemId: system.id,
      requirement: "合同模板创建",
      scenarios: [],
      newTerms: [],
      ruleCheckResult: { passed: true, checks: [] }
    });
    service.reportGap({
      projectId: system.id,
      sourceType: "test-case",
      sourceId: testCase.id,
      reason: "合同模板入口缺少真实页面证据",
      severity: "high",
      owner: "brain-creator"
    });

    const [first] = retrieveRag({
      documents: buildRagDocuments(repository),
      systemId: system.id,
      intent: "generate_plan",
      query: "合同模板",
      includeTypes: ["test-case", "gap"],
      limit: 5
    });

    expect(first).toEqual(expect.objectContaining({ assetType: "gap" }));
  });
});
