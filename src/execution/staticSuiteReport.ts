import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExecutionEvidence, RequirementSuiteRun } from "../domain/types.js";

export async function writeStaticSuiteExecutionReport(input: {
  outputPath: string;
  title: string;
  run: RequirementSuiteRun;
  requirementSetIds?: string[];
  locale?: string;
  evidence: ExecutionEvidence[];
  coverage?: Array<{
    testIntentId: string;
    title: string;
    module: string;
    classification: string;
    classificationReason: string;
    requirementRefs: string[];
  }>;
  bugs?: Array<{ id: string; status: string; caseNo?: string; actualResult: string }>;
  gaps?: Array<{ id: string; status: string; caseNo?: string; reason: string }>;
}) {
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, renderStaticSuiteExecutionReport(input), "utf8");
  return input.outputPath;
}

export function renderStaticSuiteExecutionReport(input: {
  title: string;
  run: RequirementSuiteRun;
  requirementSetIds?: string[];
  locale?: string;
  evidence: ExecutionEvidence[];
  coverage?: Array<{
    testIntentId: string;
    title: string;
    module: string;
    classification: string;
    classificationReason: string;
    requirementRefs: string[];
  }>;
  bugs?: Array<{ id: string; status: string; caseNo?: string; actualResult: string }>;
  gaps?: Array<{ id: string; status: string; caseNo?: string; reason: string }>;
}) {
  const evidenceByCase = new Map(input.evidence.map((item) => [item.executableCaseId, item]));
  const strong = input.evidence.filter((item) => item.assuranceLevel === "strong").length;
  const limited = input.evidence.filter((item) => item.assuranceLevel === "limited").length;
  const none = input.evidence.filter((item) => !item.assuranceLevel || item.assuranceLevel === "none").length;
  const consoleErrors = input.evidence.reduce(
    (total, item) => total + item.consoleErrors.length,
    0
  );
  const networkFailures = input.evidence.reduce(
    (total, item) => total + item.networkFailures.length,
    0
  );
  const coverageCounts = (input.coverage ?? []).reduce<Record<string, number>>((counts, item) => {
    counts[item.classification] = (counts[item.classification] ?? 0) + 1;
    return counts;
  }, {});
  const coverageRows = (input.coverage ?? []).map((item) =>
    `<tr class="searchable-row"><td>${escapeHtml(item.testIntentId)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.module)}</td><td>${escapeHtml(item.classification)}</td><td>${escapeHtml(item.classificationReason)}</td><td>${escapeHtml(item.requirementRefs.join(", "))}</td></tr>`
  ).join("");
  const requirementSetIds = [...new Set(input.requirementSetIds ?? [])];
  const formattedCreatedAt = formatTimestamp(input.run.createdAt, input.locale);
  const formattedUpdatedAt = formatTimestamp(input.run.updatedAt, input.locale);
  const rows = input.run.caseRuns.map((caseRun) => {
    const evidence = evidenceByCase.get(caseRun.executableCaseId);
    const assurance = evidence?.assuranceLevel ?? "none";
    const artifacts = evidence?.artifactPaths ?? [];
    const warnings = evidence?.evidenceWarnings ?? [];
    const reason = evidence?.actualResult ?? caseRun.error ?? (caseRun.status === "queued" ? "Not executed" : "");
    const steps = evidence?.steps ?? [];
    const stepDetails = steps.length > 0
      ? `<details><summary>${steps.length} step(s)</summary><ol>${steps.map((step) => `<li class="searchable-row"><strong>${escapeHtml(step.assertionStatus)}</strong> ${escapeHtml(step.instruction)}${step.expected ? ` | expected: ${escapeHtml(step.expected)}` : ""}${step.actual ? ` | actual: ${escapeHtml(step.actual)}` : ""}${step.screenshotPath ? ` | ${artifactLink(step.screenshotPath)}` : ""}</li>`).join("")}</ol></details>`
      : "<span class=muted>No step evidence</span>";
    return `<tr class="searchable-row"><td>${caseRun.order}</td><td>${escapeHtml(caseRun.title)}</td><td class="${caseRun.status}">${escapeHtml(caseRun.status)}</td><td>${escapeHtml(assurance)}</td><td>${escapeHtml(reason)}</td><td>${escapeHtml(warnings.join("; "))}</td><td>${stepDetails}</td><td>${escapeHtml(String(evidence?.consoleErrors.length ?? 0))}</td><td>${escapeHtml(String(evidence?.networkFailures.length ?? 0))}</td><td>${artifactLinks(artifacts)}</td></tr>`;
  }).join("");
  const bugs = (input.bugs ?? []).map((bug) => `<li class="searchable-row">${escapeHtml(bug.id)} ${escapeHtml(bug.status)}: ${escapeHtml(bug.actualResult)}</li>`).join("") || "<li class=muted>None</li>";
  const gaps = (input.gaps ?? []).map((gap) => `<li class="searchable-row">${escapeHtml(gap.id)} ${escapeHtml(gap.status)}: ${escapeHtml(gap.reason)}</li>`).join("") || "<li class=muted>None</li>";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title><style>body{font:14px system-ui,sans-serif;max-width:1400px;margin:2rem auto;padding:0 1rem;color:#17202a}header{border-bottom:1px solid #ddd;margin-bottom:1rem}input{width:100%;padding:.6rem;margin:1rem 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:.5rem;text-align:left;vertical-align:top}.passed{color:#087f5b}.failed{color:#c92a2a}.blocked{color:#a15c00}.muted{color:#667085}details{min-width:240px}</style></head><body><header><h1>${escapeHtml(input.title)}</h1><p>Status: <strong class="${input.run.status}">${escapeHtml(input.run.status)}</strong> | Total: ${input.run.total} | Passed: ${input.run.passed} | Failed: ${input.run.failed} | Blocked: ${input.run.blocked}</p><p>Assurance: <strong>strong ${strong}</strong> | limited ${limited} | none ${none}</p><p>Runtime impact: console errors ${consoleErrors} | network failures ${networkFailures}</p><p>TestIntent coverage: ${Object.entries(coverageCounts).map(([key, value]) => `${escapeHtml(key)} ${value}`).join(" | ") || "not attached"}</p><p>Run: ${escapeHtml(input.run.id)} | System: ${escapeHtml(input.run.systemId)} | Requirement project: ${escapeHtml(input.run.knowledgeProjectId)}</p><p>Created: ${escapeHtml(formattedCreatedAt)} | Updated: ${escapeHtml(formattedUpdatedAt)}${input.locale ? ` | Locale: ${escapeHtml(input.locale)}` : ""}</p>${requirementSetIds.length > 0 ? `<p>Requirement sets: ${requirementSetIds.map((id) => escapeHtml(id)).join(", ")}</p>` : ""}</header><label for="search">Search report</label><input id="search" type="search" placeholder="case, status, evidence" oninput="filterReport(this.value)"><h2>TestIntent coverage</h2><table><thead><tr><th>Intent</th><th>Title</th><th>Module</th><th>Classification</th><th>Reason</th><th>Requirement refs</th></tr></thead><tbody>${coverageRows || "<tr><td colspan=6 class=muted>No coverage ledger attached</td></tr>"}</tbody></table><h2>Cases</h2><table><thead><tr><th>#</th><th>Case</th><th>Status</th><th>Assurance</th><th>Actual result / not executed reason</th><th>Evidence warnings</th><th>Steps</th><th>Console errors</th><th>Network failures</th><th>Artifacts</th></tr></thead><tbody>${rows || "<tr><td colspan=10 class=muted>No cases</td></tr>"}</tbody></table><h2>BugReports</h2><ul>${bugs}</ul><h2>Gaps</h2><ul>${gaps}</ul><script>function filterReport(q){q=q.toLowerCase();document.querySelectorAll('.searchable-row').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q))}</script></body></html>`;
  return localizeReportHtml(html, input.locale);
}

function localizeReportHtml(html: string, locale?: string) {
  if (!locale?.toLowerCase().startsWith("zh")) return html;
  const replacements: Array<[string, string]> = [
    ['lang="en"', 'lang="zh-CN"'],
    ["Status:", "状态："],
    ["Total:", "总数："],
    ["Passed:", "通过："],
    ["Failed:", "失败："],
    ["Blocked:", "阻塞："],
    ["Assurance:", "验证强度："],
    ["Runtime impact:", "运行时影响："],
    ["console errors", "控制台错误"],
    ["network failures", "网络失败"],
    ["TestIntent coverage", "测试意图覆盖"],
    ["Requirement project:", "需求项目："],
    ["Requirement sets:", "需求版本："],
    ["Created:", "创建时间："],
    ["Updated:", "更新时间："],
    ["Search report", "搜索报告"],
    ["case, status, evidence", "用例、状态、证据"],
    ["Cases", "用例"],
    ["BugReports", "缺陷报告"],
    ["Gaps", "缺口"],
    ["No cases", "暂无用例"],
    ["No coverage ledger attached", "未关联覆盖台账"],
    ["No step evidence", "暂无步骤证据"],
    ["Artifacts", "产物"],
    ["Steps", "步骤"],
    ["Actual result / not executed reason", "实际结果 / 未执行原因"],
    ["Evidence warnings", "证据警告"],
    ["Requirement refs", "需求引用"],
    ["None", "无"]
  ];
  return replacements.reduce((value, [from, to]) => value.replaceAll(from, to), html);
}

function formatTimestamp(value: string, locale = "en-US") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "medium"
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "medium"
    }).format(date);
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function artifactLinks(paths: string[]) {
  return paths.map((path) => artifactLink(path)).filter(Boolean).join("<br>");
}

function artifactLink(path?: string) {
  if (!path) return "";
  return `<a href="${escapeHtml(artifactHref(path))}">${escapeHtml(path)}</a>`;
}

function artifactHref(path: string) {
  const normalized = path.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${normalized}`;
  if (normalized.startsWith("/")) return `file://${normalized}`;
  if (/^[a-z][a-z\d+.-]*:/i.test(normalized) || normalized.startsWith("//")) return "#";
  return normalized;
}
