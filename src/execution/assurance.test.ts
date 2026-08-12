// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildAssertionContracts, determineAssuranceLevel } from "./assurance.js";
import type { ExecutableCaseStep, StructuredReporterResult } from "../domain/types.js";

describe("assertion assurance", () => {
  it("builds typed contracts with requirement and evidence references", () => {
    const contracts = buildAssertionContracts([
      {
        id: "step-1",
        order: 1,
        action: "assert",
        instruction: "Verify the order workflow is approved",
        targetSemantic: "Order approval workflow",
        expected: "approved",
        origin: "source",
        sourceRefs: ["requirement:order.status"]
      } as ExecutableCaseStep
    ]);

    expect(contracts).toEqual([
      expect.objectContaining({
        type: "workflow",
        strength: "strong",
        requirementRefs: ["requirement:order.status"],
        evidenceRequirements: expect.arrayContaining(["actual-value", "screenshot", "trace"])
      })
    ]);
  });

  it("does not call a reporter-less or partially verified run strong", () => {
    const contracts = buildAssertionContracts([assertionStep()]);
    expect(determineAssuranceLevel(contracts, undefined)).toBe("none");
    expect(determineAssuranceLevel(contracts, reporter({ status: "failed" }))).toBe("none");
    expect(determineAssuranceLevel(contracts, reporter({ status: "passed" }))).toBe("none");
  });

  it("calls a fully mapped passing reporter strong", () => {
    const contracts = buildAssertionContracts([assertionStep()]);
    expect(
      determineAssuranceLevel(
        contracts,
        reporter({
          status: "passed",
          assertions: [{ id: contracts[0].id, status: "passed", evidenceRefs: ["step-1.png"] }]
        })
      )
    ).toBe("strong");
  });
});

function assertionStep(): ExecutableCaseStep {
  return {
    id: "step-1",
    order: 1,
    action: "assert",
    instruction: "Check order amount",
    targetSemantic: "Order amount",
    expected: "42",
    origin: "source",
    sourceRefs: ["requirement:amount"]
  };
}

function reporter(overrides: Partial<StructuredReporterResult>): StructuredReporterResult {
  return {
    status: "passed",
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    durationMs: 10,
    assertions: [],
    attachments: [],
    consoleErrors: [],
    networkFailures: [],
    ...overrides
  };
}
