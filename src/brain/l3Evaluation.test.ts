import { describe, expect, it } from "vitest";
import {
  evaluateL3GoldenCorpus,
  L3_GOLDEN_CORPUS
} from "./l3Evaluation.js";

describe("L3 golden evaluation", () => {
  it("covers the business dimensions required for the L3 host candidate", () => {
    const report = evaluateL3GoldenCorpus({
      generatedAt: "2026-09-03T00:00:00.000Z",
      seed: "brain-creator-l3-baseline"
    });

    expect(L3_GOLDEN_CORPUS).toHaveLength(7);
    expect(report.sampleResults).toHaveLength(7);
    expect(report.sampleResults.filter((sample) => sample.passed === true)).toHaveLength(6);
    expect(report.metrics["workflow-state-coverage"]).toEqual(expect.objectContaining({
      status: "measured",
      rate: 1
    }));
    expect(report.metrics["multi-role"]).toEqual(expect.objectContaining({
      status: "measured",
      rate: 1
    }));
    expect(report.metrics["multi-requirement"]).toEqual(expect.objectContaining({
      status: "measured",
      rate: 1
    }));
  });

  it("does not turn synthetic evidence into a real-system release claim", () => {
    const report = evaluateL3GoldenCorpus({ seed: "test" });

    expect(report.metrics["real-system-regression"]).toEqual(expect.objectContaining({
      status: "not-measured",
      rate: null
    }));
    expect(report.metrics["historical-bug-replay"]).toEqual(expect.objectContaining({
      status: "not-measured",
      rate: null
    }));
    expect(report.releaseGate.status).toBe("blocked");
    expect(report.releaseGate.blockers.some((blocker) => /real-system/i.test(blocker))).toBe(true);
    expect(report.releaseGate.blockers.some((blocker) => /historical bug/i.test(blocker))).toBe(true);
  });

  it("fails a golden sample when a measured control falls below its threshold", () => {
    const report = evaluateL3GoldenCorpus({
      samples: L3_GOLDEN_CORPUS.map((sample) => sample.id === "cross-role-journey"
        ? {
            ...sample,
            checks: sample.checks.map((check) => check.dimension === "multi-role"
              ? { ...check, passed: 3 }
              : check)
          }
        : sample)
    });

    const sample = report.sampleResults.find((item) => item.sampleId === "cross-role-journey");
    expect(sample?.passed).toBe(false);
    expect(sample?.failures).toEqual(expect.arrayContaining([
      expect.stringContaining("multi-role")
    ]));
    expect(report.metrics["multi-role"].rate).toBe(0.7);
    expect(report.releaseGate.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("cross-role-journey")
    ]));
  });
});
