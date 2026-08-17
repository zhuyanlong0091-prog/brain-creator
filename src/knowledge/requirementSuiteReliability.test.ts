// @vitest-environment node

import { describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type { ExecutableCase } from "../domain/types.js";
import { RequirementSuiteRunService } from "./requirementSuiteRun.js";

function executableCase(id: string, requirementSetId: string): ExecutableCase {
  return {
    id,
    knowledgeProjectId: "knowledge",
    requirementSetId,
    testIntentId: `intent-${id}`,
    systemId: "system",
    title: id,
    status: "ready",
    compileKey: `compile-${id}`,
    preconditions: [],
    steps: [],
    dataProfileIds: [],
    gapIds: [],
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z"
  };
}

describe("requirement suite reliability controls", () => {
  it("persists same-system multi-requirement reconciliation on suite creation", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.executableCases.push(
      executableCase("case-a", "requirement-a"),
      executableCase("case-b", "requirement-b")
    );
    const service = new RequirementSuiteRunService(repository);
    const run = service.create({
      knowledgeProjectId: "knowledge",
      systemId: "system",
      requirementSetIds: ["requirement-a", "requirement-b"],
      cases: [
        { executableCaseId: "case-a", title: "Case A" },
        { executableCaseId: "case-b", title: "Case B" }
      ],
      continueOnBlocked: false
    });

    expect(run.reconciliation).toMatchObject({
      status: "complete",
      requirementSetIds: ["requirement-a", "requirement-b"]
    });
  });

  it("holds the next stability iteration until its scheduled time", () => {
    const repository = new InMemoryBrainCreatorRepository();
    repository.executableCases.push(executableCase("case-a", "requirement-a"));
    const service = new RequirementSuiteRunService(repository);
    const run = service.create({
      knowledgeProjectId: "knowledge",
      systemId: "system",
      cases: [{ executableCaseId: "case-a", title: "Case A" }],
      continueOnBlocked: false,
      stabilityTarget: 2,
      stabilityPolicy: {
        targetIterations: 2,
        minIntervalMs: 60_000
      }
    });
    service.beginNext(run.id);
    service.completeCase(run.id, "case-a", { status: "passed", gapIds: [] });

    const next = repository.requirementSuiteRuns.find((item) => item.id === run.stabilityNextRunId);
    expect(next?.stabilitySchedule?.nextRunAt).toBeDefined();
    expect(service.beginNext(next!.id).caseRun).toBeUndefined();
  });
});
