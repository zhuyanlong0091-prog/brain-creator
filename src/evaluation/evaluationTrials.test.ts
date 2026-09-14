import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { BusinessScenario } from "../brain/types.js";
import type { ExecutableCase, ExecutionEvidence } from "../domain/types.js";
import { RequirementSuiteRunService } from "../knowledge/requirementSuiteRun.js";
import { RequirementGateService } from "./requirementGate.js";
import { EvaluationIntegrityService } from "./evaluationIntegrity.js";
import { calculateEvaluationTrialMetrics } from "./evaluationMetrics.js";
import { readRuntimeIdentity } from "../shared/runtimeIdentity.js";

export function trialFixture() {
  const repository = new InMemoryBrainCreatorRepository();
  const now = "2026-09-11T00:00:00.000Z";
  repository.knowledgeProjects.push({ id: "p", name: "P", key: "p", status: "active", defaultLocale: "en", systemIds: ["s"], createdAt: now, updatedAt: now });
  repository.systemProfiles.push({ id: "s", name: "S", environment: "test", baseUrl: "https://example.test", urlAllowlist: [], defaultLocale: "en", status: "succeeded", createdAt: now, updatedAt: now });
  repository.requirementSources.push({ id: "source", knowledgeProjectId: "p", source: "req.md", sourceType: "local-file", title: "R", contentHash: "hash", content: "Approve", blocks: [], attachments: [], warnings: [], accessStatus: "available", revision: 1, latestRequirementSetId: "set", createdAt: now, updatedAt: now });
  repository.requirementSets.push({ id: "set", knowledgeProjectId: "p", sourceId: "source", version: 1, title: "R", summary: "R", contentHash: "hash", status: "approved", affectedNodeIds: [], createdAt: now, updatedAt: now });
  for (const n of [1, 2, 3]) {
    repository.businessScenarios.push({ id: `scenario${n}`, knowledgeProjectId: "p", requirementSetId: "set", title: "Approve", objective: "Approve", family: "main-flow", actors: [], preconditions: [], workflowRefs: [], stateTransitionRefs: [], decisionRuleRefs: [], testDataNeeds: [], expectedBusinessOutcomes: ["approved"], sourceRefs: ["req:1"], testIntentIds: [`intent${n}`], risk: "low", status: "approved" } satisfies BusinessScenario);
    repository.executableCases.push({ id: `case${n}`, knowledgeProjectId: "p", requirementSetId: "set", testIntentId: `intent${n}`, systemId: "s", title: "Approve", status: "ready", preconditions: [], steps: [], dataProfileIds: [], gapIds: [], createdAt: now, updatedAt: now } satisfies ExecutableCase);
  }
  const service = new EvaluationIntegrityService(repository);
  const input = { comparisonGroupId: "g", knowledgeProjectId: "p", systemId: "s", requirementSourceId: "source", provider: "builtin" as const, workspacePath: ".", storePath: "./isolated", codeRevision: "commit", runtimeVersions: {}, runtimeBuildIdentity: readRuntimeIdentity({ workspace: ".", schemaVersion: 19, provider: "unknown" }).buildId, businessScenarioIds: ["scenario1", "scenario2", "scenario3"] };
  const start = () => service.startTrial(input).trial;
  return { repository, service, input, start };
}

describe("frozen evaluation execution scope", () => {
  it.each(["project", "system", "source", "scenario"])("rejects foreign %s at start", (kind) => {
    const f = trialFixture();
    if (kind === "project") f.input.knowledgeProjectId = "foreign";
    if (kind === "system") f.input.systemId = "foreign";
    if (kind === "source") f.repository.requirementSets[0].sourceId = "foreign";
    if (kind === "scenario") f.repository.businessScenarios[0].requirementSetId = "foreign";
    expect(() => f.start()).toThrow();
  });
  it("requires an explicit scoped system but preserves legacy analysis trials", () => {
    const f = trialFixture();
    expect(() => f.service.startTrial({ ...f.input, systemId: undefined })).toThrow("explicit");
    expect(f.service.startTrial({ ...f.input, systemId: undefined, businessScenarioIds: undefined }).trial.executionScope).toBeUndefined();
  });
  it.each(["none", "multiple", "outside"])("rejects %s selected scenario mapping", (kind) => {
    const f = trialFixture();
    if (kind === "none") f.repository.businessScenarios[0].testIntentIds = [];
    if (kind === "multiple") f.repository.businessScenarios[1].testIntentIds = ["intent1"];
    if (kind === "outside") f.input.businessScenarioIds = ["scenario2"];
    const trial = f.start();
    expect(f.service.validateExecutionBinding({ trialId: trial.id, knowledgeProjectId: "p", systemId: "s", executableCaseIds: ["case1"] }).valid).toBe(false);
  });
  it.each(["scope", "version", "source", "membership"])("detects changed %s even after a checkpoint", (kind) => {
    const f = trialFixture(); const trial = f.start();
    if (kind === "scope") trial.executionScope!.businessScenarioIds.pop();
    if (kind === "version") f.repository.requirementSets[0].version++;
    if (kind === "source") f.repository.requirementSources[0].revision++;
    if (kind === "membership") f.repository.knowledgeProjects[0].systemIds = [];
    f.service.checkpointTrial({ trialId: trial.id, previousProjectionManifestId: trial.latestProjectionManifestId, operation: "test", evidenceRefs: ["test:1"] });
    expect(f.service.validateExecutionBinding({ trialId: trial.id, knowledgeProjectId: "p", systemId: "s", executableCaseIds: ["case1"] }).valid).toBe(false);
  });
  it.each([undefined, "unknown", "other"])("rejects missing or changed runtime %s", (runtimeBuildIdentity) => {
    const f = trialFixture();
    const trial = f.service.startTrial({ ...f.input, runtimeBuildIdentity: "pinned" }).trial;
    expect(f.service.validateExecutionBinding({ trialId: trial.id, knowledgeProjectId: "p", systemId: "s", executableCaseIds: ["case1"], runtimeBuildIdentity }).valid).toBe(false);
  });
  it("accepts an actual current receipt and rejects fake, draft and stale approvals", () => {
    const f = trialFixture(); const gate = new RequirementGateService(f.repository);
    expect(() => f.service.startTrial({ ...f.input, approvalReceiptId: "arbitrary-hash" })).toThrow();
    const challenge = gate.issueApprovalChallenge("set");
    const receipt = gate.createApprovalReceipt({ requirementSetId: "set", assetHash: challenge.assetHash, method: "challenge-response", approvedBy: "reviewer", challengeId: challenge.challengeId, approvalCode: challenge.code });
    f.repository.requirementSets[0].status = "draft";
    expect(() => f.service.startTrial({ ...f.input, approvalReceiptId: receipt.id })).toThrow("approved");
    f.repository.requirementSets[0].status = "approved";
    const trial = f.service.startTrial({ ...f.input, approvalReceiptId: receipt.id }).trial;
    expect(trial.executionScope?.approvalScopeHash).toBe(receipt.assetHash);
    f.repository.requirementSets[0].version++;
    expect(f.service.validateExecutionBinding({ trialId: trial.id, knowledgeProjectId: "p", systemId: "s" }).valid).toBe(false);
  });
});

function measuredFixture() {
  const f = trialFixture(); const trial = f.start();
  const runs = new RequirementSuiteRunService(f.repository);
  const run = runs.create({ knowledgeProjectId: "p", systemId: "s", evaluationTrialId: trial.id, cases: [{ executableCaseId: "case1", title: "Approve" }, { executableCaseId: "case2", title: "Blocked" }], continueOnBlocked: true });
  const at = new Date(Date.parse(run.createdAt) + 1000).toISOString();
  run.updatedAt = at;
  run.caseRuns[0].status = "passed"; run.caseRuns[0].completedAt = at; run.caseRuns[0].executionEvidenceId = "e";
  run.caseRuns[1].status = "blocked";
  const evidence: ExecutionEvidence = {
    id: "e", knowledgeProjectId: "p", systemId: "s", executableCaseId: "case1", testCaseId: "test", contextPackPath: "", status: "passed", provenance: "real-system", assuranceLevel: "strong", createdAt: run.createdAt, completedAt: at,
    artifactValidation: { status: "valid", files: [{ path: "evidence.json", sha256: "a".repeat(64) }], reasons: [] },
    assertionContracts: [{ id: "assert", stepId: "step", type: "state", strength: "strong", requirementRefs: ["req:1"], evidenceRequirements: ["actual-value"], oracle: { operator: "equals", expected: "approved", applicable: true, applicabilityRefs: ["req:1"] } }],
    reporterResult: { status: "passed", total: 1, passed: 1, failed: 0, skipped: 0, durationMs: 1, assertions: [{ id: "assert", stepId: "step", status: "passed", actual: "approved", evidenceRefs: ["evidence.json"] }], attachments: ["evidence.json"], consoleErrors: [], networkFailures: [] },
    steps: [], tracePaths: [], artifactPaths: ["evidence.json"], consoleErrors: [], networkFailures: []
  };
  f.repository.executionEvidence.push(evidence);
  f.repository.conformanceResults.push({ id: "c", scenarioId: "scenario1", executionEvidenceId: "e", verdict: "conform", expectationRefs: ["req:1"], observationRefs: ["evidence.json"], executionRefs: ["e"], reasons: [], createdAt: at });
  const metrics = () => calculateEvaluationTrialMetrics({ trial, runs: f.repository.requirementSuiteRuns, evidence: f.repository.executionEvidence, conformanceResults: f.repository.conformanceResults, scenarios: f.repository.businessScenarios, executableCases: f.repository.executableCases, interventions: f.repository.interventionRecords });
  return { ...f, trial, run, runs, evidence, metrics };
}

describe("evaluation trial metrics", () => {
  it("keeps blocked and unexecuted selected scenarios in the denominator", () => {
    const f = measuredFixture();
    expect(f.metrics().businessConformance).toMatchObject({ denominator: 3, measured: 1, passed: 1, blocked: 1, notRun: 1, rate: 1 / 3 });
  });
  it.each(["synthetic", "unknown", undefined] as const)("does not measure %s provenance", (provenance) => {
    const f = measuredFixture(); f.evidence.provenance = provenance;
    expect(f.metrics().businessConformance).toMatchObject({ status: "not-measured", rate: null, syntheticOrUnknown: 1 });
  });
  it.each(["systemId", "knowledgeProjectId", "executableCaseId", "createdAt"] as const)("rejects foreign or old evidence %s", (key) => {
    const f = measuredFixture(); f.evidence[key] = key === "createdAt" ? "2000-01-01T00:00:00.000Z" : "foreign";
    expect(f.metrics().businessConformance.measured).toBe(0);
  });
  it.each(["systemId", "knowledgeProjectId", "evaluationTrialId", "evaluationSourceHash"] as const)("rejects a foreign linked run %s", (key) => {
    const f = measuredFixture(); f.run[key] = "foreign";
    expect(f.metrics().businessConformance.measured).toBe(0);
  });
  it.each(["queued", "blocked", "cancelled", "waiting-for-agent"] as const)("latest %s without evidence supersedes old success including ties", (status) => {
    const f = measuredFixture();
    const next = structuredClone(f.run); next.id = "next";
    next.caseRuns[0].status = status; next.caseRuns[0].executionEvidenceId = undefined;
    f.repository.requirementSuiteRuns.push(next);
    expect(f.metrics().businessConformance).toMatchObject({ measured: 0, rate: null });
  });
  it("deduplicates attempts and fails closed on ambiguous mapping or contradicted oracles", () => {
    const f = measuredFixture();
    f.repository.requirementSuiteRuns.push(structuredClone(f.run));
    expect(f.metrics().businessConformance.passed).toBe(1);
    f.evidence.reporterResult!.assertions[0].actual = "rejected";
    expect(f.metrics().businessConformance.measured).toBe(0);
    f.evidence.reporterResult!.assertions[0].actual = "approved";
    f.repository.businessScenarios[1].testIntentIds = ["intent1"];
    expect(f.metrics().businessConformance.measured).toBe(0);
  });
  it("returns no invented rates for legacy scope or invalidated trials", () => {
    const f = measuredFixture(); f.trial.executionScope = undefined;
    expect(f.metrics().businessConformance).toMatchObject({ status: "not-comparable", denominator: null, rate: null });
    f.trial.status = "invalidated";
    expect(f.metrics().autonomy.status).toBe("not-measured");
  });
  it("holds multi-case scenarios inconclusive without an aggregation contract", () => {
    const f = measuredFixture();
    f.repository.businessScenarios[0].testIntentIds!.push("intent2");
    expect(f.metrics().businessConformance).toMatchObject({ measured: 0, rate: null });
  });
  it("does not reuse historical suites and preserves binding on repeats", () => {
    const f = trialFixture(); const runs = new RequirementSuiteRunService(f.repository);
    const input = { knowledgeProjectId: "p", systemId: "s", cases: [{ executableCaseId: "case1", title: "C" }], continueOnBlocked: true };
    const old = runs.create(input); const trial = f.start();
    const run = runs.create({ ...input, evaluationTrialId: trial.id, stabilityTarget: 2 });
    expect(run.id).not.toBe(old.id);
    runs.beginNext(run.id); runs.completeCase(run.id, "case1", { status: "passed", gapIds: [] });
    expect(runs.get(run.stabilityNextRunId!).evaluationTrialId).toBe(trial.id);
  });
});
