import {
  REQUIREMENT_GOLDEN_SAMPLES,
  evaluateRequirementGoldenSample,
  summarizeRequirementGoldenSamples
} from "../src/knowledge/goldenSamples.js";

const results = REQUIREMENT_GOLDEN_SAMPLES.map(evaluateRequirementGoldenSample);
const summary = summarizeRequirementGoldenSamples(results);

console.log("Requirement Brain golden evaluation");
console.log(JSON.stringify(summary, null, 2));
for (const result of results) {
  console.log(
    `${result.passed ? "PASS" : "FAIL"} ${result.sample.id}: ` +
      `${result.evaluation.coverage.coveredClauses}/${result.evaluation.coverage.totalClauses} clauses, ` +
      `${result.design.testIntents.length} intents, verdict=${result.evaluation.verdict}`
  );
  for (const failure of result.failures) console.log(`  - ${failure}`);
}

if (results.some((result) => !result.passed)) process.exitCode = 1;
