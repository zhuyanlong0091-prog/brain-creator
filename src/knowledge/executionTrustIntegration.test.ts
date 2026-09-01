// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { ExecutionEvidence } from "../domain/types.js";
import type { BusinessScenario, ScenarioTrustRecord } from "../brain/types.js";
import { KnowledgeService } from "./service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("execution evidence and scenario trust integration", () => {
  it("records trust from completed evidence without requiring a manual trust call", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const knowledgeDir = await tempDir();
    const service = new KnowledgeService(repository, knowledgeDir);
    const project = await service.createProject({ name: "Trust", key: "trust", defaultLocale: "en-US" });
    repository.systemProfiles.push({
      id: "system-trust",
      name: "Trust system",
      environment: "test",
      baseUrl: "https://trust.example.test",
      defaultLocale: "en-US",
      urlAllowlist: ["https://trust.example.test"],
      status: "succeeded",
      createdAt: now,
      updatedAt: now
    });
    service.bindSystem(project.id, "system-trust");
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Approval",
        content: "A request can be approved.",
        blocks: [{ type: "paragraph", text: "A request can be approved." }],
        attachments: [],
        source: "approval.md",
        sourceType: "local-file",
        contentHash: "requirement-v1",
        warnings: []
      }
    });
    const scenario: BusinessScenario = {
      id: "scenario-approval",
      knowledgeProjectId: project.id,
      requirementSetId: ingested.requirementSet.id,
      title: "Approve request",
      objective: "Approve a request",
      family: "main-flow",
      actors: ["approver"],
      preconditions: [],
      workflowRefs: ["workflow-approval"],
      stateTransitionRefs: [],
      decisionRuleRefs: [],
      testDataNeeds: [],
      expectedBusinessOutcomes: ["Request is approved"],
      sourceRefs: ["requirement:approval"],
      testIntentIds: ["intent-approval"],
      risk: "high",
      status: "approved"
    };
    repository.businessScenarios.push(scenario);
    const trust: ScenarioTrustRecord = {
      scenarioId: scenario.id,
      status: "bound",
      strongRunCount: 0,
      lastRequirementHash: "requirement-v1",
      updatedAt: now
    };
    repository.scenarioTrustRecords.push(trust);
    repository.executableCases.push({
      id: "case-approval",
      knowledgeProjectId: project.id,
      requirementSetId: ingested.requirementSet.id,
      testIntentId: "intent-approval",
      systemId: "system-trust",
      title: "Approve request",
      status: "ready",
      preconditions: [],
      steps: [],
      assertionContracts: [],
      dataProfileIds: [],
      gapIds: [],
      createdAt: now,
      updatedAt: now
    });

    const executionEvidence = evidence(project.id);
    repository.executionEvidence.push(executionEvidence);
    const result = await service.completeExecutionEvidence(executionEvidence.id, {
      status: "passed",
      artifactPaths: [],
      reporterResult: executionEvidence.reporterResult,
      observationMode: "observe"
    });

    expect(result.scenarioTrust).toEqual(expect.objectContaining({
      decision: "promoted",
      status: "verified",
      strongRunCount: 1
    }));
    expect(repository.scenarioTrustRecords[0]).toEqual(expect.objectContaining({ status: "verified" }));
    const report = await readFile(
      join(knowledgeDir, "trust", "reports", "evidence-approval", "summary.md"),
      "utf8"
    );
    expect(report).toContain("Plain-language summary");
    expect(report).toContain("What was understood");
  });
});

function evidence(knowledgeProjectId: string): ExecutionEvidence {
  return {
    id: "evidence-approval",
    knowledgeProjectId,
    systemId: "system-trust",
    executableCaseId: "case-approval",
    testCaseId: "test-approval",
    contextPackPath: "context.json",
    status: "passed",
    assuranceLevel: "strong",
    assertionContracts: [{
      id: "assert-approval",
      type: "workflow",
      strength: "strong",
      requirementRefs: ["requirement:approval"],
      evidenceRequirements: ["actual-value"]
    }],
    reporterResult: {
      status: "passed",
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      durationMs: 10,
      assertions: [{
        id: "assert-approval",
        status: "passed",
        actual: "approved",
        evidenceRefs: ["actual-value"]
      }],
      steps: [{
        id: "step-approval",
        title: "Verify approval",
        status: "passed",
        evidenceRefs: ["actual-value"]
      }],
      attachments: [],
      consoleErrors: [],
      networkFailures: []
    },
    steps: [{
      stepId: "step-approval",
      order: 1,
      action: "assert",
      instruction: "Verify approval",
      expected: "approved",
      actual: "approved",
      assertionStatus: "passed",
      sourceRefs: ["requirement:approval"],
      origin: "source"
    }],
    coverage: { required: [], verified: [], missing: [] },
    tracePaths: [],
    artifactPaths: [],
    consoleErrors: [],
    networkFailures: [],
    evidenceWarnings: [],
    createdAt: now
  };
}

const now = "2026-09-01T00:00:00.000Z";

async function tempDir() {
  const directory = await mkdtemp(join(tmpdir(), "brain-trust-"));
  tempDirs.push(directory);
  return directory;
}
