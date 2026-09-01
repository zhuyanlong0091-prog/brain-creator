// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBrainCreatorRepository } from "../domain/repository.js";
import type {
  ExecutableCaseStep,
  TestDataProfile
} from "../domain/types.js";
import { KnowledgeService } from "./service.js";
import {
  applyTestDataResolutions,
  confirmTestDataPlan,
  planTestData
} from "./testDataPlanner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("Test data planner", () => {
  it("generates a deterministic candidate and binds one matching field step", () => {
    const profile = dataProfile({
      id: "data-customer-name",
      field: "Customer Name",
      strategy: "generated",
      seed: "customer-name-seed"
    });

    const first = planTestData([profile], [
      step("fill", "Fill Customer Name", "Customer Name")
    ]);
    const second = planTestData([profile], [
      step("fill", "Fill Customer Name", "Customer Name")
    ]);

    expect(first.plan).toEqual(
      expect.objectContaining({
        verdict: "ready",
        requiresConfirmation: true
      })
    );
    expect(first.plan.operations[0]).toEqual(
      expect.objectContaining({
        profileId: profile.id,
        decision: "generate",
        status: "proposed",
        value: expect.stringMatching(/^bc-customer-name-/)
      })
    );
    expect(second.plan.operations[0].value).toBe(
      first.plan.operations[0].value
    );
    expect(first.steps[0]).toEqual(
      expect.objectContaining({
        dataProfileId: profile.id,
        value: first.plan.operations[0].value
      })
    );

    const confirmed = confirmTestDataPlan(
      first.plan,
      "2026-07-30T00:00:00.000Z"
    );
    expect(confirmed).toEqual(
      expect.objectContaining({
        confirmedAt: "2026-07-30T00:00:00.000Z",
        operations: [
          expect.objectContaining({ status: "ready" })
        ]
      })
    );
  });

  it("carries a stable entity reference into both the data plan and executable step", () => {
    const profile = dataProfile({
      id: "data-employee-name",
      field: "Employee Name",
      strategy: "generated",
      seed: "employee-name-seed",
      entityReference: "employee:testperson001"
    });

    const planned = planTestData([profile], [
      step("fill", "Fill Employee Name", "Employee Name")
    ]);

    expect(planned.plan.entityReferences).toEqual(["employee:testperson001"]);
    expect(planned.plan.operations[0]).toEqual(expect.objectContaining({
      entityReference: "employee:testperson001"
    }));
    expect(planned.steps[0]).toEqual(expect.objectContaining({
      dataReference: "employee:testperson001"
    }));
  });

  it("orders runtime-captured data after its declared dependencies", () => {
    const account = dataProfile({
      id: "data-account",
      field: "Account",
      strategy: "fixed",
      seed: "qa-account"
    });
    const orderId = dataProfile({
      id: "data-order-id",
      field: "Order ID",
      strategy: "runtime-captured",
      seed: "",
      dependsOnFields: ["Account"]
    });

    const result = planTestData([orderId, account], []);

    expect(result.plan.verdict).toBe("ready");
    expect(result.plan.dependencyOrder).toEqual([
      "data-account",
      "data-order-id"
    ]);
    expect(result.plan.operations[1]).toEqual(
      expect.objectContaining({
        decision: "capture",
        dependsOnProfileIds: ["data-account"],
        status: "ready"
      })
    );
  });

  it("blocks missing and cyclic data dependencies", () => {
    const missing = planTestData([
      dataProfile({
        id: "data-child",
        field: "Child",
        strategy: "runtime-captured",
        seed: "",
        dependsOnFields: ["Missing Parent"]
      })
    ], []);

    expect(missing.plan.verdict).toBe("blocked");
    expect(missing.plan.reasons[0]).toContain("Missing Parent");

    const cyclic = planTestData([
      dataProfile({
        id: "data-a",
        field: "A",
        strategy: "runtime-captured",
        seed: "",
        dependsOnFields: ["B"]
      }),
      dataProfile({
        id: "data-b",
        field: "B",
        strategy: "runtime-captured",
        seed: "",
        dependsOnFields: ["A"]
      })
    ], []);

    expect(cyclic.plan.verdict).toBe("blocked");
    expect(cyclic.plan.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("cycle")])
    );
    expect(() =>
      applyTestDataResolutions(cyclic.plan, cyclic.steps, [
        {
          profileId: "data-a",
          decision: "use-value",
          value: "cannot-bypass-cycle"
        }
      ])
    ).toThrow("structural");
    expect(() =>
      confirmTestDataPlan(cyclic.plan, "2026-07-30T00:00:00.000Z")
    ).toThrow("Blocked");
  });

  it("blocks duplicate field profiles instead of selecting one", () => {
    const result = planTestData([
      dataProfile({
        id: "data-name-a",
        field: "Name",
        strategy: "fixed",
        seed: "A"
      }),
      dataProfile({
        id: "data-name-b",
        field: "Name",
        strategy: "fixed",
        seed: "B"
      })
    ], []);

    expect(result.plan.verdict).toBe("blocked");
    expect(result.plan.reasons[0]).toContain("multiple profiles");
  });

  it("requires an explicit reuse or create resolution for existing references", () => {
    const profile = dataProfile({
      id: "data-customer",
      field: "Customer",
      strategy: "existing-reference",
      seed: "status=active",
      cleanup: "none"
    });
    const planned = planTestData([profile], [
      step("select", "Select Customer", "Customer")
    ]);

    expect(planned.plan.verdict).toBe("blocked");
    expect(planned.plan.operations[0]).toEqual(
      expect.objectContaining({
        decision: "lookup",
        lookupQuery: "status=active",
        status: "needs-resolution"
      })
    );

    const resolved = applyTestDataResolutions(planned.plan, planned.steps, [
      {
        profileId: profile.id,
        decision: "reuse",
        reference: "customer:existing-42",
        value: "Existing Customer"
      }
    ]);

    expect(resolved.plan.verdict).toBe("ready");
    expect(resolved.plan.operations[0]).toEqual(
      expect.objectContaining({
        decision: "reuse",
        reference: "customer:existing-42",
        value: "Existing Customer",
        status: "ready"
      })
    );
    expect(resolved.steps[0].value).toBe("Existing Customer");
  });

  it("keeps secret references out of executable values", () => {
    const result = planTestData([
      dataProfile({
        id: "data-api-token",
        field: "API Token",
        strategy: "secret-reference",
        seed: "env:TEST_API_TOKEN"
      })
    ], [step("fill", "Fill API Token", "API Token")]);

    expect(result.plan.verdict).toBe("ready");
    expect(result.plan.operations[0]).toEqual(
      expect.objectContaining({
        decision: "resolve-secret",
        secretRef: "env:TEST_API_TOKEN",
        status: "ready"
      })
    );
    expect(result.plan.operations[0].value).toBeUndefined();
    expect(result.steps[0].value).toBeUndefined();
  });

  it("never overwrites an observed state value with an unrelated data candidate", () => {
    const observedSelect: ExecutableCaseStep = {
      ...step("select", "Select the observed value for Mode", "Mode"),
      value: "Advanced",
      origin: "observed",
      locatorPointId: "locator-mode"
    };
    const result = planTestData([
      dataProfile({
        id: "data-form-input",
        field: "Form Input",
        strategy: "generated",
        seed: "form-input-seed"
      })
    ], [observedSelect]);

    expect(result.steps[0]).toEqual(observedSelect);
  });

  it("carries cleanup policy for data created by the host agent", () => {
    const profile = dataProfile({
      id: "data-order",
      field: "Order",
      strategy: "existing-reference",
      seed: "status=draft",
      cleanup: "delete-created"
    });
    const planned = planTestData([profile], []);
    const resolved = applyTestDataResolutions(planned.plan, planned.steps, [
      {
        profileId: profile.id,
        decision: "create",
        reference: "order:created-7",
        value: "Created Order"
      }
    ]);

    expect(resolved.plan.operations[0]).toEqual(
      expect.objectContaining({
        decision: "create",
        cleanup: "delete-created",
        reference: "order:created-7",
        status: "ready"
      })
    );
    expect(resolved.plan.requiresCleanup).toBe(true);
  });

  it("compiles only intent-related profiles and resolves a blocked reference plan", async () => {
    const repository = new InMemoryBrainCreatorRepository();
    const service = new KnowledgeService(repository, await tempDir());
    const project = await service.createProject({
      name: "Customer Data",
      key: "customer-data-plan",
      defaultLocale: "en-US"
    });
    const ingested = await service.ingestRequirement({
      projectId: project.id,
      contentPackage: {
        title: "Customer forms",
        content: "Fill Customer Name form.\nFill Order Reference form.",
        blocks: [
          { type: "paragraph", text: "Fill Customer Name form." },
          { type: "paragraph", text: "Fill Order Reference form." }
        ],
        attachments: [],
        source: "requirements/customer-data.md",
        sourceType: "local-file",
        contentHash: "customer-data-v1",
        warnings: []
      }
    });
    const design = await service.generateTestDesign(ingested.requirementSet.id);
    if (design.evaluationGate.actions.some((action) => action.status === "pending")) {
      await service.confirmEvaluationActions({
        requirementSetId: ingested.requirementSet.id,
        actionIds: design.evaluationGate.actions
          .filter((action) => action.status === "pending")
          .map((action) => action.id),
        note: "The requirement clauses are confirmed for the data planner test.",
        confirm: true
      });
    }
    service.approveRequirementSet(ingested.requirementSet.id);
    expect(design.testIntents.length).toBeGreaterThanOrEqual(2);
    const selectedIntent = design.testIntents[0];
    const relatedProfiles = design.dataProfiles.filter((profile) =>
      profile.sourceRefs.some((sourceRef) =>
        selectedIntent.requirementRefs.includes(sourceRef)
      )
    );
    expect(relatedProfiles).toHaveLength(1);
    relatedProfiles[0].field = "Customer";
    relatedProfiles[0].strategy = "existing-reference";
    relatedProfiles[0].seed = "status=active";

    const compiled = service.compileExecutableCases(selectedIntent.id);

    expect(compiled.executableCase.status).toBe("needs-data");
    expect(compiled.executableCase.dataProfileIds).toEqual([
      relatedProfiles[0].id
    ]);
    expect(compiled.executableCase.dataPlan).toEqual(
      expect.objectContaining({
        verdict: "blocked",
        operations: [
          expect.objectContaining({
            profileId: relatedProfiles[0].id,
            decision: "lookup"
          })
        ]
      })
    );
    expect(compiled.gaps).toEqual([]);

    const resolved = service.resolveExecutableCaseTestData({
      executableCaseId: compiled.executableCase.id,
      resolutions: [
        {
          profileId: relatedProfiles[0].id,
          decision: "reuse",
          reference: "customer:42",
          value: "Existing Customer"
        }
      ]
    });

    expect(resolved.executableCase.status).toBe("ready");
    expect(resolved.executableCase.dataPlan).toEqual(
      expect.objectContaining({ verdict: "ready" })
    );
    expect(resolved.resolvedGaps).toEqual([]);
  });
});

function dataProfile(
  input: Partial<TestDataProfile> &
    Pick<TestDataProfile, "id" | "field" | "strategy" | "seed">
): TestDataProfile {
  return {
    knowledgeProjectId: "knowledge-data",
    requirementSetId: "requirement-data",
    name: `${input.field} data`,
    constraints: [],
    sourceRefs: [`requirement:${input.field}`],
    createdAt: new Date(0).toISOString(),
    ...input
  };
}

function step(
  action: ExecutableCaseStep["action"],
  instruction: string,
  targetSemantic: string
): ExecutableCaseStep {
  return {
    id: `step-${action}-${targetSemantic}`,
    order: 1,
    action,
    instruction,
    targetSemantic,
    origin: "source",
    sourceRefs: [`requirement:${targetSemantic}`]
  };
}

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "brain-data-plan-"));
  tempDirs.push(dir);
  return dir;
}
