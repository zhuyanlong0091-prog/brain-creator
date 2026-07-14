import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import AdmZip from "adm-zip";
import type { CaseSource, DocumentCase } from "../domain/types.js";

export type ParsedCaseSource = {
  source: string;
  sourceType: CaseSource["sourceType"];
  contentHash: string;
  cases: DocumentCase[];
  moduleStats: Record<string, number>;
  priorityStats: Record<string, number>;
  warnings: string[];
  sampleCases: DocumentCase[];
};

type SourceReference = {
  source: string;
  filePath: string;
  sourceTypeOverride?: CaseSource["sourceType"];
};

const requiredHeaders = [
  "用例编号",
  "用例标题",
  "所属模块",
  "前置条件",
  "操作步骤",
  "预期结果",
  "优先级"
];

export async function parseCaseSource(source: string): Promise<ParsedCaseSource> {
  const reference = resolveSourceReference(source);
  const buffer = await readFile(reference.filePath);
  const sourceType = inferSourceType(reference.filePath, reference.sourceTypeOverride);
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  if (sourceType === "xlsx" || extname(reference.filePath).toLowerCase() === ".xlsx") {
    return parseXlsxCaseSource(reference.source, buffer, contentHash, sourceType);
  }
  if (sourceType === "markdown" || sourceType === "obsidian" || sourceType === "claudian") {
    return parseMarkdownCaseSource(reference.source, buffer.toString("utf8"), contentHash, sourceType);
  }
  throw new Error("Unsupported case source type. Use .xlsx or .md.");
}

export function summarizeDocumentCases(cases: DocumentCase[]) {
  return {
    total: cases.length,
    moduleStats: countBy(cases, (item) => item.module || "未分组"),
    priorityStats: countBy(cases, (item) => item.priority || "未标记")
  };
}

function parseXlsxCaseSource(
  source: string,
  buffer: Buffer,
  contentHash: string,
  sourceType: CaseSource["sourceType"] = "xlsx"
): ParsedCaseSource {
  const zip = new AdmZip(buffer);
  const sharedStrings = readSharedStrings(zip);
  const workbook = textEntry(zip, "xl/workbook.xml");
  const sheetNames = [...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"/g)].map((item) =>
    decodeXml(item[1] ?? "")
  );
  const sheetIndex = Math.max(0, sheetNames.findIndex((item) => item.includes("测试用例")));
  const sheetPath = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
  const sheet = textEntry(zip, sheetPath);
  const rows = readRows(sheet, sharedStrings);
  const headerIndex = rows.findIndex((row) => requiredHeaders.every((header) => row.includes(header)));
  if (headerIndex < 0) {
    throw new Error("Case source is missing the expected test case header row.");
  }

  const header = rows[headerIndex];
  const headerMap = new Map(header.map((name, index) => [name.trim(), index]));
  const warnings = requiredHeaders
    .filter((name) => !headerMap.has(name))
    .map((name) => `Missing required column: ${name}`);
  const cases = rows
    .slice(headerIndex + 1)
    .map((row, index) => rowToDocumentCase(row, headerMap, headerIndex + index + 2))
    .filter((item): item is DocumentCase => item !== undefined);

  const stats = summarizeDocumentCases(cases);
  return {
    source,
    sourceType,
    contentHash,
    cases,
    moduleStats: stats.moduleStats,
    priorityStats: stats.priorityStats,
    warnings,
    sampleCases: cases.slice(0, 5)
  };
}

function parseMarkdownCaseSource(
  source: string,
  content: string,
  contentHash: string,
  sourceType: CaseSource["sourceType"]
): ParsedCaseSource {
  const tableRows = content
    .split(/\r?\n/)
    .map((line, index) => ({ line, sourceRow: index + 1 }))
    .filter((item) => item.line.trim().startsWith("|"))
    .map((item) => ({ ...item, row: parseMarkdownTableRow(item.line) }));
  const warnings: string[] = [];
  const headerIndex = tableRows.findIndex((item) =>
    requiredHeaders.every((header) => item.row.includes(header))
  );
  if (headerIndex < 0) {
    warnings.push("Markdown source does not include an executable case table.");
  }
  const header = headerIndex >= 0 ? tableRows[headerIndex].row : [];
  const headerMap = new Map(header.map((name, index) => [name.trim(), index]));
  const cases =
    headerIndex >= 0
      ? tableRows
          .slice(headerIndex + 1)
          .filter((item) => !isMarkdownSeparatorRow(item.row))
          .map((item) => rowToDocumentCase(item.row, headerMap, item.sourceRow))
          .filter((item): item is DocumentCase => item !== undefined)
      : [];
  const stats = summarizeDocumentCases(cases);
  return {
    source,
    sourceType,
    contentHash,
    cases,
    moduleStats: stats.moduleStats,
    priorityStats: stats.priorityStats,
    warnings,
    sampleCases: cases.slice(0, 5)
  };
}

function readSharedStrings(zip: AdmZip) {
  const entry = zip.getEntry("xl/sharedStrings.xml");
  if (!entry) {
    return [];
  }
  const xml = entry.getData().toString("utf8");
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    [...(match[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXml(textMatch[1] ?? ""))
      .join("")
  );
}

function readRows(sheetXml: string, sharedStrings: string[]) {
  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(attr(rowMatch[1] ?? "", "r")) || rows.length + 1;
    const values: string[] = [];
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] ?? "";
      const cellRef = attr(attrs, "r");
      const type = attr(attrs, "t");
      const column = columnIndex(cellRef);
      const rawValue = firstMatch(cellMatch[2] ?? "", /<v>([\s\S]*?)<\/v>/);
      const inlineValue = firstMatch(cellMatch[2] ?? "", /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
      values[column] =
        type === "s"
          ? sharedStrings[Number(rawValue)] ?? ""
          : decodeXml(inlineValue || rawValue || "");
    }
    rows[rowNumber - 1] = values.map((item) => item ?? "");
  }
  return rows.filter(Boolean);
}

function rowToDocumentCase(
  row: string[],
  headerMap: Map<string, number>,
  sourceRow: number
): DocumentCase | undefined {
  const caseNo = value(row, headerMap, "用例编号");
  const title = value(row, headerMap, "用例标题");
  if (!caseNo || !title) {
    return undefined;
  }
  return {
    caseNo,
    title,
    module: value(row, headerMap, "所属模块"),
    precondition: normalizeCellText(value(row, headerMap, "前置条件")),
    steps: splitSteps(value(row, headerMap, "操作步骤")),
    expectedResult: normalizeCellText(value(row, headerMap, "预期结果")),
    actualResult: normalizeCellText(value(row, headerMap, "实际结果")) || undefined,
    priority: value(row, headerMap, "优先级"),
    status: value(row, headerMap, "用例状态") || undefined,
    bugId: value(row, headerMap, "BugID") || undefined,
    remark: normalizeCellText(value(row, headerMap, "备注")) || undefined,
    sourceRow
  };
}

function splitSteps(value: string) {
  return normalizeCellText(value)
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*\d+[.、)]\s*/, "").trim())
    .filter(Boolean);
}

function normalizeCellText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&#(?:10|x0*a);/gi, "\n")
    .replace(/&#(?:13|x0*d);/gi, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function parseMarkdownTableRow(line: string) {
  return line
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isMarkdownSeparatorRow(row: string[]) {
  return row.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function resolveSourceReference(source: string): SourceReference {
  const trimmed = source.trim();
  const prefixed = /^(obsidian|claudian):(.+)$/i.exec(trimmed);
  if (prefixed) {
    return {
      source: trimmed,
      filePath: prefixed[2]!.trim(),
      sourceTypeOverride: prefixed[1]!.toLowerCase() as CaseSource["sourceType"]
    };
  }
  const wiki = /^\[\[(.+)\]\]$/.exec(trimmed);
  if (wiki) {
    return {
      source: trimmed,
      filePath: wiki[1]!.trim(),
      sourceTypeOverride: "obsidian"
    };
  }
  return { source: trimmed, filePath: trimmed };
}

function inferSourceType(
  source: string,
  override?: CaseSource["sourceType"]
): CaseSource["sourceType"] {
  if (override) {
    return override;
  }
  const ext = extname(source).toLowerCase();
  if (ext === ".xlsx") {
    return "xlsx";
  }
  if (ext === ".md" || ext === ".markdown") {
    return source.includes("[[") ? "obsidian" : "markdown";
  }
  return "unknown";
}

function textEntry(zip: AdmZip, path: string) {
  const entry = zip.getEntry(path);
  if (!entry) {
    throw new Error(`XLSX entry not found: ${path}`);
  }
  return entry.getData().toString("utf8");
}

function attr(value: string, name: string) {
  return firstMatch(value, new RegExp(`${name}="([^"]*)"`));
}

function firstMatch(value: string, pattern: RegExp) {
  return pattern.exec(value)?.[1] ?? "";
}

function value(row: string[], headerMap: Map<string, number>, key: string) {
  const index = headerMap.get(key);
  return index === undefined ? "" : (row[index] ?? "").trim();
}

function columnIndex(cellRef: string) {
  const letters = /^[A-Z]+/.exec(cellRef)?.[0] ?? "A";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function countBy(items: DocumentCase[], getKey: (item: DocumentCase) => string) {
  return items.reduce<Record<string, number>>((result, item) => {
    const key = getKey(item);
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}
