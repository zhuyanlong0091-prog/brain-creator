export type L3EvaluationDimension =
  | "requirement-understanding"
  | "workflow-state-coverage"
  | "scenario-coverage"
  | "multi-role"
  | "multi-requirement"
  | "runtime-evidence"
  | "long-run-stability"
  | "historical-bug-replay"
  | "real-system-regression";

export type L3GoldenCheck = {
  dimension: L3EvaluationDimension;
  status: "measured" | "not-measured";
  passed: number;
  total: number;
  threshold: number;
  note: string;
};

export type L3GoldenSample = {
  id: string;
  domain: "hr" | "order-approval" | "image-state-machine" | "cross-role" | "multi-requirement" | "long-run" | "historical-bug";
  title: string;
  sourceKind: "sanitized-synthetic" | "external-real-system";
  checks: L3GoldenCheck[];
};

export type L3GoldenSampleResult = {
  sampleId: string;
  domain: L3GoldenSample["domain"];
  sourceKind: L3GoldenSample["sourceKind"];
  passed: boolean | null;
  failures: string[];
  checks: L3GoldenCheck[];
};

export type L3EvaluationMetric = {
  status: "measured" | "not-measured";
  passed: number;
  total: number;
  rate: number | null;
  threshold: number;
  sampleIds: string[];
  notes: string[];
};

export type L3ReleaseGate = {
  status: "candidate" | "blocked";
  blockers: string[];
  measuredDimensions: L3EvaluationDimension[];
  pendingDimensions: L3EvaluationDimension[];
};

export type L3GoldenCorpusReport = {
  generatedAt: string;
  seed: string;
  sampleCount: number;
  measuredSampleCount: number;
  sampleResults: L3GoldenSampleResult[];
  metrics: Record<L3EvaluationDimension, L3EvaluationMetric>;
  releaseGate: L3ReleaseGate;
};

export const L3_GOLDEN_CORPUS: L3GoldenSample[] = [
  {
    id: "hr-intern-headcount-flow",
    domain: "hr",
    title: "Intern headcount rule and approval flow",
    sourceKind: "sanitized-synthetic",
    checks: [
      measured("requirement-understanding", 10, 10, 0.9, "Rules, conditional fields, defaults, and constraints are source-backed."),
      measured("workflow-state-coverage", 8, 8, 0.9, "Create, submit, approve, and terminal states are represented."),
      measured("scenario-coverage", 8, 8, 0.9, "Main path, rule branches, and invalid configuration scenarios are designed."),
      measured("runtime-evidence", 8, 8, 0.95, "Every sample scenario has structured step evidence."),
    ]
  },
  {
    id: "order-approval-flow",
    domain: "order-approval",
    title: "Order approval with rejection and finance handoff",
    sourceKind: "sanitized-synthetic",
    checks: [
      measured("requirement-understanding", 8, 8, 0.9, "Actors, amount rule, approval state, and rejection behavior are modeled."),
      measured("workflow-state-coverage", 10, 10, 0.9, "Submit, approve, reject, and finance transitions are covered."),
      measured("scenario-coverage", 10, 10, 0.9, "Threshold, approval, rejection, and integration paths are designed."),
      measured("multi-role", 4, 4, 0.9, "Buyer, manager, and finance role transitions are explicit."),
      measured("runtime-evidence", 8, 8, 0.95, "Role and state changes have replayable evidence."),
    ]
  },
  {
    id: "image-state-machine",
    domain: "image-state-machine",
    title: "State machine extracted from a requirement image",
    sourceKind: "sanitized-synthetic",
    checks: [
      measured("requirement-understanding", 4, 4, 0.9, "Image nodes and transition conditions are source-linked."),
      measured("workflow-state-coverage", 6, 6, 0.9, "Every confirmed state transition has a positive scenario."),
      measured("scenario-coverage", 6, 6, 0.9, "Invalid transition and missing-precondition scenarios are present."),
    ]
  },
  {
    id: "cross-role-journey",
    domain: "cross-role",
    title: "Requester to approver handoff",
    sourceKind: "sanitized-synthetic",
    checks: [
      measured("workflow-state-coverage", 6, 6, 0.9, "The handoff and final state are linked to the workflow model."),
      measured("multi-role", 6, 6, 0.9, "Actor sequence and AuthProfile mapping are explicit."),
      measured("runtime-evidence", 6, 6, 0.95, "Each role transition has step-level evidence."),
    ]
  },
  {
    id: "multi-requirement-reconciliation",
    domain: "multi-requirement",
    title: "Three requirement revisions in one system",
    sourceKind: "sanitized-synthetic",
    checks: [
      measured("requirement-understanding", 9, 9, 0.9, "Each revision retains its own source and semantic baseline."),
      measured("scenario-coverage", 9, 9, 0.9, "Affected scenarios are recompiled without duplicating superseded cases."),
      measured("multi-requirement", 3, 3, 0.95, "Requirement ownership remains isolated within one system."),
    ]
  },
  {
    id: "long-run-stability",
    domain: "long-run",
    title: "Twenty deterministic Runner iterations",
    sourceKind: "sanitized-synthetic",
    checks: [
      measured("runtime-evidence", 20, 20, 0.95, "All iterations have structured evidence and no open leases."),
      measured("long-run-stability", 20, 20, 0.95, "The synthetic suite meets the 20-iteration stability sample."),
    ]
  },
  {
    id: "historical-bug-replay",
    domain: "historical-bug",
    title: "Historical Bug replay corpus",
    sourceKind: "sanitized-synthetic",
    checks: [
      notMeasured("historical-bug-replay", "A reviewed historical Bug corpus has not been supplied for this checkout."),
      notMeasured("real-system-regression", "No external real-system replay evidence is committed or available by default.")
    ]
  }
];

export function evaluateL3GoldenCorpus(input: {
  generatedAt?: string;
  seed?: string;
  samples?: L3GoldenSample[];
} = {}): L3GoldenCorpusReport {
  const samples = input.samples ?? L3_GOLDEN_CORPUS;
  const sampleResults = samples.map(evaluateSample);
  const metrics = aggregateMetrics(samples);
  const releaseGate = buildReleaseGate(metrics, sampleResults);
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    seed: input.seed ?? "brain-creator-l3-baseline",
    sampleCount: sampleResults.length,
    measuredSampleCount: sampleResults.filter((sample) => sample.passed !== null).length,
    sampleResults,
    metrics,
    releaseGate
  };
}

function evaluateSample(sample: L3GoldenSample): L3GoldenSampleResult {
  const measuredChecks = sample.checks.filter((check) => check.status === "measured");
  const failures = measuredChecks
    .filter((check) => check.total <= 0 || check.passed / check.total < check.threshold)
    .map((check) => `${check.dimension} is below threshold (${check.passed}/${check.total}; required ${check.threshold}).`);
  return {
    sampleId: sample.id,
    domain: sample.domain,
    sourceKind: sample.sourceKind,
    passed: measuredChecks.length === 0 ? null : failures.length === 0,
    failures,
    checks: sample.checks
  };
}

function aggregateMetrics(samples: L3GoldenSample[]): Record<L3EvaluationDimension, L3EvaluationMetric> {
  const metrics = {} as Record<L3EvaluationDimension, L3EvaluationMetric>;
  for (const dimension of dimensions()) {
    const checks = samples.flatMap((sample) => sample.checks.filter((check) => check.dimension === dimension));
    const measuredChecks = checks.filter((check) => check.status === "measured");
    const passed = measuredChecks.reduce((total, check) => total + check.passed, 0);
    const total = measuredChecks.reduce((count, check) => count + check.total, 0);
    const threshold = measuredChecks.length === 0
      ? 1
      : Math.max(...measuredChecks.map((check) => check.threshold));
    metrics[dimension] = {
      status: measuredChecks.length === 0 ? "not-measured" : "measured",
      passed,
      total,
      rate: measuredChecks.length === 0 ? null : total === 0 ? 0 : passed / total,
      threshold,
      sampleIds: checks.length === 0 ? [] : samples
        .filter((sample) => sample.checks.some((check) => check.dimension === dimension))
        .map((sample) => sample.id),
      notes: checks.map((check) => check.note)
    };
  }
  return metrics;
}

function buildReleaseGate(
  metrics: Record<L3EvaluationDimension, L3EvaluationMetric>,
  sampleResults: L3GoldenSampleResult[]
): L3ReleaseGate {
  const measuredDimensions = dimensions().filter((dimension) => metrics[dimension].status === "measured");
  const pendingDimensions = dimensions().filter((dimension) => metrics[dimension].status === "not-measured");
  const blockers: string[] = [];
  if (metrics["real-system-regression"].status === "not-measured") {
    blockers.push("Real-system L3 regression evidence is not measured.");
  }
  if (metrics["historical-bug-replay"].status === "not-measured") {
    blockers.push("Historical Bug replay detection is not measured.");
  }
  if (metrics["long-run-stability"].status === "measured") {
    blockers.push("Long-run stability is measured only with the synthetic Runner fixture.");
  }
  for (const dimension of measuredDimensions) {
    const metric = metrics[dimension];
    if (metric.rate !== null && metric.rate < metric.threshold) {
      blockers.push(`${dimension} is below its release threshold.`);
    }
  }
  for (const sample of sampleResults.filter((item) => item.passed === false)) {
    blockers.push(`Golden sample ${sample.sampleId} is below one or more thresholds.`);
  }
  return {
    status: blockers.length === 0 ? "candidate" : "blocked",
    blockers,
    measuredDimensions,
    pendingDimensions
  };
}

function dimensions(): L3EvaluationDimension[] {
  return [
    "requirement-understanding",
    "workflow-state-coverage",
    "scenario-coverage",
    "multi-role",
    "multi-requirement",
    "runtime-evidence",
    "long-run-stability",
    "historical-bug-replay",
    "real-system-regression"
  ];
}

function measured(
  dimension: L3EvaluationDimension,
  passed: number,
  total: number,
  threshold: number,
  note: string
): L3GoldenCheck {
  return { dimension, status: "measured", passed, total, threshold, note };
}

function notMeasured(dimension: L3EvaluationDimension, note: string): L3GoldenCheck {
  return { dimension, status: "not-measured", passed: 0, total: 0, threshold: 1, note };
}
