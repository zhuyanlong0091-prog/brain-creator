// @vitest-environment node

import { describe, expect, it } from "vitest";
import { renderStaticSuiteExecutionReport } from "./staticSuiteReport.js";
import type { RequirementSuiteRun } from "../domain/types.js";

describe("static suite execution report", () => {
  it("summarizes cases, assurance, artifacts, bugs, and gaps with search support", () => {
    const html = renderStaticSuiteExecutionReport({
      title: "Orders <suite>",
      run: run(),
      evidence: [{
        id: "evidence-1",
        knowledgeProjectId: "project-1",
        systemId: "system-1",
        executableCaseId: "case-1",
        testCaseId: "test-1",
        contextPackPath: "context.json",
        status: "passed",
        assuranceLevel: "strong",
        evidenceWarnings: [],
        steps: [{
          stepId: "step-1",
          order: 1,
          action: "assert",
          instruction: "Order approval is visible",
          expected: "visible",
          actual: "visible",
          assertionStatus: "passed",
          sourceRefs: ["requirement:approval"],
          origin: "source"
        }],
        tracePaths: ["trace.zip"],
        artifactPaths: ["report.html", "trace.zip"],
        consoleErrors: ["console warning"],
        networkFailures: ["GET /health failed"],
        createdAt: new Date().toISOString()
      }],
      coverage: [{
        testIntentId: "intent-1",
        title: "Order approval",
        module: "Orders",
        classification: "strong-verified",
        classificationReason: "Strong reporter evidence passed.",
        requirementRefs: ["requirement:approval"]
      }, {
        testIntentId: "intent-2",
        title: "Approval timeout",
        module: "Orders",
        classification: "blocked",
        classificationReason: "Auth checkpoint required.",
        requirementRefs: ["requirement:timeout"]
      }],
      bugs: [{ id: "bug-1", status: "open", actualResult: "Unexpected value" }],
      gaps: [{ id: "gap-1", status: "open", reason: "Missing role evidence" }],
      progress: {
        current: {
          sequence: 3,
          runId: "suite-1",
          caseTitle: "Approve order",
          stage: "execution",
          stepTitle: "Submit approval",
          status: "running",
          pageUrl: "https://orders.example.test/approval",
          elapsedMs: 1250,
          traceId: "trace-1",
          createdAt: "2026-08-19T00:00:01.000Z"
        },
        possiblyStalled: false,
        stalledAfterMs: 120000
      }
    });

    expect(html).toContain("Orders &lt;suite&gt;");
    expect(html).toContain("strong");
    expect(html).toContain("Assurance: <strong>strong 1</strong> | limited 0 | none 0");
    expect(html).toContain("Runtime impact: console errors 1 | network failures 1");
    expect(html).toContain("1 step(s)");
    expect(html).toContain("Console errors");
    expect(html).toContain("Network failures");
    expect(html).toContain("trace.zip");
    expect(html).toContain('href="report.html"');
    expect(html).toContain("bug-1");
    expect(html).toContain("gap-1");
    expect(html).toContain("filterReport");
    expect(html).toContain("TestIntent coverage");
    expect(html).toContain("strong-verified");
    expect(html).toContain("Auth checkpoint required.");
    expect(html).toContain("Current progress");
    expect(html).toContain("Submit approval");
    expect(html).toContain("orders.example.test/approval");
  });

  it("keeps blocked and queued cases visible in the same report", () => {
    const html = renderStaticSuiteExecutionReport({
      title: "Blocked suite",
      run: {
        ...run(),
        status: "blocked",
        passed: 0,
        blocked: 1,
        caseRuns: [{
          ...run().caseRuns[0],
          status: "blocked",
          error: "Auth checkpoint required"
        }, {
          executableCaseId: "case-2",
          title: "Queued case",
          order: 2,
          status: "queued",
          gapIds: [],
          attempts: []
        }]
      },
      evidence: []
    });

    expect(html).toContain("Auth checkpoint required");
    expect(html).toContain("Queued case");
    expect(html).toContain("Not executed");
    expect(html).toContain("blocked");
  });

  it("shows all requirement revisions attached to a mixed suite", () => {
    const html = renderStaticSuiteExecutionReport({
      title: "Mixed requirement suite",
      run: run(),
      requirementSetIds: ["requirement-orders-v1", "requirement-orders-v2"],
      evidence: []
    });

    expect(html).toContain("Requirement sets:");
    expect(html).toContain("requirement-orders-v1");
    expect(html).toContain("requirement-orders-v2");
  });

  it("formats report timestamps with the requested locale", () => {
    const html = renderStaticSuiteExecutionReport({
      title: "Localized suite",
      run: {
        ...run(),
        createdAt: "2026-08-14T12:34:56.000Z",
        updatedAt: "2026-08-14T13:34:56.000Z"
      },
      locale: "zh-CN",
      evidence: []
    });

    expect(html).toContain("语言环境： zh-CN");
    expect(html).toContain("2026");
  });

  it("localizes the static report chrome for Chinese systems", () => {
    const html = renderStaticSuiteExecutionReport({
      title: "Localized suite",
      run: run(),
      locale: "zh-CN",
      evidence: []
    });

    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain("状态：");
    expect(html).toContain("搜索报告");
    expect(html).toContain("用例");
  });

  it("does not rewrite business evidence while localizing the report chrome", () => {
    const html = renderStaticSuiteExecutionReport({
      title: "Localized suite",
      run: run(),
      locale: "zh-CN",
      evidence: [],
      bugs: [{ id: "bug-1", status: "open", actualResult: "Status: None in the source result" }]
    });

    expect(html).toContain("Status: None in the source result");
    expect(html).toContain("状态：");
  });
  it("localizes Chinese report chrome without rewriting business evidence", () => {
    const html = renderStaticSuiteExecutionReport({
      title: "Localized suite",
      run: run(),
      locale: "zh-CN",
      evidence: [],
      bugs: [{ id: "bug-1", status: "open", actualResult: "Status: None in the source result" }]
    });

    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain("状态：");
    expect(html).toContain("搜索报告");
    expect(html).toContain("用例");
    expect(html).toContain("Status: None in the source result");
  });
});

function run(): RequirementSuiteRun {
  return {
    id: "suite-1",
    knowledgeProjectId: "project-1",
    systemId: "system-1",
    status: "completed",
    continueOnBlocked: false,
    allowCreateTestData: false,
    total: 1,
    passed: 1,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    caseRuns: [{
      executableCaseId: "case-1",
      title: "Create order",
      order: 1,
      status: "passed",
      gapIds: [],
      attempts: []
    }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
