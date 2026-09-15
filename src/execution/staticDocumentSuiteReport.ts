import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CaseSuite,
  CaseSuiteCaseResult,
  CaseSuiteRun,
  DocumentCase,
  ExecutionProgressEvent
} from "../domain/types.js";
import { redactSensitiveText } from "../shared/secretScan.js";

export type DocumentSuiteProgress = {
  current?: ExecutionProgressEvent;
  possiblyStalled: boolean;
};

export type DocumentSuiteReportInput = {
  title: string;
  suite: CaseSuite;
  cases: DocumentCase[];
  runs: CaseSuiteRun[];
  locale?: string;
  progress?: DocumentSuiteProgress;
  bugs?: Array<{ id: string; status: string; caseNo?: string; actualResult: string }>;
  gaps?: Array<{ id: string; status: string; caseNo?: string; reason: string }>;
  protectedSecrets?: Record<string, string>;
};

export async function writeStaticDocumentSuiteReport(input: DocumentSuiteReportInput & {
  outputPath: string;
}) {
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, renderStaticDocumentSuiteReport(input), "utf8");
  return input.outputPath;
}

export function renderStaticDocumentSuiteReport(input: DocumentSuiteReportInput) {
  const labels = documentReportLabels(input.locale);
  const redact = (value: string) => input.protectedSecrets
    ? redactSensitiveText(value, input.protectedSecrets)
    : value;
  const resultByCaseNo = latestCaseResults(input.runs);
  const selectedCases = input.cases.filter((item) => input.suite.selectedCaseNos.includes(item.caseNo));
  const rows = selectedCases.map((documentCase, index) => {
    const result = resultByCaseNo.get(documentCase.caseNo);
    const status = result?.status ?? "pending";
    const actual = redact(result?.error ?? (status === "pending" ? labels.notExecuted : labels.none));
    const refs = [result?.testCaseId, result?.chainRunId, result?.bugReportId, ...result?.gapIds ?? []]
      .filter((value): value is string => Boolean(value));
    return `<tr class="searchable-row"><td>${index + 1}</td><td>${escapeHtml(documentCase.caseNo)}</td><td>${escapeHtml(documentCase.title)}</td><td>${escapeHtml(documentCase.module)}</td><td>${escapeHtml(documentCase.priority)}</td><td class="${escapeHtml(status)}">${escapeHtml(status)}</td><td>${escapeHtml(actual)}</td><td>${escapeHtml(refs.join(", "))}</td></tr>`;
  }).join("");
  const results = selectedCases.map((item) => resultByCaseNo.get(item.caseNo)).filter(Boolean) as CaseSuiteCaseResult[];
  const counts = countStatuses(results);
  const current = input.progress?.current;
  const progress = current
    ? `<section class="progress"><h2>${labels.progress}</h2><p><strong>${escapeHtml(current.status)}</strong> | ${labels.case}: ${escapeHtml(current.caseTitle ?? current.caseId ?? labels.none)} | ${labels.stage}: ${escapeHtml(current.stage)} | ${labels.step}: ${escapeHtml(current.stepTitle ?? labels.none)} | ${labels.elapsed}: ${current.elapsedMs} ms${input.progress?.possiblyStalled ? ` | <strong class="blocked">${labels.possiblyStalled}</strong>` : ""}</p>${current.pageUrl ? `<p>${labels.page}: ${escapeHtml(redact(current.pageUrl))}</p>` : ""}${current.waitReason ? `<p>${labels.waitReason}: ${escapeHtml(redact(current.waitReason))}</p>` : ""}</section>`
    : `<section class="progress"><h2>${labels.progress}</h2><p>${labels.noProgress}</p></section>`;
  const bugs = listItems(input.bugs, (item) => `${item.id} ${item.status}: ${redact(item.actualResult)}`, labels.none);
  const gaps = listItems(input.gaps, (item) => `${item.id} ${item.status}: ${redact(item.reason)}`, labels.none);
  const runIds = input.runs.map((run) => run.id).join(", ") || labels.none;
  return `<!doctype html><html lang="${labels.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title><style>body{font:14px system-ui,sans-serif;max-width:1400px;margin:2rem auto;padding:0 1rem;color:#17202a}header{border-bottom:1px solid #ddd;margin-bottom:1rem}input{width:100%;padding:.6rem;margin:1rem 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:.5rem;text-align:left;vertical-align:top}.passed{color:#087f5b}.failed{color:#c92a2a}.blocked{color:#a15c00}.waiting-for-agent{color:#a15c00}.pending,.muted{color:#667085}.progress{border:1px solid #ddd;padding:1rem;margin:1rem 0}</style></head><body><header><h1>${escapeHtml(input.title)}</h1><p>${labels.suiteStatus}: <strong>${escapeHtml(input.suite.status)}</strong> | ${labels.total}: ${selectedCases.length} | ${labels.attempted}: ${results.length} | ${labels.passed}: ${counts.passed} | ${labels.failed}: ${counts.failed} | ${labels.blocked}: ${counts.blocked} | ${labels.waiting}: ${counts.waiting}</p><p>${labels.suite}: ${escapeHtml(input.suite.id)} | ${labels.system}: ${escapeHtml(input.suite.systemId)} | ${labels.source}: ${escapeHtml(input.suite.sourceId)}</p><p>${labels.runs}: ${escapeHtml(runIds)}</p></header>${progress}<label for="search">${labels.search}</label><input id="search" type="search" placeholder="${labels.searchPlaceholder}" oninput="filterReport(this.value)"><h2>${labels.cases}</h2><table><thead><tr><th>#</th><th>${labels.caseNo}</th><th>${labels.title}</th><th>${labels.module}</th><th>${labels.priority}</th><th>${labels.status}</th><th>${labels.result}</th><th>${labels.references}</th></tr></thead><tbody>${rows || `<tr><td colspan="8" class="muted">${labels.noCases}</td></tr>`}</tbody></table><h2>${labels.bugs}</h2><ul>${bugs}</ul><h2>${labels.gaps}</h2><ul>${gaps}</ul><script>function filterReport(q){q=q.toLowerCase();document.querySelectorAll('.searchable-row').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q))}</script></body></html>`;
}

function latestCaseResults(runs: CaseSuiteRun[]) {
  const results = new Map<string, CaseSuiteCaseResult>();
  for (const run of runs) {
    for (const result of run.caseResults) {
      const current = results.get(result.caseNo);
      if (current?.status === "passed") continue;
      results.set(result.caseNo, result);
    }
  }
  return results;
}

function countStatuses(results: CaseSuiteCaseResult[]) {
  return results.reduce(
    (counts, result) => {
      if (result.status === "passed") counts.passed += 1;
      if (result.status === "failed") counts.failed += 1;
      if (result.status === "blocked") counts.blocked += 1;
      if (result.status === "waiting-for-agent") counts.waiting += 1;
      return counts;
    },
    { passed: 0, failed: 0, blocked: 0, waiting: 0 }
  );
}

function listItems<T extends { id: string; status: string }>(
  items: T[] | undefined,
  format: (item: T) => string,
  empty: string
) {
  return items?.map((item) => `<li class="searchable-row">${escapeHtml(format(item))}</li>`).join("") || `<li class="muted">${empty}</li>`;
}

function documentReportLabels(locale?: string) {
  if (locale?.toLowerCase().startsWith("zh")) {
    return {
      lang: "zh-CN", suiteStatus: "套件状态", total: "总数", attempted: "已尝试", passed: "通过", failed: "失败", blocked: "阻塞", waiting: "等待", suite: "套件", system: "系统", source: "来源", runs: "运行记录", progress: "当前进度", case: "用例", stage: "阶段", step: "步骤", elapsed: "耗时", page: "页面", waitReason: "等待原因", possiblyStalled: "可能已卡住", noProgress: "暂无执行进度", search: "搜索报告", searchPlaceholder: "用例、状态、模块、结果", cases: "用例明细", caseNo: "用例编号", title: "标题", module: "模块", priority: "优先级", status: "状态", result: "实际结果 / 未执行原因", references: "关联产物", bugs: "缺陷报告", gaps: "缺口", noCases: "暂无用例", notExecuted: "尚未执行", none: "无"
    };
  }
  return {
    lang: "en", suiteStatus: "Suite status", total: "Total", attempted: "Attempted", passed: "Passed", failed: "Failed", blocked: "Blocked", waiting: "Waiting", suite: "Suite", system: "System", source: "Source", runs: "Runs", progress: "Current progress", case: "Case", stage: "Stage", step: "Step", elapsed: "Elapsed", page: "Page", waitReason: "Wait reason", possiblyStalled: "Possibly stalled", noProgress: "No execution progress recorded", search: "Search report", searchPlaceholder: "case, status, module, result", cases: "Cases", caseNo: "Case no.", title: "Title", module: "Module", priority: "Priority", status: "Status", result: "Actual result / not executed reason", references: "Related artifacts", bugs: "Bug reports", gaps: "Gaps", noCases: "No cases", notExecuted: "Not executed", none: "None"
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
