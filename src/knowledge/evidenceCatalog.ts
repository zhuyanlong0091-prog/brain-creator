import { createHash } from "node:crypto";
import type { AttachmentAnalysis, RequirementSource, TestIntent } from "../domain/types.js";
import type { BusinessScenario } from "../brain/types.js";
import type { RequirementAnalysis } from "./policies.js";

export type EvidenceReference = {
  id: string;
  rawRef: string;
  sourceType: string;
  location: string;
  summary: string;
  contentHash?: string;
  relatedAssetIds: string[];
  relatedLabels: string[];
};

export type EvidenceCatalog = {
  entries: EvidenceReference[];
  byRawRef: Map<string, EvidenceReference>;
};

export type EvidenceCatalogInput = {
  source: RequirementSource;
  analysis: RequirementAnalysis;
  intents: TestIntent[];
  businessScenarios?: BusinessScenario[];
  attachmentAnalyses?: AttachmentAnalysis[];
  workflowModels?: Array<{ id: string; title: string; sourceRefs: string[] }>;
  stateMachineModels?: Array<{ id: string; title: string; sourceRefs: string[] }>;
  businessObjectModels?: Array<{ id: string; name: string; sourceRefs: string[] }>;
  decisionTableModels?: Array<{ id: string; title: string; sourceRefs: string[] }>;
  additionalTexts?: string[];
};

type EvidenceCandidate = {
  rawRef: string;
  sourceType: string;
  location: string;
  summary?: string;
  contentHash?: string;
  relatedAssetIds: Set<string>;
  relatedLabels: Set<string>;
};

const prefixOrder = ["REQ", "TAB", "IMG", "SYS", "RUN", "EVD"];

export function buildEvidenceCatalog(input: EvidenceCatalogInput): EvidenceCatalog {
  const candidates = new Map<string, EvidenceCandidate>();
  const add = (rawRef: string, details: Omit<EvidenceCandidate, "rawRef">) => {
    if (!rawRef) return;
    const existing = candidates.get(rawRef);
    if (!existing) {
      candidates.set(rawRef, { rawRef, ...details });
      return;
    }
    existing.summary ||= details.summary;
    existing.contentHash ||= details.contentHash;
    for (const id of details.relatedAssetIds) existing.relatedAssetIds.add(id);
    for (const label of details.relatedLabels) existing.relatedLabels.add(label);
  };

  const sourceDetails = (rawRef: string, summary?: string): Omit<EvidenceCandidate, "rawRef"> => ({
    sourceType: sourceTypeLabel(input.source.sourceType),
    location: sourceLocation(rawRef, input.source),
    summary: summary ?? sourceExcerpt(rawRef, input.source),
    contentHash: input.source.contentHash,
    relatedAssetIds: new Set(),
    relatedLabels: new Set()
  });

  for (const clause of input.analysis.clauses) {
    for (const rawRef of clauseRefs(clause.sourceRefs, clause.sourceRef)) {
      add(rawRef, sourceDetails(rawRef, clause.text));
      addRelation(candidates, rawRef, clause.id, `需求条款 ${clause.index}`);
    }
  }
  input.analysis.nodes.forEach((node, index) => {
    for (const rawRef of node.sourceRefs) {
      add(rawRef, sourceDetails(rawRef, node.content));
      addRelation(candidates, rawRef, `knowledge-${index + 1}`, assetLabel("业务知识", node.title));
    }
  });
  input.intents.forEach((intent) => {
    for (const rawRef of intent.requirementRefs) {
      add(rawRef, sourceDetails(rawRef, intent.objective));
      addRelation(candidates, rawRef, intent.id, assetLabel("测试意图", intent.title));
    }
    const intentLabel = assetLabel("测试意图", intent.title);
    addRelations(candidates, intent.processModelRefs ?? [], intent.id, intentLabel);
    addRelations(candidates, intent.scenarioIds ?? [], intent.id, intentLabel);
    addRelations(candidates, intent.producesEntityRefs ?? [], intent.id, intentLabel);
    addRelations(candidates, intent.consumesEntityRefs ?? [], intent.id, intentLabel);
  });
  for (const scenario of input.businessScenarios ?? []) {
    for (const rawRef of scenario.sourceRefs) {
      add(rawRef, sourceDetails(rawRef, scenario.objective));
      addRelation(candidates, rawRef, scenario.id, assetLabel("业务场景", scenario.title));
    }
    const scenarioLabel = assetLabel("业务场景", scenario.title);
    addRelations(candidates, scenario.workflowRefs, scenario.id, scenarioLabel);
    addRelations(candidates, scenario.stateTransitionRefs, scenario.id, scenarioLabel);
    addRelations(candidates, scenario.decisionRuleRefs, scenario.id, scenarioLabel);
  }
  for (const text of input.additionalTexts ?? []) {
    for (const rawRef of extractEvidenceRefs(text)) {
      add(rawRef, sourceDetails(rawRef, text));
    }
  }
  for (const model of input.workflowModels ?? []) addModel(candidates, model.sourceRefs, model.id, assetLabel("业务流程", model.title), sourceDetails);
  for (const model of input.stateMachineModels ?? []) addModel(candidates, model.sourceRefs, model.id, assetLabel("状态模型", model.title), sourceDetails);
  for (const model of input.businessObjectModels ?? []) addModel(candidates, model.sourceRefs, model.id, assetLabel("业务对象", model.name), sourceDetails);
  for (const model of input.decisionTableModels ?? []) addModel(candidates, model.sourceRefs, model.id, assetLabel("决策表", model.title), sourceDetails);

  for (const analysis of input.attachmentAnalyses ?? []) {
    const contentHash = hash(JSON.stringify({ markdown: analysis.markdown, nodes: analysis.nodes, edges: analysis.edges }));
    for (const rawRef of analysis.sourceRefs) {
      const details = attachmentDetails(rawRef, analysis, contentHash);
      add(rawRef, details);
      addRelation(candidates, rawRef, analysis.id, `附件分析：${attachmentKindLabel(analysis.kind)}`);
    }
    analysis.edges.forEach((edge, index) => {
      const rawRef = `${analysis.id}#edge:${index + 1}`;
      add(rawRef, attachmentDetails(rawRef, analysis, contentHash, edgeSummary(analysis, edge)));
      addRelation(candidates, rawRef, analysis.id, `附件分析：${attachmentKindLabel(analysis.kind)}`);
    });
    analysis.markdown.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      const rawRef = `${analysis.id}#row:${index + 1}`;
      add(rawRef, attachmentDetails(rawRef, analysis, contentHash, line));
      addRelation(candidates, rawRef, analysis.id, `附件分析：${attachmentKindLabel(analysis.kind)}`);
    });
  }

  const grouped = new Map<string, EvidenceCandidate[]>();
  for (const candidate of candidates.values()) {
    const prefix = evidencePrefix(candidate.rawRef);
    (grouped.get(prefix) ?? grouped.set(prefix, []).get(prefix)!).push(candidate);
  }
  const entries: EvidenceReference[] = [];
  for (const prefix of prefixOrder) {
    const items = (grouped.get(prefix) ?? []).sort(compareCandidates);
    items.forEach((candidate, index) => {
      entries.push({
        id: `${prefix}-${String(index + 1).padStart(3, "0")}`,
        rawRef: candidate.rawRef,
        sourceType: candidate.sourceType,
        location: candidate.location,
        summary: compact(candidate.summary || "待补充原始证据"),
        contentHash: candidate.contentHash,
        relatedAssetIds: [...candidate.relatedAssetIds].sort(),
        relatedLabels: [...candidate.relatedLabels].sort()
      });
    });
  }
  const byRawRef = new Map(entries.map((entry) => [entry.rawRef, entry]));
  return { entries, byRawRef };
}

export function renderEvidenceIndex(input: { title: string; fallbackTitle?: string; requirementSetId: string; catalog: EvidenceCatalog }) {
  const lines = [
    "---",
    `requirement_set_id: ${input.requirementSetId}`,
    "type: evidence-index",
    "---",
    "",
    `# ${readableTitle(input.title, input.fallbackTitle)}：证据索引`,
    "",
    "> 本索引把审核文档中的短证据编号映射回需求正文、表格和图片分析结果。完整原文仍保留在同目录的 `source.md`，本页只展示便于审核的摘要。",
    "",
    "| 证据编号 | 来源类型 | 原始位置 | 内容摘要 | 关联内容 |",
    "| --- | --- | --- | --- | --- |",
    ...(input.catalog.entries.length > 0
      ? input.catalog.entries.map((entry) => `| [${entry.id}](#${entry.id.toLowerCase()}) | ${mdCell(entry.sourceType)} | ${locationLink(entry.location)} | ${mdCell(entry.summary)} | ${mdCell(relatedLabelSummary(entry))} |`)
      : ["| - | - | - | 暂无证据 | - |"]),
    "",
    "## 证据详情",
    "",
    ...(input.catalog.entries.length > 0
      ? input.catalog.entries.flatMap((entry) => [
          `### ${entry.id}`,
          `- **来源类型**：${entry.sourceType}`,
          `- **原始位置**：${locationLink(entry.location)}`,
          `- **内容摘要**：${entry.summary}`,
          `- **内容哈希**：${entry.contentHash ?? "未提供"}`,
          `- **关联内容**：${relatedLabelSummary(entry)}`,
          ""
        ])
      : ["- 暂无证据详情。", ""])
  ];
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

export function evidenceLink(rawRef: string, catalog?: EvidenceCatalog) {
  const entry = catalog?.byRawRef.get(rawRef);
  return entry ? `[${entry.id}](evidence-index.md#${entry.id.toLowerCase()})` : "待补充证据";
}

export function evidenceLinks(rawRefs: string[], catalog?: EvidenceCatalog) {
  const links = [...new Set(rawRefs.filter(Boolean))].map((rawRef) => evidenceLink(rawRef, catalog));
  return links.length > 0 ? links.join("、") : "暂无来源";
}

function addModel(
  candidates: Map<string, EvidenceCandidate>,
  refs: string[],
  assetId: string,
  label: string,
  sourceDetails: (rawRef: string, summary?: string) => Omit<EvidenceCandidate, "rawRef">
) {
  for (const rawRef of refs) {
    addCandidate(candidates, rawRef, sourceDetails(rawRef, label));
    addRelation(candidates, rawRef, assetId, label);
  }
}

function addCandidate(candidates: Map<string, EvidenceCandidate>, rawRef: string, details: Omit<EvidenceCandidate, "rawRef">) {
  const existing = candidates.get(rawRef);
  if (!existing) {
    candidates.set(rawRef, { rawRef, ...details });
    return;
  }
  existing.summary ||= details.summary;
  existing.contentHash ||= details.contentHash;
  for (const id of details.relatedAssetIds) existing.relatedAssetIds.add(id);
  for (const label of details.relatedLabels) existing.relatedLabels.add(label);
}

function addRelation(candidates: Map<string, EvidenceCandidate>, rawRef: string, assetId: string, label: string) {
  const candidate = candidates.get(rawRef);
  if (!candidate) return;
  candidate.relatedAssetIds.add(assetId);
  candidate.relatedLabels.add(label);
}

function addRelations(candidates: Map<string, EvidenceCandidate>, refs: string[], assetId: string, label: string) {
  for (const rawRef of refs) {
    if (!candidates.has(rawRef)) {
      candidates.set(rawRef, {
        rawRef,
        sourceType: "业务模型",
        location: "结构化业务模型",
        summary: label,
        relatedAssetIds: new Set(),
        relatedLabels: new Set()
      });
    }
    addRelation(candidates, rawRef, assetId, label);
  }
}

function attachmentDetails(rawRef: string, analysis: AttachmentAnalysis, contentHash: string, summary?: string): Omit<EvidenceCandidate, "rawRef"> {
  return {
    sourceType: `附件：${attachmentKindLabel(analysis.kind)}`,
    location: attachmentLocation(rawRef),
    summary: summary ?? compact(analysis.markdown.split(/\r?\n/).find(Boolean) || "图片分析结果"),
    contentHash,
    relatedAssetIds: new Set(),
    relatedLabels: new Set()
  };
}

function sourceExcerpt(rawRef: string, source: RequirementSource) {
  const line = sourceLine(rawRef);
  if (line !== undefined) return compact(source.content.split(/\r?\n/)[line - 1] || "");
  return compact(source.content.split(/\r?\n/).find((item) => item.trim()) || "");
}

function sourceLocation(rawRef: string, source: RequirementSource) {
  const line = sourceLine(rawRef);
  if (line !== undefined) return `正文第 ${line} 行`;
  const block = rawRef.match(/#block:([^#]+)/i)?.[1];
  if (block) return `正文块 ${block}`;
  const clause = rawRef.match(/#clause[-:](\d+)/i)?.[1];
  if (clause) return `需求条款 ${clause}`;
  if (rawRef.includes(source.id)) return "需求正文";
  return "结构化需求来源";
}

function attachmentLocation(rawRef: string) {
  const row = rawRef.match(/#row:(\d+)/i)?.[1];
  if (row) return `附件识别结果第 ${row} 行`;
  const edge = rawRef.match(/#edge:(\d+)/i)?.[1];
  if (edge) return `附件识别结果第 ${edge} 条流程关系`;
  return "图片/附件识别结果";
}

function sourceLine(rawRef: string) {
  const line = rawRef.match(/#line:(\d+)/i)?.[1];
  return line ? Number(line) : undefined;
}

function extractEvidenceRefs(value: string) {
  return [...value.matchAll(/(?:source|attachment-analysis):[A-Za-z0-9_-]+(?:#(?:line|block|row|edge|clause):?[A-Za-z0-9_-]+)?/g)].map((match) => match[0]);
}

function clauseRefs(sourceRefs: string[], sourceRef: string) {
  return sourceRefs.length > 0 ? sourceRefs : sourceRef ? [sourceRef] : [];
}

function edgeSummary(analysis: AttachmentAnalysis, edge: AttachmentAnalysis["edges"][number]) {
  const from = analysis.nodes.find((node) => node.id === edge.from)?.label ?? edge.from;
  const to = analysis.nodes.find((node) => node.id === edge.to)?.label ?? edge.to;
  return `${from} → ${to}${edge.condition ? `；条件：${edge.condition}` : ""}${edge.actor ? `；角色：${edge.actor}` : ""}`;
}

function evidencePrefix(rawRef: string) {
  if (/#row:/i.test(rawRef)) return "TAB";
  if (/attachment-analysis|#edge:/i.test(rawRef)) return "IMG";
  if (/^source[:_-]|#line:|#block:|#clause[-:]/i.test(rawRef)) return "REQ";
  if (/^(system|page|probe|locator)/i.test(rawRef)) return "SYS";
  if (/^(run|suite|chain|execution)/i.test(rawRef)) return "RUN";
  return "EVD";
}

function compareCandidates(left: EvidenceCandidate, right: EvidenceCandidate) {
  const leftLine = sourceLine(left.rawRef);
  const rightLine = sourceLine(right.rawRef);
  if (leftLine !== undefined && rightLine !== undefined && leftLine !== rightLine) return leftLine - rightLine;
  return left.rawRef.localeCompare(right.rawRef);
}

function sourceTypeLabel(value: string) {
  return ({ "local-file": "需求正文", http: "网页需求", feishu: "飞书文档", obsidian: "Obsidian 文档", "host-connector": "宿主连接器" } as Record<string, string>)[value] ?? "需求来源";
}

function attachmentKindLabel(value: AttachmentAnalysis["kind"]) {
  return ({ table: "表格", flowchart: "流程图", "state-machine": "状态图", wireframe: "原型图", "text-image": "文字图片", other: "其他图片" })[value];
}

function assetLabel(prefix: string, value: string) {
  const name = value.split(/\s+(?:requirement|workflow|state|rule|field|actor|object|integration|permission|term|module|data-constraint):\s*|:\s*/i)[0];
  const cleaned = compact(name || value).replace(/^(requirement|workflow|state|rule|field|actor|object|integration|permission|term|module|data-constraint):\s*/i, "").replace(/^Requirement\s+(\d+)$/i, "需求条款 $1");
  return `${prefix}：${cleaned}`;
}
function relatedLabelSummary(entry: EvidenceReference) {
  if (entry.relatedLabels.length === 0) return "暂无";
  const labels = entry.relatedLabels.slice(0, 4);
  return `${labels.join("；")}${entry.relatedLabels.length > labels.length ? `；共 ${entry.relatedLabels.length} 项` : ""}`;
}
function locationLink(location: string) { return `[${mdCell(location)}](source.md)`; }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function compact(value: string) { return value.replace(/\s+/g, " ").trim().slice(0, 120); }
function mdCell(value: string) { return compact(value).replace(/\|/g, "\\|"); }
function readableTitle(title: string, fallback = "需求文档") { return /[�\u0000-\u001F]/.test(title) || compact(title).length < 2 ? compact(fallback) : compact(title); }
