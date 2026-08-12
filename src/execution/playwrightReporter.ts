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
  return {
    status: failed > 0 ? "failed" : skipped > 0 && passed === 0 ? "blocked" : "passed",
    total,
    passed,
    failed,
    skipped,
    durationMs: Number(stats.duration ?? 0),
    assertions,
    attachments,
    consoleErrors: [],
    networkFailures: []
  };
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
