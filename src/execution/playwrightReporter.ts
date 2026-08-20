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
  const runtime = collectRuntimeImpact(report.suites ?? []);
  return {
    status: failed > 0 ? "failed" : skipped > 0 && passed === 0 ? "blocked" : "passed",
    total,
    passed,
    failed,
    skipped,
    durationMs: Number(stats.duration ?? 0),
    assertions,
    steps,
    attachments: [...new Set([...attachments, ...runtime.attachments])],
    consoleErrors: runtime.consoleErrors,
    networkFailures: runtime.networkFailures
  };
}

export function normalizeReporterExitCode(
  exitCode: number,
  reporter: StructuredReporterResult | undefined
) {
  if (exitCode !== 0 || !reporter) return exitCode;
  return reporter.status === "passed" ? 0 : 1;
}

function collectRuntimeImpact(suites: unknown[], output = {
  attachments: [] as string[],
  consoleErrors: [] as string[],
  networkFailures: [] as string[]
}) {
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
        for (const result of results) {
          if (!result || typeof result !== "object") continue;
          collectRuntimeAttachments(result as Record<string, unknown>, output);
        }
      }
    }
    if (Array.isArray(record.suites)) collectRuntimeImpact(record.suites, output);
  }
  output.attachments = [...new Set(output.attachments)];
  output.consoleErrors = [...new Set(output.consoleErrors)];
  output.networkFailures = [...new Set(output.networkFailures)];
  return output;
}

function collectRuntimeAttachments(
  result: Record<string, unknown>,
  output: { attachments: string[]; consoleErrors: string[]; networkFailures: string[] }
) {
  const attachments = Array.isArray(result.attachments) ? result.attachments : [];
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") continue;
    const item = attachment as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : "";
    if (!name.startsWith("brain-creator-runtime-")) continue;
    const ref = typeof item.path === "string" ? item.path : name;
    output.attachments.push(ref);
    const body = typeof item.body === "string" ? item.body : undefined;
    if (!body) continue;
    try {
      const runtime = JSON.parse(body) as { consoleErrors?: unknown; networkFailures?: unknown };
      if (Array.isArray(runtime.consoleErrors)) {
        output.consoleErrors.push(
          ...runtime.consoleErrors.filter((value): value is string => typeof value === "string")
        );
      }
      if (Array.isArray(runtime.networkFailures)) {
        output.networkFailures.push(
          ...runtime.networkFailures.filter((value): value is string => typeof value === "string")
        );
      }
    } catch {
      continue;
    }
  }
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
  const traceRefs = traceRefsFromAttachments(result.attachments);
  const hasSingleSemanticStep = countSemanticSteps(result.steps) === 1;
  for (const item of result.steps) {
    if (!item || typeof item !== "object") continue;
    const step = item as Record<string, unknown>;
    const title = typeof step.title === "string" ? step.title : "";
    if (title.startsWith("bc:")) {
      const attachments = Array.isArray(step.attachments) ? step.attachments : [];
      const runtime = runtimeImpactFromAttachments(attachments);
      output.push({
        id: title.slice(3),
        title,
        status: normalizeStepStatus(step.error ? "failed" : result.status),
        durationMs: typeof step.duration === "number" ? step.duration : undefined,
        ...(runtime.pageUrl ? { pageUrl: runtime.pageUrl } : {}),
        evidenceRefs: attachments
          .filter((attachment): attachment is Record<string, unknown> => Boolean(attachment && typeof attachment === "object"))
          .map((attachment) => attachment.path ?? attachment.name)
          .filter((path): path is string => typeof path === "string"),
        ...(traceRefs.length > 0 && hasSingleSemanticStep ? { traceRefs } : {}),
        ...(runtime.consoleErrors.length > 0 ? { consoleErrors: runtime.consoleErrors } : {}),
        ...(runtime.networkFailures.length > 0 ? { networkFailures: runtime.networkFailures } : {}),
        ...(typeof step.error === "string" ? { error: step.error } : {})
      });
    }
    collectResultSteps(step, output);
  }
}

function countSemanticSteps(value: unknown[]): number {
  return value.reduce<number>((total, item) => {
    if (!item || typeof item !== "object") return total;
    const record = item as Record<string, unknown>;
    const own = typeof record.title === "string" && record.title.startsWith("bc:") ? 1 : 0;
    const nested = Array.isArray(record.steps) ? countSemanticSteps(record.steps) : 0;
    return total + own + nested;
  }, 0);
}

function traceRefsFromAttachments(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value
    .filter((attachment): attachment is Record<string, unknown> => Boolean(attachment && typeof attachment === "object"))
    .map((attachment) => attachment.path ?? attachment.name)
    .filter((path): path is string => typeof path === "string" && /trace[^/\\]*\.zip$/i.test(path)))];
}

function runtimeImpactFromAttachments(attachments: unknown[]) {
  const output = {
    consoleErrors: [] as string[],
    networkFailures: [] as string[],
    pageUrl: undefined as string | undefined
  };
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") continue;
    const item = attachment as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : "";
    if (!name.startsWith("brain-creator-runtime-") || typeof item.body !== "string") continue;
    try {
      const value = JSON.parse(item.body) as {
        consoleErrors?: unknown;
        networkFailures?: unknown;
        pageUrl?: unknown;
      };
      if (Array.isArray(value.consoleErrors)) output.consoleErrors.push(...value.consoleErrors.filter((item): item is string => typeof item === "string"));
      if (Array.isArray(value.networkFailures)) output.networkFailures.push(...value.networkFailures.filter((item): item is string => typeof item === "string"));
      if (typeof value.pageUrl === "string") output.pageUrl = sanitizePageUrl(value.pageUrl);
    } catch {
      continue;
    }
  }
  output.consoleErrors = [...new Set(output.consoleErrors)];
  output.networkFailures = [...new Set(output.networkFailures)];
  return output;
}

function sanitizePageUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      url.searchParams.set(key, "[REDACTED]");
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value;
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
