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
        steps: [],
        tracePaths: ["trace.zip"],
        artifactPaths: ["report.html", "trace.zip"],
        consoleErrors: [],
        networkFailures: [],
        createdAt: new Date().toISOString()
      }],
      bugs: [{ id: "bug-1", status: "open", actualResult: "Unexpected value" }],
      gaps: [{ id: "gap-1", status: "open", reason: "Missing role evidence" }]
    });

    expect(html).toContain("Orders &lt;suite&gt;");
    expect(html).toContain("strong");
    expect(html).toContain("Assurance: <strong>strong 1</strong> | limited 0 | none 0");
    expect(html).toContain("trace.zip");
    expect(html).toContain('href="report.html"');
    expect(html).toContain("bug-1");
    expect(html).toContain("gap-1");
    expect(html).toContain("filterReport");
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
