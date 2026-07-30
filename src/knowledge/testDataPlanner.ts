import { createHash } from "node:crypto";
import type {
  ExecutableCaseDataOperation,
  ExecutableCaseDataPlan,
  ExecutableCaseStep,
  TestDataProfile
} from "../domain/types.js";

export type TestDataResolution = {
  profileId: string;
  decision: "use-value" | "reuse" | "create" | "capture" | "secret-reference";
  value?: string;
  reference?: string;
};

export type TestDataPlanningResult = {
  plan: ExecutableCaseDataPlan;
  steps: ExecutableCaseStep[];
};

export function planTestData(
  profiles: TestDataProfile[],
  steps: ExecutableCaseStep[]
): TestDataPlanningResult {
  if (profiles.length === 0) {
    return {
      plan: {
        verdict: "not-required",
        reasons: [],
        operations: [],
        dependencyOrder: [],
        requiresConfirmation: false,
        requiresCleanup: false,
        sourceRefs: []
      },
      steps
    };
  }

  const fields = new Map<string, TestDataProfile[]>();
  for (const profile of profiles) {
    const key = normalize(profile.field);
    fields.set(key, [...(fields.get(key) ?? []), profile]);
  }
  const duplicateFields = new Set(
    [...fields.entries()]
      .filter(([, matches]) => matches.length > 1)
      .map(([field]) => field)
  );
  const operations = profiles.map((profile) =>
    planProfile(profile, fields, duplicateFields)
  );
  const dependencyOrder = topologicalOrder(operations);
  const ordered =
    dependencyOrder.length === operations.length
      ? dependencyOrder
          .map((profileId) =>
            operations.find((operation) => operation.profileId === profileId)
          )
          .filter((operation): operation is ExecutableCaseDataOperation =>
            Boolean(operation)
          )
      : operations.map((operation) =>
          dependencyOrder.includes(operation.profileId)
            ? operation
            : {
                ...operation,
                status: "blocked" as const,
                reason:
                  operation.reason ??
                  "Test data dependency cycle prevents a deterministic order"
              }
        );
  const reasons = unique(
    ordered
      .filter(
        (operation) =>
          operation.status === "blocked" ||
          operation.status === "needs-resolution"
      )
      .map(
        (operation) =>
          operation.reason ??
          `Test data for ${operation.field} requires a resolution`
      )
  );
  const plan = summarizePlan(ordered, dependencyOrder, reasons);
  return { plan, steps: bindDataSteps(steps, ordered) };
}

export function applyTestDataResolutions(
  plan: ExecutableCaseDataPlan,
  steps: ExecutableCaseStep[],
  resolutions: TestDataResolution[]
): TestDataPlanningResult {
  const byProfile = new Map(
    resolutions.map((resolution) => [resolution.profileId, resolution])
  );
  const operations = plan.operations.map((operation) => {
    const resolution = byProfile.get(operation.profileId);
    return resolution ? resolveOperation(operation, resolution) : operation;
  });
  for (const resolution of resolutions) {
    if (!plan.operations.some((operation) => operation.profileId === resolution.profileId)) {
      throw new Error(`Test data profile is not part of this plan: ${resolution.profileId}`);
    }
  }
  const reasons = unique(
    operations
      .filter(
        (operation) =>
          operation.status === "blocked" ||
          operation.status === "needs-resolution"
      )
      .map(
        (operation) =>
          operation.reason ??
          `Test data for ${operation.field} requires a resolution`
      )
  );
  const resolvedPlan = summarizePlan(
    operations,
    plan.dependencyOrder,
    reasons
  );
  return {
    plan: resolvedPlan,
    steps: bindDataSteps(steps, operations)
  };
}

export function confirmTestDataPlan(
  plan: ExecutableCaseDataPlan,
  confirmedAt: string
): ExecutableCaseDataPlan {
  if (plan.verdict === "blocked") {
    throw new Error("Blocked test data cannot be confirmed");
  }
  return {
    ...plan,
    operations: plan.operations.map((operation) =>
      operation.status === "proposed"
        ? { ...operation, status: "ready" as const }
        : operation
    ),
    confirmedAt
  };
}

function planProfile(
  profile: TestDataProfile,
  fields: Map<string, TestDataProfile[]>,
  duplicateFields: Set<string>
): ExecutableCaseDataOperation {
  const dependencies = (profile.dependsOnFields ?? []).flatMap((field) => {
    const matches = fields.get(normalize(field)) ?? [];
    return matches.length === 1 ? [matches[0].id] : [];
  });
  const missingDependencies = (profile.dependsOnFields ?? []).filter(
    (field) => (fields.get(normalize(field)) ?? []).length !== 1
  );
  const base = {
    profileId: profile.id,
    field: profile.field,
    strategy: profile.strategy,
    dependsOnProfileIds: dependencies,
    cleanup: profile.cleanup ?? "none",
    constraints: profile.constraints,
    sourceRefs: unique([
      ...profile.sourceRefs,
      `test-data-profile:${profile.id}`
    ])
  };

  if (duplicateFields.has(normalize(profile.field))) {
    return {
      ...base,
      decision: "use-fixed",
      status: "blocked",
      reason: `Test data field ${profile.field} has multiple profiles`
    };
  }
  if (missingDependencies.length > 0) {
    return {
      ...base,
      decision: decisionFor(profile.strategy),
      status: "blocked",
      reason: `Test data field ${profile.field} has missing or ambiguous dependencies: ${missingDependencies.join(", ")}`
    };
  }

  if (profile.strategy === "fixed") {
    return profile.seed
      ? {
          ...base,
          decision: "use-fixed",
          status: "ready",
          value: profile.seed
        }
      : {
          ...base,
          decision: "use-fixed",
          status: "needs-resolution",
          reason: `Fixed test data for ${profile.field} has no value`
        };
  }
  if (profile.strategy === "generated" || profile.strategy === "unique") {
    return profile.seed
      ? {
          ...base,
          decision: "generate",
          status: "proposed",
          value: generatedCandidate(profile)
        }
      : {
          ...base,
          decision: "generate",
          status: "needs-resolution",
          reason: `Generated test data for ${profile.field} has no deterministic seed`
        };
  }
  if (profile.strategy === "existing-reference") {
    return {
      ...base,
      decision: "lookup",
      status: "needs-resolution",
      lookupQuery: profile.seed || undefined,
      reason: profile.seed
        ? `Test data for ${profile.field} requires an explicit reuse or create decision`
        : `Existing reference data for ${profile.field} has no lookup query`
    };
  }
  if (profile.strategy === "runtime-captured") {
    return dependencies.length > 0
      ? {
          ...base,
          decision: "capture",
          status: "ready"
        }
      : {
          ...base,
          decision: "capture",
          status: "blocked",
          reason: `Runtime-captured data for ${profile.field} requires a dependency`
        };
  }
  return profile.seed
    ? {
        ...base,
        decision: "resolve-secret",
        status: "ready",
        secretRef: profile.seed
      }
    : {
        ...base,
        decision: "resolve-secret",
        status: "needs-resolution",
        reason: `Secret test data for ${profile.field} has no secret reference`
      };
}

function resolveOperation(
  operation: ExecutableCaseDataOperation,
  resolution: TestDataResolution
): ExecutableCaseDataOperation {
  if (operation.status === "blocked") {
    throw new Error(
      `Test data profile ${operation.profileId} has a structural planning error that must be fixed before resolution`
    );
  }
  if (resolution.decision === "reuse" || resolution.decision === "create") {
    if (!resolution.reference?.trim()) {
      throw new Error(
        `${resolution.decision} resolution requires a data reference`
      );
    }
    return {
      ...operation,
      decision: resolution.decision,
      status: "ready",
      value: resolution.value?.trim() || resolution.reference.trim(),
      reference: resolution.reference.trim(),
      reason: undefined
    };
  }
  if (resolution.decision === "use-value") {
    if (!resolution.value?.trim()) {
      throw new Error("use-value resolution requires a value");
    }
    return {
      ...operation,
      decision: "use-fixed",
      status: "ready",
      value: resolution.value.trim(),
      reason: undefined
    };
  }
  if (resolution.decision === "secret-reference") {
    if (!resolution.reference?.trim()) {
      throw new Error("secret-reference resolution requires a reference");
    }
    return {
      ...operation,
      decision: "resolve-secret",
      status: "ready",
      value: undefined,
      secretRef: resolution.reference.trim(),
      reason: undefined
    };
  }
  return {
    ...operation,
    decision: "capture",
    status: "ready",
    value: undefined,
    reason: undefined
  };
}

function summarizePlan(
  operations: ExecutableCaseDataOperation[],
  dependencyOrder: string[],
  reasons: string[]
): ExecutableCaseDataPlan {
  return {
    verdict: reasons.length > 0 ? "blocked" : "ready",
    reasons,
    operations,
    dependencyOrder,
    requiresConfirmation: operations.some(
      (operation) =>
        operation.status === "proposed" || operation.decision === "create"
    ),
    requiresCleanup: operations.some(
      (operation) =>
        operation.decision === "create" && operation.cleanup !== "none"
    ),
    sourceRefs: unique(operations.flatMap((operation) => operation.sourceRefs))
  };
}

function topologicalOrder(operations: ExecutableCaseDataOperation[]) {
  const incoming = new Map(
    operations.map((operation) => [
      operation.profileId,
      new Set(operation.dependsOnProfileIds)
    ])
  );
  const order: string[] = [];
  while (order.length < operations.length) {
    const ready = operations
      .filter(
        (operation) =>
          !order.includes(operation.profileId) &&
          [...(incoming.get(operation.profileId) ?? [])].every((dependency) =>
            order.includes(dependency)
          )
      )
      .map((operation) => operation.profileId);
    if (ready.length === 0) break;
    order.push(...ready);
  }
  return order;
}

function bindDataSteps(
  steps: ExecutableCaseStep[],
  operations: ExecutableCaseDataOperation[]
) {
  const executable = operations.filter(
    (operation) =>
      operation.status === "ready" || operation.status === "proposed"
  );
  const dataSteps = steps.filter((step) =>
    ["fill", "select", "api"].includes(step.action) &&
    !(step.origin === "observed" && step.value !== undefined)
  );
  return steps.map((step) => {
    if (!dataSteps.includes(step)) return step;
    const selected =
      (step.dataProfileId
        ? executable.find(
            (operation) => operation.profileId === step.dataProfileId
          )
        : uniqueBestOperation(step, executable)) ??
      (step.action === "fill" &&
      dataSteps.length === 1 &&
      executable.length === 1
        ? executable[0]
        : undefined);
    if (!selected) return step;
    return {
      ...step,
      dataProfileId: selected.profileId,
      value:
        selected.decision === "resolve-secret"
          ? undefined
          : step.value ?? selected.value,
      sourceRefs: unique([...step.sourceRefs, ...selected.sourceRefs])
    };
  });
}

function uniqueBestOperation(
  step: ExecutableCaseStep,
  operations: ExecutableCaseDataOperation[]
) {
  const query = `${step.instruction} ${step.targetSemantic}`;
  const scored = operations
    .map((operation) => ({
      operation,
      score: semanticScore(query, operation.field)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.operation.profileId.localeCompare(right.operation.profileId)
    );
  if (scored.length === 0) return undefined;
  return scored.filter((candidate) => candidate.score === scored[0].score)
    .length === 1
    ? scored[0].operation
    : undefined;
}

function generatedCandidate(profile: TestDataProfile) {
  const enumValues = profile.constraints
    .find((constraint) => constraint.startsWith("enum:"))
    ?.slice("enum:".length)
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
  if (enumValues?.length) return enumValues[0];
  const minimum = numericConstraint(profile.constraints, "min");
  if (minimum !== undefined) return String(minimum);
  const minimumLength = numericConstraint(profile.constraints, "min-length");
  if (minimumLength !== undefined) {
    return "x".repeat(Math.max(1, Math.min(minimumLength, 256)));
  }
  const field = slug(profile.field) || "data";
  const hash = createHash("sha256")
    .update(`${profile.seed}:${profile.field}`)
    .digest("hex")
    .slice(0, 8);
  return `bc-${field}-${hash}`;
}

function numericConstraint(constraints: string[], name: string) {
  const value = constraints
    .find((constraint) => constraint.startsWith(`${name}:`))
    ?.slice(name.length + 1);
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function decisionFor(
  strategy: TestDataProfile["strategy"]
): ExecutableCaseDataOperation["decision"] {
  if (strategy === "fixed") return "use-fixed";
  if (strategy === "generated" || strategy === "unique") return "generate";
  if (strategy === "existing-reference") return "lookup";
  if (strategy === "runtime-captured") return "capture";
  return "resolve-secret";
}

function semanticScore(left: string, right: string) {
  const leftNormalized = normalize(left);
  const rightNormalized = normalize(right);
  if (!leftNormalized || !rightNormalized) return 0;
  if (
    leftNormalized.includes(rightNormalized) ||
    rightNormalized.includes(leftNormalized)
  ) {
    return 3;
  }
  const leftTokens = new Set(left.toLowerCase().split(/\W+/).filter(Boolean));
  return right
    .toLowerCase()
    .split(/\W+/)
    .filter((token) => token.length > 1 && leftTokens.has(token)).length;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
