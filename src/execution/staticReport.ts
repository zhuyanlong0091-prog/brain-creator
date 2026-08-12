import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AssuranceLevel, ExecutionEvidence } from "../domain/types.js";

export async function writeStaticExecutionReport(input: {
  outputPath: string;
  title: string;
  evidence: ExecutionEvidence;
  bugReports?: Array<{ id: string; status: string; actualResult: string }>;
  gaps?: Array<{ id: string; status: string; reason: string }>;
}) {
  const html = renderStaticExecutionReport(input);
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, html, "utf8");
  return input.outputPath;
}

export function renderStaticExecutionReport(input: {
  title: string;
  evidence: ExecutionEvidence;
  bugReports?: Array<{ id: string; status: string; actualResult: string }>;
  gaps?: Array<{ id: string; status: string; reason: string }>;
}) {
  const evidence = input.evidence;
  const contracts = evidence.assertionContracts ?? [];
  const reporterAssertions = evidence.reporterResult?.assertions ?? [];
  const strong = contracts.filter((contract) => contract.strength === "strong").length;
  const limited = contracts.filter((contract) => contract.strength === "limited").length;
  const searchable = [input.title, evidence.actualResult, ...evidence.steps.map((step) => step.instruction)].join(" ");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>body{font:14px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#17202a}header{border-bottom:1px solid #ddd;margin-bottom:1rem}input{width:100%;padding:.6rem;margin:1rem 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:.5rem;text-align:left;vertical-align:top}.passed{color:#087f5b}.failed{color:#c92a2a}.blocked{color:#a15c00}.muted{color:#667085}</style></head>
<body data-searchable="${escapeHtml(searchable)}"><header><h1>${escapeHtml(input.title)}</h1><p>Status: <strong class="${evidence.status}">${escapeHtml(evidence.status)}</strong> | Assurance: <strong>${escapeHtml(evidence.assuranceLevel ?? "none")}</strong></p><p>Strong assertions: ${strong} | Limited assertions: ${limited}</p></header>
<label for="search">Search report</label><input id="search" type="search" placeholder="step, assertion, evidence" oninput="filterReport(this.value)">
<h2>Steps</h2><table id="steps"><thead><tr><th>#</th><th>Action</th><th>Instruction</th><th>Expected</th><th>Actual</th><th>Status</th><th>Screenshot</th><th>Evidence</th><th>Trace</th><th>Console</th><th>Network</th></tr></thead><tbody>${evidence.steps.map((step) => { const runtime = evidence.reporterResult?.steps?.find((item) => item.id === step.stepId); return `<tr class="searchable-row"><td>${step.order}</td><td>${escapeHtml(step.action)}</td><td>${escapeHtml(step.instruction)}</td><td>${escapeHtml(step.expected ?? "")}</td><td>${escapeHtml(step.actual ?? "")}</td><td class="${step.assertionStatus}">${escapeHtml(step.assertionStatus)}</td><td>${escapeHtml(step.screenshotPath ?? "")}</td><td>${escapeHtml((step.evidenceRefs ?? []).join(", "))}</td><td>${escapeHtml((step.traceRefs ?? runtime?.traceRefs ?? []).join(", "))}</td><td>${escapeHtml((runtime?.consoleErrors ?? []).join("; "))}</td><td>${escapeHtml((runtime?.networkFailures ?? []).join("; "))}</td></tr>`; }).join("")}</tbody></table>
<h2>Assertions</h2><ul>${contracts.map((contract) => `<li class="searchable-row">${escapeHtml(contract.type)} / ${escapeHtml(contract.strength)} / refs: ${escapeHtml(contract.requirementRefs.join(", "))}</li>`).join("") || "<li class=muted>No assertion contract</li>"}</ul>
<h2>Coverage dimensions</h2><p>Required: ${escapeHtml((evidence.coverage?.required ?? []).join(", ") || "not declared")}; Verified: ${escapeHtml((evidence.coverage?.verified ?? []).join(", ") || "none")}; Missing: ${escapeHtml((evidence.coverage?.missing ?? []).join(", ") || "none")}</p>
<h2>Structured Reporter</h2><p>${evidence.reporterResult ? `Status: ${escapeHtml(evidence.reporterResult.status)}; ${evidence.reporterResult.passed}/${evidence.reporterResult.total} passed; ${evidence.reporterResult.skipped} skipped` : "No structured reporter result; assurance is not strong."}</p><table><thead><tr><th>Assertion</th><th>Status</th><th>Expected</th><th>Actual</th><th>Evidence</th></tr></thead><tbody>${reporterAssertions.map((assertion) => `<tr class="searchable-row"><td>${escapeHtml(assertion.id)}</td><td class="${assertion.status}">${escapeHtml(assertion.status)}</td><td>${escapeHtml(assertion.expected ?? "")}</td><td>${escapeHtml(assertion.actual ?? "")}</td><td>${escapeHtml(assertion.evidenceRefs.join(", "))}</td></tr>`).join("") || "<tr><td colspan=5 class=muted>No reporter assertions</td></tr>"}</tbody></table>
<h2>Evidence warnings</h2><ul>${(evidence.evidenceWarnings ?? []).map((warning) => `<li class="searchable-row">${escapeHtml(warning)}</li>`).join("") || "<li class=muted>None</li>"}</ul>
<h2>Actor Journey</h2><p>${evidence.actorJourney?.length ? `${evidence.actorJourney.length} declared role(s); role evidence is recorded without credentials.` : "Single-role or host-managed execution."}</p><ul>${(evidence.actorJourney ?? []).map((actor) => `<li class="searchable-row">${actor.order}: ${escapeHtml(actor.role)} after ${escapeHtml(actor.afterStepId ?? "start")}</li>`).join("") || "<li class=muted>No role transitions</li>"}</ul>
<h2>Runtime impact</h2><p>Console errors: ${evidence.consoleErrors.length}; Network failures: ${evidence.networkFailures.length}</p><ul>${[...evidence.tracePaths, ...evidence.artifactPaths].map((path) => `<li>${escapeHtml(path)}</li>`).join("")}</ul>
<h2>BugReports</h2><ul>${(input.bugReports ?? []).map((bug) => `<li class="searchable-row">${escapeHtml(bug.id)}: ${escapeHtml(bug.status)} - ${escapeHtml(bug.actualResult)}</li>`).join("") || "<li class=muted>None</li>"}</ul>
<h2>Gaps</h2><ul>${(input.gaps ?? []).map((gap) => `<li class="searchable-row">${escapeHtml(gap.id)}: ${escapeHtml(gap.status)} - ${escapeHtml(gap.reason)}</li>`).join("") || "<li class=muted>None</li>"}</ul>
<script>function filterReport(q){q=q.toLowerCase();document.querySelectorAll('.searchable-row').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q))}</script></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function assuranceLabel(level: AssuranceLevel) {
  return level === "strong" ? "strong" : level === "limited" ? "limited" : "none";
}
