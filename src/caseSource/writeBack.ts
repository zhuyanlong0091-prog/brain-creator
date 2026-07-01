import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import AdmZip from "adm-zip";
import type { BugReport, CaseSuiteCaseResult, DocumentCase } from "../domain/types.js";

export type XlsxWriteBackInput = {
  source: string;
  cases: DocumentCase[];
  results: CaseSuiteCaseResult[];
  bugs: BugReport[];
};

export async function writeXlsxCaseSourceResults(input: XlsxWriteBackInput) {
  if (!isLocalXlsx(input.source)) {
    return {
      status: "unsupported",
      source: input.source,
      updatedRows: 0,
      reason: "Write-back currently supports local .xlsx case sources only."
    };
  }

  const buffer = await readFile(input.source);
  const zip = new AdmZip(buffer);
  const sharedStrings = readSharedStrings(zip);
  const sheetPath = worksheetPath(zip);
  let sheet = textEntry(zip, sheetPath);
  const header = findHeader(sheet, sharedStrings);
  const columns = {
    actualResult: header.columns.get("实际结果"),
    status: header.columns.get("用例状态"),
    bugId: header.columns.get("BugID")
  };
  if (
    columns.actualResult === undefined ||
    columns.status === undefined ||
    columns.bugId === undefined
  ) {
    return {
      status: "unsupported",
      source: input.source,
      updatedRows: 0,
      reason: "Case source is missing actual result, status, or BugID columns."
    };
  }

  const casesByNo = new Map(input.cases.map((item) => [item.caseNo, item]));
  const bugsByCaseNo = new Map(input.bugs.map((bug) => [bug.caseNo, bug]));
  let updatedRows = 0;
  const skippedCaseNos: string[] = [];
  for (const result of input.results) {
    const documentCase = casesByNo.get(result.caseNo);
    if (!documentCase) {
      skippedCaseNos.push(result.caseNo);
      continue;
    }
    const bug = result.bugReportId
      ? input.bugs.find((item) => item.id === result.bugReportId)
      : bugsByCaseNo.get(result.caseNo);
    sheet = setCellValue(sheet, documentCase.sourceRow, columns.actualResult, writeBackActualResult(result, bug));
    sheet = setCellValue(sheet, documentCase.sourceRow, columns.status, writeBackStatus(result.status));
    sheet = setCellValue(sheet, documentCase.sourceRow, columns.bugId, bug?.id ?? "");
    updatedRows += 1;
  }

  zip.updateFile(sheetPath, Buffer.from(sheet, "utf8"));
  await writeFile(input.source, zip.toBuffer());
  return {
    status: "written",
    source: input.source,
    updatedRows,
    skippedCaseNos
  };
}

function isLocalXlsx(source: string) {
  const trimmed = source.trim();
  return !/^(obsidian|claudian):/i.test(trimmed) && !/^\[\[.+\]\]$/.test(trimmed) && extname(trimmed).toLowerCase() === ".xlsx";
}

function worksheetPath(zip: AdmZip) {
  const workbook = textEntry(zip, "xl/workbook.xml");
  const sheetNames = [...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"/g)].map((item) =>
    decodeXml(item[1] ?? "")
  );
  const sheetIndex = Math.max(0, sheetNames.findIndex((item) => item.includes("测试用例")));
  return `xl/worksheets/sheet${sheetIndex + 1}.xml`;
}

function findHeader(sheet: string, sharedStrings: string[]) {
  for (const row of readSheetRows(sheet, sharedStrings)) {
    if (["用例编号", "用例标题", "实际结果", "用例状态", "BugID"].every((name) => row.values.includes(name))) {
      return {
        rowNumber: row.rowNumber,
        columns: new Map(row.values.map((value, index) => [value.trim(), index]))
      };
    }
  }
  throw new Error("Case source is missing the expected test case header row.");
}

function readSheetRows(sheet: string, sharedStrings: string[]) {
  const rows: Array<{ rowNumber: number; values: string[] }> = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
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
    rows.push({ rowNumber, values: values.map((item) => item ?? "") });
  }
  return rows;
}

function setCellValue(sheet: string, rowNumber: number, columnIndexValue: number, value: string) {
  const cellRef = `${columnName(columnIndexValue)}${rowNumber}`;
  const escaped = escapeXml(value);
  const cellXml = `<c r="${cellRef}" t="inlineStr"><is><t>${escaped}</t></is></c>`;
  return sheet.replace(
    new RegExp(`(<row\\b[^>]*\\br="${rowNumber}"[^>]*>)([\\s\\S]*?)(<\\/row>)`),
    (_match, open: string, body: string, close: string) => {
      const existing = new RegExp(`<c\\b[^>]*\\br="${cellRef}"[^>]*>[\\s\\S]*?<\\/c>`);
      const nextBody = existing.test(body) ? body.replace(existing, cellXml) : `${body}${cellXml}`;
      return `${open}${nextBody}${close}`;
    }
  );
}

function writeBackActualResult(result: CaseSuiteCaseResult, bug?: BugReport) {
  if (result.status === "passed") {
    return "通过";
  }
  return result.error || bug?.actualResult || result.status;
}

function writeBackStatus(status: CaseSuiteCaseResult["status"]) {
  if (status === "passed") {
    return "通过";
  }
  if (status === "failed") {
    return "失败";
  }
  return "阻塞";
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

function columnIndex(cellRef: string) {
  const letters = /^[A-Z]+/.exec(cellRef)?.[0] ?? "A";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function columnName(index: number) {
  let value = "";
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) {
    value = String.fromCharCode(((current - 1) % 26) + 65) + value;
  }
  return value;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
