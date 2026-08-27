import { describe, expect, it } from "vitest";
import {
  HARNESS_GOLDEN_SAMPLES,
  evaluateHarnessGoldenSample,
  summarizeHarnessGoldenSamples
} from "./goldenHarness.js";

describe("cross-Brain Harness golden samples", () => {
  it("covers HR, order approval, cross-role, multi-requirement, and long-run paths", () => {
    const results = HARNESS_GOLDEN_SAMPLES.map(evaluateHarnessGoldenSample);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(summarizeHarnessGoldenSamples()).toEqual(expect.objectContaining({
      total: 5,
      passed: 5,
      passRate: 1,
      longRunIterations: 20
    }));
  });

  it("fails the golden gate when a run leaks a system reference or data lease", () => {
    const result = evaluateHarnessGoldenSample({
      ...HARNESS_GOLDEN_SAMPLES[0],
      leakedSystemRefs: 1,
      openDataLeases: 1
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      "Cross-system references were detected",
      "Test data cleanup left active leases"
    ]));
  });
});
