// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderStaticExecutionReport, writeStaticExecutionReport } from "./staticReport.js";
import type { ExecutionEvidence } from "../domain/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("static execution report", () => {
  it("contains searchable steps, assurance, evidence, bugs, gaps, and escaped content", () => {
    const html = renderStaticExecutionReport({
      title: "Order <review>",
      evidence: evidence(),
      bugReports: [{ id: "bug-1", status: "open", actualResult: "wrong value" }],
      gaps: [{ id: "gap-1", status: "open", reason: "missing page" }]
    });

    expect(html).toContain("Order &lt;review&gt;");
    expect(html).toContain("Assurance: <strong>strong</strong>");
    expect(html).toContain("Search report");
    expect(html).toContain("step-01.png");
    expect(html).toContain('href="step-01.png"');
    expect(html).toContain('href="trace.zip"');
    expect(html).toContain("requirement:amount");
    expect(html).toContain("bug-1");
    expect(html).toContain("gap-1");
    expect(html).toContain("What was understood");
    expect(html).toContain("What was observed");
    expect(html).toContain("Why this result is trusted");
    expect(html).toContain("Data used");
  });

  it("renders business target and execution bindings for each step", () => {
    const html = renderStaticExecutionReport({
      title: "Orders",
      evidence: {
        ...evidence(),
        steps: [{
          ...evidence().steps[0],
          targetSemantic: "Order total",
          value: "42",
          pageModelId: "page-order-form",
          locatorPointId: "locator-total",
          dataProfileId: "data-order-total"
        }]
      }
    });

    expect(html).toContain("Business target");
    expect(html).toContain("Order total");
    expect(html).toContain("page-order-form");
    expect(html).toContain("locator-total");
    expect(html).toContain("data-order-total");
  });

  it("shows the persisted failure classification in the plain-language summary", () => {
    const html = renderStaticExecutionReport({
      title: "Orders",
      evidence: { ...evidence(), status: "failed", assuranceLevel: "none" },
      diagnosis: { verdict: "network_gap", failureType: "network_failure" }
    });

    expect(html).toContain("network_gap");
    expect(html).toContain("network_failure");
  });

  it("does not turn untrusted artifact protocols into executable links", () => {
    const html = renderStaticExecutionReport({
      title: "Orders",
      evidence: { ...evidence(), artifactPaths: ["javascript:alert(1)"] }
    });

    expect(html).not.toContain('href="javascript:');
  });

  it("writes a standalone HTML file", async () => {
    const root = await mkdtemp(join(tmpdir(), "brain-static-report-"));
    tempDirs.push(root);
    const path = await writeStaticExecutionReport({ outputPath: join(root, "report.html"), title: "Orders", evidence: evidence() });
    expect(await readFile(path, "utf8")).toContain("<!doctype html>");
  });
});

function evidence(): ExecutionEvidence {
  return {
    id: "evidence-1",
    knowledgeProjectId: "project-1",
    systemId: "system-1",
    executableCaseId: "case-1",
    testCaseId: "test-1",
    contextPackPath: "context.json",
    status: "passed",
    assuranceLevel: "strong",
    assertionContracts: [{
      id: "assert-1",
      type: "value",
      strength: "strong",
      expected: "42",
      requirementRefs: ["requirement:amount"],
      evidenceRequirements: ["actual-value", "screenshot", "trace"]
    }],
    steps: [{ stepId: "step-1", order: 1, action: "assert", instruction: "Check total", expected: "42", actual: "42", assertionStatus: "passed", screenshotPath: "step-01.png", evidenceRefs: ["evidence/step-01.png"], traceRefs: ["trace.zip"], sourceRefs: ["requirement:amount"], origin: "source" }],
    tracePaths: ["trace.zip"],
    artifactPaths: ["step-01.png"],
    consoleErrors: [],
    networkFailures: [],
    actualResult: "42",
    createdAt: new Date().toISOString()
  };
}
