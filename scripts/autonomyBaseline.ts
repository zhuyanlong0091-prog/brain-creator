import { buildAutonomyBaselineReport } from "../src/brain/autonomyBaseline.js";

const report = buildAutonomyBaselineReport();
console.log(JSON.stringify(report, null, 2));

const measuredFailures = Object.values(report.metrics).filter(
  (metric) =>
    metric.status === "measured" &&
    metric.rate !== null &&
    metric.rate < (metric.threshold ?? 1)
);
if (measuredFailures.length > 0) process.exitCode = 1;
