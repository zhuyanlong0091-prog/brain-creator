import {
  REQUIREMENT_GOLDEN_SAMPLES,
  evaluateProcessRequirementGoldenSample,
  evaluateRequirementGoldenSample,
  summarizeRequirementGoldenSamples
} from "../src/knowledge/goldenSamples.js";

const results = REQUIREMENT_GOLDEN_SAMPLES.map(evaluateRequirementGoldenSample);
const summary = summarizeRequirementGoldenSamples(results);
const processResult = evaluateProcessRequirementGoldenSample();
const processPassed =
  processResult.coverageProfile.status === "complete" &&
  processResult.workflowModels.length > 0 &&
  processResult.stateMachineModels.length > 0 &&
  processResult.testIntents.some((intent) => intent.scenarioType === "negative") &&
  processResult.testIntents.some((intent) => (intent.actorJourney?.length ?? 0) > 1);

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
console.log(
  `${processPassed ? "PASS" : "FAIL"} ${processResult.sample.id}: ` +
    `${processResult.workflowModels.length} workflows, ` +
    `${processResult.stateMachineModels.length} state machines, ` +
    `${processResult.testIntents.length} intents, coverage=${processResult.coverageProfile.status}`
);

if (results.some((result) => !result.passed) || !processPassed) process.exitCode = 1;
