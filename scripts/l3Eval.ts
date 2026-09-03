import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { evaluateL3GoldenCorpus } from "../src/brain/l3Evaluation.js";

const report = evaluateL3GoldenCorpus({
  seed: process.env.BRAIN_CREATOR_EVAL_SEED ?? "brain-creator-l3-baseline"
});
const outputPath = optionValue("--output") ?? npmForwardedOutputPath();
const json = process.argv.includes("--json") || Boolean(outputPath);

if (process.argv.includes("--output") && !outputPath) {
  throw new Error("--output requires a file path");
}

if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Brain Creator L3 golden evaluation");
  console.log(`Seed: ${report.seed}`);
  console.log(`Samples: ${report.measuredSampleCount}/${report.sampleCount} measured`);
  console.log("");
  for (const sample of report.sampleResults) {
    const result = sample.passed === null ? "NOT-MEASURED" : sample.passed ? "PASS" : "FAIL";
    console.log(`${result} ${sample.sampleId} (${sample.domain})`);
    for (const failure of sample.failures) console.log(`  - ${failure}`);
  }
  console.log("");
  for (const [dimension, metric] of Object.entries(report.metrics)) {
    const rate = metric.rate === null ? "not measured" : `${(metric.rate * 100).toFixed(1)}%`;
    console.log(`${metric.status.toUpperCase()} ${dimension}: ${rate} (${metric.passed}/${metric.total})`);
  }
  console.log("");
  console.log(`Release gate: ${report.releaseGate.status}`);
  for (const blocker of report.releaseGate.blockers) console.log(`  - ${blocker}`);
}

const measuredFailure = Object.values(report.metrics).some((metric) =>
  metric.status === "measured" && metric.rate !== null && metric.rate < metric.threshold
);
if (measuredFailure || (process.argv.includes("--strict") && report.releaseGate.status !== "candidate")) {
  process.exitCode = 1;
}

function optionValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function npmForwardedOutputPath() {
  const candidate = process.argv.slice(2).find((argument) =>
    argument.toLowerCase().endsWith(".json") && !argument.startsWith("--")
  );
  return candidate;
}
