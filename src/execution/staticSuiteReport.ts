import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExecutionEvidence, RequirementSuiteRun } from "../domain/types.js";

export async function writeStaticSuiteExecutionReport(input: {
  outputPath: string;
  title: string;
  run: RequirementSuiteRun;
  evidence: ExecutionEvidence[];
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
  evidence: ExecutionEvidence[];
  bugs?: Array<{ id: string; status: string; caseNo?: string; actualResult: string }>;
  gaps?: Array<{ id: string; status: string; caseNo?: string; reason: string }>;
}) {
  const evidenceByCase = new Map(input.evidence.map((item) => [item.executableCaseId, item]));
  const strong = input.evidence.filter((item) => item.assuranceLevel === "strong").length;
  const limited = input.evidence.filter((item) => item.assuranceLevel === "limited").length;
  const none = input.evidence.filter((item) => !item.assuranceLevel || item.assuranceLevel === "none").length;
  const rows = input.run.caseRuns.map((caseRun) => {
    const evidence = evidenceByCase.get(caseRun.executableCaseId);
    const assurance = evidence?.assuranceLevel ?? "none";
    const artifacts = evidence?.artifactPaths ?? [];
    const warnings = evidence?.evidenceWarnings ?? [];
    const reason = evidence?.actualResult ?? caseRun.error ?? (caseRun.status === "queued" ? "Not executed" : "");
    return `<tr class="searchable-row"><td>${caseRun.order}</td><td>${escapeHtml(caseRun.title)}</td><td class="${caseRun.status}">${escapeHtml(caseRun.status)}</td><td>${escapeHtml(assurance)}</td><td>${escapeHtml(reason)}</td><td>${escapeHtml(warnings.join("; "))}</td><td>${escapeHtml(artifacts.join(", "))}</td></tr>`;
  }).join("");
  const bugs = (input.bugs ?? []).map((bug) => `<li class="searchable-row">${escapeHtml(bug.id)} ${escapeHtml(bug.status)}: ${escapeHtml(bug.actualResult)}</li>`).join("") || "<li class=muted>None</li>";
  const gaps = (input.gaps ?? []).map((gap) => `<li class="searchable-row">${escapeHtml(gap.id)} ${escapeHtml(gap.status)}: ${escapeHtml(gap.reason)}</li>`).join("") || "<li class=muted>None</li>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title><style>body{font:14px system-ui,sans-serif;max-width:1400px;margin:2rem auto;padding:0 1rem;color:#17202a}header{border-bottom:1px solid #ddd;margin-bottom:1rem}input{width:100%;padding:.6rem;margin:1rem 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:.5rem;text-align:left;vertical-align:top}.passed{color:#087f5b}.failed{color:#c92a2a}.blocked{color:#a15c00}.muted{color:#667085}</style></head><body><header><h1>${escapeHtml(input.title)}</h1><p>Status: <strong class="${input.run.status}">${escapeHtml(input.run.status)}</strong> | Total: ${input.run.total} | Passed: ${input.run.passed} | Failed: ${input.run.failed} | Blocked: ${input.run.blocked}</p><p>Assurance: <strong>strong ${strong}</strong> | limited ${limited} | none ${none}</p><p>Run: ${escapeHtml(input.run.id)} | System: ${escapeHtml(input.run.systemId)} | Requirement project: ${escapeHtml(input.run.knowledgeProjectId)}</p></header><label for="search">Search report</label><input id="search" type="search" placeholder="case, status, evidence" oninput="filterReport(this.value)"><h2>Cases</h2><table><thead><tr><th>#</th><th>Case</th><th>Status</th><th>Assurance</th><th>Actual result / not executed reason</th><th>Evidence warnings</th><th>Artifacts</th></tr></thead><tbody>${rows || "<tr><td colspan=7 class=muted>No cases</td></tr>"}</tbody></table><h2>BugReports</h2><ul>${bugs}</ul><h2>Gaps</h2><ul>${gaps}</ul><script>function filterReport(q){q=q.toLowerCase();document.querySelectorAll('.searchable-row').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q))}</script></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
