// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderStaticDocumentSuiteReport } from "./staticDocumentSuiteReport.js";

describe("static document suite report", () => {
  it("keeps pending cases visible while summarizing completed results", () => {
    const html = renderStaticDocumentSuiteReport({
      title: "招聘流程套件",
      suite: suite(),
      cases: [
        documentCase("TC-001", "提交需求", "招聘"),
        documentCase("TC-002", "审批需求", "招聘")
      ],
      runs: [{
        id: "suite-run-1",
        systemId: "system-1",
        suiteId: "suite-1",
        sourceId: "source-1",
        status: "completed",
        total: 1,
        passed: 1,
        failed: 0,
        blocked: 0,
        caseResults: [{
          caseNo: "TC-001",
          title: "提交需求",
          status: "passed",
          testCaseId: "test-1",
          chainRunId: "chain-1",
          gapIds: []
        }],
        artifactPaths: ["evidence/TC-001.png"],
        bugReportIds: [],
        gapIds: [],
        createdAt: "2026-09-14T00:00:00.000Z",
        completedAt: "2026-09-14T00:00:01.000Z"
      }],
      progress: {
        current: {
          sequence: 2,
          runId: "suite-1",
          caseTitle: "审批需求",
          stage: "execution",
          status: "waiting",
          stepTitle: "等待审批",
          elapsedMs: 2500,
          traceId: "trace-1",
          createdAt: "2026-09-14T00:00:02.000Z"
        },
        possiblyStalled: false
      },
      bugs: [{ id: "bug-1", status: "open", caseNo: "TC-001", actualResult: "提交后状态未变化" }],
      gaps: [{ id: "gap-1", status: "open", caseNo: "TC-002", reason: "等待审批人" }]
    });

    expect(html).toContain("招聘流程套件");
    expect(html).toContain("TC-001");
    expect(html).toContain("passed");
    expect(html).toContain("TC-002");
    expect(html).toContain("Not executed");
    expect(html).toContain("等待审批");
    expect(html).toContain("bug-1");
    expect(html).toContain("gap-1");
    expect(html).toContain("filterReport");
  });

  it("escapes business text and localizes report chrome", () => {
    const html = renderStaticDocumentSuiteReport({
      title: "Orders <suite>",
      locale: "zh-CN",
      suite: suite(),
      cases: [documentCase("TC-001", "<创建订单>", "订单")],
      runs: []
    });

    expect(html).toContain("Orders &lt;suite&gt;");
    expect(html).toContain("&lt;创建订单&gt;");
    expect(html).toContain("套件状态");
    expect(html).toContain("搜索报告");
    expect(html).toContain('<html lang="zh-CN">');
  });
});

function suite() {
  return {
    id: "suite-1",
    systemId: "system-1",
    sourceId: "source-1",
    status: "waiting-for-agent" as const,
    totalCases: 2,
    selectedCaseNos: ["TC-001", "TC-002"],
    continueOnBlocked: false,
    browserMode: "observe" as const,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:02.000Z"
  };
}

function documentCase(caseNo: string, title: string, module: string) {
  return {
    caseNo,
    title,
    module,
    precondition: "已登录",
    steps: ["执行操作"],
    expectedResult: "操作成功",
    priority: "P1",
    sourceRow: 2
  };
}
