import type { StructuredReporterResult } from "../domain/types.js";

export type PlaywrightJsonReport = {
  stats?: { duration?: number; expected?: number; unexpected?: number; skipped?: number };
  suites?: unknown[];
};

export function parsePlaywrightJsonReport(value: unknown): StructuredReporterResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Playwright JSON reporter output must be an object");
  }
  const report = value as PlaywrightJsonReport;
  const assertions = collectAssertions(report.suites ?? []);
  const stats = report.stats ?? {};
  const total = assertions.length ||
    Number(stats.expected ?? 0) + Number(stats.unexpected ?? 0) + Number(stats.skipped ?? 0);
  const failed = Number(stats.unexpected ?? assertions.filter((item) => item.status === "failed").length);
  const skipped = Number(stats.skipped ?? assertions.filter((item) => item.status === "skipped").length);
  const passed = Math.max(0, total - failed - skipped);
  const attachments = [...new Set(assertions.flatMap((item) => item.evidenceRefs))];
  const steps = collectSteps(report.suites ?? []);
  return {
    status: failed > 0 ? "failed" : skipped > 0 && passed === 0 ? "blocked" : "passed",
    total,
    passed,
    failed,
    skipped,
    durationMs: Number(stats.duration ?? 0),
    assertions,
    steps,
    attachments,
    consoleErrors: [],
    networkFailures: []
  };
}

function collectSteps(suites: unknown[], output: NonNullable<StructuredReporterResult["steps"]> = []) {
  for (const suite of suites) {
    if (!suite || typeof suite !== "object") continue;
    const record = suite as Record<string, unknown>;
    if (Array.isArray(record.specs)) {
      for (const spec of record.specs) {
        if (!spec || typeof spec !== "object") continue;
        const specRecord = spec as Record<string, unknown>;
        const tests = Array.isArray(specRecord.tests) ? specRecord.tests : [];
        const test = tests[0] as Record<string, unknown> | undefined;
        const results = test && Array.isArray(test.results) ? test.results : [];
        const result = results.at(-1) as Record<string, unknown> | undefined;
        if (result) collectResultSteps(result, output);
      }
    }
    if (Array.isArray(record.suites)) collectSteps(record.suites, output);
  }
  return output;
}

function collectResultSteps(result: Record<string, unknown>, output: NonNullable<StructuredReporterResult["steps"]>) {
  if (!Array.isArray(result.steps)) return;
  for (const item of result.steps) {
    if (!item || typeof item !== "object") continue;
    const step = item as Record<string, unknown>;
    const title = typeof step.title === "string" ? step.title : "";
    if (title.startsWith("bc:")) {
      const attachments = Array.isArray(step.attachments) ? step.attachments : [];
      output.push({
        id: title.slice(3),
        title,
        status: normalizeStepStatus(step.error ? "failed" : result.status),
        durationMs: typeof step.duration === "number" ? step.duration : undefined,
        evidenceRefs: attachments
          .filter((attachment): attachment is Record<string, unknown> => Boolean(attachment && typeof attachment === "object"))
          .map((attachment) => attachment.path ?? attachment.name)
          .filter((path): path is string => typeof path === "string"),
        ...(typeof step.error === "string" ? { error: step.error } : {})
      });
    }
    collectResultSteps(step, output);
  }
}

function normalizeStepStatus(value: unknown): NonNullable<StructuredReporterResult["steps"]>[number]["status"] {
  if (value === "passed") return "passed";
  if (value === "failed" || value === "timedout") return "failed";
  if (value === "skipped" || value === "pending") return "skipped";
  return "unknown";
}

function collectAssertions(suites: unknown[], output: StructuredReporterResult["assertions"] = []) {
  for (const suite of suites) {
    if (!suite || typeof suite !== "object") continue;
    const record = suite as Record<string, unknown>;
    if (Array.isArray(record.specs)) {
      for (const spec of record.specs) {
        if (!spec || typeof spec !== "object") continue;
        const specRecord = spec as Record<string, unknown>;
        const tests = Array.isArray(specRecord.tests) ? specRecord.tests : [];
        const test = tests[0] as Record<string, unknown> | undefined;
        const results = test && Array.isArray(test.results) ? test.results : [];
        const result = results.at(-1) as Record<string, unknown> | undefined;
        const status = result?.status === "passed"
          ? "passed"
          : result?.status === "skipped" || result?.status === "pending"
            ? "skipped"
            : result?.status === "failed" || result?.status === "timedout"
              ? "failed"
              : "unknown";
        const attachments = Array.isArray(result?.attachments) ? result.attachments : [];
        output.push({
          id: typeof specRecord.id === "string" ? specRecord.id : String(specRecord.title ?? `assertion-${output.length + 1}`),
          status,
          expected: typeof specRecord.title === "string" ? specRecord.title : undefined,
          evidenceRefs: attachments
            .filter((attachment): attachment is Record<string, unknown> => Boolean(attachment && typeof attachment === "object"))
            .map((attachment) => attachment.path ?? attachment.name)
            .filter((path): path is string => typeof path === "string")
        });
      }
    }
    if (Array.isArray(record.suites)) collectAssertions(record.suites, output);
  }
  return output;
}
