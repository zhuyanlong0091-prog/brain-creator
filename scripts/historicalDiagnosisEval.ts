import { JsonFileBrainCreatorRepository } from "../src/domain/repository.js";
import { ExecutionDiagnosisService } from "../src/knowledge/executionDiagnosis.js";
import { resolveBrainCreatorDataFile } from "../src/shared/workspace.js";

const args = process.argv.slice(2);
const systemId = valueAfter(args, "--system");
const minSampleSize = Number(valueAfter(args, "--min-sample") ?? "20");
const dataFile = resolveBrainCreatorDataFile(process.cwd(), process.env);
const repository = new JsonFileBrainCreatorRepository(dataFile);
const service = new ExecutionDiagnosisService(repository);
const systemIds = systemId
  ? [systemId]
  : [...new Set(repository.executionDiagnosisReviews.map((review) => review.systemId))];
const evaluation = service.legacyReviewEvalForSystems(systemIds, minSampleSize);

console.log("Historical execution diagnosis Eval");
console.log(`Data file: ${dataFile}`);
console.log(`Systems: ${systemIds.length > 0 ? systemIds.join(", ") : "none"}`);
console.log(JSON.stringify(evaluation, null, 2));
console.log("");
console.log("# Historical Execution Diagnosis Eval");
console.log(`- Readiness: ${evaluation.readiness}`);
console.log(
  `- Adjudicated sample: ${evaluation.adjudicated}/${evaluation.minSampleSize}`
);
console.log(
  `- Observed accuracy: ${formatPercent(evaluation.observedAccuracy)}`
);
console.log(
  `- Reportable accuracy: ${formatPercent(evaluation.reportableAccuracy)}`
);
if (evaluation.warning) console.log(`- Warning: ${evaluation.warning}`);

function valueAfter(values: string[], flag: string) {
  const index = values.indexOf(flag);
  return index >= 0 ? values[index + 1] : undefined;
}

function formatPercent(value: number | null) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}
