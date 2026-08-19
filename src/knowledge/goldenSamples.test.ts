// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  REQUIREMENT_GOLDEN_SAMPLES,
  evaluateRequirementGoldenSample,
  summarizeRequirementGoldenSamples,
  buildGoldenExecutionFixture,
  evaluateProcessRequirementGoldenSample
} from "./goldenSamples.js";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutableCase,
  ExecutionEvidence,
  KnowledgeProject,
  RequirementSet,
  TestIntent
} from "../domain/types.js";
import { KnowledgeService } from "./service.js";

describe("Requirement Brain golden samples", () => {
  it("meets the quality contract across HR and non-HR domains", () => {
    const results = REQUIREMENT_GOLDEN_SAMPLES.map(evaluateRequirementGoldenSample);

    expect(results.map((result) => ({
      id: result.sample.id,
      passed: result.passed,
      failures: result.failures
    }))).toEqual(
      REQUIREMENT_GOLDEN_SAMPLES.map((sample) => ({
        id: sample.id,
        passed: true,
        failures: []
      }))
    );
  });

  it("reports a stable aggregate quality baseline", () => {
    const summary = summarizeRequirementGoldenSamples(
      REQUIREMENT_GOLDEN_SAMPLES.map(evaluateRequirementGoldenSample)
    );

    expect(summary).toEqual(
      expect.objectContaining({
        totalSamples: 7,
        passedSamples: 7,
        passRate: 1,
        averageCoverageRate: 1,
        unsupportedClaimCount: 0
      })
    );
    expect(summary.domains).toEqual([
      "access-control",
      "commerce",
      "hr",
      "inventory",
      "order"
    ]);
  });

  it("keeps every generated intent bound to exactly one golden requirement clause", () => {
    for (const sample of REQUIREMENT_GOLDEN_SAMPLES) {
      const result = evaluateRequirementGoldenSample(sample);

      expect(result.design.testIntents).toHaveLength(result.analysis.clauses.length);
      expect(
        result.design.testIntents.every(
          (intent) =>
            intent.requirementRefs.length === 1 &&
            result.analysis.clauses.some(
              (clause) =>
                clause.sourceRef === intent.requirementRefs[0] &&
                clause.text === intent.objective
            )
        )
      ).toBe(true);
    }
  });

  it("turns complex table rows into atomic clauses without treating headers as requirements", () => {
    const result = evaluateRequirementGoldenSample(
      REQUIREMENT_GOLDEN_SAMPLES.find(
        (sample) => sample.id === "commerce-discount-rule-table"
      )!
    );

    expect(result.analysis.clauses).toHaveLength(3);
    expect(result.analysis.clauses[0].text).toContain("Customer tier: Standard");
    expect(result.analysis.clauses.some((clause) => clause.text.includes("---"))).toBe(false);
  });

  it("keeps module ownership for cross-module workflow clauses", () => {
    const result = evaluateRequirementGoldenSample(
      REQUIREMENT_GOLDEN_SAMPLES.find(
        (sample) => sample.id === "recruiting-offer-cross-module-flow"
      )!
    );

    expect(new Set(result.analysis.clauses.map((clause) => clause.module))).toEqual(
      new Set(["Recruiting", "Offer"])
    );
    expect(result.design.testIntents.map((intent) => intent.module)).toEqual([
      "Recruiting",
      "Offer",
      "Recruiting"
    ]);
  });

  it("preserves actor and permission semantics for every permission matrix row", () => {
    const result = evaluateRequirementGoldenSample(
      REQUIREMENT_GOLDEN_SAMPLES.find(
        (sample) => sample.id === "account-permission-matrix"
      )!
    );

    expect(result.analysis.clauses).toHaveLength(3);
    expect(
      result.analysis.clauses.every(
        (clause) =>
          clause.nodeTypes.includes("actor") && clause.nodeTypes.includes("permission")
      )
    ).toBe(true);
  });

  it("keeps the scale fixture reconciled without claiming unexecuted coverage", () => {
    const fixture = buildGoldenExecutionFixture();
    expect(fixture.testIntentCount).toBe(457);
    expect(fixture.executableCaseCount).toBe(61);
    expect(Object.values(fixture.classifications).reduce((sum, count) => sum + count, 0)).toBe(457);
    expect(fixture.classifications["strong-verified"]).toBe(40);
    expect(fixture.classifications.limited).toBe(10);
    expect(fixture.classifications.blocked).toBe(5);
    expect(fixture.classifications.failed).toBe(6);
    expect(fixture.classifications["not-selected"]).toBe(374);
    expect(fixture.classifications.superseded).toBe(22);
  });

  it("restores workflow, state, negative-path, and cross-role coverage from confirmed visual evidence", () => {
    const result = evaluateProcessRequirementGoldenSample();

    expect(result.workflowModels).toHaveLength(1);
    expect(result.stateMachineModels).toHaveLength(1);
    expect(result.coverageProfile.status).toBe("complete");
    expect(result.coverageProfile.dimensions.workflow.missingRefs).toEqual([]);
    expect(result.coverageProfile.dimensions.state.missingRefs).toEqual([]);
    expect(result.testIntents.filter((intent) => intent.scenarioType === "positive").length).toBeGreaterThanOrEqual(4);
    expect(result.testIntents.filter((intent) => intent.scenarioType === "negative").length).toBeGreaterThanOrEqual(5);
    expect(result.testIntents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorJourney: ["requester", "manager"] })
      ])
    );
    expect(result.testIntents.every((intent) => intent.requirementRefs.length > 0)).toBe(true);
  });

  it("reconciles the 457-intent golden scale fixture through the real coverage ledger", () => {
    const fixture = buildGoldenExecutionFixture();
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, ".brain-creator/test-golden-scale");
    const now = new Date().toISOString();
    const project: KnowledgeProject = {
      id: fixture.knowledgeProjectId,
      key: fixture.knowledgeProjectId,
      name: "Synthetic golden execution scale",
      defaultLocale: "en-US",
      status: "active",
      systemIds: ["golden-system"],
      createdAt: now,
      updatedAt: now
    };
    repository.knowledgeProjects.push(project);

    const approvedSet: RequirementSet = {
      id: "golden-approved-set",
      knowledgeProjectId: project.id,
      sourceId: "golden-source",
      version: 1,
      title: "Synthetic approved requirements",
      summary: "Synthetic coverage scale fixture",
      contentHash: "golden-approved-hash",
      status: "approved",
      affectedNodeIds: [],
      createdAt: now,
      updatedAt: now
    };
    const supersededSet: RequirementSet = {
      ...approvedSet,
      id: "golden-superseded-set",
      status: "superseded"
    };
    repository.requirementSets.push(approvedSet, supersededSet);

    for (let index = 0; index < fixture.testIntentCount; index += 1) {
      const superseded = index >= 435;
      const intent: TestIntent = {
        id: `golden-intent-${index}`,
        knowledgeProjectId: project.id,
        requirementSetId: superseded ? supersededSet.id : approvedSet.id,
        title: `Synthetic intent ${index}`,
        module: "Synthetic",
        priority: "P1",
        objective: `Verify synthetic requirement ${index}`,
        preconditions: [],
        expectedResults: ["Expected behavior is observed"],
        requirementRefs: [`golden-requirement-${index}`],
        knowledgeNodeRefs: [],
        techniques: ["scenario"],
        coverageDimensions: ["workflow"],
        status: superseded ? "compiled" : "approved",
        createdAt: now,
        updatedAt: now
      };
      repository.testIntents.push(intent);

      if (index >= fixture.executableCaseCount) continue;
      const classification = index < 40
        ? "strong"
        : index < 50
          ? "limited"
          : index < 55
            ? "blocked"
            : "failed";
      const caseId = `golden-case-${index}`;
      const executableCase: ExecutableCase = {
        id: caseId,
        knowledgeProjectId: project.id,
        requirementSetId: approvedSet.id,
        testIntentId: intent.id,
        title: `Synthetic executable case ${index}`,
        status: classification === "blocked" ? "blocked" : "executed",
        preconditions: [],
        steps: [],
        dataProfileIds: [],
        gapIds: [],
        createdAt: now,
        updatedAt: now
      };
      repository.executableCases.push(executableCase);
      const evidence: ExecutionEvidence = {
        id: `golden-evidence-${index}`,
        knowledgeProjectId: project.id,
        systemId: "golden-system",
        executableCaseId: caseId,
        testCaseId: `golden-test-${index}`,
        contextPackPath: `golden/context/${index}.json`,
        status: classification === "blocked" ? "blocked" : classification === "failed" ? "failed" : "passed",
        assuranceLevel: classification === "strong" ? "strong" : classification === "limited" ? "limited" : "none",
        coverage: classification === "strong"
          ? { required: ["workflow"], verified: ["workflow"], missing: [] }
          : { required: ["workflow"], verified: [], missing: ["workflow"] },
        steps: [],
        tracePaths: [],
        artifactPaths: [],
        consoleErrors: [],
        networkFailures: [],
        createdAt: now
      };
      repository.executionEvidence.push(evidence);
    }

    const ledger = service.testIntentCoverage(project.id);
    expect(ledger.total).toBe(fixture.testIntentCount);
    expect(ledger.counts).toEqual(fixture.classifications);
    expect(ledger.items).toHaveLength(fixture.testIntentCount);
    expect(ledger.items.every((item) => item.classificationReason.length > 0)).toBe(true);
    expect(ledger.items.find((item) => item.classification === "strong-verified")?.classificationReason)
      .toContain("strong assurance");
    expect(ledger.items.find((item) => item.classification === "not-selected")?.classificationReason)
      .toContain("No active ExecutableCase");
    expect(ledger.items.find((item) => item.classification === "superseded")?.classificationReason)
      .toContain("superseded");
    expect(ledger.items.every((item) => item.stability.verdict === "insufficient-sample")).toBe(true);
    expect(ledger.items.filter((item) => item.classification === "strong-verified")).toHaveLength(40);
    expect(ledger.items.filter((item) => item.classification === "superseded")).toHaveLength(22);
  });
});
